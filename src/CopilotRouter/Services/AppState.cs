namespace CopilotRouter.Services;

/// <summary>
/// Application state that holds runtime configuration and cached data
/// </summary>
public class AppState
{
    public string? GitHubToken { get; set; }
    public string? CopilotToken { get; set; }
    public string AccountType { get; set; } = "individual";
    public ModelsResponse? Models { get; set; }
    public string? VSCodeVersion { get; set; }
    
    public bool ManualApprove { get; set; }
    public bool RateLimitWait { get; set; }
    public bool ShowToken { get; set; }
    
    public int? RateLimitSeconds { get; set; }
    public DateTime? LastRequestTimestamp { get; set; }
}

/// <summary>
/// Response containing available models
/// </summary>
public class ModelsResponse
{
    public List<Model> Data { get; set; } = [];
    public string Object { get; set; } = "list";
}

public class Model
{
    public required string Id { get; set; }
    public required string Name { get; set; }
    public required string Vendor { get; set; }
    public required string Version { get; set; }
    public required string Object { get; set; }
    public bool Preview { get; set; }
    public bool ModelPickerEnabled { get; set; }
    public ModelCapabilities? Capabilities { get; set; }
    public ModelPolicy? Policy { get; set; }
}

public class ModelCapabilities
{
    public string? Family { get; set; }
    public string? Object { get; set; }
    public string? Tokenizer { get; set; }
    public string? Type { get; set; }
    public ModelLimits Limits { get; set; } = new();
    public ModelSupports Supports { get; set; } = new();
}

public class ModelLimits
{
    public int? MaxContextWindowTokens { get; set; }
    public int? MaxOutputTokens { get; set; }
    public int? MaxPromptTokens { get; set; }
    public int? MaxInputs { get; set; }
}

public class ModelSupports
{
    public bool? ToolCalls { get; set; }
    public bool? ParallelToolCalls { get; set; }
    public bool? Dimensions { get; set; }
}

public class ModelPolicy
{
    public string? State { get; set; }
    public string? Terms { get; set; }
}
