using api.Caching;
using api.PlayerStats.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace api.PlayerStats;

[ApiController]
[Route("stats/[controller]")]
public class LeaderboardController(
    ISqliteLeaderboardService sqliteLeaderboardService,
    ILogger<LeaderboardController> logger) : ControllerBase
{
    private const int MaxPageSize = 100;
    private const int MaxSearchLength = 64;
    private const int MaxUnscopedDays = 365;

    /// <summary>
    /// Retrieves a paged global leaderboard. Filtering, search, sort, and paging run in SQL.
    /// </summary>
    /// <param name="page">Page index (1-based, default: 1).</param>
    /// <param name="pageSize">Number of items per page (default: 50, max: 100).</param>
    /// <param name="sortBy">Column to sort by (score, kd, kills, deaths, kpm, playMin, rounds, player, favServer, favMap).</param>
    /// <param name="sortDir">Sort direction: asc or desc (default: desc).</param>
    /// <param name="q">Search query across player name, tag, server, and map.</param>
    /// <param name="server">Comma-separated server names or GUIDs to include. Wins over exclude / populated-only.</param>
    /// <param name="map">Comma-separated map names to include (e.g. Wake Island,Bocage).</param>
    /// <param name="days">Lookback period in days (default: 30). 0 is all-time, allowed only with a server filter; otherwise capped at 365.</param>
    /// <param name="minRounds">Minimum rounds played to be included (default: 1).</param>
    /// <param name="minPlay">Minimum play time in minutes (default: 0).</param>
    /// <param name="game">Game filter (default: bf1942).</param>
    /// <param name="exclude">Comma-separated server names or GUIDs to omit from aggregation.</param>
    /// <param name="populatedOnly">When true, keep only servers in the high-occupancy cluster (regular player counts).</param>
    /// <returns>Paged global leaderboard dataset, active servers, and active maps.</returns>
    [HttpGet]
    [EdgeCache(60)]
    [ProducesResponseType(typeof(GlobalLeaderboardResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<GlobalLeaderboardResponse>> GetLeaderboard(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string sortBy = "score",
        [FromQuery] string sortDir = "desc",
        [FromQuery] string? q = null,
        [FromQuery] string? server = null,
        [FromQuery] string? map = null,
        [FromQuery] int days = 30,
        [FromQuery] int minRounds = 1,
        [FromQuery] int minPlay = 0,
        [FromQuery] string game = "bf1942",
        [FromQuery] string? exclude = null,
        [FromQuery] bool populatedOnly = false)
    {
        if (days < 0)
            return BadRequest("Days parameter cannot be negative.");

        if (page < 1)
            page = 1;

        if (pageSize < 1)
            pageSize = 50;
        else if (pageSize > MaxPageSize)
            pageSize = MaxPageSize;

        if (!string.IsNullOrWhiteSpace(q) && q.Length > MaxSearchLength)
            q = q[..MaxSearchLength];

        var scopedToServer = !string.IsNullOrWhiteSpace(server);
        if (!scopedToServer && (days == 0 || days > MaxUnscopedDays))
            days = MaxUnscopedDays;

        if (minRounds < 1)
            minRounds = 1;

        if (minPlay < 0)
            minPlay = 0;

        logger.LogDebug("Fetching global leaderboard: page={Page}, size={PageSize}, sort={SortBy} {SortDir}, q={Q}, server={Server}, exclude={Exclude}, populatedOnly={PopulatedOnly}, map={Map}, days={Days}, minRounds={MinRounds}, minPlay={MinPlay}",
            page, pageSize, sortBy, sortDir, q, server, exclude, populatedOnly, map, days, minRounds, minPlay);

        try
        {
            var response = await sqliteLeaderboardService.GetGlobalLeaderboardAsync(
                page, pageSize, sortBy, sortDir, q, server, map, days, minRounds, minPlay, game, exclude, populatedOnly);
            return Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to generate global leaderboard for days={Days}", days);
            return StatusCode(StatusCodes.Status500InternalServerError, "Failed to retrieve leaderboard data.");
        }
    }

    /// <summary>
    /// Searches available maps for map filters on the leaderboard.
    /// </summary>
    /// <param name="q">Optional search substring for map name.</param>
    /// <param name="limit">Max maps to return (default: 50, max: 200).</param>
    [HttpGet("maps")]
    [EdgeCache(3600)]
    [ProducesResponseType(typeof(List<string>), StatusCodes.Status200OK)]
    public async Task<ActionResult<List<string>>> GetMaps(
        [FromQuery] string? q = null,
        [FromQuery] int limit = 50)
    {
        if (limit < 1) limit = 50;
        if (limit > 200) limit = 200;

        try
        {
            var maps = await sqliteLeaderboardService.SearchMapsAsync(q, limit);
            return Ok(maps);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to search leaderboard maps for q={Q}", q);
            return StatusCode(StatusCodes.Status500InternalServerError, "Failed to retrieve maps.");
        }
    }
}
