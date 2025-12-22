using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CopilotRouter.Services;

/// <summary>
/// Service for interacting with GitHub Copilot API
/// </summary>
public class CopilotService
{
    private readonly HttpClient _httpClient;
    private readonly AppState _state;
    private readonly ILogger<CopilotService> _logger;

    private const string CopilotVersion = "0.26.7";
    private const string EditorPluginVersion = $"copilot-chat/{CopilotVersion}";
    private const string UserAgent = $"GitHubCopilotChat/{CopilotVersion}";
    private const string ApiVersion = "2025-04-01";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public CopilotService(HttpClient httpClient, AppState state, ILogger<CopilotService> logger)
    {
        _httpClient = httpClient;
        _state = state;
        _logger = logger;
        
        _httpClient.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        _httpClient.DefaultRequestHeaders.UserAgent.ParseAdd(UserAgent);
    }

    private string CopilotBaseUrl => _state.AccountType == "individual"
        ? "https://api.githubcopilot.com"
        : $"https://api.{_state.AccountType}.githubcopilot.com";

    private string GitHubApiBaseUrl => "https://api.github.com";

    private Dictionary<string, string> GetCopilotHeaders(bool vision = false)
    {
        var headers = new Dictionary<string, string>
        {
            ["Authorization"] = $"Bearer {_state.CopilotToken}",
            ["Content-Type"] = "application/json",
            ["copilot-integration-id"] = "vscode-chat",
            ["editor-version"] = $"vscode/{_state.VSCodeVersion}",
            ["editor-plugin-version"] = EditorPluginVersion,
            ["user-agent"] = UserAgent,
            ["openai-intent"] = "conversation-panel",
            ["x-github-api-version"] = ApiVersion,
            ["x-request-id"] = Guid.NewGuid().ToString(),
            ["x-vscode-user-agent-library-version"] = "electron-fetch"
        };

        if (vision)
        {
            headers["copilot-vision-request"] = "true";
        }

        return headers;
    }

    private Dictionary<string, string> GetGitHubHeaders()
    {
        return new Dictionary<string, string>
        {
            ["Authorization"] = $"token {_state.GitHubToken}",
            ["Content-Type"] = "application/json",
            ["Accept"] = "application/json",
            ["editor-version"] = $"vscode/{_state.VSCodeVersion}",
            ["editor-plugin-version"] = EditorPluginVersion,
            ["user-agent"] = UserAgent,
            ["x-github-api-version"] = ApiVersion,
            ["x-vscode-user-agent-library-version"] = "electron-fetch"
        };
    }

    /// <summary>
    /// Get Copilot token from GitHub
    /// </summary>
    public async Task<CopilotTokenResponse> GetCopilotTokenAsync()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"{GitHubApiBaseUrl}/copilot_internal/v2/token");
        foreach (var header in GetGitHubHeaders())
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<CopilotTokenResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse Copilot token response");
    }

    /// <summary>
    /// Get available models from Copilot
    /// </summary>
    public async Task<ModelsResponse> GetModelsAsync()
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"{CopilotBaseUrl}/models");
        foreach (var header in GetCopilotHeaders())
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<ModelsResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse models response");
    }

    /// <summary>
    /// Get VSCode version from API
    /// </summary>
    public async Task<string> GetVSCodeVersionAsync()
    {
        try
        {
            var response = await _httpClient.GetStringAsync(
                "https://api.github.com/repos/microsoft/vscode/releases/latest");
            var release = JsonSerializer.Deserialize<JsonElement>(response);
            var tagName = release.GetProperty("tag_name").GetString() ?? "1.96.0";
            return tagName;
        }
        catch
        {
            return "1.96.0"; // Fallback version
        }
    }

    /// <summary>
    /// Create chat completions (non-streaming)
    /// </summary>
    public async Task<ChatCompletionResponse> CreateChatCompletionsAsync(ChatCompletionsPayload payload)
    {
        if (string.IsNullOrEmpty(_state.CopilotToken))
            throw new InvalidOperationException("Copilot token not found");

        var enableVision = payload.Messages.Any(m =>
            m.Content is List<ContentPart> parts && parts.Any(p => p.Type == "image_url"));

        var isAgentCall = payload.Messages.Any(m => m.Role is "assistant" or "tool");

        var request = new HttpRequestMessage(HttpMethod.Post, $"{CopilotBaseUrl}/chat/completions")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };

        foreach (var header in GetCopilotHeaders(enableVision))
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        request.Headers.TryAddWithoutValidation("X-Initiator", isAgentCall ? "agent" : "user");

        var response = await _httpClient.SendAsync(request);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<ChatCompletionResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse chat completion response");
    }

    /// <summary>
    /// Create chat completions with streaming
    /// </summary>
    public async IAsyncEnumerable<ChatCompletionChunk> CreateChatCompletionsStreamAsync(
        ChatCompletionsPayload payload,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_state.CopilotToken))
            throw new InvalidOperationException("Copilot token not found");

        payload.Stream = true;

        var enableVision = payload.Messages.Any(m =>
            m.Content is List<ContentPart> parts && parts.Any(p => p.Type == "image_url"));

        var isAgentCall = payload.Messages.Any(m => m.Role is "assistant" or "tool");

        var request = new HttpRequestMessage(HttpMethod.Post, $"{CopilotBaseUrl}/chat/completions")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };

        foreach (var header in GetCopilotHeaders(enableVision))
        {
            request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }
        request.Headers.TryAddWithoutValidation("X-Initiator", isAgentCall ? "agent" : "user");

        var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();

        using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(stream);

        string? line;
        while ((line = await reader.ReadLineAsync(cancellationToken)) != null && !cancellationToken.IsCancellationRequested)
        {
            if (string.IsNullOrEmpty(line))
                continue;

            if (!line.StartsWith("data: "))
                continue;

            var data = line[6..];

            if (data == "[DONE]")
                yield break;

            ChatCompletionChunk? chunk;
            try
            {
                chunk = JsonSerializer.Deserialize<ChatCompletionChunk>(data, JsonOptions);
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex, "Failed to parse SSE chunk: {Data}", data);
                continue;
            }

            if (chunk != null)
                yield return chunk;
        }
    }

    /// <summary>
    /// Create embeddings
    /// </summary>
    public async Task<EmbeddingResponse> CreateEmbeddingsAsync(EmbeddingRequest request)
    {
        if (string.IsNullOrEmpty(_state.CopilotToken))
            throw new InvalidOperationException("Copilot token not found");

        var httpRequest = new HttpRequestMessage(HttpMethod.Post, $"{CopilotBaseUrl}/embeddings")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(request, JsonOptions),
                Encoding.UTF8,
                "application/json")
        };

        foreach (var header in GetCopilotHeaders())
        {
            httpRequest.Headers.TryAddWithoutValidation(header.Key, header.Value);
        }

        var response = await _httpClient.SendAsync(httpRequest);
        response.EnsureSuccessStatusCode();

        var content = await response.Content.ReadAsStringAsync();
        return JsonSerializer.Deserialize<EmbeddingResponse>(content, JsonOptions)
            ?? throw new InvalidOperationException("Failed to parse embedding response");
    }
}

// Token Response
public class CopilotTokenResponse
{
    [JsonPropertyName("token")]
    public required string Token { get; set; }

    [JsonPropertyName("expires_at")]
    public long ExpiresAt { get; set; }

    [JsonPropertyName("refresh_in")]
    public int RefreshIn { get; set; }
}

// Embedding types
public class EmbeddingRequest
{
    [JsonPropertyName("input")]
    public required object Input { get; set; } // string or string[]

    [JsonPropertyName("model")]
    public required string Model { get; set; }
}

public class EmbeddingResponse
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "list";

    [JsonPropertyName("data")]
    public List<EmbeddingData> Data { get; set; } = [];

    [JsonPropertyName("model")]
    public string? Model { get; set; }

    [JsonPropertyName("usage")]
    public EmbeddingUsage? Usage { get; set; }
}

public class EmbeddingData
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "embedding";

    [JsonPropertyName("embedding")]
    public List<float> Embedding { get; set; } = [];

    [JsonPropertyName("index")]
    public int Index { get; set; }
}

public class EmbeddingUsage
{
    [JsonPropertyName("prompt_tokens")]
    public int PromptTokens { get; set; }

    [JsonPropertyName("total_tokens")]
    public int TotalTokens { get; set; }
}
