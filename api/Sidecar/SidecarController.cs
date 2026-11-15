using System.Security.Claims;
using api.Authorization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace api.Sidecar;

/// <summary>
/// The bfstats Sidecar early access page's API (features/early-access-sidecar):
/// the current release for an Early Adopter or an admin, with a signed link per
/// file, and the files themselves behind those links. A link is needed because a
/// download is a plain navigation, which carries no sign-in header.
/// </summary>
[ApiController]
[Route("stats/sidecar")]
public sealed class SidecarController(
    IOptions<SidecarDownloadsOptions> options,
    IDataProtectionProvider protection,
    ILogger<SidecarController> logger) : ControllerBase
{
    private readonly SidecarDownloadsOptions settings = options.Value;
    private readonly ITimeLimitedDataProtector protector =
        protection.CreateProtector(SidecarLink.Purpose).ToTimeLimitedDataProtector();

    public sealed record FileDto(string File, string Platform, string? Arch, long Size, string? Sha256, string Url);

    public sealed record ReleaseDto(string Version, string? ReleasedAt, DateTimeOffset LinksExpireAt, IReadOnlyList<FileDto> Files);

    /// <summary>The release to download, or 404 while none is uploaded.</summary>
    [HttpGet("release")]
    [Authorize(Policy = AppRoles.EarlyAccessPolicy)]
    public ActionResult<ReleaseDto> Release()
    {
        Response.Headers.CacheControl = "private, no-store";
        if (UserId() is not { } userId) return Forbid();
        if (SidecarRelease.Read(settings.Path) is not { } release) return NotFound();
        var lifetime = TimeSpan.FromMinutes(Math.Max(1, settings.LinkMinutes));
        var files = release.Files
            .Select(f => new FileDto(f.File, f.Platform, f.Arch, f.Size, f.Sha256,
                $"/stats/sidecar/files/{Uri.EscapeDataString(f.File)}?t={Uri.EscapeDataString(SidecarLink.Make(protector, f.File, userId, lifetime))}"))
            .ToList();
        return Ok(new ReleaseDto(release.Version, release.ReleasedAt, DateTimeOffset.UtcNow + lifetime, files));
    }

    /// <summary>One file of the release, for a link <see cref="Release"/> made.</summary>
    [HttpGet("files/{file}")]
    [AllowAnonymous]
    public IActionResult Download(string file, [FromQuery(Name = "t")] string? token)
    {
        Response.Headers.CacheControl = "private, no-store";
        if (!SidecarRelease.IsPlainName(file)
            || SidecarRelease.Read(settings.Path) is not { } release
            || release.Files.FirstOrDefault(f => f.File == file) is not { } entry)
        {
            return NotFound();
        }
        if (SidecarLink.Check(protector, token, entry.File) is not { } userId)
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                "This download link has expired. Open the early access page again for a new one.");
        }
        logger.LogInformation("Sidecar download {File} ({Version}) by user {UserId}", entry.File, release.Version, userId);
        return PhysicalFile(Path.Combine(settings.Path, entry.File), "application/octet-stream",
            fileDownloadName: entry.File, enableRangeProcessing: true);
    }

    private int? UserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return int.TryParse(id, out var userId) ? userId : null;
    }
}
