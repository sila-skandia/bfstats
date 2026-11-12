using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using api.Authorization;
using api.Recordings;
using api.Shorts.Models;
using Microsoft.AspNetCore.Authorization;
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
    IOptions<ShortsOptions> options,
    IOptions<RecordingsOptions> recordingOptions) : ControllerBase
{
    public const string KeyHeader = "X-Shorts-Key";

    /// <summary>The rate limit on a player's shares: 10 an hour per account.</summary>
    public const string ShareLimit = "shorts-share";

    /// <summary>A poster alone, as <see cref="ShortsOptions.MaxPosterBytes"/> takes it.</summary>
    private const long PosterLimitBytes = 2L * 1024 * 1024 + 1;

    /// <summary>A link copy alone, as <see cref="ShortsOptions.MaxLinkVideoBytes"/> takes it.</summary>
    private const long LinkVideoLimitBytes = 48L * 1024 * 1024 + 1;

    /// <summary>A studio share's whole body: the largest video, HD copy and poster
    /// (<see cref="ShortsOptions"/>), and the framing round them.</summary>
    private const long ShareLimitBytes = (90L + 90 + 2 + 1) * 1024 * 1024;

    /// <summary>One part of a chunked upload: <see cref="ShortsOptions.MaxPartBytes"/> and a little.</summary>
    private const long PartLimitBytes = 90L * 1024 * 1024 + 64 * 1024;

    /// <summary>The render job's whole body: an action roll's 600 MiB video, its 200 MiB HD copy
    /// and the poster, and the framing round them. <see cref="ShortService"/> holds each kind to
    /// its own limits.</summary>
    private const long UploadLimitBytes = (600L + 200 + 2 + 1) * 1024 * 1024;

    [HttpGet]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<PagedShortsDto>> List(
        [FromQuery] int days = ShortService.DefaultDays, [FromQuery] string? sort = null,
        [FromQuery] int page = 1, [FromQuery] int pageSize = ShortService.DefaultPageSize,
        [FromQuery] string? kind = null, [FromQuery] string? player = null, [FromQuery] string? server = null,
        CancellationToken ct = default) =>
        Ok(await shorts.ListAsync(days, sort, page, pageSize, ct, kind, player, server));

    /// <summary>The players in the week's Shorts, for the strip's player filter.</summary>
    [HttpGet("players")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<ShortPlayersDto>> Players([FromQuery] int days = ShortService.DefaultDays,
        CancellationToken ct = default) =>
        Ok(await shorts.PlayersAsync(days, ct));

    [HttpGet("keys")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<ShortKeysDto>> Keys([FromQuery] string? recording, CancellationToken ct) =>
        Ok(await shorts.KeysAsync(recording, ct));

    [HttpGet("{slug:length(10)}")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public async Task<ActionResult<ShortDto>> Get(string slug, CancellationToken ct) =>
        RecordingStorage.CleanSlug(slug) is { } clean && await shorts.GetAsync(clean, ct) is { } dto ? Ok(dto) : NotFound();

    /// <summary>A Short's share link, <c>replay.bfstats.io/s/&lt;slug&gt;</c>: a page that goes on
    /// to the Short in the REPLAY tab's player, with the video and poster for whatever unfurls
    /// the link (Discord plays it in the chat). A slug retyped in capitals still finds it.</summary>
    [HttpGet("/replay/s/{slug}")]
    public async Task<IActionResult> ShareLink(string slug, CancellationToken ct)
    {
        var found = RecordingStorage.CleanSlug(slug.ToLowerInvariant()) is { } clean
            ? await shorts.GetAsync(clean, ct)
            : null;
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
        var play = recordingOptions.Value.PlayOrigin.TrimEnd('/');
        if (found is null)
        {
            // On to the replays, which say it is gone in a toast (the owner, 2026-11-04: the
            // bare page was "an ugly black page with the text").
            Response.Headers["X-Robots-Tag"] = "noindex";
            return Redirect($"{play}/play/index.html?tab=replay&gone=1");
        }
        Response.Headers.CacheControl = "public, max-age=300";
        return Content(
            ShortLink.Page(found, play, recordingOptions.Value.ShortLinkOrigin.TrimEnd('/')),
            "text/html; charset=utf-8");
    }

    /// <summary>The video, with ranges, so a player can seek and a phone can stream it. A slug
    /// is never reused, so its file never changes.</summary>
    [HttpGet("{slug:length(10)}.mp4")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public IActionResult Video(string slug) => Serve(slug, storage.VideoPath, "video/mp4");

    /// <summary>The HD copy, when the Short has one (an action roll's 1080p take), served as the
    /// video is.</summary>
    [HttpGet("{slug:length(10)}.hd.mp4")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public IActionResult HdVideo(string slug) => Serve(slug, storage.HdVideoPath, "video/mp4");

    /// <summary>The link copy, when the Short has one: the small take its share link names.</summary>
    [HttpGet("{slug:length(10)}.link.mp4")]
    [EnableCors(RecordingsController.PublicReadCors)]
    public IActionResult LinkVideo(string slug) => Serve(slug, storage.LinkVideoPath, "video/mp4");

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

    /// <summary>One part of a chunked upload, the raw body, at most 90 MiB: a 4K roll goes up in
    /// pieces under the edge's 100 MB a request, then <see cref="Upload"/> names it with a
    /// <c>videoUpload</c> or <c>videoHdUpload</c> part. 200 with what was kept.</summary>
    [HttpPost("parts")]
    [RequestSizeLimit(PartLimitBytes)]
    [DisableFormValueModelBinding]
    public async Task<ActionResult<ShortPartDto>> Part([FromQuery] string? upload, [FromQuery] int? index, CancellationToken ct)
    {
        if (Refusal() is { } refusal) return refusal;
        try
        {
            return Ok(await shorts.ReceivePartAsync(upload, index ?? -1, Request.Body, Request.ContentLength, ct));
        }
        catch (RecordingRejectedException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    /// <summary>A signed-in player's clip from the studio, live at once under his linked in-game
    /// name (the owner, 2026-11-04: "allow creators to create clips and share them as shorts").
    /// 201 with the Short.</summary>
    [HttpPost("share")]
    [Authorize]
    [EnableRateLimiting(ShareLimit)]
    [RequestSizeLimit(ShareLimitBytes)]
    [DisableFormValueModelBinding]
    public async Task<ActionResult<ShortDto>> Share(CancellationToken ct)
    {
        if (UserId() is not { } userId)
        {
            return StatusCode(StatusCodes.Status401Unauthorized, new { message = "Sign in to share a Short." });
        }
        try
        {
            var result = await shorts.ShareAsync(Request.ContentType, Request.Body, Request.ContentLength, userId, ct);
            return CreatedAtAction(nameof(Get), new { slug = result.Short.Slug }, result.Short);
        }
        catch (RecordingRejectedException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    [HttpDelete("{slug:length(10)}")]
    public async Task<IActionResult> Delete(string slug, CancellationToken ct)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        if (await MayChangeAsync(clean, ct) is { } refusal) return refusal;
        return await shorts.DeleteAsync(clean, ct) ? NoContent() : NotFound();
    }

    /// <summary>A new poster for a Short: a JPEG in the body. For the key, an admin, or the
    /// creator who shared it (2026-11-08: studio shares went up with a black poster).</summary>
    [HttpPut("{slug:length(10)}/poster")]
    [RequestSizeLimit(PosterLimitBytes)]
    public async Task<ActionResult<ShortDto>> SetPoster(string slug, CancellationToken ct)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        if (await MayChangeAsync(clean, ct) is { } refusal) return refusal;
        try
        {
            return await shorts.SetPosterAsync(clean, Request.Body, ct) is { } dto ? Ok(dto) : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    /// <summary>A small copy for the share link to name (an MP4 in the body, at most 48 MiB):
    /// Discord embeds a linked video only under about 50 MB, and a roll's 4K is far over
    /// (2026-11-12). For the key, an admin, or the creator who shared it.</summary>
    [HttpPut("{slug:length(10)}/link-video")]
    [RequestSizeLimit(LinkVideoLimitBytes)]
    public async Task<ActionResult<ShortDto>> SetLinkVideo(string slug, CancellationToken ct)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        if (await MayChangeAsync(clean, ct) is { } refusal) return refusal;
        try
        {
            return await shorts.SetLinkVideoAsync(clean, Request.Body, ct) is { } dto ? Ok(dto) : NotFound();
        }
        catch (RecordingRejectedException ex)
        {
            return StatusCode(ex.StatusCode, new { message = ex.Message });
        }
    }

    /// <summary>Rewrites a Short's video as a plain MP4 when it is a fragmented one (a studio share
    /// from before shares were flattened on the way in), so a link preview can read it.</summary>
    [HttpPost("{slug:length(10)}/flatten")]
    public async Task<ActionResult<ShortDto>> Flatten(string slug, CancellationToken ct)
    {
        if (RecordingStorage.CleanSlug(slug) is not { } clean) return NotFound();
        if (await MayChangeAsync(clean, ct) is { } refusal) return refusal;
        return await shorts.FlattenVideoAsync(clean, ct) is { } dto ? Ok(dto) : NotFound();
    }

    /// <summary>Retention, for the nightly Shorts job (never by itself): takes down the Shorts a
    /// week old or more with 0-1 views, leaving their rows as tombstones whose keys
    /// <c>/keys</c> still names, and sweeps chunked uploads left unjoined a day. With
    /// <c>dryRun=true</c> it lists what it would take and changes nothing. For the key or an
    /// admin, as the upload is.</summary>
    [HttpPost("prune")]
    public async Task<ActionResult<ShortPruneDto>> Prune([FromQuery] bool dryRun = false, CancellationToken ct = default)
    {
        if (Refusal() is { } refusal) return refusal;
        return Ok(await shorts.PruneUnwatchedAsync(dryRun, ct));
    }

    /// <summary>Null when the request may change or take down the Short: the key, an admin, or
    /// the creator who shared it.</summary>
    private async Task<ObjectResult?> MayChangeAsync(string slug, CancellationToken ct)
    {
        if (Refusal() is not { } refusal) return null;
        return UserId() is { } userId && await shorts.SharedByAsync(slug, userId, ct) ? null : refusal;
    }

    private int? UserId()
    {
        if (User.Identity?.IsAuthenticated != true) return null;
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return int.TryParse(id, out var userId) ? userId : null;
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
        User.IsInRole(AppRoles.Admin) || AppRoles.HasAdminEmail(User);

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
