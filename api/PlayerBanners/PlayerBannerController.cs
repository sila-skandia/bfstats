using Microsoft.AspNetCore.Mvc;

namespace api.PlayerBanners;

/// <summary>
/// Public endpoint for player signature banners. Returns a generated PNG suitable
/// for direct embedding in forum BBCode ([img]…[/img]).
/// </summary>
[ApiController]
[Route("stats/players")]
public class PlayerBannerController(IPlayerBannerService bannerService) : ControllerBase
{
    [HttpGet("{playerName}/banner.png")]
    [ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> GetBanner(
        string playerName,
        [FromQuery] string? style,
        [FromQuery] string? server,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(playerName))
        {
            return BadRequest(new { error = "playerName is required" });
        }

        playerName = Uri.UnescapeDataString(playerName);
        BannerStyleExtensions.TryParse(style, out var bannerStyle);

        var bytes = await bannerService.RenderAsync(playerName, bannerStyle, server, cancellationToken);
        if (bytes is null)
        {
            return NotFound(new { error = "No stats available for this player" });
        }

        Response.Headers.CacheControl = "public, max-age=3600";
        return File(bytes, "image/png");
    }
}
