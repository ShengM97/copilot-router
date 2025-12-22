namespace CopilotRouter.Services;

/// <summary>
/// Service for managing file paths for token storage
/// </summary>
public class PathService
{
    private readonly string _appDir;
    private readonly string _githubTokenPath;

    public PathService()
    {
        var homeDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        _appDir = Path.Combine(homeDir, ".local", "share", "copilot-api");
        _githubTokenPath = Path.Combine(_appDir, "github_token");
    }

    public string AppDir => _appDir;
    public string GitHubTokenPath => _githubTokenPath;

    public async Task EnsurePathsAsync()
    {
        Directory.CreateDirectory(_appDir);
        await EnsureFileAsync(_githubTokenPath);
    }

    private static async Task EnsureFileAsync(string filePath)
    {
        if (!File.Exists(filePath))
        {
            await File.WriteAllTextAsync(filePath, string.Empty);
        }
    }

    public async Task<string?> ReadGitHubTokenAsync()
    {
        if (!File.Exists(_githubTokenPath))
            return null;

        var token = await File.ReadAllTextAsync(_githubTokenPath);
        return string.IsNullOrWhiteSpace(token) ? null : token.Trim();
    }

    public async Task WriteGitHubTokenAsync(string token)
    {
        await File.WriteAllTextAsync(_githubTokenPath, token);
    }
}
