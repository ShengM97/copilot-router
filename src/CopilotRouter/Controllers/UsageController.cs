using CopilotRouter.Services;
using Microsoft.AspNetCore.Mvc;

namespace CopilotRouter.Controllers;

/// <summary>
/// Controller for usage information endpoint
/// </summary>
[ApiController]
[Route("usage")]
public class UsageController : ControllerBase
{
    private readonly GitHubService _gitHubService;
    private readonly ILogger<UsageController> _logger;

    public UsageController(GitHubService gitHubService, ILogger<UsageController> logger)
    {
        _gitHubService = gitHubService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetUsage()
    {
        try
        {
            var usage = await _gitHubService.GetCopilotUsageAsync();
            return Ok(usage);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogError(ex, "HTTP error fetching Copilot usage: {StatusCode}", ex.StatusCode);
            return StatusCode((int)(ex.StatusCode ?? System.Net.HttpStatusCode.InternalServerError), 
                new { error = "Failed to fetch Copilot usage", details = ex.Message });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching Copilot usage");
            return StatusCode(500, new { error = "Failed to fetch Copilot usage", details = ex.Message });
        }
    }
}
