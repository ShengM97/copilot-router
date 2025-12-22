using CopilotRouter.Services;
using Microsoft.AspNetCore.Mvc;

namespace CopilotRouter.Controllers;

/// <summary>
/// Controller for token information endpoint
/// </summary>
[ApiController]
[Route("token")]
public class TokenController : ControllerBase
{
    private readonly AppState _state;

    public TokenController(AppState state)
    {
        _state = state;
    }

    [HttpGet]
    public IActionResult GetToken()
    {
        return Ok(new
        {
            copilot_token = _state.ShowToken ? _state.CopilotToken : "***hidden***",
            github_token = _state.ShowToken ? _state.GitHubToken : "***hidden***",
            account_type = _state.AccountType
        });
    }
}
