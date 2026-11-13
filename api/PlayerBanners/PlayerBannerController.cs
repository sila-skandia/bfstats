using api.Signatures;
using Microsoft.AspNetCore.Mvc;

namespace api.PlayerBanners;

/// <summary>
/// Public endpoint for player signatures. Returns a generated PNG suitable for direct
/// embedding in forum BBCode ([img]...[/img]).
/// </summary>
[ApiController]
[Route("stats/players")]
public class PlayerBannerController(IPlayerBannerService bannerService) : ControllerBase
{
    /// <param name="mod">The mod whose models draw the hero (<c>fhsw</c>); defaults to BF1942.</param>
    /// <param name="scene">The mod's scene (<c>/stats/signatures/catalogue</c> lists them).</param>
    /// <param name="style">The four pre-2026-11 backdrops (tank, plane, island, map); still honoured as scenes.</param>
    /// <param name="server">A server guid to scope the stats to; lifetime stats without one.</param>
    [HttpGet("{playerName}/banner.png")]
    [ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Any)]
    public async Task<IActionResult> GetBanner(
        string playerName,
        [FromQuery] string? mod,
        [FromQuery] string? scene,
        [FromQuery] string? style,
        [FromQuery] string? server,
        [FromQuery] int w = SignatureCanvas.DefaultWidth,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(playerName))
        {
            return BadRequest(new { error = "playerName is required" });
        }

        playerName = Uri.UnescapeDataString(playerName);
        scene ??= LegacyScene(style);

        var bytes = await bannerService.RenderAsync(playerName, mod, scene, server, SignatureCanvas.ClampWidth(w), cancellationToken);
        if (bytes is null)
        {
            return NotFound(new { error = "No stats available for this player" });
        }

        Response.Headers.CacheControl = "public, max-age=3600";
        return File(bytes, "image/png");
    }

    /// <summary>The scene that stands in for each of the old backdrop styles, so posted links keep their subject.</summary>
    internal static string? LegacyScene(string? style) => style?.Trim().ToLowerInvariant() switch
    {
        "tank" => "armour",
        "plane" => "fighter",
        "island" => "bomber",
        "map" => "assault",
        _ => null
    };
}
