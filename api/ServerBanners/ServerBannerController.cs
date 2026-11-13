using api.Signatures;
using Microsoft.AspNetCore.Mvc;

namespace api.ServerBanners;

/// <summary>
/// Public endpoint for server signatures. Returns a generated PNG suitable for direct
/// embedding in forum BBCode ([img]...[/img]). Player count and current map are read fresh,
/// so the edge keeps it for 30 seconds only.
/// </summary>
[ApiController]
[Route("stats/servers")]
public class ServerBannerController(IServerBannerService bannerService) : ControllerBase
{
    /// <param name="mod">The mod whose models draw the hero; defaults to the server's own.</param>
    /// <param name="scene">The mod's scene (<c>/stats/signatures/catalogue</c> lists them).</param>
    /// <param name="style">The four pre-2026-11 art styles; links that still carry one get the server's mod.</param>
    [HttpGet("{serverName}/banner.png")]
    public async Task<IActionResult> GetBanner(
        string serverName,
        [FromQuery] string? mod,
        [FromQuery] string? scene,
        [FromQuery] string? style,
        [FromQuery] bool tickets = true,
        [FromQuery] int w = SignatureCanvas.DefaultWidth,
        CancellationToken cancellationToken = default)
    {
        _ = style;
        if (string.IsNullOrWhiteSpace(serverName))
        {
            return BadRequest(new { error = "serverName is required" });
        }

        serverName = Uri.UnescapeDataString(serverName);
        var bytes = await bannerService.RenderAsync(serverName, mod, scene, tickets, SignatureCanvas.ClampWidth(w), cancellationToken);
        if (bytes is null)
        {
            return NotFound(new { error = "Server not found" });
        }

        // The signature paints live server state, so the edge keeps it 30s: the collector's
        // own cadence, and hot servers are viewed far more often than that.
        Response.Headers.CacheControl = "public, max-age=30";
        return File(bytes, "image/png");
    }
}
