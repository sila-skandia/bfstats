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
        [FromQuery] bool tickets = true,
        [FromQuery] int w = ServerBannerRenderer.DefaultWidth,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(serverName))
        {
            return BadRequest(new { error = "serverName is required" });
        }

        serverName = Uri.UnescapeDataString(serverName);
        ServerBannerStyleExtensions.TryParse(style, out var bannerStyle);

        var bytes = await bannerService.RenderAsync(serverName, bannerStyle, tickets, ServerBannerRenderer.ClampWidth(w), cancellationToken);
        if (bytes is null)
        {
            return NotFound(new { error = "Server not found" });
        }

        // The banner paints live server state, so it can't be cached for long — but
        // no-store meant re-rendering the PNG for every single view (p50 ~460ms,
        // p95 ~714ms) and cf-cache-status: BYPASS, so the render also cost a round
        // trip to Finland every time. The underlying data only moves as fast as the
        // stats collector, so 30s matches the freshest it can ever be. Hot servers
        // are shown far more than twice a minute; those views now come off the edge.
        Response.Headers.CacheControl = "public, max-age=30";
        return File(bytes, "image/png");
    }
}
