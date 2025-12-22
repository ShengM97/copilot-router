using CopilotRouter.Extensions;
using CopilotRouter.Middleware;
using CopilotRouter.Services;
using Serilog;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .WriteTo.Console()
    .CreateLogger();

try
{
    var builder = WebApplication.CreateBuilder(args);

    // Add Serilog
    builder.Host.UseSerilog();

    // Add services
    builder.Services.AddControllers();
    builder.Services.AddEndpointsApiExplorer();

    // Add CORS
    builder.Services.AddCors(options =>
    {
        options.AddDefaultPolicy(policy =>
        {
            policy.AllowAnyOrigin()
                  .AllowAnyMethod()
                  .AllowAnyHeader();
        });
    });

    // Register custom services
    builder.Services.AddSingleton<AppState>();
    builder.Services.AddSingleton<PathService>();
    builder.Services.AddHttpClient<GitHubService>();
    builder.Services.AddHttpClient<CopilotService>();
    builder.Services.AddSingleton<TokenService>();
    builder.Services.AddSingleton<AnthropicTranslationService>();

    var app = builder.Build();

    // Initialize application
    await app.InitializeAsync();

    app.UseCors();
    app.UseMiddleware<RateLimitMiddleware>();
    app.MapControllers();

    app.MapGet("/", () => "Server running");

    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Application terminated unexpectedly");
}
finally
{
    Log.CloseAndFlush();
}
