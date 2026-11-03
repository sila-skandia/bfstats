using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using api.Authorization;
using api.Recordings;
using api.Shorts.Models;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;

namespace api.Shorts;

/// <summary>
/// Replay Shorts (features/replay-shorts): short 9:16 clips of notable kills cut from the
/// shared recordings. Reading is public and open to any origin, as the recordings' is.
/// Uploading and taking one down is for the render job, which sends <c>X-Shorts-Key</c>, or a
/// signed-in admin. No <c>[Authorize]</c> on those actions: the key way in has no JWT, and the
/// action decides.
/// </summary>
[ApiController]
[Route("stats/shorts")]
public class ShortsController(
    IShortService shorts,
    ShortStorage storage,
    IShortViewCounter views,
    IConfiguration configuration,
    IOptions<ShortsOptions> options) : ControllerBase
{
    public const string KeyHeader = "X-Shorts-Key";

    /// <summary>The whole upload body: the largest video and poster, and the framing round them.</summary>
    private const long UploadLimitBytes = 44L * 1024 * 1024;

    [HttpGet]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<PagedShortsDto>> List(
        [FromQuery] int days = ShortService.DefaultDays, [FromQuery] string? sort = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = ShortService.DefaultPageSize,
        CancellationToken ct = default) =>
        Ok(await shorts.ListAsync(days, sort, page, pageSize, ct));

    [HttpGet("keys")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<ShortKeysDto>> Keys([FromQuery] string? recording, CancellationToken ct) =>
        Ok(await shorts.KeysAsync(recording, ct));

    [HttpGet("{slug:length(10)}")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<ShortDto>> Get(string slug, CancellationToken ct) =>
        RecordingStorage.CleanSlug(slug) is { } clean && await shorts.GetAsync(clean, ct) is { } dto ? Ok(dto) : NotFound();

    /// <summary>The video, with ranges, so a player can seek and a phone can stream it. A slug
    /// is never reused, so its file never changes.</summary>
    [HttpGet("{slug:length(10)}.mp4")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public IActionResult Video(string slug) => Serve(slug, storage.VideoPath, "video/mp4");

    [HttpGet("{slug:length(10)}.jpg")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public IActionResult Poster(string slug) => Serve(slug, storage.PosterPath, "image/jpeg");

    /// <summary>201 with the new Short, or 200 with the one its kill was clipped as already.</summary>
    [HttpPost]
    [RequestSizeLimit(UploadLimitBytes)]
    [DisableFormValueModelBinding]
    public async Task<ActionResult<ShortDto>> Upload(CancellationToken ct)
    {
        if (Refusal() is { } refusal) return refusal;
        try
        {
            var result = await shorts.UploadAsync(Request.ContentType, Request.Body, Request.ContentLength, ct);
            return result.Created
                ? CreatedAtAction(nameof(Get), new { slug = result.Short.Slug }, result.Short)
                : Ok(result.Short);
        }
        catch (RecordingRejectedException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    [HttpDelete("{slug:length(10)}")]
    public async Task<IActionResult> Delete(string slug, CancellationToken ct)
    {
        if (Refusal() is { } refusal) return refusal;
        return RecordingStorage.CleanSlug(slug) is { } clean && await shorts.DeleteAsync(clean, ct) ? NoContent() : NotFound();
    }

    /// <summary>The player says so when a Short starts. Counted a few seconds later, in a
    /// batch, once per viewer per window; the answer is the count so far.</summary>
    [HttpPost("{slug:length(10)}/views")]
    [EnableRateLimiting(RecordingsController.ViewLimit)]
    public async Task<ActionResult<ShortViewsDto>> View(string slug, CancellationToken ct)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean || await shorts.WatchableAsync(clean, ct) is not { } found)
        {
            return NotFound();
        }
        views.Enqueue(found.Id, ViewerKey());
        return Ok(new ShortViewsDto(found.Views));
    }

    private IActionResult Serve(string slug, Func<string, string> pathOf, string contentType)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        var path = pathOf(clean);
        if (!System.IO.File.Exists(path)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        return PhysicalFile(path, contentType, enableRangeProcessing: true);
    }

    /// <summary>
    /// Null when the request may write: it carries the configured upload key, or comes from a
    /// signed-in admin. A key that is sent and wrong is a 401 whoever is signed in; an empty
    /// configured key turns that way in off.
    /// </summary>
    private ObjectResult? Refusal()
    {
        if (Request.Headers.TryGetValue(KeyHeader, out var sent) && sent.ToString().Length > 0)
        {
            return KeyMatches(sent.ToString(), options.Value.UploadKey)
                ? null
                : StatusCode(StatusCodes.Status401Unauthorized, new { message = "The upload key is not right." });
        }
        if (User.Identity?.IsAuthenticated != true)
        {
            return StatusCode(StatusCodes.Status401Unauthorized, new { message = "Sign in as an admin, or send the upload key." });
        }
        return IsAdmin()
            ? null
            : StatusCode(StatusCodes.Status403Forbidden, new { message = "Only an admin can do that." });
    }

    /// <summary>Whether <paramref name="sent"/> is the configured key. Whitespace round the
    /// configured key is not part of it: a secret made with <c>--from-file</c> from
    /// <c>openssl rand -hex 32</c> carries the file's newline, which no header can send
    /// (2026-11-03, every upload refused).</summary>
    internal static bool KeyMatches(string sent, string configured)
    {
        configured = configured?.Trim() ?? "";
        sent = sent.Trim();
        if (configured.Length == 0) return false;
        var a = SHA256.HashData(Encoding.UTF8.GetBytes(sent));
        var b = SHA256.HashData(Encoding.UTF8.GetBytes(configured));
        return CryptographicOperations.FixedTimeEquals(a, b);
    }

    private bool IsAdmin() =>
        User.IsInRole(AppRoles.Admin) || User.HasClaim(ClaimTypes.Email, AppRoles.AdminEmail);

    /// <summary>Who is watching, for counting them once: a signed-in user's id, else a keyed
    /// hash of the address and browser, so that neither is kept.</summary>
    private string ViewerKey()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        if (User.Identity?.IsAuthenticated == true && int.TryParse(id, out var userId)) return $"u:{userId}";
        var secret = configuration["RefreshToken:Secret"] ?? configuration["Jwt:Issuer"] ?? "bfstats";
        var key = SHA256.HashData(Encoding.UTF8.GetBytes($"short-views|{secret}"));
        var visitor = Encoding.UTF8.GetBytes($"{ClientAddress.Of(HttpContext)}|{Request.Headers.UserAgent}");
        return $"a:{Convert.ToHexStringLower(HMACSHA256.HashData(key, visitor))[..32]}";
    }
}
