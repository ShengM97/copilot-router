using System.Text.Json;
using CopilotRouter.Services;
using Microsoft.AspNetCore.Mvc;

namespace CopilotRouter.Controllers;

/// <summary>
/// Controller for Anthropic-compatible messages endpoint
/// </summary>
[ApiController]
[Route("v1/messages")]
public class MessagesController : ControllerBase
{
    private readonly CopilotService _copilotService;
    private readonly AnthropicTranslationService _translationService;
    private readonly AppState _state;
    private readonly ILogger<MessagesController> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower
    };

    public MessagesController(
        CopilotService copilotService,
        AnthropicTranslationService translationService,
        AppState state,
        ILogger<MessagesController> logger)
    {
        _copilotService = copilotService;
        _translationService = translationService;
        _state = state;
        _logger = logger;
    }

    [HttpPost]
    public async Task<IActionResult> CreateMessage([FromBody] AnthropicMessagesPayload payload)
    {
        _logger.LogDebug("Anthropic request payload: {Payload}", JsonSerializer.Serialize(payload, JsonOptions));

        // Translate Anthropic payload to OpenAI format
        var openAIPayload = _translationService.TranslateToOpenAI(payload);
        _logger.LogDebug("Translated OpenAI request payload: {Payload}", JsonSerializer.Serialize(openAIPayload, JsonOptions));

        // Manual approval check
        if (_state.ManualApprove)
        {
            _logger.LogInformation("Waiting for manual approval...");
        }

        // Check if streaming is requested
        if (payload.Stream == true)
        {
            return await HandleStreamingResponse(openAIPayload);
        }

        // Non-streaming response
        var response = await _copilotService.CreateChatCompletionsAsync(openAIPayload);
        _logger.LogDebug("Non-streaming response from Copilot: {Response}", 
            JsonSerializer.Serialize(response, JsonOptions)[^Math.Min(400, JsonSerializer.Serialize(response, JsonOptions).Length)..]);

        var anthropicResponse = _translationService.TranslateToAnthropic(response);
        _logger.LogDebug("Translated Anthropic response: {Response}", JsonSerializer.Serialize(anthropicResponse, JsonOptions));

        return Ok(anthropicResponse);
    }

    private async Task<IActionResult> HandleStreamingResponse(ChatCompletionsPayload payload)
    {
        Response.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers.Connection = "keep-alive";

        _logger.LogDebug("Streaming response from Copilot");

        var state = new AnthropicStreamState();

        try
        {
            await foreach (var chunk in _copilotService.CreateChatCompletionsStreamAsync(payload, HttpContext.RequestAborted))
            {
                _logger.LogDebug("Copilot raw stream event: {Chunk}", JsonSerializer.Serialize(chunk, JsonOptions));

                var events = _translationService.TranslateChunkToAnthropicEvents(chunk, state);

                foreach (var evt in events)
                {
                    _logger.LogDebug("Translated Anthropic event: {Event}", JsonSerializer.Serialize(evt, JsonOptions));
                    
                    var data = JsonSerializer.Serialize(evt, JsonOptions);
                    await Response.WriteAsync($"event: {evt.Type}\n", HttpContext.RequestAborted);
                    await Response.WriteAsync($"data: {data}\n\n", HttpContext.RequestAborted);
                    await Response.Body.FlushAsync(HttpContext.RequestAborted);
                }
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogDebug("Streaming cancelled by client");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during streaming");

            // Send error event
            var errorEvent = new AnthropicStreamEvent
            {
                Type = "error",
                Delta = new AnthropicDelta { Text = ex.Message }
            };
            var errorData = JsonSerializer.Serialize(errorEvent, JsonOptions);
            await Response.WriteAsync($"event: error\n", HttpContext.RequestAborted);
            await Response.WriteAsync($"data: {errorData}\n\n", HttpContext.RequestAborted);
        }

        return new EmptyResult();
    }
}
