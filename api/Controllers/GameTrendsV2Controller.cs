using Microsoft.AspNetCore.Mvc;
using api.Analytics.Models;
using api.Caching;
using api.Constants;
using api.GameTrends;
using api.GameTrends.Models;
using Microsoft.Extensions.Logging;

namespace api.Controllers;

[ApiController]
[Route("stats/v2/game-trends")]
public class GameTrendsV2Controller(
    ISqliteGameTrendsService sqliteGameTrendsService,
    ICacheService cacheService,
    ILogger<GameTrendsV2Controller> logger) : ControllerBase
{
    /// <summary>
    /// Gets Google-style busy indicator comparing current activity to historical patterns, grouped by server.
    /// Uses SQLite aggregates for v2 endpoints.
    /// </summary>
    /// <param name="serverGuids">Required array of server GUIDs to analyze</param>
    [HttpGet("busy-indicator")]
    [ResponseCache(Duration = 300, Location = ResponseCacheLocation.Any)] // 5 minutes cache
    public async Task<ActionResult<GroupedServerBusyIndicatorResult>> GetBusyIndicator(
        [FromQuery] string[] serverGuids)
    {
        if (serverGuids == null || serverGuids.Length == 0)
        {
            return BadRequest("Server GUIDs are required");
        }

        try
        {
            var serverGuidsKey = string.Join(",", serverGuids.OrderBy(x => x));
            var cacheKey = $"trends:v2:busy:servers:{serverGuidsKey}";
            var cachedData = await cacheService.GetAsync<GroupedServerBusyIndicatorResult>(cacheKey);

            if (cachedData != null)
            {
                logger.LogDebug("Returning cached v2 server busy indicator for {ServerCount} servers",
                    serverGuids.Length);
                return Ok(cachedData);
            }

            var busyIndicator = await sqliteGameTrendsService.GetServerBusyIndicatorAsync(serverGuids);

            // Cache for 5 minutes - busy indicator should be current
            await cacheService.SetAsync(cacheKey, busyIndicator, TimeSpan.FromMinutes(5));

            logger.LogDebug("Generated v2 server busy indicator for {ServerCount} servers",
                serverGuids.Length);

            return Ok(busyIndicator);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating v2 server busy indicator for {ServerCount} servers",
                serverGuids?.Length ?? 0);
            return StatusCode(500, "Failed to generate server busy indicator");
        }
    }

    /// <summary>
    /// Gets comprehensive trend summary optimized for landing page display.
    /// Uses SQLite aggregates for v2 endpoints.
    /// </summary>
    /// <param name="game">Optional filter by game (bf1942)</param>
    [HttpGet("landing-summary")]
    [ResponseCache(Duration = 600, Location = ResponseCacheLocation.Any)] // 10 minutes cache
    public async Task<ActionResult<LandingPageTrendSummary>> GetLandingPageTrendSummary(
        [FromQuery] string? game = null)
    {
        try
        {
            var cacheKey = $"trends:v2:landing:{game ?? "all"}";
            var cachedData = await cacheService.GetAsync<LandingPageTrendSummary>(cacheKey);

            if (cachedData != null)
            {
                logger.LogDebug("Returning cached v2 landing page trend summary for game {GameId}", game ?? "all");
                return Ok(cachedData);
            }

            var insights = await sqliteGameTrendsService.GetSmartPredictionInsightsAsync(game);

            var summary = new LandingPageTrendSummary
            {
                Insights = insights,
                GeneratedAt = DateTime.UtcNow
            };

            // Cache for 10 minutes - landing page data should be fresh but not too frequent
            await cacheService.SetAsync(cacheKey, summary, TimeSpan.FromMinutes(10));

            logger.LogDebug("Generated v2 landing page trend summary for game {GameId}", game ?? "all");

            return Ok(summary);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating v2 landing page trend summary for game {GameId}", game);
            return StatusCode(500, "Failed to generate landing page trend summary");
        }
    }

    /// <summary>
    /// Hourly player counts across currently live servers. Fetched on demand from the
    /// landing trend drawer — not on first paint.
    /// </summary>
    [HttpGet("player-trend")]
    [ResponseCache(Duration = 900, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult<PlayerTrendResponse>> GetNetworkPlayerTrend(
        [FromQuery] string game = "bf1942",
        [FromQuery] int days = 60)
    {
        if (!ApiConstants.Games.AllowedGames.Contains(game.ToLowerInvariant()))
        {
            return BadRequest($"Invalid game type. Valid types: {string.Join(", ", ApiConstants.Games.AllowedGames)}");
        }

        try
        {
            var cacheKey = $"trends:v2:player-trend:network:{game.ToLowerInvariant()}:{days}";
            var cached = await cacheService.GetAsync<PlayerTrendResponse>(cacheKey);
            if (cached != null)
            {
                return Ok(cached);
            }

            var trend = await sqliteGameTrendsService.GetNetworkPlayerTrendAsync(game.ToLowerInvariant(), days);
            await cacheService.SetAsync(cacheKey, trend, TimeSpan.FromMinutes(15));
            return Ok(trend);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating network player trend for {Game}", game);
            return StatusCode(500, "Failed to generate player trend");
        }
    }

    /// <summary>
    /// Hourly player counts for one server. Primary-key range on ServerOnlineCounts.
    /// </summary>
    [HttpGet("player-trend/server/{serverGuid}")]
    [ResponseCache(Duration = 900, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult<PlayerTrendResponse>> GetServerPlayerTrend(
        string serverGuid,
        [FromQuery] int days = 60)
    {
        if (string.IsNullOrWhiteSpace(serverGuid))
        {
            return BadRequest("Server GUID is required");
        }

        try
        {
            var cacheKey = $"trends:v2:player-trend:server:{serverGuid}:{days}";
            var cached = await cacheService.GetAsync<PlayerTrendResponse>(cacheKey);
            if (cached != null)
            {
                return Ok(cached);
            }

            var trend = await sqliteGameTrendsService.GetServerPlayerTrendAsync(serverGuid, days);
            await cacheService.SetAsync(cacheKey, trend, TimeSpan.FromMinutes(15));
            return Ok(trend);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating player trend for server {ServerGuid}", serverGuid);
            return StatusCode(500, "Failed to generate player trend");
        }
    }

    /// <summary>
    /// Gets 7x24 weekly activity pattern for a server from pre-computed ServerHourlyPatterns.
    /// </summary>
    [HttpGet("servers/{serverGuid}/weekly-pattern")]
    [ResponseCache(Duration = 3600, Location = ResponseCacheLocation.Any)]
    public async Task<ActionResult<ServerWeeklyPatternResponse>> GetServerWeeklyPattern(
        string serverGuid,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(serverGuid))
        {
            return BadRequest("Server GUID is required");
        }

        try
        {
            var cacheKey = $"trends:v2:weekly-pattern:{serverGuid}";
            var cached = await cacheService.GetAsync<ServerWeeklyPatternResponse>(cacheKey, cancellationToken);
            if (cached != null)
            {
                return Ok(cached);
            }

            var pattern = await sqliteGameTrendsService.GetServerWeeklyPatternAsync(serverGuid, cancellationToken);
            await cacheService.SetAsync(cacheKey, pattern, TimeSpan.FromHours(1), cancellationToken);
            return Ok(pattern);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error generating weekly pattern for server {ServerGuid}", serverGuid);
            return StatusCode(500, "Failed to generate server weekly pattern");
        }
    }
}
