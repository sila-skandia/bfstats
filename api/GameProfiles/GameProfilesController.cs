using System.Security.Claims;
using api.GameProfiles.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace api.GameProfiles;

/// <summary>
/// The signed-in account's BF1942 profiles (features/game-profiles, "API contract"):
/// the site's profile page imports them, the viewer plays with the active one.
/// </summary>
[ApiController]
[Route("stats/account/game-profiles")]
[Authorize]
public class GameProfilesController(IGameProfileService profiles) : ControllerBase
{
    /// <summary>Five files of 64 KB, JSON-escaped, with room to spare.</summary>
    private const long MaxBodyBytes = 1024 * 1024;

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<GameProfileResponse>>> List(CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        return Ok(await profiles.ListAsync(userId, cancellationToken));
    }

    [HttpPut("{name}")]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> Upsert(string name, [FromBody] UpsertGameProfileRequest request, CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        return Answer(await profiles.UpsertAsync(userId, name, request, cancellationToken));
    }

    [HttpPost("{name}/activate")]
    public async Task<IActionResult> Activate(string name, CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        var result = await profiles.ActivateAsync(userId, name, cancellationToken);
        return result.Outcome == GameProfileOutcome.Ok ? NoContent() : Answer(result);
    }

    [HttpDelete("{name}")]
    public async Task<IActionResult> Delete(string name, CancellationToken cancellationToken)
    {
        if (CurrentUserId() is not { } userId) return Unauthorized(new { message = "Not signed in" });
        var result = await profiles.DeleteAsync(userId, name, cancellationToken);
        return result.Outcome == GameProfileOutcome.Ok ? NoContent() : Answer(result);
    }

    private IActionResult Answer(GameProfileResult result) => result.Outcome switch
    {
        GameProfileOutcome.Ok => Ok(result.Profile),
        GameProfileOutcome.Invalid => BadRequest(new { message = result.Message }),
        GameProfileOutcome.NotFound => NotFound(new { message = result.Message }),
        GameProfileOutcome.LimitReached or GameProfileOutcome.Conflict => Conflict(new { message = result.Message }),
        _ => StatusCode(500, new { message = "Unexpected result" }),
    };

    private int? CurrentUserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return int.TryParse(id, out var userId) ? userId : null;
    }
}
