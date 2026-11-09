using System.Security.Claims;
using api.Authorization;
using api.Recordings.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace api.Recordings;

/// <summary>
/// Sharing a creator's edit of a clip (features/replay-creator-view, "Sharing an edit"): a
/// signed-in user keeps one against a shared recording and gets a link; anyone with the link
/// reads it back. The recording's short link takes <c>?edit=</c> to unfurl and open it.
/// </summary>
[ApiController]
public class RecordingEditsController(IRecordingEditService edits) : ControllerBase
{
    [HttpPost("stats/recordings/{slug:length(10)}/edits")]
    [Authorize]
    [EnableRateLimiting(RecordingsController.CommentLimit)]
    public async Task<ActionResult<RecordingEditDto>> Share(string slug, [FromBody] ShareRecordingEditRequest request, CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            return await edits.ShareAsync(slug, actor, request, ct) is { } edit
                ? CreatedAtAction(nameof(Get), new { code = edit.Code }, edit)
                : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    [HttpGet("stats/recording-edits/{code}")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<RecordingEditDto>> Get(string code, CancellationToken ct) =>
        await edits.GetAsync(code, ct) is { } edit ? Ok(edit) : NotFound();

    private RecordingActor? Actor()
    {
        if (User.Identity?.IsAuthenticated != true) return null;
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!int.TryParse(id, out var userId)) return null;
        var admin = User.IsInRole(AppRoles.Admin) || AppRoles.HasAdminEmail(User);
        return new RecordingActor(userId, admin);
    }
}
