using CopilotRouter.Services;
using Microsoft.AspNetCore.Mvc;

namespace CopilotRouter.Controllers;

/// <summary>
/// Controller for embeddings endpoint
/// </summary>
[ApiController]
[Route("embeddings")]
[Route("v1/embeddings")]
public class EmbeddingsController : ControllerBase
{
    private readonly CopilotService _copilotService;
    private readonly ILogger<EmbeddingsController> _logger;

    public EmbeddingsController(
        CopilotService copilotService,
        ILogger<EmbeddingsController> logger)
    {
        _copilotService = copilotService;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> CreateEmbedding([FromBody] EmbeddingRequest request)
    {
        try
        {
            var response = await _copilotService.CreateEmbeddingsAsync(request);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating embedding");
            return StatusCode(500, new
            {
                error = new { message = ex.Message, type = "error" }
            });
        }
    }
}
