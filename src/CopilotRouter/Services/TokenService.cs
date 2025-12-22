namespace CopilotRouter.Services;

/// <summary>
/// Service for managing GitHub and Copilot tokens
/// </summary>
public class TokenService
{
    private readonly AppState _state;
    private readonly PathService _pathService;
    private readonly GitHubService _gitHubService;
    private readonly CopilotService _copilotService;
    private readonly ILogger<TokenService> _logger;
    private Timer? _refreshTimer;

    public TokenService(
        AppState state,
        PathService pathService,
        GitHubService gitHubService,
        CopilotService copilotService,
        ILogger<TokenService> logger)
    {
        _state = state;
        _pathService = pathService;
        _gitHubService = gitHubService;
        _copilotService = copilotService;
        _logger = logger;
    }

    /// <summary>
    /// Setup GitHub token - read from file or perform OAuth flow
    /// </summary>
    public async Task SetupGitHubTokenAsync(bool force = false)
    {
        try
        {
            var existingToken = await _pathService.ReadGitHubTokenAsync();

            if (!string.IsNullOrEmpty(existingToken) && !force)
            {
                _state.GitHubToken = existingToken;
                if (_state.ShowToken)
                {
                    _logger.LogInformation("GitHub token: {Token}", existingToken);
                }
                await LogUserAsync();
                return;
            }

            _logger.LogInformation("Not logged in, getting new access token");
            var deviceCode = await _gitHubService.GetDeviceCodeAsync();
            _logger.LogDebug("Device code response: {Response}", deviceCode);

            _logger.LogInformation(
                "Please enter the code \"{Code}\" in {Uri}",
                deviceCode.UserCode,
                deviceCode.VerificationUri);

            var token = await _gitHubService.PollAccessTokenAsync(deviceCode);
            await _pathService.WriteGitHubTokenAsync(token);
            _state.GitHubToken = token;

            if (_state.ShowToken)
            {
                _logger.LogInformation("GitHub token: {Token}", token);
            }
            await LogUserAsync();
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "Failed to get GitHub token");
            throw;
        }
    }

    /// <summary>
    /// Setup Copilot token and configure auto-refresh
    /// </summary>
    public async Task SetupCopilotTokenAsync()
    {
        var tokenResponse = await _copilotService.GetCopilotTokenAsync();
        _state.CopilotToken = tokenResponse.Token;

        _logger.LogDebug("GitHub Copilot Token fetched successfully!");
        if (_state.ShowToken)
        {
            _logger.LogInformation("Copilot token: {Token}", tokenResponse.Token);
        }

        // Setup auto-refresh
        var refreshInterval = TimeSpan.FromSeconds(tokenResponse.RefreshIn - 60);
        _refreshTimer = new Timer(async _ =>
        {
            try
            {
                _logger.LogDebug("Refreshing Copilot token");
                var newToken = await _copilotService.GetCopilotTokenAsync();
                _state.CopilotToken = newToken.Token;
                _logger.LogDebug("Copilot token refreshed");

                if (_state.ShowToken)
                {
                    _logger.LogInformation("Refreshed Copilot token: {Token}", newToken.Token);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to refresh Copilot token");
            }
        }, null, refreshInterval, refreshInterval);
    }

    private async Task LogUserAsync()
    {
        var user = await _gitHubService.GetUserAsync();
        _logger.LogInformation("Logged in as {Login}", user.Login);
    }
}
