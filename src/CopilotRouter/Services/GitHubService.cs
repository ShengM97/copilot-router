using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotRouter.Services;

/// <summary>
/// Service for interacting with GitHub APIs (OAuth, user info, etc.)
/// </summary>
public class GitHubService
{
    private readonly HttpClient _httpClient;
    private readonly AppState _state;
    private readonly ILogger<GitHubService> _logger;

    private const string GitHubBaseUrl = "https://github.com";
    private const string GitHubApiBaseUrl = "https://api.github.com";
    private const string GitHubClientId = "Iv1.b507a08c87ecfe98";
    private const string GitHubAppScopes = "read:user";
    private const string UserAgent = "GitHubCopilotChat/0.26.7";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public GitHubService(HttpClient httpClient, AppState state, ILogger<GitHubService> logger)
    {
        _httpClient = httpClient;
        _state = state;
        _logger = logger;
        
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
    }

    /// <summary>
    /// Request a device code for OAuth flow
    /// </summary>
    public async Task<DeviceCodeResponse> GetDeviceCodeAsync()
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"{GitHubBaseUrl}/login/device/code")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { client_id = GitHubClientId, scope = GitHubAppScopes }, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<DeviceCodeResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse device code response");
    }

    /// <summary>
    /// Poll for access token after user authorizes
    /// </summary>
    public async Task<string> PollAccessTokenAsync(DeviceCodeResponse deviceCode)
    {
        var sleepDuration = TimeSpan.FromSeconds(deviceCode.Interval + 1);
        _logger.LogDebug("Polling access token with interval of {Duration}ms", sleepDuration.TotalMilliseconds);

        while (true)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, $"{GitHubBaseUrl}/login/oauth/access_token")
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new
                    {
                        client_id = GitHubClientId,
                        device_code = deviceCode.DeviceCode,
                        grant_type = "urn:ietf:params:oauth:grant-type:device_code"
                    }, JsonOptions),
                    Encoding.UTF8,
                    "application/json")
            };
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var response = await _httpClient.SendAsync(request);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError("Failed to poll access token: {Content}", await response.Content.ReadAsStringAsync());
                await Task.Delay(sleepDuration);
                continue;
            }

            var content = await response.Content.ReadAsStringAsync();
            var tokenResponse = JsonSerializer.Deserialize<AccessTokenResponse>(content, JsonOptions);
            _logger.LogDebug("Polling access token response: {Content}", content);

            if (!string.IsNullOrEmpty(tokenResponse?.AccessToken))
            {
                return tokenResponse.AccessToken;
            }

            await Task.Delay(sleepDuration);
        }
    }

    /// <summary>
    /// Get current authenticated user info
    /// </summary>
    public async Task<GitHubUser> GetUserAsync()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"{GitHubApiBaseUrl}/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("token", _state.GitHubToken);

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<GitHubUser>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse user response");
    }

    /// <summary>
    /// Get Copilot usage/quota information
    /// </summary>
    public async Task<CopilotUsageResponse> GetCopilotUsageAsync()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"{GitHubApiBaseUrl}/copilot_internal/user");
        
        // Add GitHub headers
        request.Headers.Authorization = new AuthenticationHeaderValue("token", _state.GitHubToken);
        request.Headers.TryAddWithoutValidation("editor-version", $"vscode/{_state.VSCodeVersion}");
        request.Headers.TryAddWithoutValidation("editor-plugin-version", "copilot-chat/0.26.7");
        request.Headers.TryAddWithoutValidation("x-github-api-version", "2025-04-01");
        request.Headers.TryAddWithoutValidation("x-vscode-user-agent-library-version", "electron-fetch");

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<CopilotUsageResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse Copilot usage response");
    }
}

public class DeviceCodeResponse
{
    [JsonPropertyName("device_code")]
    public required string DeviceCode { get; set; }

    [JsonPropertyName("user_code")]
    public required string UserCode { get; set; }

    [JsonPropertyName("verification_uri")]
    public required string VerificationUri { get; set; }

    [JsonPropertyName("expires_in")]
    public int ExpiresIn { get; set; }

    [JsonPropertyName("interval")]
    public int Interval { get; set; }
}

public class AccessTokenResponse
{
    [JsonPropertyName("access_token")]
    public string? AccessToken { get; set; }

    [JsonPropertyName("token_type")]
    public string? TokenType { get; set; }

    [JsonPropertyName("scope")]
    public string? Scope { get; set; }
}

public class GitHubUser
{
    [JsonPropertyName("login")]
    public required string Login { get; set; }
}

#region Copilot Usage Types

public class CopilotUsageResponse
{
    [JsonPropertyName("access_type_sku")]
    public string? AccessTypeSku { get; set; }

    [JsonPropertyName("analytics_tracking_id")]
    public string? AnalyticsTrackingId { get; set; }

    [JsonPropertyName("assigned_date")]
    public string? AssignedDate { get; set; }

    [JsonPropertyName("can_signup_for_limited")]
    public bool CanSignupForLimited { get; set; }

    [JsonPropertyName("chat_enabled")]
    public bool ChatEnabled { get; set; }

    [JsonPropertyName("copilot_plan")]
    public string? CopilotPlan { get; set; }

    [JsonPropertyName("organization_login_list")]
    public List<object>? OrganizationLoginList { get; set; }

    [JsonPropertyName("organization_list")]
    public List<object>? OrganizationList { get; set; }

    [JsonPropertyName("quota_reset_date")]
    public string? QuotaResetDate { get; set; }

    [JsonPropertyName("quota_snapshots")]
    public QuotaSnapshots? QuotaSnapshots { get; set; }
}

public class QuotaSnapshots
{
    [JsonPropertyName("chat")]
    public QuotaDetail? Chat { get; set; }

    [JsonPropertyName("completions")]
    public QuotaDetail? Completions { get; set; }

    [JsonPropertyName("premium_interactions")]
    public QuotaDetail? PremiumInteractions { get; set; }
}

public class QuotaDetail
{
    [JsonPropertyName("entitlement")]
    public double Entitlement { get; set; }

    [JsonPropertyName("overage_count")]
    public double OverageCount { get; set; }

    [JsonPropertyName("overage_permitted")]
    public bool OveragePermitted { get; set; }

    [JsonPropertyName("percent_remaining")]
    public double PercentRemaining { get; set; }

    [JsonPropertyName("quota_id")]
    public string? QuotaId { get; set; }

    [JsonPropertyName("quota_remaining")]
    public double QuotaRemaining { get; set; }

    [JsonPropertyName("remaining")]
    public double Remaining { get; set; }

    [JsonPropertyName("unlimited")]
    public bool Unlimited { get; set; }
}

#endregion
