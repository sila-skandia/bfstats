using api.Caching;
using api.Landing.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace api.Landing;

[ApiController]
[Route("stats/landing")]
public class LandingController(
    ILandingService landingService,
    ICacheService cacheService,
    ILogger<LandingController> logger) : ControllerBase
{
    private static readonly string[] ValidGames = ["bf1942", "fh2", "bfvietnam"];

    [HttpGet("network-pulse")]
    [ResponseCache(Duration = 120, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult<NetworkPulseResponse>> GetNetworkPulse(
        [FromQuery] string? game = null,
        [FromQuery] int trendHours = 12,
        CancellationToken cancellationToken = default)
    {
        if (trendHours < 1 || trendHours > 72)
        {
            return BadRequest("trendHours must be between 1 and 72");
        }

        if (!string.IsNullOrWhiteSpace(game) && !ValidGames.Contains(game.ToLowerInvariant()))
        {
            return BadRequest($"Invalid game. Valid values: {string.Join(", ", ValidGames)}");
        }

        var cacheKey = $"landing:network-pulse:{game ?? "all"}:{trendHours}";
        var cached = await cacheService.GetAsync<NetworkPulseResponse>(cacheKey, cancellationToken);
        if (cached != null)
        {
            return Ok(cached);
        }

        try
        {
            var pulse = await landingService.GetNetworkPulseAsync(game, trendHours, cancellationToken);
            await cacheService.SetAsync(cacheKey, pulse, TimeSpan.FromMinutes(2), cancellationToken);
            return Ok(pulse);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating network pulse for game {Game}", game ?? "all");
            return StatusCode(500, "Failed to generate network pulse");
        }
    }
}
