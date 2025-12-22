using CopilotRouter.Services;

namespace CopilotRouter.Middleware;

/// <summary>
/// Middleware for rate limiting requests
/// </summary>
public class RateLimitMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RateLimitMiddleware> _logger;

    public RateLimitMiddleware(RequestDelegate next, ILogger<RateLimitMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, AppState state)
    {
        // Skip rate limiting for non-API endpoints
        var path = context.Request.Path.Value ?? "";
        if (!path.Contains("/chat/completions") && 
            !path.Contains("/messages") && 
            !path.Contains("/embeddings"))
        {
            await _next(context);
            return;
        }

        if (state.RateLimitSeconds == null)
        {
            await _next(context);
            return;
        }

        var now = DateTime.UtcNow;

        if (state.LastRequestTimestamp == null)
        {
            state.LastRequestTimestamp = now;
            await _next(context);
            return;
        }

        var elapsed = (now - state.LastRequestTimestamp.Value).TotalSeconds;

        if (elapsed > state.RateLimitSeconds.Value)
        {
            state.LastRequestTimestamp = now;
            await _next(context);
            return;
        }

        var waitTime = Math.Ceiling(state.RateLimitSeconds.Value - elapsed);

        if (!state.RateLimitWait)
        {
            _logger.LogWarning("Rate limit exceeded. Need to wait {WaitTime} more seconds.", waitTime);
            context.Response.StatusCode = 429;
            await context.Response.WriteAsJsonAsync(new
            {
                error = new { message = "Rate limit exceeded", type = "error" }
            });
            return;
        }

        _logger.LogWarning("Rate limit reached. Waiting {WaitTime} seconds before proceeding...", waitTime);
        await Task.Delay(TimeSpan.FromSeconds(waitTime));
        state.LastRequestTimestamp = DateTime.UtcNow;
        _logger.LogInformation("Rate limit wait completed, proceeding with request");

        await _next(context);
    }
}
