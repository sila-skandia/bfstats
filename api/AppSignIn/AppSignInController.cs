using System.Security.Claims;
using api.AppSignIn.Models;
using api.Recordings;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace api.AppSignIn;

/// <summary>
/// An app signs in through the browser (features/app-sign-in, "API contract"). The app
/// sends no cookies: tokens travel in bodies and the Authorization header, so there is
/// nothing here for a cross-site request to ride on and no CSRF check is needed.
/// </summary>
[ApiController]
[Route("stats/auth/app")]
public class AppSignInController(IAppSignInService appSignIn) : ControllerBase
{
    /// <summary>Per signed-in user (Program.cs).</summary>
    public const string AuthorizeLimit = "app-sign-in-authorize";

    /// <summary>The code exchange, per address.</summary>
    public const string TokenLimit = "app-sign-in-token";

    /// <summary>Refresh and revoke, per address.</summary>
    public const string RefreshLimit = "app-sign-in-refresh";

    [HttpPost("authorize")]
    [Authorize]
    [EnableRateLimiting(AuthorizeLimit)]
    public async Task<IActionResult> Authorize([FromBody] AuthorizeAppRequest request, CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        return Answer(await appSignIn.AuthorizeAsync(userId, request, cancellationToken));
    }

    [HttpPost("token")]
    [EnableRateLimiting(TokenLimit)]
    public async Task<IActionResult> Token([FromBody] AppTokenRequest request, CancellationToken cancellationToken) =>
        Answer(await appSignIn.ExchangeAsync(request, ClientAddress.Of(HttpContext), UserAgent(), cancellationToken));

    [HttpPost("refresh")]
    [EnableRateLimiting(RefreshLimit)]
    public async Task<IActionResult> Refresh([FromBody] AppRefreshRequest request, CancellationToken cancellationToken) =>
        Answer(await appSignIn.RefreshAsync(request.RefreshToken, ClientAddress.Of(HttpContext), UserAgent(), cancellationToken));

    [HttpPost("revoke")]
    [EnableRateLimiting(RefreshLimit)]
    public async Task<IActionResult> Revoke([FromBody] AppRefreshRequest request, CancellationToken cancellationToken)
    {
        await appSignIn.RevokeAsync(request.RefreshToken, cancellationToken);
        return NoContent();
    }

    [HttpGet("sessions")]
    [Authorize]
    public async Task<ActionResult<IReadOnlyList<AppSessionResponse>>> Sessions(CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        return Ok(await appSignIn.ListSessionsAsync(userId, cancellationToken));
    }

    [HttpDelete("sessions/{id:guid}")]
    [Authorize]
    public async Task<IActionResult> DeleteSession(Guid id, CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        return await appSignIn.RevokeSessionAsync(userId, id, cancellationToken)
            ? NoContent()
            : NotFound(new { message = "No such signed-in app" });
    }

    private IActionResult Answer<T>(AppSignInResult<T> result) => result.Outcome switch
    {
        AppSignInOutcome.Ok => Ok(result.Value),
        AppSignInOutcome.InvalidRequest or AppSignInOutcome.InvalidGrant =>
            BadRequest(new { error = result.Error, message = result.Message }),
        AppSignInOutcome.Unauthorized => Unauthorized(new { error = result.Error, message = result.Message }),
        AppSignInOutcome.NotFound => NotFound(new { error = result.Error, message = result.Message }),
        AppSignInOutcome.Busy => StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = result.Error, message = result.Message }),
        _ => StatusCode(500, new { message = "Unexpected result" }),
    };

    private string? UserAgent()
    {
        var agent = Request.Headers.UserAgent.ToString();
        return agent.Length == 0 ? null : agent[..Math.Min(agent.Length, 512)];
    }

    private int? CurrentUserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return int.TryParse(id, out var userId) ? userId : null;
    }
}
