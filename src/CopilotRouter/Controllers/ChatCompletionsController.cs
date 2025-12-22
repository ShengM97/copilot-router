using System.Text.Json;
using CopilotRouter.Services;
using Microsoft.AspNetCore.Mvc;

namespace CopilotRouter.Controllers;

/// <summary>
/// Controller for OpenAI-compatible chat completions endpoint
/// </summary>
[ApiController]
[Route("chat/completions")]
[Route("v1/chat/completions")]
public class ChatCompletionsController : ControllerBase
{
    private readonly CopilotService _copilotService;
    private readonly AppState _state;
    private readonly ILogger<ChatCompletionsController> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    public ChatCompletionsController(
        CopilotService copilotService,
        AppState state,
        ILogger<ChatCompletionsController> logger)
    {
        _copilotService = copilotService;
        _state = state;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> CreateChatCompletion([FromBody] ChatCompletionsPayload payload)
    {
        _logger.LogDebug("Request payload: {Payload}", 
            JsonSerializer.Serialize(payload, JsonOptions)[^Math.Min(400, JsonSerializer.Serialize(payload, JsonOptions).Length)..]);

        // Find selected model and set max_tokens if not specified
        var selectedModel = _state.Models?.Data.Find(m => m.Id == payload.Model);
        if (payload.MaxTokens == null && selectedModel?.Capabilities?.Limits.MaxOutputTokens != null)
        {
            payload.MaxTokens = selectedModel.Capabilities.Limits.MaxOutputTokens;
            _logger.LogDebug("Set max_tokens to: {MaxTokens}", payload.MaxTokens);
        }

        // Manual approval check
        if (_state.ManualApprove)
        {
            _logger.LogInformation("Waiting for manual approval...");
            // In a real implementation, you'd have a mechanism for manual approval
            // For now, we just log and continue
        }

        // Check if streaming is requested
        if (payload.Stream == true)
        {
            return await HandleStreamingResponse(payload);
        }

        // Non-streaming response
        var response = await _copilotService.CreateChatCompletionsAsync(payload);
        _logger.LogDebug("Non-streaming response: {Response}", JsonSerializer.Serialize(response, JsonOptions));
        return Ok(response);
    }

    private async Task<IActionResult> HandleStreamingResponse(ChatCompletionsPayload payload)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        _logger.LogDebug("Streaming response");

        try
        {
            await foreach (var chunk in _copilotService.CreateChatCompletionsStreamAsync(payload, HttpContext.RequestAborted))
            {
                _logger.LogDebug("Streaming chunk: {Chunk}", JsonSerializer.Serialize(chunk, JsonOptions));
                
                var data = JsonSerializer.Serialize(chunk, JsonOptions);
                await Response.WriteAsync($"data: {data}\n\n", HttpContext.RequestAborted);
                await Response.Body.FlushAsync(HttpContext.RequestAborted);
            }

            await Response.WriteAsync("data: [DONE]\n\n", HttpContext.RequestAborted);
            await Response.Body.FlushAsync(HttpContext.RequestAborted);
        }
        catch (OperationCanceledException)
        {
            _logger.LogDebug("Streaming cancelled by client");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during streaming");
        }

        return new EmptyResult();
    }
}
