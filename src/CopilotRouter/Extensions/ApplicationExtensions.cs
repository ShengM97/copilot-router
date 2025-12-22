using CopilotRouter.Services;

namespace CopilotRouter.Extensions;

/// <summary>
/// Application initialization extensions
/// </summary>
public static class ApplicationExtensions
{
    /// <summary>
    /// Initialize the application (setup tokens, cache models, etc.)
    /// </summary>
    public static async Task InitializeAsync(this WebApplication app)
    {
        var logger = app.Services.GetRequiredService<ILogger<Program>>();
        var config = app.Configuration;
        var state = app.Services.GetRequiredService<AppState>();
        var pathService = app.Services.GetRequiredService<PathService>();
        var tokenService = app.Services.GetRequiredService<TokenService>();
        var copilotService = app.Services.GetRequiredService<CopilotService>();

        // Apply configuration
        state.AccountType = config.GetValue<string>("AccountType") ?? "individual";
        state.ManualApprove = config.GetValue<bool>("ManualApprove");
        state.RateLimitSeconds = config.GetValue<int?>("RateLimitSeconds");
        state.RateLimitWait = config.GetValue<bool>("RateLimitWait");
        state.ShowToken = config.GetValue<bool>("ShowToken");

        if (state.AccountType != "individual")
        {
            logger.LogInformation("Using {AccountType} plan GitHub account", state.AccountType);
        }

        // Ensure paths exist
        await pathService.EnsurePathsAsync();

        // Get VSCode version
        state.VSCodeVersion = await copilotService.GetVSCodeVersionAsync();
        logger.LogInformation("Using VSCode version: {Version}", state.VSCodeVersion);

        // Setup GitHub token
        var providedToken = config.GetValue<string>("GitHubToken");
        if (!string.IsNullOrEmpty(providedToken))
        {
            state.GitHubToken = providedToken;
            logger.LogInformation("Using provided GitHub token");
        }
        else
        {
            await tokenService.SetupGitHubTokenAsync();
        }

        // Setup Copilot token
        await tokenService.SetupCopilotTokenAsync();

        // Cache models
        state.Models = await copilotService.GetModelsAsync();
        logger.LogInformation("Available models:\n{Models}",
            string.Join("\n", state.Models.Data.Select(m => $"- {m.Id}")));
    }
}
