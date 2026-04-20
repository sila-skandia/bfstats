using Microsoft.AspNetCore.Mvc;

namespace api.ServerBanners;

/// <summary>
/// Public endpoint for server signature banners. Returns a generated PNG suitable
/// for direct embedding in forum BBCode ([img]…[/img]). The response is intentionally
/// uncached — player count and current map/mode are read fresh on every request.
/// </summary>
[ApiController]
[Route("stats/servers")]
public class ServerBannerController(IServerBannerService bannerService) : ControllerBase
{
    [HttpGet("{serverName}/banner.png")]
    public async Task<IActionResult> GetBanner(
        string serverName,
        [FromQuery] string? style,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(serverName))
        {
            return BadRequest(new { error = "serverName is required" });
        }

        serverName = Uri.UnescapeDataString(serverName);
        ServerBannerStyleExtensions.TryParse(style, out var bannerStyle);

        var bytes = await bannerService.RenderAsync(serverName, bannerStyle, cancellationToken);
        if (bytes is null)
        {
            return NotFound(new { error = "Server not found" });
        }

        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        Response.Headers.Pragma = "no-cache";
        return File(bytes, "image/png");
    }
}
