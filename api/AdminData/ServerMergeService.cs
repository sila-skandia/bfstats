using System.Text.Json;
using api.AdminData.Models;
using api.Data.Entities;
using api.PlayerTracking;
using api.Services.BackgroundJobs;
using api.StatsCollectors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.AdminData;

public class ServerMergeService(
    PlayerTrackerDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    ILogger<ServerMergeService> logger
) : IServerMergeService
{
    public async Task<IReadOnlyList<ServerMergeCandidate>> FindDuplicateCandidatesAsync(string? game)
    {
        var gameParam = string.IsNullOrWhiteSpace(game) ? "" : game.Trim().ToLowerInvariant();

        // SQLite julianday() handles ISO-8601 timestamps; PlayerSessions.StartTime/LastSeenTime
        // are stored as TEXT in that format.
        const string sql = @"
            SELECT
                s.Guid AS ServerGuid,
                s.Name AS Name,
                s.Ip AS Ip,
                s.Port AS Port,
                s.Game AS Game,
                s.IsOnline AS IsOnline,
                s.LastSeenTime AS LastSeenTime,
                COUNT(ps.SessionId) AS SessionCount,
                CAST(COALESCE(SUM((julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440.0), 0) AS INTEGER) AS PlaytimeMinutes,
                MIN(ps.StartTime) AS FirstSession,
                MAX(ps.LastSeenTime) AS LastSession
            FROM Servers s
            LEFT JOIN PlayerSessions ps ON ps.ServerGuid = s.Guid AND ps.IsDeleted = 0
            WHERE @p0 = '' OR s.Game = @p0
            GROUP BY s.Guid";

        var rows = await dbContext.Database
            .SqlQueryRaw<CandidateGuidRow>(sql, gameParam)
            .ToListAsync();

        return rows
            .GroupBy(r => new { r.Game, r.Ip, r.Port, r.Name })
            .Where(g => g.Count() > 1)
            .Select(g => new ServerMergeCandidate(
                Game: g.Key.Game,
                Ip: g.Key.Ip,
                Port: g.Key.Port,
                Name: g.Key.Name,
                TotalSessions: g.Sum(r => r.SessionCount),
                TotalPlaytimeMinutes: g.Sum(r => r.PlaytimeMinutes),
                FirstSeen: g.Min(r => r.FirstSession),
                LastSeen: g.Max(r => r.LastSession),
                Guids: g
                    .OrderByDescending(r => r.PlaytimeMinutes)
                    .ThenByDescending(r => r.SessionCount)
                    .Select(r => new ServerMergeCandidateGuid(
                        ServerGuid: r.ServerGuid,
                        SessionCount: r.SessionCount,
                        PlaytimeMinutes: r.PlaytimeMinutes,
                        FirstSession: r.FirstSession,
                        LastSession: r.LastSession,
                        IsOnline: r.IsOnline,
                        LastSeenTime: r.LastSeenTime
                    ))
                    .ToList()
            ))
            .OrderByDescending(c => c.Guids.Count)
            .ThenByDescending(c => c.TotalPlaytimeMinutes)
            .ToList();
    }

    public async Task<MergeServersResponse> MergeServersAsync(
        string primaryGuid,
        IReadOnlyList<string> duplicateGuids,
        string adminEmail)
    {
        if (string.IsNullOrWhiteSpace(primaryGuid))
            throw new ArgumentException("primaryGuid is required", nameof(primaryGuid));
        if (duplicateGuids == null || duplicateGuids.Count == 0)
            throw new ArgumentException("at least one duplicateGuid is required", nameof(duplicateGuids));

        var dupeGuids = duplicateGuids
            .Where(g => !string.IsNullOrWhiteSpace(g) && g != primaryGuid)
            .Distinct()
            .ToList();
        if (dupeGuids.Count == 0)
            throw new ArgumentException("duplicateGuids must contain at least one GUID different from primary", nameof(duplicateGuids));

        var allGuids = dupeGuids.Concat([primaryGuid]).ToList();
        var servers = await dbContext.Servers
            .Where(s => allGuids.Contains(s.Guid))
            .ToListAsync();

        var primary = servers.FirstOrDefault(s => s.Guid == primaryGuid)
            ?? throw new InvalidOperationException($"Primary server {primaryGuid} not found");

        var foundDupeGuids = servers.Where(s => s.Guid != primaryGuid).Select(s => s.Guid).ToHashSet();
        var missing = dupeGuids.Where(g => !foundDupeGuids.Contains(g)).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"Server(s) not found: {string.Join(", ", missing)}");

        // Identity check: every duplicate must share Game/Ip/Port/Name with primary
        foreach (var dup in servers.Where(s => s.Guid != primaryGuid))
        {
            if (!string.Equals(dup.Game, primary.Game, StringComparison.OrdinalIgnoreCase)
                || !string.Equals(dup.Ip, primary.Ip, StringComparison.OrdinalIgnoreCase)
                || dup.Port != primary.Port
                || !string.Equals(dup.Name, primary.Name, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Server {dup.Guid} differs from primary on Game/Ip/Port/Name. Refusing to merge.");
            }
        }

        logger.LogInformation(
            "Starting server merge: primary={PrimaryGuid} duplicates=[{DupeGuids}] requested by {AdminEmail}",
            primaryGuid, string.Join(",", dupeGuids), adminEmail);

        // Snapshot impact (before re-pointing) for recalc and audit
        var affectedPlayers = await dbContext.PlayerSessions
            .Where(ps => dupeGuids.Contains(ps.ServerGuid))
            .Select(ps => ps.PlayerName)
            .Distinct()
            .ToListAsync();

        var affectedRoundPeriods = await dbContext.Rounds
            .Where(r => dupeGuids.Contains(r.ServerGuid))
            .Select(r => new { r.MapName, r.StartTime })
            .ToListAsync();

        var mapPeriodSet = affectedRoundPeriods
            .Where(r => !string.IsNullOrEmpty(r.MapName))
            .Select(r => (MapName: r.MapName, Year: r.StartTime.Year, Month: r.StartTime.Month))
            .ToHashSet();
        var rankingPeriodSet = affectedRoundPeriods
            .Select(r => (Year: r.StartTime.Year, Month: r.StartTime.Month))
            .ToHashSet();

        await using var tx = await dbContext.Database.BeginTransactionAsync();

        // 1. Re-point raw FKs (no time overlap per requirements, so no PK conflicts on ServerOnlineCount)
        var repointedSessions = await dbContext.PlayerSessions
            .Where(ps => dupeGuids.Contains(ps.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(ps => ps.ServerGuid, primaryGuid));

        var repointedRounds = await dbContext.Rounds
            .Where(r => dupeGuids.Contains(r.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ServerGuid, primaryGuid));

        var repointedAchievements = await dbContext.PlayerAchievements
            .Where(pa => dupeGuids.Contains(pa.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(pa => pa.ServerGuid, primaryGuid));

        // ServerOnlineCount has unique (ServerGuid, HourTimestamp). Sessions don't overlap in time
        // but a mid-hour bounce can leave both GUIDs with a row at the same hour bucket. Merge
        // overlapping hours into the primary (sample-weighted average, max peak, summed sample
        // count), drop the duplicate's overlapping rows, then re-point the rest.
        var inListPlaceholders = string.Join(",", dupeGuids.Select((_, i) => $"{{{i + 1}}}"));
        var sqlParams = new List<object> { primaryGuid };
        sqlParams.AddRange(dupeGuids);
        var sqlParamsArray = sqlParams.ToArray();

        await dbContext.Database.ExecuteSqlRawAsync($@"
            UPDATE ServerOnlineCounts
            SET AvgPlayers = CASE WHEN (SampleCount + d.TotalSamples) > 0
                    THEN (AvgPlayers * SampleCount + d.WeightedSum) * 1.0 / (SampleCount + d.TotalSamples)
                    ELSE 0 END,
                PeakPlayers = MAX(PeakPlayers, d.MaxPeak),
                SampleCount = SampleCount + d.TotalSamples
            FROM (
                SELECT HourTimestamp,
                       SUM(AvgPlayers * SampleCount) AS WeightedSum,
                       MAX(PeakPlayers) AS MaxPeak,
                       SUM(SampleCount) AS TotalSamples
                FROM ServerOnlineCounts
                WHERE ServerGuid IN ({inListPlaceholders})
                GROUP BY HourTimestamp
            ) AS d
            WHERE ServerOnlineCounts.ServerGuid = {{0}}
              AND ServerOnlineCounts.HourTimestamp = d.HourTimestamp",
            sqlParamsArray);

        await dbContext.Database.ExecuteSqlRawAsync($@"
            DELETE FROM ServerOnlineCounts
            WHERE ServerGuid IN ({inListPlaceholders})
              AND HourTimestamp IN (
                  SELECT HourTimestamp FROM ServerOnlineCounts WHERE ServerGuid = {{0}}
              )",
            sqlParamsArray);

        var repointedOnlineCounts = await dbContext.ServerOnlineCounts
            .Where(soc => dupeGuids.Contains(soc.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(soc => soc.ServerGuid, primaryGuid));

        await dbContext.Tournaments
            .Where(t => t.ServerGuid != null && dupeGuids.Contains(t.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.ServerGuid, primaryGuid));

        await dbContext.TournamentMatches
            .Where(tm => tm.ServerGuid != null && dupeGuids.Contains(tm.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(tm => tm.ServerGuid, primaryGuid));

        // 2. UserFavoriteServer has unique (UserId, ServerGuid) — drop dupes for users that already favorite primary, re-point the rest
        var usersAlreadyFavoritingPrimary = await dbContext.UserFavoriteServers
            .Where(ufs => ufs.ServerGuid == primaryGuid)
            .Select(ufs => ufs.UserId)
            .ToListAsync();

        if (usersAlreadyFavoritingPrimary.Count > 0)
        {
            await dbContext.UserFavoriteServers
                .Where(ufs => dupeGuids.Contains(ufs.ServerGuid) && usersAlreadyFavoritingPrimary.Contains(ufs.UserId))
                .ExecuteDeleteAsync();
        }

        await dbContext.UserFavoriteServers
            .Where(ufs => dupeGuids.Contains(ufs.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(ufs => ufs.ServerGuid, primaryGuid));

        // 3. Delete aggregate rows for both dupes and primary so recalc rebuilds them cleanly.
        // PlayerMapStats and MapGlobalAverage have GlobalServerGuid="" rows for cross-server aggregates
        // — those are filtered out because primary/dupe GUIDs are non-empty, so the IN clause is safe.
        var allMergeGuids = dupeGuids.Concat([primaryGuid]).ToList();
        var deletedAggregateRows = 0;

        deletedAggregateRows += await dbContext.PlayerServerStats
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        deletedAggregateRows += await dbContext.PlayerMapStats
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        deletedAggregateRows += await dbContext.ServerMapStats
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        deletedAggregateRows += await dbContext.ServerHourlyPatterns
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        deletedAggregateRows += await dbContext.MapServerHourlyPatterns
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        deletedAggregateRows += await dbContext.ServerPlayerRankings
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        deletedAggregateRows += await dbContext.MapGlobalAverages
            .Where(x => allMergeGuids.Contains(x.ServerGuid))
            .ExecuteDeleteAsync();

        // 4. Hard-delete duplicate GameServer rows
        await dbContext.Servers
            .Where(s => dupeGuids.Contains(s.Guid))
            .ExecuteDeleteAsync();

        // 5. Audit log
        var auditDetails = JsonSerializer.Serialize(new
        {
            DuplicateGuids = dupeGuids,
            PrimaryName = primary.Name,
            Game = primary.Game,
            Ip = primary.Ip,
            Port = primary.Port,
            AffectedPlayers = affectedPlayers.Count,
            AffectedPeriods = mapPeriodSet.Count,
            RepointedSessions = repointedSessions,
            RepointedRounds = repointedRounds,
            RepointedAchievements = repointedAchievements,
            RepointedOnlineCounts = repointedOnlineCounts,
            DeletedAggregateRows = deletedAggregateRows,
        });

        dbContext.AdminAuditLogs.Add(new AdminAuditLog
        {
            Action = "merge_servers",
            TargetType = "GameServer",
            TargetId = primaryGuid,
            Details = auditDetails,
            AdminEmail = adminEmail,
            Timestamp = clock.GetCurrentInstant()
        });
        await dbContext.SaveChangesAsync();

        await tx.CommitAsync();

        logger.LogInformation(
            "Server merge committed: primary={PrimaryGuid} dupes={DupeCount} sessions={Sessions} rounds={Rounds} achievements={Achievements} onlineCounts={OnlineCounts} aggregateRowsDeleted={AggDeleted}",
            primaryGuid, dupeGuids.Count, repointedSessions, repointedRounds, repointedAchievements, repointedOnlineCounts, deletedAggregateRows);

        // 6. Queue background recalculation
        var capturedPlayers = affectedPlayers;
        var capturedMapPeriods = mapPeriodSet.ToList();
        var capturedRankingPeriods = rankingPeriodSet.ToList();
        var capturedPrimary = primaryGuid;

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var aggregateBackfill = scope.ServiceProvider.GetRequiredService<IAggregateBackfillBackgroundService>();
                var dailyRefresh = scope.ServiceProvider.GetRequiredService<IDailyAggregateRefreshBackgroundService>();
                var rankingsRecalc = scope.ServiceProvider.GetRequiredService<IServerPlayerRankingsRecalculationService>();

                if (capturedPlayers.Count > 0)
                {
                    await aggregateBackfill.RunForPlayersAsync(capturedPlayers);
                }

                foreach (var (mapName, year, month) in capturedMapPeriods)
                {
                    await dailyRefresh.RefreshServerMapStatsForServerMapPeriodAsync(capturedPrimary, mapName, year, month);
                }

                foreach (var (year, month) in capturedRankingPeriods)
                {
                    await rankingsRecalc.RecalculateForServerAndPeriodAsync(capturedPrimary, year, month);
                }

                // Lifetime/global aggregates (ServerHourlyPatterns, MapServerHourlyPatterns,
                // MapGlobalAverages, HourlyActivityPatterns) are rebuilt by the daily refresh job.
                await dailyRefresh.RunAsync();

                logger.LogInformation(
                    "Merge recalc completed for primary={PrimaryGuid} (players={PlayerCount} mapPeriods={MapPeriodCount} rankingPeriods={RankingPeriodCount})",
                    capturedPrimary, capturedPlayers.Count, capturedMapPeriods.Count, capturedRankingPeriods.Count);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Merge recalc failed for primary={PrimaryGuid}", capturedPrimary);
            }
        });

        return new MergeServersResponse(
            PrimaryGuid: primaryGuid,
            DuplicateGuids: dupeGuids,
            AffectedPlayers: affectedPlayers.Count,
            AffectedPeriods: mapPeriodSet.Count,
            RepointedSessions: repointedSessions,
            RepointedRounds: repointedRounds,
            RepointedAchievements: repointedAchievements,
            RepointedOnlineCounts: repointedOnlineCounts,
            DeletedAggregateRows: deletedAggregateRows
        );
    }

    // SqlQueryRaw row type — public class so the EF Core projection can construct it.
    public class CandidateGuidRow
    {
        public string ServerGuid { get; set; } = "";
        public string Name { get; set; } = "";
        public string Ip { get; set; } = "";
        public int Port { get; set; }
        public string Game { get; set; } = "";
        public bool IsOnline { get; set; }
        public DateTime LastSeenTime { get; set; }
        public int SessionCount { get; set; }
        public long PlaytimeMinutes { get; set; }
        public DateTime? FirstSession { get; set; }
        public DateTime? LastSession { get; set; }
    }
}
