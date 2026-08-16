using api.Bflist;
using api.Bflist.Models;
using api.Constants;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using api.Caching;
using api.Servers;

namespace api.Controllers;

[ApiController]
[Route("stats/[controller]")]
public class LiveServersController(
    IBfListApiService bfListApiService,
    IBotDetectionService botDetectionService,
    ILogger<LiveServersController> logger,
    PlayerTrackerDbContext dbContext) : ControllerBase
{

    private static readonly string[] ValidGames = ApiConstants.Games.AllowedGames;

    // How old the live snapshot can be before we stop trusting it as "current" — a couple of
    // missed 30s collection cycles' worth of grace. Beyond this: don't let Cloudflare lock the
    // response in at the edge, and the UI switches to its "data may be stale" treatment.
    private static readonly TimeSpan StaleDataThreshold = TimeSpan.FromSeconds(90);

    /// <summary>
    /// Get all servers for a specific game
    /// </summary>
    /// <param name="game">Game type: bf1942</param>
    /// <param name="showAll">If true, show all servers including offline ones. If false (default), show only online servers.</param>
    /// <returns>Server list</returns>
    // This payload is identical for every visitor, so Cloudflare can absorb repeat
    // traffic. The browser must still request it on every landing-page visit and poll.
    //
    // s-maxage tracks the UI's own 30s poll interval — a shorter TTL bought freshness
    // nobody consumed and made expiry more frequent, which matters because Cloudflare
    // does not appear to honour stale-while-revalidate here: an expired entry was
    // measured revalidating synchronously (cf-cache-status: EXPIRED, 1164ms) rather
    // than serving stale and refreshing behind the request. Every expiry is a visitor
    // paying full origin latency, so expiries should be no more frequent than the data
    // actually changes.
    [HttpGet("{game}/servers")]
    [EdgeCache(30, StaleWhileRevalidate = 30)]
    public async Task<ActionResult<ServerListResponse>> GetServers(string game, [FromQuery] bool showAll = false)
    {
        if (!ValidGames.Contains(game.ToLower()))
        {
            return BadRequest($"Invalid game type. Valid types: {string.Join(", ", ValidGames)}");
        }

        var stopwatch = System.Diagnostics.Stopwatch.StartNew();

        try
        {
            ServerSummary[] serverList;
            DateTime fetchedAtUtc;
            var isFallback = false;

            if (showAll)
            {
                // Historical/offline browse mode — BFList's live response only contains
                // servers it can currently reach, so this still needs the DB.
                serverList = await GetServersFromDatabaseAsync(game, showAll: true) ?? [];
                fetchedAtUtc = DateTime.UtcNow;
            }
            else
            {
                try
                {
                    var snapshot = await GetLiveServersAsync(game);
                    serverList = snapshot.Servers;
                    fetchedAtUtc = snapshot.FetchedAtUtc;
                    isFallback = snapshot.IsFallback;
                }
                catch (Exception ex)
                {
                    // No hot cache, no live upstream, no last-known-good — genuinely nothing to show.
                    logger.LogError(ex, "No live server snapshot available for {Game}", game);
                    serverList = [];
                    fetchedAtUtc = DateTime.UtcNow;
                    isFallback = true;
                }
            }

            var totalPlayers = serverList.Sum(s => s.NumPlayers);
            var isStale = isFallback || DateTime.UtcNow - fetchedAtUtc > StaleDataThreshold;

            // Don't let Cloudflare edge-cache a degraded, empty, or stale response — every one
            // of those should be re-checked on the next request rather than served for the
            // full SWR window.
            if (serverList.Length == 0 || totalPlayers == 0 || isStale)
            {
                Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
            }

            var response = new ServerListResponse
            {
                Servers = serverList,
                LastUpdated = fetchedAtUtc.ToString("O")
            };

            return Ok(response);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error fetching servers for game {Game} after {ElapsedMs}ms", game, stopwatch.ElapsedMilliseconds);
            return StatusCode(500, "Internal server error");
        }
    }

    /// <summary>
    /// The landing page's "who's online now" — sourced directly from the last successful
    /// BFList poll (via <see cref="IBfListApiService.FetchAllServersWithMetaAsync"/>) rather
    /// than reconstructed from PlayerSessions. This removes the active-session threshold
    /// entirely: there's nothing to age out, the snapshot either reflects reality as of
    /// FetchedAtUtc or falls back to the last known one.
    /// </summary>
    private async Task<(ServerSummary[] Servers, DateTime FetchedAtUtc, bool IsFallback)> GetLiveServersAsync(string game)
    {
        var snapshot = await bfListApiService.FetchAllServersWithMetaAsync(game);
        var summaries = snapshot.Servers.Select(bfListApiService.MapToSummary).ToArray();

        if (summaries.Length > 0)
        {
            // Bot flag isn't reported by the bf1942 API — apply the same name-pattern
            // detection PlayerTrackingService uses at ingestion time.
            foreach (var summary in summaries)
            {
                foreach (var player in summary.Players)
                {
                    player.AiBot = botDetectionService.IsBotPlayer(player.Name, false);
                }
            }

            // Geo/Discord/forum data isn't in the BFList payload — cheap point lookup by
            // Guid, not the PlayerSessions/Rounds scans this used to require.
            var guids = summaries.Select(s => s.Guid).ToArray();
            var geoByGuid = await dbContext.Servers
                .AsNoTracking()
                .Where(s => guids.Contains(s.Guid))
                .ToDictionaryAsync(s => s.Guid);

            foreach (var summary in summaries)
            {
                if (geoByGuid.TryGetValue(summary.Guid, out var gameServer))
                {
                    summary.Country = gameServer.Country;
                    summary.Region = gameServer.Region;
                    summary.City = gameServer.City;
                    summary.Loc = gameServer.Loc;
                    summary.Timezone = gameServer.Timezone;
                    summary.Org = gameServer.Org;
                    summary.Postal = gameServer.Postal;
                    summary.GeoLookupDate = gameServer.GeoLookupDate;
                    summary.DiscordUrl = gameServer.DiscordUrl;
                    summary.ForumUrl = gameServer.ForumUrl;
                }
                summary.IsOnline = true;
                summary.LastSeenTime = snapshot.FetchedAtUtc;
            }
        }

        var sorted = summaries.OrderByDescending(s => s.NumPlayers).ToArray();
        return (sorted, snapshot.FetchedAtUtc, snapshot.IsFallback);
    }

    /// <summary>
    /// Get individual server data for real-time updates
    /// </summary>
    /// <param name="game">Game type: bf1942</param>
    /// <param name="ip">Server IP address</param>
    /// <param name="port">Server port number</param>
    /// <returns>Individual server data</returns>
    [HttpGet("{game}/{ip}/{port}")]
    [EdgeCache(10, StaleWhileRevalidate = 5)]
    public async Task<ActionResult<ServerSummary>> GetServer(string game, string ip, int port)
    {
        if (!ValidGames.Contains(game.ToLower()))
        {
            return BadRequest($"Invalid game type. Valid types: {string.Join(", ", ValidGames)}");
        }

        if (!IsValidServerDetails(ip, port))
        {
            return BadRequest("Invalid server details. IP must be valid and port must be 1-65535");
        }

        var serverIdentifier = $"{ip}:{port}";

        try
        {
            var server = await bfListApiService.FetchSingleServerSummaryAsync(game, serverIdentifier);
            if (server == null)
            {
                return NotFound($"Server {serverIdentifier} not found");
            }

            // Enrich server with geo location data from database
            var enrichedServers = await EnrichServersWithGeoLocationAsync(new[] { server });
            var enrichedServer = enrichedServers.FirstOrDefault();

            return Ok(enrichedServer ?? server);
        }
        catch (HttpRequestException ex)
        {
            logger.LogError(ex, "Failed to fetch server {ServerIdentifier} from BFList API for game {Game}",
                serverIdentifier, game);
            return StatusCode(502, "Failed to fetch server data from upstream API");
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unexpected error fetching server {ServerIdentifier} for game {Game}",
                serverIdentifier, game);
            return StatusCode(500, "Internal server error");
        }
    }

    private async Task<ServerSummary[]> GetServersFromDatabaseAsync(string game, bool showAll = false)
    {
        var totalStopwatch = System.Diagnostics.Stopwatch.StartNew();
        var stepStopwatch = System.Diagnostics.Stopwatch.StartNew();

        // Align active session threshold with session timeout (5 minutes) rather than 60s
        // so deployments and transient collection delays do not abruptly drop active players to 0.
        var activeThreshold = DateTime.UtcNow.AddMinutes(-5);

        // Get servers filtering only by online status
        stepStopwatch.Restart();
        var serverQuery = dbContext.Servers
            .AsNoTracking()
            .Where(s => s.Game.ToLower() == game.ToLower());

        // Filter by online status unless showing all servers
        if (!showAll)
        {
            serverQuery = serverQuery.Where(s => s.IsOnline);
        }

        var servers = await serverQuery.ToListAsync();
        stepStopwatch.Stop();
        logger.LogDebug("Step 1 - Servers query completed in {ElapsedMs}ms. Found {ServerCount} servers",
            stepStopwatch.ElapsedMilliseconds, servers.Count);

        if (servers.Count == 0)
        {
            return [];
        }

        var serverGuids = servers.Select(s => s.Guid).ToHashSet();
        logger.LogDebug("Processing {ServerCount} servers with GUIDs: {ServerGuids}",
            servers.Count, string.Join(", ", serverGuids.Take(5)) + (serverGuids.Count > 5 ? "..." : ""));

        // Get active player sessions efficiently (excluding bots) using the IsActive index directly
        stepStopwatch.Restart();
        var allActiveSessions = await dbContext.PlayerSessions
            .FromSqlRaw("SELECT * FROM \"PlayerSessions\" WHERE \"IsActive\" = 1")
            .AsNoTracking()
            .Include(ps => ps.Player)
            .Where(ps => ps.LastSeenTime >= activeThreshold
                         && (!ps.Player.AiBot))
            .ToListAsync();
        var activeSessions = allActiveSessions.Where(ps => serverGuids.Contains(ps.ServerGuid)).ToList();
        stepStopwatch.Stop();
        logger.LogDebug("Step 2 - Active player sessions query completed in {ElapsedMs}ms. Found {SessionCount} sessions WITH ALL DATA",
            stepStopwatch.ElapsedMilliseconds, activeSessions.Count);

        // ELIMINATED: PlayerObservations query - no longer needed!
        logger.LogDebug("Step 3 - SKIPPED PlayerObservations query - using denormalized data from PlayerSession!");

        // Get current rounds efficiently using the IsActive index directly.
        // Server merges can leave multiple IsActive rounds per ServerGuid until the next map change closes them, so pick the most recent.
        stepStopwatch.Restart();
        var allActiveRounds = await dbContext.Rounds
            .FromSqlRaw("SELECT * FROM \"Rounds\" WHERE \"IsActive\" = 1")
            .AsNoTracking()
            .ToListAsync();
        var currentRounds = allActiveRounds
            .Where(r => serverGuids.Contains(r.ServerGuid))
            .GroupBy(r => r.ServerGuid)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.StartTime).First());
        stepStopwatch.Stop();
        logger.LogDebug("Step 4 - Current rounds query completed in {ElapsedMs}ms. Found {RoundCount} active rounds",
            stepStopwatch.ElapsedMilliseconds, currentRounds.Count);

        // Build response by combining the data. Isolate each server: a data quirk on one
        // server (e.g. post-merge inconsistency) must not 500 the whole list — this endpoint
        // drives the landing page.
        stepStopwatch.Restart();
        var serverSummaries = new List<ServerSummary>(servers.Count);
        var skipped = 0;
        foreach (var server in servers)
        {
            try
            {
                var serverSessions = activeSessions.Where(ps => ps.ServerGuid == server.Guid).ToList();
                currentRounds.TryGetValue(server.Guid, out var currentRound);

                serverSummaries.Add(new ServerSummary
                {
                    Guid = server.Guid,
                    Name = server.Name,
                    Ip = server.Ip,
                    Port = server.Port,
                    NumPlayers = serverSessions.Count,
                    MaxPlayers = server.MaxPlayers ?? 64,
                    MapName = server.MapName ?? "",
                    GameType = currentRound?.GameType ?? "",
                    JoinLink = server.JoinLink ?? "",
                    RoundTimeRemain = currentRound?.RoundTimeRemain ?? 0,
                    Tickets1 = currentRound?.Tickets1 ?? 0,
                    Tickets2 = currentRound?.Tickets2 ?? 0,
                    Players = serverSessions.Select(session => new PlayerInfo
                    {
                        Name = session.PlayerName,
                        Score = session.TotalScore,
                        Kills = session.TotalKills,
                        Deaths = session.TotalDeaths,
                        Ping = session.CurrentPing,      // From denormalized field
                        Team = session.CurrentTeam,      // From denormalized field
                        TeamLabel = session.CurrentTeamLabel, // From denormalized field
                        AiBot = session.Player?.AiBot ?? false
                    }).ToArray(),
                    Teams = BuildTeamsFromRound(currentRound),
                    Country = server.Country,
                    Region = server.Region,
                    City = server.City,
                    Loc = server.Loc,
                    Timezone = server.Timezone,
                    Org = server.Org,
                    Postal = server.Postal,
                    GeoLookupDate = server.GeoLookupDate,
                    IsOnline = server.IsOnline,
                    LastSeenTime = server.LastSeenTime,
                    DiscordUrl = server.DiscordUrl,
                    ForumUrl = server.ForumUrl,
                    GameId = server.GameId
                });
            }
            catch (Exception ex)
            {
                skipped++;
                logger.LogError(ex, "Failed to build summary for server {ServerGuid} ({ServerName}); skipping", server.Guid, server.Name);
            }
        }
        if (skipped > 0)
        {
            logger.LogWarning("Skipped {SkippedCount} of {TotalCount} servers due to projection errors for game {Game}", skipped, servers.Count, game);
        }
        stepStopwatch.Stop();
        logger.LogDebug("Step 5 - Response building completed in {ElapsedMs}ms", stepStopwatch.ElapsedMilliseconds);

        stepStopwatch.Restart();
        var sortedSummaries = serverSummaries.OrderByDescending(s => s.NumPlayers).ToArray();
        stepStopwatch.Stop();
        totalStopwatch.Stop();

        logger.LogDebug("Step 6 - Sorting completed in {ElapsedMs}ms", stepStopwatch.ElapsedMilliseconds);
        logger.LogDebug("GetServersFromDatabaseAsync completed in {TotalMs}ms, returning {ServerCount} servers",
            totalStopwatch.ElapsedMilliseconds, sortedSummaries.Length);

        return sortedSummaries;
    }

    private static TeamInfo[] BuildTeamsFromRound(Round? currentRound)
    {
        if (currentRound == null) return [];

        var teams = new List<TeamInfo>();

        if (!string.IsNullOrEmpty(currentRound.Team1Label))
        {
            teams.Add(new TeamInfo { Index = 1, Label = currentRound.Team1Label, Tickets = currentRound.Tickets1 ?? 0 });
        }
        if (!string.IsNullOrEmpty(currentRound.Team2Label))
        {
            teams.Add(new TeamInfo { Index = 2, Label = currentRound.Team2Label, Tickets = currentRound.Tickets2 ?? 0 });
        }

        return teams.ToArray();
    }

    private static bool IsValidServerDetails(string ip, int port)
    {
        return !string.IsNullOrEmpty(ip) &&
               System.Net.IPAddress.TryParse(ip, out _) &&
               port > 0 && port <= 65535;
    }

    private async Task<ServerSummary[]> EnrichServersWithGeoLocationAsync(ServerSummary[] servers)
    {
        if (servers.Length == 0) return servers;

        // Create lookup table for server geo data by GUID
        var serverGuids = servers.Select(s => s.Guid).ToArray();
        var geoData = await dbContext.Servers
            .Where(gs => serverGuids.Contains(gs.Guid))
            .ToDictionaryAsync(gs => gs.Guid, gs => gs);

        // Enrich servers with geo location data
        foreach (var server in servers)
        {
            if (geoData.TryGetValue(server.Guid, out var gameServer))
            {
                server.Country = gameServer.Country;
                server.Region = gameServer.Region;
                server.City = gameServer.City;
                server.Loc = gameServer.Loc;
                server.Timezone = gameServer.Timezone;
                server.Org = gameServer.Org;
                server.Postal = gameServer.Postal;
                server.GeoLookupDate = gameServer.GeoLookupDate;
                server.DiscordUrl = gameServer.DiscordUrl;
                server.ForumUrl = gameServer.ForumUrl;
                server.GameId = gameServer.GameId;
            }
        }

        return servers;
    }


}
