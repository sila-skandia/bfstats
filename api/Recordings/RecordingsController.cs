using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using api.Authorization;
using api.Recordings.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;

namespace api.Recordings;

/// <summary>
/// The REPLAY feed's API (features/replay-feed): shared bf42plus recordings, newest or most
/// watched first, their files, views and comments, and sharing one. Reading is public and
/// open to any origin, so a local viewer can browse the live feed; writing is for a
/// signed-in user, as one of their linked player names.
/// </summary>
[ApiController]
[Route("stats/recordings")]
public class RecordingsController(
    IRecordingService recordings,
    IRecordingUploadService uploads,
    IRecordingStorage storage,
    IRecordingViewCounter views,
    IConfiguration configuration) : ControllerBase
{
    /// <summary>The whole upload body: the largest recording and server log the options
    /// allow, and the multipart framing round them.</summary>
    private const long UploadLimitBytes = 120L * 1024 * 1024;

    public const string PublicReadCors = "recordings-public";
    public const string UploadLimit = "recordings-upload";
    public const string CommentLimit = "recordings-comments";
    public const string ViewLimit = "recordings-views";

    [HttpGet]
    [EnableCors(PublicReadCors)]
    public async Task<ActionResult<PagedRecordingsDto>> List(
        [FromQuery] string? sort, [FromQuery] int page = 1, [FromQuery] int pageSize = RecordingService.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await recordings.ListAsync(sort, page, pageSize, ct));

    /// <summary>The signed-in viewer: the player names they can post as.</summary>
    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<RecordingViewerDto>> Me(CancellationToken ct) =>
        Actor() is { } actor ? Ok(await recordings.ViewerAsync(actor, ct)) : Unauthorized();

    [HttpGet("{slug:length(10)}")]
    [EnableCors(PublicReadCors)]
    public async Task<ActionResult<RecordingDetailDto>> Get(string slug, CancellationToken ct) =>
        await recordings.GetAsync(slug, Actor(), ct) is { } detail ? Ok(detail) : NotFound();

    /// <summary>The recording, gzipped on disk and sent as it is (<c>Content-Encoding:
    /// gzip</c>): the browser unpacks it, and nothing here spends CPU compressing.</summary>
    [HttpGet("{slug:length(10)}.ndjson")]
    [EnableCors(PublicReadCors)]
    public IActionResult RecordingFile(string slug) => Gzipped(slug, storage.RecordingPath, "application/x-ndjson");

    [HttpGet("{slug:length(10)}.xml")]
    [EnableCors(PublicReadCors)]
    public IActionResult ServerLogFile(string slug) => Gzipped(slug, storage.ServerLogPath, "text/xml");

    /// <summary>The cover. Its link carries a version (<c>?v=</c>), so it keeps a year.</summary>
    [HttpGet("{slug:length(10)}.jpg")]
    [EnableCors(PublicReadCors)]
    public IActionResult Thumbnail(string slug)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        var path = storage.ThumbnailPath(clean);
        if (!System.IO.File.Exists(path)) return NotFound();
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return PhysicalFile(path, "image/jpeg");
    }

    /// <summary>Sets the cover: an image in the body, a frame the replay page grabbed.</summary>
    [HttpPut("{slug:length(10)}/thumbnail")]
    [Authorize]
    [RequestSizeLimit(RecordingThumbnails.MaxBytes + 1)]
    [EnableRateLimiting(CommentLimit)]
    public async Task<ActionResult<RecordingDetailDto>> SetThumbnail(string slug, CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            return await recordings.SetThumbnailAsync(slug, actor, Request.Body, ct) is { } detail ? Ok(detail) : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return Rejected(ex);
        }
    }

    [HttpPost]
    [Authorize]
    [RequestSizeLimit(UploadLimitBytes)]
    [DisableFormValueModelBinding]
    [EnableRateLimiting(UploadLimit)]
    public async Task<ActionResult<RecordingDetailDto>> Upload(CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            var detail = await uploads.UploadAsync(Request.ContentType, Request.Body, Request.ContentLength, actor, ct);
            return CreatedAtAction(nameof(Get), new { slug = detail.Slug }, detail);
        }
        catch (RecordingRejectedException ex)
        {
            return Rejected(ex);
        }
    }

    [HttpPatch("{slug:length(10)}")]
    [Authorize]
    public async Task<ActionResult<RecordingDetailDto>> Rename(string slug, [FromBody] UpdateRecordingRequest request, CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            return await recordings.RenameAsync(slug, actor, request.Title, ct) is { } detail ? Ok(detail) : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return Rejected(ex);
        }
    }

    [HttpDelete("{slug:length(10)}")]
    [Authorize]
    public async Task<IActionResult> Delete(string slug, CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            return await recordings.DeleteAsync(slug, actor, ct) ? NoContent() : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return Rejected(ex);
        }
    }

    /// <summary>The replay page says so when it opens a recording. Counted a few seconds
    /// later, in a batch, once per viewer per window: accepted either way.</summary>
    [HttpPost("{slug:length(10)}/views")]
    [EnableRateLimiting(ViewLimit)]
    public async Task<IActionResult> View(string slug, CancellationToken ct)
    {
        if (await recordings.WatchableIdAsync(slug, ct) is not { } id) return NotFound();
        views.Enqueue(id, ViewerKey());
        return Accepted();
    }

    [HttpGet("{slug:length(10)}/comments")]
    [EnableCors(PublicReadCors)]
    public async Task<ActionResult<PagedRecordingCommentsDto>> Comments(
        string slug, [FromQuery] string? sort, [FromQuery] int page = 1, [FromQuery] int pageSize = 20,
        CancellationToken ct = default) =>
        await recordings.CommentsAsync(slug, sort, page, pageSize, Actor(), ct) is { } comments ? Ok(comments) : NotFound();

    [HttpPost("{slug:length(10)}/comments")]
    [Authorize]
    [EnableRateLimiting(CommentLimit)]
    public async Task<ActionResult<RecordingCommentDto>> AddComment(
        string slug, [FromBody] CreateRecordingCommentRequest request, CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            return await recordings.AddCommentAsync(slug, actor, request, ct) is { } comment
                ? CreatedAtAction(nameof(Comments), new { slug }, comment)
                : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return Rejected(ex);
        }
    }

    [HttpDelete("{slug:length(10)}/comments/{commentId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteComment(string slug, int commentId, CancellationToken ct)
    {
        if (Actor() is not { } actor) return Unauthorized();
        try
        {
            return await recordings.DeleteCommentAsync(slug, commentId, actor, ct) ? NoContent() : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return Rejected(ex);
        }
    }

    private IActionResult Gzipped(string slug, Func<string, string> pathOf, string contentType)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        var path = pathOf(clean);
        if (!System.IO.File.Exists(path)) return NotFound();
        Response.Headers.ContentEncoding = "gzip";
        // A slug is never reused, so a file never changes under its name.
        Response.Headers.CacheControl = "public, max-age=86400";
        return PhysicalFile(path, contentType);
    }

    private ObjectResult Rejected(RecordingRejectedException ex) =>
        StatusCode(ex.StatusCode, new { message = ex.Message, existingSlug = ex.ExistingSlug });

    private RecordingActor? Actor()
    {
        if (User.Identity?.IsAuthenticated != true) return null;
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (!int.TryParse(id, out var userId)) return null;
        var admin = User.IsInRole(AppRoles.Admin) || User.HasClaim(ClaimTypes.Email, AppRoles.AdminEmail);
        return new RecordingActor(userId, admin);
    }

    /// <summary>Who is watching, for counting them once: a signed-in user's id, else a keyed
    /// hash of the address and browser, so that neither is kept.</summary>
    private string ViewerKey()
    {
        if (Actor() is { } actor) return $"u:{actor.UserId}";
        var secret = configuration["RefreshToken:Secret"] ?? configuration["Jwt:Issuer"] ?? "bfstats";
        var key = SHA256.HashData(Encoding.UTF8.GetBytes($"recording-views|{secret}"));
        var visitor = Encoding.UTF8.GetBytes($"{ClientAddress.Of(HttpContext)}|{Request.Headers.UserAgent}");
        return $"a:{Convert.ToHexStringLower(HMACSHA256.HashData(key, visitor))[..32]}";
    }
}
