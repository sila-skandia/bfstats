using System.Diagnostics;
using System.Globalization;
using api.Analytics.Models;
using api.Players.Models;
using api.PlayerTracking;
using api.Telemetry;
using Microsoft.EntityFrameworkCore;
using NodaTime;
using ServerStatistics = api.Analytics.Models.ServerStatistics;

namespace api.PlayerStats;

/// <summary>
/// SQLite-based player stats service that queries pre-computed tables.
/// </summary>
public class SqlitePlayerStatsService(PlayerTrackerDbContext dbContext) : ISqlitePlayerStatsService
{
    private sealed class HighestScoreSession
    {
        public string ServerGuid { get; set; } = "";
        public int HighestScore { get; set; }
        public string? HighestScoreRoundId { get; set; }
    }

    private async Task<List<HighestScoreSession>> GetHighestScoreSessionsAsync(
        string playerName,
        string[] serverGuids)
    {
        if (serverGuids.Length == 0)
            return [];

        var serverGuidsIn = string.Join(",", serverGuids.Select(g => $"'{g.Replace("'", "''")}'"));

        var sql = $"""
            SELECT ServerGuid, TotalScore AS HighestScore, RoundId AS HighestScoreRoundId
            FROM (
                SELECT 
                    ServerGuid, 
                    TotalScore, 
                    RoundId,
                    ROW_NUMBER() OVER (
                        PARTITION BY ServerGuid 
                        ORDER BY TotalScore DESC, StartTime DESC
                    ) AS RowNum
                FROM PlayerSessions
                WHERE PlayerName = @playerName 
                  AND ServerGuid IN ({serverGuidsIn})
            )
            WHERE RowNum = 1
            """;

        return await dbContext.Database
            .SqlQueryRaw<HighestScoreSession>(sql,
                new Microsoft.Data.Sqlite.SqliteParameter("@playerName", playerName))
            .ToListAsync();
    }

    /// <inheritdoc/>
    public async Task<PlayerLifetimeStats?> GetPlayerStatsAsync(string playerName, int lookBackDays = 30)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetPlayerStatsAsync");
        activity?.SetTag("query.name", "GetPlayerStats");
        activity?.SetTag("query.filters", $"player:{playerName},lookBackDays:{lookBackDays}");

        var stopwatch = Stopwatch.StartNew();

        var query = dbContext.PlayerStatsMonthly.Where(p => p.PlayerName == playerName);
        if (lookBackDays > 0)
        {
            var cutoff = Instant.FromDateTimeUtc(DateTime.SpecifyKind(DateTime.UtcNow.AddDays(-lookBackDays), DateTimeKind.Utc));
            query = query.Where(p => p.LastRoundTime >= cutoff);
        }

        // SUM across matching months for lifetime stats
        var stats = await query
            .GroupBy(p => p.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalRounds = g.Sum(p => p.TotalRounds),
                TotalKills = g.Sum(p => p.TotalKills),
                TotalDeaths = g.Sum(p => p.TotalDeaths),
                TotalScore = g.Sum(p => p.TotalScore),
                TotalPlayTimeMinutes = g.Sum(p => p.TotalPlayTimeMinutes),
                FirstRoundTime = g.Min(p => p.FirstRoundTime),
                LastRoundTime = g.Max(p => p.LastRoundTime)
            })
            .SingleOrDefaultAsync();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", stats != null ? 1 : 0);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerStatsMonthly");

        if (stats == null)
            return null;

        // Calculate derived stats from totals
        var avgScorePerRound = stats.TotalRounds > 0 ? (double)stats.TotalScore / stats.TotalRounds : 0;
        var kdRatio = stats.TotalDeaths > 0 ? (double)stats.TotalKills / stats.TotalDeaths : stats.TotalKills;
        var killRate = stats.TotalPlayTimeMinutes > 0 ? stats.TotalKills / stats.TotalPlayTimeMinutes : 0;

        return new PlayerLifetimeStats
        {
            PlayerName = stats.PlayerName,
            TotalRounds = stats.TotalRounds,
            TotalKills = stats.TotalKills,
            TotalDeaths = stats.TotalDeaths,
            TotalScore = stats.TotalScore,
            TotalPlayTimeMinutes = stats.TotalPlayTimeMinutes,
            AvgScorePerRound = avgScorePerRound,
            KdRatio = kdRatio,
            KillRate = killRate,
            FirstRoundTime = stats.FirstRoundTime.ToDateTimeUtc(),
            LastRoundTime = stats.LastRoundTime.ToDateTimeUtc()
        };
    }

    /// <inheritdoc/>
    public async Task<List<ServerStatistics>> GetPlayerMapStatsAsync(
        string playerName,
        TimePeriod period,
        string? serverGuid = null)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetPlayerMapStatsAsync");
        activity?.SetTag("query.name", "GetPlayerMapStats");
        activity?.SetTag("query.filters", $"player:{playerName},server:{serverGuid ?? "all"},period:{period}");

        var stopwatch = Stopwatch.StartNew();

        // Filter by server or use global stats (empty string)
        var targetServerGuid = string.IsNullOrEmpty(serverGuid)
            ? Data.Entities.PlayerMapStats.GlobalServerGuid
            : serverGuid;

        var now = DateTime.UtcNow;
        var (startYear, startMonth, endYear, endMonth) = period switch
        {
            TimePeriod.ThisYear => (now.Year, 1, now.Year, 12),
            TimePeriod.LastYear => (now.Year - 1, 1, now.Year - 1, 12),
            TimePeriod.Last30Days => (now.AddDays(-30).Year, now.AddDays(-30).Month, now.Year, now.Month),
            _ => throw new ArgumentOutOfRangeException(nameof(period), period, "Unsupported time period")
        };

        if (!string.IsNullOrEmpty(serverGuid))
        {
            var server = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid);
            var serverGameId = server?.GameId;

            var mapStats = await dbContext.PlayerMapStats
                .Where(p => p.PlayerName == playerName && p.ServerGuid == serverGuid)
                .Where(p =>
                    (p.Year > startYear || (p.Year == startYear && p.Month >= startMonth)) &&
                    (p.Year < endYear || (p.Year == endYear && p.Month <= endMonth)))
                .GroupBy(p => p.MapName)
                .Select(g => new
                {
                    MapName = g.Key,
                    TotalScore = g.Sum(p => p.TotalScore),
                    TotalKills = g.Sum(p => p.TotalKills),
                    TotalDeaths = g.Sum(p => p.TotalDeaths),
                    TotalRounds = g.Sum(p => p.TotalRounds),
                    TotalPlayTimeMinutes = g.Sum(p => p.TotalPlayTimeMinutes)
                })
                .OrderByDescending(p => p.TotalKills)
                .ToListAsync();

            stopwatch.Stop();
            activity?.SetTag("result.row_count", mapStats.Count);
            activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
            activity?.SetTag("result.table", "PlayerMapStats");

            return mapStats.Select(m => new ServerStatistics
            {
                MapName = m.MapName,
                GameId = CanonicalizeMod(serverGameId, m.MapName),
                TotalScore = m.TotalScore,
                TotalKills = m.TotalKills,
                TotalDeaths = m.TotalDeaths,
                SessionsPlayed = m.TotalRounds,
                TotalPlayTimeMinutes = (int)m.TotalPlayTimeMinutes
            }).ToList();
        }

        // Cross-server map stats: stitch together the mod from server records so maps are split by mod
        var serverRows = await (
            from pms in dbContext.PlayerMapStats.AsNoTracking()
            where pms.PlayerName == playerName && pms.ServerGuid != ""
               && (pms.Year > startYear || (pms.Year == startYear && pms.Month >= startMonth))
               && (pms.Year < endYear || (pms.Year == endYear && pms.Month <= endMonth))
            join s in dbContext.Servers.AsNoTracking() on pms.ServerGuid equals s.Guid into sGroup
            from s in sGroup.DefaultIfEmpty()
            select new
            {
                pms.MapName,
                ServerGameId = s != null ? s.GameId : null,
                pms.TotalScore,
                pms.TotalKills,
                pms.TotalDeaths,
                pms.TotalRounds,
                pms.TotalPlayTimeMinutes
            }
        ).ToListAsync();

        var globalRows = await dbContext.PlayerMapStats.AsNoTracking()
            .Where(p => p.PlayerName == playerName && p.ServerGuid == "")
            .Where(p =>
                (p.Year > startYear || (p.Year == startYear && p.Month >= startMonth)) &&
                (p.Year < endYear || (p.Year == endYear && p.Month <= endMonth)))
            .GroupBy(p => p.MapName)
            .Select(g => new
            {
                MapName = g.Key,
                TotalScore = g.Sum(p => p.TotalScore),
                TotalKills = g.Sum(p => p.TotalKills),
                TotalDeaths = g.Sum(p => p.TotalDeaths),
                TotalRounds = g.Sum(p => p.TotalRounds),
                TotalPlayTimeMinutes = g.Sum(p => p.TotalPlayTimeMinutes)
            })
            .ToListAsync();

        // Group server rows by (MapName, Mod)
        var modGroups = new Dictionary<(string MapName, string GameId), (int Score, int Kills, int Deaths, int Rounds, double PlayTime)>();

        foreach (var row in serverRows)
        {
            var mod = CanonicalizeMod(row.ServerGameId, row.MapName);
            var key = (row.MapName, mod);
            if (modGroups.TryGetValue(key, out var current))
            {
                modGroups[key] = (
                    current.Score + row.TotalScore,
                    current.Kills + row.TotalKills,
                    current.Deaths + row.TotalDeaths,
                    current.Rounds + row.TotalRounds,
                    current.PlayTime + row.TotalPlayTimeMinutes
                );
            }
            else
            {
                modGroups[key] = (row.TotalScore, row.TotalKills, row.TotalDeaths, row.TotalRounds, row.TotalPlayTimeMinutes);
            }
        }

        // Reconcile with global rows (ensuring no legacy/merged data is lost)
        foreach (var gRow in globalRows)
        {
            var matchingEntries = modGroups.Where(kv => kv.Key.MapName == gRow.MapName).ToList();
            if (matchingEntries.Count == 0)
            {
                var mod = CanonicalizeMod(null, gRow.MapName);
                modGroups[(gRow.MapName, mod)] = (gRow.TotalScore, gRow.TotalKills, gRow.TotalDeaths, gRow.TotalRounds, gRow.TotalPlayTimeMinutes);
            }
            else
            {
                var serverSumKills = matchingEntries.Sum(e => e.Value.Kills);
                var serverSumPlayTime = matchingEntries.Sum(e => e.Value.PlayTime);
                if (gRow.TotalKills > serverSumKills || gRow.TotalPlayTimeMinutes > serverSumPlayTime)
                {
                    var primary = matchingEntries.OrderByDescending(e => e.Value.PlayTime).First();
                    var deltaScore = Math.Max(0, gRow.TotalScore - matchingEntries.Sum(e => e.Value.Score));
                    var deltaKills = Math.Max(0, gRow.TotalKills - serverSumKills);
                    var deltaDeaths = Math.Max(0, gRow.TotalDeaths - matchingEntries.Sum(e => e.Value.Deaths));
                    var deltaRounds = Math.Max(0, gRow.TotalRounds - matchingEntries.Sum(e => e.Value.Rounds));
                    var deltaPlayTime = Math.Max(0, gRow.TotalPlayTimeMinutes - serverSumPlayTime);

                    modGroups[primary.Key] = (
                        primary.Value.Score + deltaScore,
                        primary.Value.Kills + deltaKills,
                        primary.Value.Deaths + deltaDeaths,
                        primary.Value.Rounds + deltaRounds,
                        primary.Value.PlayTime + deltaPlayTime
                    );
                }
            }
        }

        var results = modGroups.Select(kv => new ServerStatistics
        {
            MapName = kv.Key.MapName,
            GameId = kv.Key.GameId,
            TotalScore = kv.Value.Score,
            TotalKills = kv.Value.Kills,
            TotalDeaths = kv.Value.Deaths,
            SessionsPlayed = kv.Value.Rounds,
            TotalPlayTimeMinutes = (int)kv.Value.PlayTime
        })
        .OrderByDescending(s => s.TotalPlayTimeMinutes)
        .ThenByDescending(s => s.TotalKills)
        .ToList();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", results.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerMapStats");

        return results;
    }

    /// <summary>
    /// Canonicalizes a mod identifier from server telemetry or determines the native mod for expansion/mod maps.
    /// </summary>
    public static string CanonicalizeMod(string? mod, string mapName)
    {
        var normMap = mapName.Trim().ToLowerInvariant().Replace(' ', '_');
        var normMod = string.IsNullOrWhiteSpace(mod) ? "" : mod.Trim().ToLowerInvariant();

        switch (normMod)
        {
            case "dc_final" or "dc2" or "dc_extended" or "dc_realism":
                return "dc_final";
            case "desertcombat":
                return "desertcombat";
            case "xpack1":
                return "xpack1";
            case "xpack2":
                return "xpack2";
            case "fhsw" or "fhsweurope" or "sks_fhsw":
                return "fhsw";
            case "fh":
                return "fh";
            case "bf1918" or "xmas1918":
                return "bf1918";
            case "eod" or "eodp":
                return "eod";
            case "interstate":
                return "interstate";
            case "gcmod":
                return "gcmod";
            case "bg42" or "battlegroup42":
                return "bg42";
            case "warfront" or "warfront1":
                return "warfront";
            case "pirates" or "bfpirates":
                return "pirates";
            case "finnwars":
                return "finnwars";
            case "bfheroes":
                return "bfheroes";
        }

        // Road to Rome expansion (xpack1) maps
        if (normMap is "baytown" or "cassino" or "salerno" or "anzio" or "monte_santa_croce" or "santo_croce" or "husky")
            return "xpack1";

        // Secret Weapons of WWII expansion (xpack2) maps
        if (normMap is "eagles_nest" or "essen" or "gothic_line" or "hellendoorn" or "kbely_airfield" or "mimoyecques" or "peenemunde" or "telemark")
            return "xpack2";

        // Desert Combat maps
        if (normMap.StartsWith("dc_") || normMap is "desert_pursuit" || normMap is "sea_rigs" || normMap is "urban_siege" || normMap is "weapon_bunkers" || normMap is "al_nas" || normMap is "basrahs_edge" || normMap is "medina_ridge")
            return "dc_final";

        if (!string.IsNullOrEmpty(normMod) && normMod != "bf1942")
            return normMod;

        return "bf1942";
    }

    /// <inheritdoc/>
    public async Task<List<ServerInsight>> GetPlayerServerInsightsAsync(string playerName, int lookBackDays = 30)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetPlayerServerInsightsAsync");
        activity?.SetTag("query.name", "GetPlayerServerInsights");
        activity?.SetTag("query.filters", $"player:{playerName},lookBackDays:{lookBackDays}");

        var stopwatch = Stopwatch.StartNew();

        var query = dbContext.PlayerServerStats.Where(p => p.PlayerName == playerName);
        if (lookBackDays > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-lookBackDays);
            var (cutoffYear, cutoffWeek) = GetIsoWeek(cutoff);
            query = query.Where(p =>
                (p.Year > cutoffYear) ||
                (p.Year == cutoffYear && p.Week >= cutoffWeek));
        }

        // SUM across matching weeks, then filter by 10+ hours (600 minutes)
        var serverStats = await query
            .GroupBy(p => p.ServerGuid)
            .Select(g => new
            {
                ServerGuid = g.Key,
                TotalRounds = g.Sum(p => p.TotalRounds),
                TotalKills = g.Sum(p => p.TotalKills),
                TotalDeaths = g.Sum(p => p.TotalDeaths),
                TotalScore = g.Sum(p => p.TotalScore),
                TotalPlayTimeMinutes = g.Sum(p => p.TotalPlayTimeMinutes)
            })
            .Where(s => s.TotalPlayTimeMinutes >= 600)
            .OrderByDescending(s => s.TotalPlayTimeMinutes)
            .ToListAsync();

        // Get server names
        var serverGuids = serverStats.Select(s => s.ServerGuid).ToArray();
        var servers = await dbContext.Servers
            .Where(s => serverGuids.Contains(s.Guid))
            .ToDictionaryAsync(s => s.Guid, s => new { s.Name, s.GameId });

        // SQLite doesn't support APPLY operations, so use raw SQL with window functions
        var highestScoreSessions = await GetHighestScoreSessionsAsync(playerName, serverGuids);

        var highestScoresByServer = highestScoreSessions
            .ToDictionary(s => s.ServerGuid, s => s);

        stopwatch.Stop();
        activity?.SetTag("result.row_count", serverStats.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerServerStats");

        return serverStats.Select(s =>
        {
            var killsPerMinute = s.TotalPlayTimeMinutes > 0
                ? Math.Round(s.TotalKills / s.TotalPlayTimeMinutes, 3)
                : 0;

            servers.TryGetValue(s.ServerGuid, out var serverInfo);
            highestScoresByServer.TryGetValue(s.ServerGuid, out var highestScore);

            return new ServerInsight
            {
                ServerGuid = s.ServerGuid,
                ServerName = serverInfo?.Name ?? "Unknown Server",
                GameId = serverInfo?.GameId ?? "",
                TotalMinutes = s.TotalPlayTimeMinutes,
                TotalKills = s.TotalKills,
                TotalDeaths = s.TotalDeaths,
                HighestScore = highestScore?.HighestScore ?? 0,
                HighestScoreRoundId = highestScore?.HighestScoreRoundId ?? "",
                KillsPerMinute = killsPerMinute,
                TotalRounds = s.TotalRounds
            };
        }).ToList();
    }

    /// <inheritdoc/>
    public async Task<PlayerBestScores> GetPlayerBestScoresAsync(string playerName)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetPlayerBestScoresAsync");
        activity?.SetTag("query.name", "GetPlayerBestScores");
        activity?.SetTag("query.filters", $"player:{playerName}");

        var stopwatch = Stopwatch.StartNew();

        var bestScores = await dbContext.PlayerBestScores
            .Where(p => p.PlayerName == playerName)
            .OrderBy(p => p.Period)
            .ThenBy(p => p.Rank)
            .ToListAsync();

        // Get server names
        var serverGuids = bestScores.Select(s => s.ServerGuid).Distinct().ToArray();
        var serverNames = await dbContext.Servers
            .Where(s => serverGuids.Contains(s.Guid))
            .ToDictionaryAsync(s => s.Guid, s => s.Name);

        stopwatch.Stop();
        activity?.SetTag("result.row_count", bestScores.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerBestScores");

        var result = new PlayerBestScores();

        foreach (var score in bestScores)
        {
            serverNames.TryGetValue(score.ServerGuid, out var serverName);

            var detail = new BestScoreDetail
            {
                Score = score.FinalScore,
                Kills = score.FinalKills,
                Deaths = score.FinalDeaths,
                MapName = score.MapName,
                ServerName = serverName ?? "Unknown Server",
                ServerGuid = score.ServerGuid,
                Timestamp = score.RoundEndTime.ToDateTimeUtc(),
                RoundId = score.RoundId
            };

            switch (score.Period.ToLowerInvariant())
            {
                case "this_week":
                    result.ThisWeek.Add(detail);
                    break;
                case "last_30_days":
                    result.Last30Days.Add(detail);
                    break;
                case "all_time":
                    result.AllTime.Add(detail);
                    break;
            }
        }

        return result;
    }

    /// <inheritdoc/>
    public async Task<Dictionary<string, double>> GetAveragePingAsync(string[] playerNames, int sampleSize = 50)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetAveragePingAsync");
        activity?.SetTag("query.name", "GetAveragePing");
        activity?.SetTag("query.filters", $"players:{playerNames.Length},sampleSize:{sampleSize}");

        var stopwatch = Stopwatch.StartNew();

        // Get the last N sessions per player and calculate average ping from those
        // This ensures we get a consistent sample size regardless of how long ago they played
        var pingData = new List<dynamic>();

        foreach (var playerName in playerNames)
        {
            var avgPing = await dbContext.PlayerSessions
                .Where(ps => ps.Player.Name == playerName &&
                            ps.AveragePing > 0 &&
                            ps.AveragePing < 1000)
                .OrderByDescending(ps => ps.StartTime)
                .Take(sampleSize)
                .Select(ps => ps.AveragePing)
                .AverageAsync();

            pingData.Add(new
            {
                PlayerName = playerName,
                AvgPing = avgPing
            });
        }

        stopwatch.Stop();
        activity?.SetTag("result.row_count", pingData.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerSessions");

        return pingData.ToDictionary(p => (string)p.PlayerName, p => (double?)p.AvgPing ?? 0);
    }

    private static (int Year, int Week) GetIsoWeek(DateTime date)
    {
        var week = ISOWeek.GetWeekOfYear(date);
        var year = ISOWeek.GetYear(date);
        return (year, week);
    }
}
