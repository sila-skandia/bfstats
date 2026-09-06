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

        var serversQuery = dbContext.Servers.AsNoTracking();
        if (gameParam.Length > 0)
        {
            serversQuery = serversQuery.Where(s => s.Game == gameParam);
        }

        var servers = await serversQuery
            .Select(s => new
            {
                s.Guid,
                s.Name,
                s.Ip,
                s.Port,
                s.Game,
                s.IsOnline,
                s.LastSeenTime
            })
            .ToListAsync();

        var duplicateGroups = servers
            .GroupBy(s => (s.Game, s.Ip, s.Port, s.Name))
            .Where(g => g.Count() > 1)
            .ToList();

        if (duplicateGroups.Count == 0)
        {
            return [];
        }

        var candidateGuids = duplicateGroups
            .SelectMany(g => g.Select(s => s.Guid))
            .Distinct()
            .ToList();

        // Session totals are only displayed for duplicate identities. Seeking
        // ServerGuid (indexed) keeps the walk off the rest of PlayerSessions.
        var placeholders = string.Join(",", candidateGuids.Select((_, i) => $"@p{i}"));
        var sql = $@"
            SELECT
                ps.ServerGuid AS ServerGuid,
                COUNT(ps.SessionId) AS SessionCount,
                CAST(COALESCE(SUM((julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440.0), 0) AS INTEGER) AS PlaytimeMinutes,
                MIN(ps.StartTime) AS FirstSession,
                MAX(ps.LastSeenTime) AS LastSession
            FROM PlayerSessions ps
            WHERE ps.IsDeleted = 0
              AND ps.ServerGuid IN ({placeholders})
            GROUP BY ps.ServerGuid";

        var stats = await dbContext.Database
            .SqlQueryRaw<CandidateGuidStatsRow>(sql, candidateGuids.Cast<object>().ToArray())
            .ToListAsync();

        var statsByGuid = stats.ToDictionary(s => s.ServerGuid, StringComparer.Ordinal);

        return duplicateGroups
            .Select(g =>
            {
                var guids = g
                    .Select(s =>
                    {
                        statsByGuid.TryGetValue(s.Guid, out var st);
                        return new ServerMergeCandidateGuid(
                            ServerGuid: s.Guid,
                            SessionCount: st?.SessionCount ?? 0,
                            PlaytimeMinutes: st?.PlaytimeMinutes ?? 0,
                            FirstSession: st?.FirstSession,
                            LastSession: st?.LastSession,
                            IsOnline: s.IsOnline,
                            LastSeenTime: s.LastSeenTime
                        );
                    })
                    .OrderByDescending(r => r.PlaytimeMinutes)
                    .ThenByDescending(r => r.SessionCount)
                    .ToList();

                return new ServerMergeCandidate(
                    Game: g.Key.Game,
                    Ip: g.Key.Ip,
                    Port: g.Key.Port,
                    Name: g.Key.Name,
                    TotalSessions: guids.Sum(r => r.SessionCount),
                    TotalPlaytimeMinutes: guids.Sum(r => r.PlaytimeMinutes),
                    FirstSeen: guids.Min(r => r.FirstSession),
                    LastSeen: guids.Max(r => r.LastSession),
                    Guids: guids
                );
            })
            .OrderByDescending(c => c.Guids.Count)
            .ThenByDescending(c => c.TotalPlaytimeMinutes)
            .ToList();
    }

    public async Task<MergeServersResponse> MergeServersAsync(
        string primaryGuid,
        IReadOnlyList<string> duplicateGuids,
        string adminEmail,
        bool allowMismatchedIdentity = false)
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

        // Identity check: every duplicate must share Game/Ip/Port/Name with primary.
        // Skipped for admin-forced manual merges (a server that changed its name/IP over
        // time but is the same physical host), where the admin asserts the identity.
        if (!allowMismatchedIdentity)
        {
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
        }

        logger.LogInformation(
            "Starting server merge: primary={PrimaryGuid} duplicates=[{DupeGuids}] forced={Forced} requested by {AdminEmail}",
            primaryGuid, string.Join(",", dupeGuids), allowMismatchedIdentity, adminEmail);

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

        // Close any still-active rounds on the dupes — only the primary should retain a
        // live round after merge, otherwise the live-servers query trips on duplicate keys.
        // Recent rounds close at merge time; anything older gets a bounded duration —
        // EndTime = now on a months-old orphan would leave a round "lasting" months,
        // which the round report renders as one snapshot per minute of that span.
        var nowUtc = DateTime.UtcNow;
        var recentCutoff = nowUtc.AddHours(-24);
        await dbContext.Rounds
            .Where(r => dupeGuids.Contains(r.ServerGuid) && r.IsActive && r.StartTime >= recentCutoff)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.IsActive, false)
                .SetProperty(r => r.EndTime, (DateTime?)nowUtc));
        await dbContext.Rounds
            .Where(r => dupeGuids.Contains(r.ServerGuid) && r.IsActive)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.IsActive, false)
                .SetProperty(r => r.EndTime, r => (DateTime?)r.StartTime.AddMinutes(60)));

        var repointedRounds = await dbContext.Rounds
            .Where(r => dupeGuids.Contains(r.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.ServerGuid, primaryGuid));

        var repointedAchievements = await dbContext.PlayerAchievements
            .Where(pa => dupeGuids.Contains(pa.ServerGuid))
            .ExecuteUpdateAsync(s => s.SetProperty(pa => pa.ServerGuid, primaryGuid));

        // ServerOnlineCount has unique (ServerGuid, HourTimestamp). Sessions don't overlap in time
        // but a mid-hour bounce can leave both GUIDs with a row at the same hour bucket.
        // We aggregate allparticipating servers into a temp table, then replace the original
        // records with the aggregated ones for the primary server.
        var sqlParams = new List<object> { primaryGuid };
        sqlParams.AddRange(dupeGuids);
        var sqlParamsArray = sqlParams.ToArray();
        var allGuidsPlaceholders = string.Join(",", sqlParams.Select((_, i) => $"{{{i}}}"));

        await dbContext.Database.ExecuteSqlRawAsync("CREATE TEMP TABLE TempServerMerge (HourTimestamp TEXT, Game TEXT, AvgPlayers REAL, PeakPlayers INTEGER, SampleCount INTEGER)");

        await dbContext.Database.ExecuteSqlRawAsync($@"
            INSERT INTO TempServerMerge (HourTimestamp, Game, AvgPlayers, PeakPlayers, SampleCount)
            SELECT HourTimestamp, Game,
                   CASE WHEN SUM(SampleCount) > 0 THEN SUM(AvgPlayers * SampleCount) * 1.0 / SUM(SampleCount) ELSE 0 END,
                   MAX(PeakPlayers),
                   SUM(SampleCount)
            FROM ServerOnlineCounts
            WHERE ServerGuid IN ({allGuidsPlaceholders})
            GROUP BY HourTimestamp, Game",
            sqlParamsArray);

        await dbContext.Database.ExecuteSqlRawAsync($@"
            DELETE FROM ServerOnlineCounts
            WHERE ServerGuid IN ({allGuidsPlaceholders})",
            sqlParamsArray);

        var repointedOnlineCounts = await dbContext.Database.ExecuteSqlRawAsync($@"
            INSERT INTO ServerOnlineCounts (ServerGuid, HourTimestamp, Game, AvgPlayers, PeakPlayers, SampleCount)
            SELECT {{0}}, HourTimestamp, Game, AvgPlayers, PeakPlayers, SampleCount
            FROM TempServerMerge",
            sqlParamsArray);

        await dbContext.Database.ExecuteSqlRawAsync("DROP TABLE TempServerMerge");

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
            Forced = allowMismatchedIdentity,
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
    public class CandidateGuidStatsRow
    {
        public string ServerGuid { get; set; } = "";
        public int SessionCount { get; set; }
        public long PlaytimeMinutes { get; set; }
        public DateTime? FirstSession { get; set; }
        public DateTime? LastSession { get; set; }
    }
}
