using CopilotRouter.Services;
using Microsoft.AspNetCore.Mvc;

namespace CopilotRouter.Controllers;

/// <summary>
/// Controller for models endpoint
/// </summary>
[ApiController]
[Route("models")]
[Route("v1/models")]
public class ModelsController : ControllerBase
{
    private readonly AppState _state;
    private readonly CopilotService _copilotService;
    private readonly ILogger<ModelsController> _logger;

    public ModelsController(
        AppState state,
        CopilotService copilotService,
        ILogger<ModelsController> logger)
    {
        _state = state;
        _copilotService = copilotService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetModels()
    {
        try
        {
            if (_state.Models == null)
            {
                // Fallback: fetch models if not cached
                _state.Models = await _copilotService.GetModelsAsync();
            }

            var models = _state.Models.Data.Select(model => new
            {
                id = model.Id,
                @object = "model",
                type = "model",
                created = 0,
                created_at = DateTime.UnixEpoch.ToString("o"),
                owned_by = model.Vendor,
                display_name = model.Name
            }).ToList();

            return Ok(new
            {
                @object = "list",
                data = models,
                has_more = false
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching models");
            return StatusCode(500, new
            {
                error = new { message = ex.Message, type = "error" }
            });
        }
    }
}
