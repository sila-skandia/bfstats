using api.Caching;
using api.Players.Models;
using api.PlayerTracking;
using api.PlayerStats;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.Players;

public class PlayerStatsService(
    PlayerTrackerDbContext dbContext,
    ISqlitePlayerStatsService sqlitePlayerStatsService,
    ILogger<PlayerStatsService> logger,
    ICacheService? cacheService = null) : IPlayerStatsService
{
    // Define a threshold for considering a player "active" (e.g., 5 minutes)
    private readonly TimeSpan _activeThreshold = TimeSpan.FromMinutes(1);

    public async Task<PagedResult<PlayerBasicInfo>> GetAllPlayersWithPaging(
        int page,
        int pageSize,
        string sortBy,
        string sortOrder,
        PlayerFilters? filters = null)
    {
        var baseQuery = dbContext.Players.Where(p => !p.AiBot);

        // Apply filters at the database level first
        if (filters != null)
        {
            if (!string.IsNullOrEmpty(filters.PlayerName))
            {
                baseQuery = baseQuery.Where(p => EF.Functions.Like(p.Name, $"%{filters.PlayerName}%"));
            }

            if (filters.MinPlayTime.HasValue)
            {
                baseQuery = baseQuery.Where(p => p.TotalPlayTimeMinutes >= filters.MinPlayTime.Value);
            }

            if (filters.MaxPlayTime.HasValue)
            {
                baseQuery = baseQuery.Where(p => p.TotalPlayTimeMinutes <= filters.MaxPlayTime.Value);
            }

            if (filters.LastSeenFrom.HasValue)
            {
                baseQuery = baseQuery.Where(p => p.LastSeen >= filters.LastSeenFrom.Value);
            }

            if (filters.LastSeenTo.HasValue)
            {
                baseQuery = baseQuery.Where(p => p.LastSeen <= filters.LastSeenTo.Value);
            }

            if (filters.IsActive.HasValue)
            {
                var activePlayerNames = await dbContext.PlayerSessions
                    .FromSqlRaw("SELECT * FROM \"PlayerSessions\" WHERE \"IsActive\" = 1")
                    .AsNoTracking()
                    .Select(s => s.PlayerName)
                    .Distinct()
                    .ToListAsync();

                baseQuery = filters.IsActive.Value
                    ? baseQuery.Where(p => activePlayerNames.Contains(p.Name))
                    : baseQuery.Where(p => !activePlayerNames.Contains(p.Name));
            }

            // Server-related filters - filter by players who have active sessions matching criteria
            if (!string.IsNullOrEmpty(filters.ServerName) ||
                !string.IsNullOrEmpty(filters.GameId) ||
                !string.IsNullOrEmpty(filters.Game) ||
                !string.IsNullOrEmpty(filters.MapName))
            {
                var matchingQuery = dbContext.PlayerSessions
                    .FromSqlRaw("SELECT * FROM \"PlayerSessions\" WHERE \"IsActive\" = 1")
                    .AsNoTracking()
                    .Include(s => s.Server)
                    .AsQueryable();

                if (!string.IsNullOrEmpty(filters.ServerName))
                    matchingQuery = matchingQuery.Where(s => s.Server.Name.Contains(filters.ServerName));
                if (!string.IsNullOrEmpty(filters.GameId))
                    matchingQuery = matchingQuery.Where(s => s.Server.GameId == filters.GameId);
                if (!string.IsNullOrEmpty(filters.Game))
                    matchingQuery = matchingQuery.Where(s => s.Server.Game == filters.Game);
                if (!string.IsNullOrEmpty(filters.MapName))
                    matchingQuery = matchingQuery.Where(s => s.MapName.Contains(filters.MapName));

                var matchingPlayerNames = await matchingQuery.Select(s => s.PlayerName).Distinct().ToListAsync();
                baseQuery = baseQuery.Where(p => matchingPlayerNames.Contains(p.Name));
            }
        }

        // Apply sorting at database level
        var isDescending = sortOrder.ToLower() == "desc";

        var sortField = sortBy.ToLower();
        IQueryable<Player> query;

        if (sortField == "isactive")
        {
            var activePlayerNames = await dbContext.PlayerSessions
                .FromSqlRaw("SELECT * FROM \"PlayerSessions\" WHERE \"IsActive\" = 1")
                .AsNoTracking()
                .Select(s => s.PlayerName)
                .Distinct()
                .ToListAsync();

            query = isDescending
                ? baseQuery.OrderByDescending(p => activePlayerNames.Contains(p.Name)).ThenByDescending(p => p.LastSeen)
                : baseQuery.OrderBy(p => activePlayerNames.Contains(p.Name)).ThenByDescending(p => p.LastSeen);
        }
        else
        {
            query = sortField switch
            {
                "playername" => isDescending
                    ? baseQuery.OrderByDescending(p => p.Name)
                    : baseQuery.OrderBy(p => p.Name),
                "totalplaytimeminutes" => isDescending
                    ? baseQuery.OrderByDescending(p => p.TotalPlayTimeMinutes)
                    : baseQuery.OrderBy(p => p.TotalPlayTimeMinutes),
                "lastseen" => isDescending
                    ? baseQuery.OrderByDescending(p => p.LastSeen)
                    : baseQuery.OrderBy(p => p.LastSeen),
                _ => baseQuery.OrderByDescending(p => p.LastSeen)
            };
        }

        // Get total count for pagination directly on base query without subqueries
        var totalCount = await baseQuery.CountAsync();

        // Apply pagination
        var players = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(p => new PlayerBasicInfo
            {
                PlayerName = p.Name,
                TotalPlayTimeMinutes = p.TotalPlayTimeMinutes,
                LastSeen = p.LastSeen,
            })
            .ToListAsync();

        var totalPages = (int)Math.Ceiling((double)totalCount / pageSize);

        // Enrich with active session info and aggregate stats from PlayerServerStats (batch load for efficiency)
        if (players.Count > 0)
        {
            var playerNames = players.Select(p => p.PlayerName).ToList();

            // Get active session details for current page players
            var activeSessions = await dbContext.PlayerSessions
                .FromSqlRaw("SELECT * FROM \"PlayerSessions\" WHERE \"IsActive\" = 1")
                .AsNoTracking()
                .Where(s => playerNames.Contains(s.PlayerName))
                .Select(s => new
                {
                    s.PlayerName,
                    s.ServerGuid,
                    ServerName = s.Server.Name,
                    s.MapName,
                    s.Server.GameId,
                    s.TotalKills,
                    s.TotalDeaths
                })
                .ToListAsync();

            var activeLookup = activeSessions.ToDictionary(s => s.PlayerName);

            // Get aggregate stats for all players in the current page
            var aggregateStats = await dbContext.PlayerServerStats
                .Where(pss => playerNames.Contains(pss.PlayerName))
                .GroupBy(pss => pss.PlayerName)
                .Select(g => new
                {
                    PlayerName = g.Key,
                    TotalKills = g.Sum(x => x.TotalKills),
                    TotalDeaths = g.Sum(x => x.TotalDeaths),
                    TotalRounds = g.Sum(x => x.TotalRounds),
                })
                .ToDictionaryAsync(x => x.PlayerName);

            // Get favorite server for each player (server with most rounds)
            var favoriteServers = await dbContext.PlayerServerStats
                .Where(pss => playerNames.Contains(pss.PlayerName))
                .GroupBy(pss => new { pss.PlayerName, pss.ServerGuid })
                .Select(g => new
                {
                    g.Key.PlayerName,
                    g.Key.ServerGuid,
                    TotalRounds = g.Sum(x => x.TotalRounds)
                })
                .ToListAsync();

            var favoriteServerByPlayer = favoriteServers
                .GroupBy(x => x.PlayerName)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderByDescending(x => x.TotalRounds).First().ServerGuid
                );

            // Get server names for favorite servers
            var favoriteServerGuids = favoriteServerByPlayer.Values.Distinct().ToList();
            var serverNames = await dbContext.Servers
                .Where(s => favoriteServerGuids.Contains(s.Guid))
                .ToDictionaryAsync(s => s.Guid, s => s.Name);

            // Get recent activity (rounds this week)
            var now = DateTime.UtcNow;
            var currentYear = now.Year;
            var currentWeek = System.Globalization.ISOWeek.GetWeekOfYear(now);

            var recentActivity = await dbContext.PlayerServerStats
                .Where(pss => playerNames.Contains(pss.PlayerName)
                    && pss.Year == currentYear
                    && pss.Week == currentWeek)
                .GroupBy(pss => pss.PlayerName)
                .Select(g => new
                {
                    PlayerName = g.Key,
                    RoundsThisWeek = g.Sum(x => x.TotalRounds)
                })
                .ToDictionaryAsync(x => x.PlayerName);

            // Enrich player data
            foreach (var player in players)
            {
                if (activeLookup.TryGetValue(player.PlayerName, out var active))
                {
                    player.IsActive = true;
                    player.CurrentServer = new ServerInfo
                    {
                        ServerGuid = active.ServerGuid,
                        ServerName = active.ServerName,
                        MapName = active.MapName,
                        GameId = active.GameId,
                        SessionKills = active.TotalKills,
                        SessionDeaths = active.TotalDeaths
                    };
                }

                if (aggregateStats.TryGetValue(player.PlayerName, out var stats))
                {
                    player.TotalKills = stats.TotalKills;
                    player.TotalDeaths = stats.TotalDeaths;
                    player.TotalRounds = stats.TotalRounds;
                }

                if (favoriteServerByPlayer.TryGetValue(player.PlayerName, out var favoriteServerGuid) &&
                    serverNames.TryGetValue(favoriteServerGuid, out var favoriteServerName))
                {
                    player.FavoriteServer = favoriteServerName;
                }

                if (recentActivity.TryGetValue(player.PlayerName, out var recent))
                {
                    player.RecentActivity = new RecentActivitySummary
                    {
                        RoundsThisWeek = recent.RoundsThisWeek
                    };
                }
            }
        }

        return new PagedResult<PlayerBasicInfo>
        {
            Items = players,
            Page = page,
            PageSize = pageSize,
            TotalItems = totalCount,
            TotalPages = totalPages
        };
    }

    public async Task<PlayerTimeStatistics> GetPlayerStatistics(string playerName)
    {
        if (string.IsNullOrWhiteSpace(playerName))
            return new PlayerTimeStatistics();

        var cacheKey = $"player_stats:{playerName.ToLowerInvariant()}";
        if (cacheService != null)
        {
            var cached = await cacheService.GetAsync<PlayerTimeStatistics>(cacheKey);
            if (cached != null)
            {
                return cached;
            }
        }

        // First check if the player exists
        var player = await dbContext.Players
            .FirstOrDefaultAsync(p => p.Name == playerName);

        if (player == null)
            return new PlayerTimeStatistics();

        var now = DateTime.UtcNow;

        // Execute queries - SQLite paths run sequentially to avoid DbContext threading issues

        // 1. First run all DbContext queries sequentially
        var sessionStats = await dbContext.PlayerSessions
            .Where(ps => ps.PlayerName == playerName && !ps.IsDeleted)
            .GroupBy(ps => ps.PlayerName)
            .Select(g => new
            {
                FirstPlayed = g.Min(s => s.StartTime),
                LastPlayed = g.Max(s => s.LastSeenTime),
                TotalSessions = g.Count(),
                HighestScore = g.Max(s => s.TotalScore)
            })
            .FirstOrDefaultAsync();

        var recentSessions = await dbContext.PlayerSessions
            .Where(ps => ps.PlayerName == playerName)
            .OrderByDescending(s => s.LastSeenTime)
            .Include(s => s.Server)
            .Take(10)
            .Select(s => new Session
            {
                SessionId = s.SessionId,
                RoundId = s.RoundId,
                ServerName = s.Server.Name,
                ServerGuid = s.ServerGuid,
                MapName = s.MapName,
                GameType = s.GameType,
                StartTime = s.StartTime,
                LastSeenTime = s.LastSeenTime,
                TotalKills = s.TotalKills,
                TotalDeaths = s.TotalDeaths,
                TotalScore = s.TotalScore,
                IsActive = s.IsActive,
                GameId = s.Server.GameId,
                PlayerTeamLabel = s.CurrentTeamLabel
            })
            .ToListAsync();

        // Enrich recent sessions with round context (placement + win/loss)
        var roundIds = recentSessions
            .Where(s => s.RoundId != null)
            .Select(s => s.RoundId!)
            .Distinct()
            .ToList();

        if (roundIds.Count > 0)
        {
            var rounds = await dbContext.Rounds
                .Where(r => roundIds.Contains(r.RoundId))
                .Select(r => new { r.RoundId, r.Tickets1, r.Tickets2, r.Team1Label, r.Team2Label, r.ParticipantCount })
                .ToDictionaryAsync(r => r.RoundId);

            var scoresByRound = await dbContext.PlayerSessions
                .Where(ps => ps.RoundId != null && roundIds.Contains(ps.RoundId) && !ps.IsDeleted)
                .Select(ps => new { ps.RoundId, ps.TotalScore })
                .ToListAsync();

            var groupedScores = scoresByRound
                .GroupBy(x => x.RoundId!)
                .ToDictionary(g => g.Key, g => g.Select(x => x.TotalScore).OrderDescending().ToList());

            foreach (var session in recentSessions.Where(s => s.RoundId != null))
            {
                if (rounds.TryGetValue(session.RoundId!, out var round))
                {
                    session.TotalParticipants = round.ParticipantCount
                        ?? (groupedScores.TryGetValue(session.RoundId!, out var scores) ? scores.Count : null);

                    // Compute placement from sorted scores
                    if (groupedScores.TryGetValue(session.RoundId!, out var roundScores))
                    {
                        session.Placement = roundScores.IndexOf(session.TotalScore) + 1;
                    }

                    // Compute team result from ticket counts
                    var teamLabel = session.PlayerTeamLabel?.Trim();
                    if (round.Tickets1.HasValue && round.Tickets2.HasValue
                        && !string.IsNullOrEmpty(round.Team1Label) && !string.IsNullOrEmpty(round.Team2Label)
                        && !string.IsNullOrEmpty(teamLabel))
                    {
                        if (round.Tickets1 == round.Tickets2)
                        {
                            session.TeamResult = "tie";
                        }
                        else
                        {
                            var winningTeam = round.Tickets1 > round.Tickets2 ? round.Team1Label : round.Team2Label;
                            session.TeamResult = string.Equals(winningTeam.Trim(), teamLabel, StringComparison.OrdinalIgnoreCase)
                                ? "win" : "loss";
                        }
                    }
                }
            }
        }

        // 2. Get player stats (SQLite)
        PlayerLifetimeStats? lifetimeStats = null;
        try
        {
            // lookBackDays: 0 → true lifetime aggregate. The default of 30 days
            // made "Lifetime kills" silently time-boxed: any player not seen
            // in the last 30 days reported 0 across the board.
            lifetimeStats = await sqlitePlayerStatsService.GetPlayerStatsAsync(playerName, lookBackDays: 0);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to get player stats for player: {PlayerName}", playerName);
        }

        // 3. Get server insights (SQLite)
        List<ServerInsight> serverInsights;
        try
        {
            // lookBackDays: 0 → all-time per-server breakdown for the Servers
            // tab on PlayerDetailsV4. Default of 30 days plus a 10-hour
            // min-playtime filter made the tab empty for most players.
            serverInsights = await sqlitePlayerStatsService.GetPlayerServerInsightsAsync(playerName, lookBackDays: 0) ?? [];
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to get server insights for player: {PlayerName}", playerName);
            serverInsights = [];
        }

        // 4. Get best scores (SQLite)
        PlayerBestScores bestScores;
        try
        {
            bestScores = await sqlitePlayerStatsService.GetPlayerBestScoresAsync(playerName) ?? new PlayerBestScores();
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to get best scores for player: {PlayerName}", playerName);
            bestScores = new PlayerBestScores();
        }

        // 5. Get insights and recent stats trends
        var insights = await GetPlayerInsights(playerName);
        var firstKnownPlayed = sessionStats?.FirstPlayed ?? (player.FirstSeen != default ? player.FirstSeen : null);
        var recentStats = await GetRecentStatsTrends(playerName, firstKnownPlayed);

        var aggregateStats = new
        {
            FirstPlayed = sessionStats?.FirstPlayed ?? DateTime.MinValue,
            LastPlayed = sessionStats?.LastPlayed ?? DateTime.MinValue,
            TotalSessions = sessionStats?.TotalSessions ?? 0,
            HighestScore = sessionStats?.HighestScore ?? 0,
            TotalKills = lifetimeStats?.TotalKills ?? 0,
            TotalDeaths = lifetimeStats?.TotalDeaths ?? 0,
            TotalPlayTimeMinutes = lifetimeStats != null
                ? (int)Math.Round(lifetimeStats.TotalPlayTimeMinutes)
                : 0
        };

        // Get server names for the insights using batch query
        if (serverInsights.Any())
        {
            var serverGuids = serverInsights.Select(si => si.ServerGuid).ToList();
            var servers = await dbContext.Servers
                .Where(s => serverGuids.Contains(s.Guid))
                .Select(s => new { s.Guid, s.Name, s.GameId })
                .ToListAsync();

            var serverLookup = servers.ToDictionary(s => s.Guid, s => new { s.Name, s.GameId });

            foreach (var serverInsight in serverInsights)
            {
                if (serverLookup.TryGetValue(serverInsight.ServerGuid, out var server))
                {
                    serverInsight.ServerName = server.Name;
                    serverInsight.GameId = server.GameId;
                }
            }
        }


        // Get the current active session if any
        var activeSession = recentSessions
            .FirstOrDefault(ps => ps.IsActive);

        // Check if player is currently active (seen within the last 5 minutes)
        bool isActive = activeSession != null &&
                        (now - activeSession.LastSeenTime) <= _activeThreshold;

        var stats = new PlayerTimeStatistics
        {
            TotalPlayTimeMinutes = aggregateStats.TotalPlayTimeMinutes,
            TotalSessions = aggregateStats.TotalSessions,
            HighestScore = aggregateStats.HighestScore,
            FirstPlayed = aggregateStats.FirstPlayed,
            LastPlayed = aggregateStats.LastPlayed,
            TotalKills = aggregateStats.TotalKills,
            TotalDeaths = aggregateStats.TotalDeaths,

            IsActive = isActive,
            CurrentServer = isActive && activeSession != null
                ? new ServerInfo
                {
                    ServerGuid = activeSession.ServerGuid,
                    ServerName = activeSession.ServerName,
                    SessionKills = activeSession.TotalKills,
                    SessionDeaths = activeSession.TotalDeaths,
                    GameId = activeSession.GameId,
                    MapName = activeSession.MapName,
                }
                : null,
            RecentSessions = recentSessions,
            Insights = insights,
            Servers = serverInsights,
            RecentStats = recentStats,
            BestScores = bestScores
        };

        if (cacheService != null)
        {
            // 30s was short enough that entries expired before a second reader arrived —
            // a FLUSHALL-then-browse cycle found no player keys surviving in Redis at all,
            // for a payload that costs 460-730ms of 19 sequential queries to rebuild.
            // The edge copy (EdgeCache(30) on the endpoint) revalidates every 30s while a
            // page is open, and it is those revalidations this cache exists to absorb.
            await cacheService.SetAsync(cacheKey, stats, TimeSpan.FromMinutes(5));
        }

        return stats;
    }

    public async Task<SessionDetail?> GetSession(string playerName, int sessionId)
    {
        var session = await dbContext.PlayerSessions
            .Where(s => s.SessionId == sessionId && s.PlayerName == playerName)
            .Include(s => s.Player)
            .Include(s => s.Server)
            .Include(s => s.Observations)
            .FirstOrDefaultAsync();

        if (session == null)
        {
            return null;
        }

        var sessionDetail = new SessionDetail
        {
            SessionId = session.SessionId,
            RoundId = session.RoundId,
            PlayerName = session.PlayerName,
            ServerName = session.Server.Name,
            MapName = session.MapName,
            GameType = session.GameType,
            StartTime = session.StartTime,
            EndTime = session.IsActive ? null : session.LastSeenTime,
            TotalPlayTimeMinutes = (int)Math.Ceiling((session.LastSeenTime - session.StartTime).TotalMinutes),
            TotalKills = session.TotalKills,
            TotalDeaths = session.TotalDeaths,
            TotalScore = session.TotalScore,
            IsActive = session.IsActive,

            // Player details
            PlayerDetails = new PlayerDetailInfo
            {
                Name = session.Player.Name,
                TotalPlayTimeMinutes = session.Player.TotalPlayTimeMinutes,
                FirstSeen = session.Player.FirstSeen,
                LastSeen = session.Player.LastSeen,
                IsAiBot = session.Player.AiBot
            },

            // Server details
            ServerDetails = new ServerDetailInfo
            {
                Guid = session.Server.Guid,
                Name = session.Server.Name,
                Address = session.Server.Ip,
                Port = session.Server.Port,
                GameId = session.Server.GameId
            },

            // Observations over time
            Observations = session.Observations.Select(o => new ObservationInfo
            {
                Timestamp = o.Timestamp,
                Score = o.Score,
                Kills = o.Kills,
                Deaths = o.Deaths,
                Ping = o.Ping,
                Team = o.Team,
                TeamLabel = o.TeamLabel
            }).ToList(),

        };

        return sessionDetail;
    }

    public async Task<PlayerInsights> GetPlayerInsights(
        string playerName,
        DateTime? startDate = null,
        DateTime? endDate = null,
        int? daysToAnalyze = null)
    {
        // Calculate the time period
        var endPeriod = endDate ?? DateTime.UtcNow;
        DateTime startPeriod;

        if (startDate.HasValue)
        {
            startPeriod = startDate.Value;
        }
        else if (daysToAnalyze.HasValue)
        {
            startPeriod = endPeriod.AddDays(-daysToAnalyze.Value);
        }
        else
        {
            // Default to 1 week
            startPeriod = endPeriod.AddDays(-7);
        }

        // Check if the player exists
        var player = await dbContext.Players
            .FirstOrDefaultAsync(p => p.Name == playerName);

        if (player == null)
            return new PlayerInsights { PlayerName = playerName, StartPeriod = startPeriod, EndPeriod = endPeriod };

        var insights = new PlayerInsights
        {
            PlayerName = playerName,
            StartPeriod = startPeriod,
            EndPeriod = endPeriod
        };

        // 1. Get server rankings and average ping
        var serverRankings = await GetServerRankingsWithPing(playerName);

        // Order by rank (best rank first) and assign to insights
        insights.ServerRankings = serverRankings
            .OrderBy(r => r.Rank)
            .ToList();

        // 2. Calculate activity by hour from sessions
        var activityByHour = await GetActivityByHourFromSessions(playerName, startPeriod, endPeriod);
        insights.ActivityByHour = activityByHour;

        return insights;
    }

    private sealed class ServerRankingQueryResult
    {
        public string ServerGuid { get; set; } = "";
        public int TotalScore { get; set; }
        public int PlayerRank { get; set; }
        public int TotalPlayers { get; set; }
    }

    private async Task<List<ServerRanking>> GetServerRankingsWithPing(string playerName)
    {
        // First, get the player's server stats efficiently using the covering index (PlayerName, ServerGuid, TotalScore)
        var playerServerStats = await dbContext.ServerPlayerRankings
            .Where(r => r.PlayerName == playerName)
            .GroupBy(r => r.ServerGuid)
            .Select(g => new
            {
                ServerGuid = g.Key,
                TotalScore = g.Sum(x => x.TotalScore)
            })
            .ToListAsync();

        if (!playerServerStats.Any())
            return [];

        // Get server names separately
        var serverGuids = playerServerStats.Select(s => s.ServerGuid).ToList();
        var servers = await dbContext.Servers
            .Where(s => serverGuids.Contains(s.Guid))
            .ToDictionaryAsync(s => s.Guid, s => s.Name);

        // Get ping data from SQLite PlayerSessions
        var pingData = await GetAveragePingFromSessions(playerName, serverGuids);

        // Calculate rankings in a single batched CTE query across all servers using SQLite window functions
        var serverGuidsIn = string.Join(",", serverGuids.Select(g => $"'{g.Replace("'", "''")}'"));

        var batchRankingSql = $"""
            WITH ServerTotals AS (
                SELECT ServerGuid, PlayerName, SUM(TotalScore) AS TotalScore
                FROM ServerPlayerRankings
                WHERE ServerGuid IN ({serverGuidsIn})
                GROUP BY ServerGuid, PlayerName
            ),
            RankedPlayers AS (
                SELECT
                    ServerGuid,
                    PlayerName,
                    TotalScore,
                    RANK() OVER (PARTITION BY ServerGuid ORDER BY TotalScore DESC) AS PlayerRank,
                    COUNT(*) OVER (PARTITION BY ServerGuid) AS TotalPlayers
                FROM ServerTotals
            )
            SELECT ServerGuid, TotalScore, PlayerRank, TotalPlayers
            FROM RankedPlayers
            WHERE PlayerName = @playerName
            """;

        var rankingResults = await dbContext.Database
            .SqlQueryRaw<ServerRankingQueryResult>(batchRankingSql,
                new Microsoft.Data.Sqlite.SqliteParameter("@playerName", playerName))
            .ToListAsync();

        var rankingDict = rankingResults.ToDictionary(r => r.ServerGuid, r => r);

        var results = new List<ServerRanking>();
        foreach (var serverStat in playerServerStats)
        {
            if (rankingDict.TryGetValue(serverStat.ServerGuid, out var rankingResult))
            {
                results.Add(new ServerRanking
                {
                    ServerGuid = serverStat.ServerGuid,
                    ServerName = servers.GetValueOrDefault(serverStat.ServerGuid, "Unknown Server"),
                    Rank = rankingResult.PlayerRank,
                    TotalScore = rankingResult.TotalScore,
                    TotalRankedPlayers = rankingResult.TotalPlayers,
                    AveragePing = Math.Round(pingData.GetValueOrDefault(serverStat.ServerGuid, 0.0), 2)
                });
            }
            else
            {
                results.Add(new ServerRanking
                {
                    ServerGuid = serverStat.ServerGuid,
                    ServerName = servers.GetValueOrDefault(serverStat.ServerGuid, "Unknown Server"),
                    Rank = 1,
                    TotalScore = serverStat.TotalScore,
                    TotalRankedPlayers = 1,
                    AveragePing = Math.Round(pingData.GetValueOrDefault(serverStat.ServerGuid, 0.0), 2)
                });
            }
        }

        return results;
    }

    private async Task<Dictionary<string, double>> GetAveragePingFromSessions(string playerName, List<string> serverGuids)
    {
        if (!serverGuids.Any())
            return new Dictionary<string, double>();

        try
        {
            var sixMonthsAgo = DateTime.UtcNow.AddMonths(-6);

            var pingData = await dbContext.PlayerSessions
                .Where(ps => ps.PlayerName == playerName &&
                            serverGuids.Contains(ps.ServerGuid) &&
                            ps.AveragePing > 0 &&
                            ps.AveragePing < 1000 &&
                            ps.StartTime >= sixMonthsAgo)
                .GroupBy(ps => ps.ServerGuid)
                .Select(g => new
                {
                    ServerGuid = g.Key,
                    AvgPing = g.Average(ps => ps.AveragePing)
                })
                .ToListAsync();

            return pingData.ToDictionary(p => p.ServerGuid, p => p.AvgPing ?? 0);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to get ping data from SQLite for player {PlayerName}", playerName);
            return new Dictionary<string, double>();
        }
    }

    private async Task<List<HourlyActivity>> GetActivityByHourFromSessions(string playerName, DateTime startPeriod, DateTime endPeriod)
    {
        // Fallback method using the original SQLite-based calculation
        var sessions = await dbContext.PlayerSessions
            .Where(ps => ps.PlayerName == playerName && ps.StartTime >= startPeriod && ps.LastSeenTime <= endPeriod)
            .ToListAsync();

        // Initialize hourly activity tracker
        var hourlyActivity = new Dictionary<int, int>();
        for (int hour = 0; hour < 24; hour++)
        {
            hourlyActivity[hour] = 0;
        }

        // Process each session's time range and break into hourly chunks
        foreach (var session in sessions)
        {
            var sessionStart = session.StartTime;
            var sessionEnd = session.LastSeenTime;

            // Track activity by processing continuous blocks of time
            var currentTime = sessionStart;

            while (currentTime < sessionEnd)
            {
                int hour = currentTime.Hour;

                // Calculate how much time was spent in this hour
                // Either go to the end of the current hour or the end of the session, whichever comes first
                var hourEnd = new DateTime(
                    currentTime.Year,
                    currentTime.Month,
                    currentTime.Day,
                    hour,
                    59,
                    59,
                    999);

                if (hourEnd > sessionEnd)
                {
                    hourEnd = sessionEnd;
                }

                // Add the minutes spent in this hour
                int minutesInHour = (int)Math.Ceiling((hourEnd - currentTime).TotalMinutes);
                hourlyActivity[hour] += minutesInHour;

                // Move to the next hour
                currentTime = hourEnd.AddMilliseconds(1);
            }
        }

        return hourlyActivity
            .Select(kvp => new HourlyActivity { Hour = kvp.Key, MinutesActive = kvp.Value })
            .OrderByDescending(ha => ha.MinutesActive)
            .ToList();
    }

    private async Task<RecentStats> GetRecentStatsTrends(string playerName, DateTime? knownFirstSeen = null)
    {
        var endDate = DateTime.UtcNow;

        DateTime? firstSeen = knownFirstSeen;
        if (!firstSeen.HasValue)
        {
            // Find the player's earliest session if not already provided
            var firstSeenSql = "SELECT MIN(StartTime) AS Value FROM PlayerSessions WHERE PlayerName = {0} AND IsDeleted = 0";
            firstSeen = await dbContext.Database
                .SqlQueryRaw<DateTime?>(firstSeenSql, playerName)
                .FirstOrDefaultAsync();
        }

        var startDate = firstSeen ?? endDate.AddDays(-90);

        // Daily granularity provides a rich high-resolution trend wave across the career timeline.
        var bucketExpr = "DATE(StartTime)";
        var granularity = "daily";

        var sql = $@"
            SELECT
                MIN(DATE(StartTime)) as Date,
                SUM(TotalKills) as TotalKills,
                SUM(TotalDeaths) as TotalDeaths,
                CAST(SUM((julianday(LastSeenTime) - julianday(StartTime)) * 1440) AS REAL) as TotalMinutes,
                COUNT(*) as SessionCount
            FROM PlayerSessions
            WHERE PlayerName = {{0}} AND IsDeleted = 0
            GROUP BY {bucketExpr}
            ORDER BY MIN(StartTime)";

        var dailyStats = await dbContext.Database
            .SqlQueryRaw<DailyStatsResult>(sql, playerName)
            .ToListAsync();

        var totalRoundsAnalyzed = dailyStats.Sum(d => d.SessionCount);

        if (!dailyStats.Any())
        {
            return new RecentStats
            {
                AnalysisPeriodStart = startDate,
                AnalysisPeriodEnd = endDate,
                TotalRoundsAnalyzed = 0,
                Granularity = granularity,
                KdRatioTrend = new List<TrendDataPoint>(),
                KillRateTrend = new List<TrendDataPoint>()
            };
        }

        var kdRatioTrend = dailyStats
            .Select(d => new TrendDataPoint
            {
                Timestamp = d.Date,
                Value = d.TotalDeaths > 0 ? (double)d.TotalKills / d.TotalDeaths : d.TotalKills,
                SessionCount = d.SessionCount
            })
            .ToList();

        var killRateTrend = dailyStats
            .Select(d => new TrendDataPoint
            {
                Timestamp = d.Date,
                Value = d.TotalMinutes > 0 ? d.TotalKills / d.TotalMinutes : 0,
                SessionCount = d.SessionCount
            })
            .ToList();

        return new RecentStats
        {
            AnalysisPeriodStart = startDate,
            AnalysisPeriodEnd = endDate,
            TotalRoundsAnalyzed = totalRoundsAnalyzed,
            Granularity = granularity,
            KdRatioTrend = kdRatioTrend,
            KillRateTrend = killRateTrend
        };
    }

    private class DailyStatsResult
    {
        public DateTime Date { get; set; }
        public int TotalKills { get; set; }
        public int TotalDeaths { get; set; }
        public double TotalMinutes { get; set; }
        public int SessionCount { get; set; }
    }

    public async Task<PagedResult<PlayerBasicInfo>> SearchPlayersAsync(
        string query,
        int page = 1,
        int pageSize = 10)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return new PagedResult<PlayerBasicInfo>
            {
                Items = [],
                Page = page,
                PageSize = pageSize,
                TotalItems = 0,
                TotalPages = 0
            };
        }

        var trimmed = query.Trim();
        var offset = Math.Max(0, (page - 1) * pageSize);

        var matchingQuery = dbContext.Players
            .AsNoTracking()
            .Where(p => !p.AiBot && EF.Functions.Like(p.Name, $"%{trimmed}%"));

        var totalItems = await matchingQuery.CountAsync();
        var totalPages = (int)Math.Ceiling((double)totalItems / pageSize);

        var results = await matchingQuery
            .OrderByDescending(p => EF.Functions.Like(p.Name, $"{trimmed}%"))
            .ThenByDescending(p => p.TotalPlayTimeMinutes)
            .Skip(offset)
            .Take(pageSize)
            .Select(p => new PlayerBasicInfo
            {
                PlayerName = p.Name,
                TotalPlayTimeMinutes = p.TotalPlayTimeMinutes,
                LastSeen = p.LastSeen
            })
            .ToListAsync();

        // Populate active status and current server for the matched small subset (5-10 items)
        if (results.Count > 0)
        {
            var matchedNames = results.Select(r => r.PlayerName).ToList();
            var activeSessions = await dbContext.PlayerSessions
                .AsNoTracking()
                .Where(s => s.IsActive && matchedNames.Contains(s.PlayerName))
                .Select(s => new
                {
                    s.PlayerName,
                    s.ServerGuid,
                    ServerName = s.Server.Name,
                    s.MapName,
                    s.Server.GameId,
                    s.TotalKills,
                    s.TotalDeaths
                })
                .ToListAsync();

            if (activeSessions.Count > 0)
            {
                var activeLookup = activeSessions.ToDictionary(s => s.PlayerName);
                foreach (var p in results)
                {
                    if (activeLookup.TryGetValue(p.PlayerName, out var session))
                    {
                        p.IsActive = true;
                        p.CurrentServer = new ServerInfo
                        {
                            ServerGuid = session.ServerGuid,
                            ServerName = session.ServerName,
                            MapName = session.MapName,
                            GameId = session.GameId,
                            SessionKills = session.TotalKills,
                            SessionDeaths = session.TotalDeaths
                        };
                    }
                }
            }
        }

        return new PagedResult<PlayerBasicInfo>
        {
            Items = results,
            Page = page,
            PageSize = pageSize,
            TotalItems = totalItems,
            TotalPages = totalPages
        };
    }
}

