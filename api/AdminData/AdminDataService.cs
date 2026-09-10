using System.Text.Json;
using api.AdminData.Models;
using api.Caching;
using api.Data.Entities;
using api.Gamification.Services;
using api.PlayerTracking;
using api.Services.BackgroundJobs;
using api.StatsCollectors;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodaTime;

using api.ImageStorage;
using api.MapDossiers;

namespace api.AdminData;

public class AdminDataService(
    PlayerTrackerDbContext dbContext,
    IServiceScopeFactory scopeFactory,
    IClock clock,
    ICacheService cacheService,
    ILogger<AdminDataService> logger,
    IMapImageResolver? mapImageResolver = null,
    IMapDossierResolver? mapDossierResolver = null
) : IAdminDataService
{
    public async Task<PagedResult<SuspiciousSessionResponse>> QuerySuspiciousSessionsAsync(QuerySuspiciousSessionsRequest request)
    {
        var query = from ps in dbContext.PlayerSessions
                    join r in dbContext.Rounds on ps.RoundId equals r.RoundId
                    join s in dbContext.Servers on r.ServerGuid equals s.Guid
                    select new { ps, r, s };

        if (!request.IncludeDeletedRounds)
        {
            query = query.Where(x => !x.r.IsDeleted && !x.ps.IsDeleted);
        }

        // Filter by game type (from server record: bf1942)
        if (!string.IsNullOrWhiteSpace(request.Game))
        {
            var game = request.Game.Trim().ToLowerInvariant();
            query = query.Where(x => x.s.Game == game);
        }

        // Apply filters (empty string / null from UI are treated as not provided)
        if (!string.IsNullOrEmpty(request.ServerGuid))
        {
            query = query.Where(x => x.ps.ServerGuid == request.ServerGuid);
        }

        if (request.MinScore.HasValue)
        {
            query = query.Where(x => x.ps.TotalScore >= request.MinScore.Value);
        }

        if (request.MinKdRatio.HasValue)
        {
            query = query.Where(x => x.ps.TotalDeaths > 0
                ? (double)x.ps.TotalKills / x.ps.TotalDeaths >= request.MinKdRatio.Value
                : x.ps.TotalKills >= request.MinKdRatio.Value);
        }

        if (request.StartDate.HasValue)
        {
            var startDateTime = request.StartDate.Value.ToDateTimeUtc();
            query = query.Where(x => x.ps.StartTime >= startDateTime);
        }

        if (request.EndDate.HasValue)
        {
            var endDateTime = request.EndDate.Value.ToDateTimeUtc();
            query = query.Where(x => x.ps.StartTime <= endDateTime);
        }

        // Get total count
        var totalItems = await query.CountAsync();

        // Apply pagination and projection
        var items = await query
            .OrderByDescending(x => x.ps.TotalScore)
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(x => new SuspiciousSessionResponse(
                x.ps.PlayerName,
                x.r.ServerName,
                x.ps.TotalScore,
                x.ps.TotalKills,
                x.ps.TotalDeaths,
                x.ps.TotalDeaths > 0 ? Math.Round((double)x.ps.TotalKills / x.ps.TotalDeaths, 2) : x.ps.TotalKills,
                x.ps.RoundId ?? "",
                x.r.StartTime,
                x.r.IsDeleted
            ))
            .ToListAsync();

        return new PagedResult<SuspiciousSessionResponse>
        {
            Items = items,
            Page = request.Page,
            PageSize = request.PageSize,
            TotalItems = totalItems,
            TotalPages = (int)Math.Ceiling((double)totalItems / request.PageSize)
        };
    }

    public async Task<RoundDetailResponse?> GetRoundDetailAsync(string roundId)
    {
        var round = await dbContext.Rounds
            .FirstOrDefaultAsync(r => r.RoundId == roundId);

        if (round == null)
        {
            return null;
        }

        var players = await dbContext.PlayerSessions
            .Where(ps => ps.RoundId == roundId)
            .Select(ps => new RoundPlayerInfo(
                ps.PlayerName,
                ps.TotalScore,
                ps.TotalKills,
                ps.TotalDeaths
            ))
            .ToListAsync();

        var achievementCount = await dbContext.PlayerAchievements
            .CountAsync(pa => pa.RoundId == roundId);

        return new RoundDetailResponse(
            round.RoundId,
            round.ServerName,
            Instant.FromDateTimeUtc(DateTime.SpecifyKind(round.StartTime, DateTimeKind.Utc)),
            round.EndTime.HasValue
                ? Instant.FromDateTimeUtc(DateTime.SpecifyKind(round.EndTime.Value, DateTimeKind.Utc))
                : null,
            round.MapName,
            players,
            achievementCount,
            round.IsDeleted
        );
    }

    public async Task<DeleteRoundResponse> DeleteRoundAsync(string roundId, string adminEmail)
    {
        var round = await dbContext.Rounds
            .FirstOrDefaultAsync(r => r.RoundId == roundId);

        if (round == null)
        {
            throw new InvalidOperationException($"Round {roundId} not found");
        }

        logger.LogInformation("Starting soft-delete for round {RoundId} (delete achievements, mark round+sessions deleted) requested by {AdminEmail}", roundId, adminEmail);

        // Step 1: Collect affected player names for aggregate recalculation (count for audit/response from .Count)
        var affectedPlayerNames = await dbContext.PlayerSessions
            .Where(ps => ps.RoundId == roundId)
            .Select(ps => ps.PlayerName)
            .Distinct()
            .ToListAsync();

        logger.LogInformation("Round {RoundId} affects {PlayerCount} players", roundId, affectedPlayerNames.Count);

        // Step 2: Delete PlayerAchievements where RoundId = roundId (achievements can be rebuilt)
        var deletedAchievements = await dbContext.PlayerAchievements
            .Where(pa => pa.RoundId == roundId)
            .ExecuteDeleteAsync();
        logger.LogInformation("Deleted {Count} achievements for round {RoundId}", deletedAchievements, roundId);

        // Step 3: Mark all PlayerSessions for this round as IsDeleted (soft-delete; observations kept)
        var sessionsMarked = await dbContext.PlayerSessions
            .Where(ps => ps.RoundId == roundId)
            .ExecuteUpdateAsync(s => s.SetProperty(ps => ps.IsDeleted, true));
        logger.LogInformation("Marked {Count} sessions as deleted for round {RoundId}", sessionsMarked, roundId);

        // Step 4: Mark the Round as IsDeleted (soft-delete; round and sessions remain for potential recovery)
        await dbContext.Rounds
            .Where(r => r.RoundId == roundId)
            .ExecuteUpdateAsync(r => r.SetProperty(ro => ro.IsDeleted, true));
        logger.LogInformation("Marked round {RoundId} as deleted", roundId);

        // Step 5: Create audit log entry (player count only; players are soft-deleted and recoverable)
        var details = JsonSerializer.Serialize(new
        {
            DeletedAchievements = deletedAchievements,
            SessionsMarkedDeleted = sessionsMarked,
            RoundMarkedDeleted = 1,
            AffectedPlayers = affectedPlayerNames.Count,
            ServerGuid = round.ServerGuid,
            MapName = round.MapName,
            RoundStartTime = round.StartTime
        });

        dbContext.AdminAuditLogs.Add(new AdminAuditLog
        {
            Action = "delete_round",
            TargetType = "Round",
            TargetId = roundId,
            Details = details,
            AdminEmail = adminEmail,
            Timestamp = clock.GetCurrentInstant()
        });
        await dbContext.SaveChangesAsync();

        // Step 6: Queue aggregate recalculation (player aggregates, ServerMapStats, ServerPlayerRankings)
        var serverGuid = round.ServerGuid;
        var mapName = round.MapName ?? "";
        var year = round.StartTime.Year;
        var month = round.StartTime.Month;

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var aggregateBackfill = scope.ServiceProvider.GetRequiredService<IAggregateBackfillBackgroundService>();
                var dailyRefresh = scope.ServiceProvider.GetRequiredService<IDailyAggregateRefreshBackgroundService>();
                var rankingsRecalc = scope.ServiceProvider.GetRequiredService<IServerPlayerRankingsRecalculationService>();

                if (affectedPlayerNames.Count > 0)
                {
                    await aggregateBackfill.RunForPlayersAsync(affectedPlayerNames);
                    logger.LogInformation("Aggregate recalculation completed for {PlayerCount} players after soft-deleting round {RoundId}",
                        affectedPlayerNames.Count, roundId);
                }
                if (!string.IsNullOrEmpty(mapName))
                {
                    await dailyRefresh.RefreshServerMapStatsForServerMapPeriodAsync(serverGuid, mapName, year, month);
                }
                await rankingsRecalc.RecalculateForServerAndPeriodAsync(serverGuid, year, month);

                if (affectedPlayerNames.Count > 0)
                {
                    var milestoneCalculator = scope.ServiceProvider.GetRequiredService<MilestoneCalculator>();
                    await milestoneCalculator.RemoveInvalidMilestoneAchievementsForPlayersAsync(affectedPlayerNames);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to recalculate aggregates after soft-deleting round {RoundId}", roundId);
            }
        });

        // DeletedObservations=0 (we keep observations); DeletedSessions/DeletedRounds = marked count for API shape
        return new DeleteRoundResponse(
            roundId,
            deletedAchievements,
            0,
            sessionsMarked,
            1,
            affectedPlayerNames.Count
        );
    }

    public async Task<BulkDeleteRoundsResponse> BulkDeleteRoundsAsync(IReadOnlyList<string> roundIds, string adminEmail)
    {
        if (roundIds == null || roundIds.Count == 0)
        {
            throw new ArgumentException("At least one round ID is required", nameof(roundIds));
        }

        var distinctIds = roundIds.Distinct().ToList();
        var rounds = await dbContext.Rounds
            .Where(r => distinctIds.Contains(r.RoundId))
            .ToListAsync();

        var foundIds = new HashSet<string>(rounds.Select(r => r.RoundId));
        var missing = distinctIds.FirstOrDefault(id => !foundIds.Contains(id));
        if (missing != null)
        {
            throw new InvalidOperationException($"Round {missing} not found");
        }

        logger.LogInformation(
            "Starting bulk soft-delete for {Count} rounds (delete achievements, mark rounds+sessions deleted) requested by {AdminEmail}",
            distinctIds.Count, adminEmail);

        // Collect affected player names (union across all rounds)
        var affectedPlayerNames = await dbContext.PlayerSessions
            .Where(ps => distinctIds.Contains(ps.RoundId ?? ""))
            .Select(ps => ps.PlayerName)
            .Distinct()
            .ToListAsync();

        // Bulk delete achievements for all rounds
        var deletedAchievements = await dbContext.PlayerAchievements
            .Where(pa => distinctIds.Contains(pa.RoundId ?? ""))
            .ExecuteDeleteAsync();
        logger.LogInformation("Deleted {Count} achievements for {RoundCount} rounds", deletedAchievements, distinctIds.Count);

        // Bulk mark sessions as deleted
        var sessionsMarked = await dbContext.PlayerSessions
            .Where(ps => distinctIds.Contains(ps.RoundId ?? ""))
            .ExecuteUpdateAsync(s => s.SetProperty(ps => ps.IsDeleted, true));
        logger.LogInformation("Marked {Count} sessions as deleted for {RoundCount} rounds", sessionsMarked, distinctIds.Count);

        // Bulk mark rounds as deleted
        await dbContext.Rounds
            .Where(r => distinctIds.Contains(r.RoundId))
            .ExecuteUpdateAsync(r => r.SetProperty(ro => ro.IsDeleted, true));
        logger.LogInformation("Marked {Count} rounds as deleted", distinctIds.Count);

        var details = JsonSerializer.Serialize(new
        {
            RoundIds = distinctIds,
            DeletedAchievements = deletedAchievements,
            SessionsMarkedDeleted = sessionsMarked,
            RoundsMarkedDeleted = distinctIds.Count,
            AffectedPlayers = affectedPlayerNames.Count,
        });

        dbContext.AdminAuditLogs.Add(new AdminAuditLog
        {
            Action = "bulk_delete_rounds",
            TargetType = "Round",
            TargetId = "bulk",
            Details = details,
            AdminEmail = adminEmail,
            Timestamp = clock.GetCurrentInstant()
        });
        await dbContext.SaveChangesAsync();

        // Distinct (ServerGuid, MapName, Year, Month) for RefreshServerMapStats
        var serverMapPeriods = rounds
            .Where(r => !string.IsNullOrEmpty(r.MapName))
            .Select(r => (r.ServerGuid, MapName: r.MapName ?? "", r.StartTime.Year, r.StartTime.Month))
            .Distinct()
            .ToList();
        // Distinct (ServerGuid, Year, Month) for RecalculateForServerAndPeriod
        var serverPeriods = rounds
            .Select(r => (r.ServerGuid, r.StartTime.Year, r.StartTime.Month))
            .Distinct()
            .ToList();

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var aggregateBackfill = scope.ServiceProvider.GetRequiredService<IAggregateBackfillBackgroundService>();
                var dailyRefresh = scope.ServiceProvider.GetRequiredService<IDailyAggregateRefreshBackgroundService>();
                var rankingsRecalc = scope.ServiceProvider.GetRequiredService<IServerPlayerRankingsRecalculationService>();

                if (affectedPlayerNames.Count > 0)
                {
                    await aggregateBackfill.RunForPlayersAsync(affectedPlayerNames);
                    logger.LogInformation(
                        "Aggregate recalculation completed for {PlayerCount} players after bulk soft-deleting {RoundCount} rounds",
                        affectedPlayerNames.Count, distinctIds.Count);
                }
                foreach (var (serverGuid, mapName, year, month) in serverMapPeriods)
                {
                    await dailyRefresh.RefreshServerMapStatsForServerMapPeriodAsync(serverGuid, mapName, year, month);
                }
                foreach (var (serverGuid, year, month) in serverPeriods)
                {
                    await rankingsRecalc.RecalculateForServerAndPeriodAsync(serverGuid, year, month);
                }
                if (affectedPlayerNames.Count > 0)
                {
                    var milestoneCalculator = scope.ServiceProvider.GetRequiredService<MilestoneCalculator>();
                    await milestoneCalculator.RemoveInvalidMilestoneAchievementsForPlayersAsync(affectedPlayerNames);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to recalculate aggregates after bulk soft-deleting {RoundCount} rounds", distinctIds.Count);
            }
        });

        return new BulkDeleteRoundsResponse(distinctIds.Count, deletedAchievements, sessionsMarked, affectedPlayerNames.Count);
    }

    public async Task<UndeleteRoundResponse> UndeleteRoundAsync(string roundId, string adminEmail)
    {
        var round = await dbContext.Rounds
            .FirstOrDefaultAsync(r => r.RoundId == roundId);

        if (round == null)
        {
            throw new InvalidOperationException($"Round {roundId} not found");
        }

        logger.LogInformation("Undelete (restore) round {RoundId} requested by {AdminEmail}", roundId, adminEmail);

        var affectedPlayerNames = await dbContext.PlayerSessions
            .Where(ps => ps.RoundId == roundId)
            .Select(ps => ps.PlayerName)
            .Distinct()
            .ToListAsync();

        var sessionsRestored = await dbContext.PlayerSessions
            .Where(ps => ps.RoundId == roundId)
            .ExecuteUpdateAsync(s => s.SetProperty(ps => ps.IsDeleted, false));

        await dbContext.Rounds
            .Where(r => r.RoundId == roundId)
            .ExecuteUpdateAsync(r => r.SetProperty(ro => ro.IsDeleted, false));

        var details = JsonSerializer.Serialize(new
        {
            SessionsRestored = sessionsRestored,
            RoundRestored = 1,
            AffectedPlayers = affectedPlayerNames.Count,
            ServerGuid = round.ServerGuid,
            MapName = round.MapName,
            RoundStartTime = round.StartTime
        });

        dbContext.AdminAuditLogs.Add(new AdminAuditLog
        {
            Action = "undelete_round",
            TargetType = "Round",
            TargetId = roundId,
            Details = details,
            AdminEmail = adminEmail,
            Timestamp = clock.GetCurrentInstant()
        });
        await dbContext.SaveChangesAsync();

        var serverGuid = round.ServerGuid;
        var mapName = round.MapName ?? "";
        var year = round.StartTime.Year;
        var month = round.StartTime.Month;

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var aggregateBackfill = scope.ServiceProvider.GetRequiredService<IAggregateBackfillBackgroundService>();
                var dailyRefresh = scope.ServiceProvider.GetRequiredService<IDailyAggregateRefreshBackgroundService>();
                var rankingsRecalc = scope.ServiceProvider.GetRequiredService<IServerPlayerRankingsRecalculationService>();

                if (affectedPlayerNames.Count > 0)
                {
                    await aggregateBackfill.RunForPlayersAsync(affectedPlayerNames);
                    logger.LogInformation("Aggregate recalculation completed for {PlayerCount} players after restoring round {RoundId}", affectedPlayerNames.Count, roundId);
                }
                if (!string.IsNullOrEmpty(mapName))
                {
                    await dailyRefresh.RefreshServerMapStatsForServerMapPeriodAsync(serverGuid, mapName, year, month);
                }
                await rankingsRecalc.RecalculateForServerAndPeriodAsync(serverGuid, year, month);

                var gamificationService = scope.ServiceProvider.GetRequiredService<GamificationService>();
                await gamificationService.ProcessAchievementsForRoundIdAsync(roundId);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to recalculate aggregates after restoring round {RoundId}", roundId);
            }
        });

        return new UndeleteRoundResponse(roundId, sessionsRestored, 1, affectedPlayerNames.Count);
    }

    public async Task<List<AdminAuditLog>> GetAuditLogAsync(int limit = 100)
    {
        return await dbContext.AdminAuditLogs
            .OrderByDescending(l => l.Timestamp)
            .Take(limit)
            .ToListAsync();
    }

    private const string InitialDataCacheKey = "app:initial:data:v1";

    public async Task<AppDataRow?> GetAppDataAsync(string key)
    {
        var row = await dbContext.AppData
            .AsNoTracking()
            .FirstOrDefaultAsync(a => a.Id == key);
        return row == null ? null : new AppDataRow(row.Id, row.Value, row.UpdatedAt);
    }

    public async Task SetAppDataAsync(string key, string value)
    {
        var row = await dbContext.AppData.FirstOrDefaultAsync(a => a.Id == key);
        var now = DateTime.UtcNow;
        if (row != null)
        {
            row.Value = value;
            row.UpdatedAt = now;
        }
        else
        {
            dbContext.AppData.Add(new AppData
            {
                Id = key,
                Value = value,
                UpdatedAt = now
            });
        }
        await dbContext.SaveChangesAsync();
        if (string.Equals(key, "site_notice", StringComparison.OrdinalIgnoreCase))
        {
            await cacheService.RemoveAsync(InitialDataCacheKey);
            logger.LogInformation("Invalidated initial data cache after site_notice update");
        }
    }

    public async Task DeleteAppDataAsync(string key)
    {
        var row = await dbContext.AppData.FirstOrDefaultAsync(a => a.Id == key);
        if (row != null)
        {
            dbContext.AppData.Remove(row);
            await dbContext.SaveChangesAsync();
            if (string.Equals(key, "site_notice", StringComparison.OrdinalIgnoreCase))
            {
                await cacheService.RemoveAsync(InitialDataCacheKey);
                logger.LogInformation("Invalidated initial data cache after site_notice delete");
            }
        }
    }

    private const string MapReportCacheKey = "admin:map_coverage_report:base_v4";
    private static readonly TimeSpan MapReportCacheDuration = TimeSpan.FromMinutes(5);

    private static readonly HashSet<string> IgnoredGames = new(StringComparer.OrdinalIgnoreCase)
    {
        "fh2",
        "bfvietnam",
        "bfv"
    };

    private static bool IsIgnoredGame(string? game, string? gameId)
    {
        return (!string.IsNullOrWhiteSpace(game) && IgnoredGames.Contains(game.Trim())) ||
               (!string.IsNullOrWhiteSpace(gameId) && IgnoredGames.Contains(gameId.Trim()));
    }

    public async Task<MapReportResponse> GetMapReportAsync(MapReportRequest request, CancellationToken ct = default)
    {
        var baseReport = await cacheService.GetAsync<CachedBaseMapReport>(MapReportCacheKey, ct);
        if (baseReport == null)
        {
            baseReport = await BuildBaseMapReportAsync(ct);
            await cacheService.SetAsync(MapReportCacheKey, baseReport, MapReportCacheDuration, ct);
        }

        var items = baseReport.AllMaps.AsEnumerable();

        // Status filter
        var status = request.Status?.Trim().ToLowerInvariant() ?? "missing";
        if (status == "missing")
        {
            items = items.Where(m => !m.HasThumbnail);
        }
        else if (status == "has_icon")
        {
            items = items.Where(m => m.HasThumbnail);
        }

        // Mod filter
        if (!string.IsNullOrWhiteSpace(request.Mod))
        {
            var targetMod = request.Mod.Trim();
            items = items.Where(m => m.Servers.Any(s => string.Equals(s.GameId, targetMod, StringComparison.OrdinalIgnoreCase)));
        }

        // Search filter (map name, normalized name, or server name)
        if (!string.IsNullOrWhiteSpace(request.Search))
        {
            var search = request.Search.Trim();
            items = items.Where(m =>
                m.MapName.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                m.NormalizedMapName.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                m.Servers.Any(s => s.ServerName.Contains(search, StringComparison.OrdinalIgnoreCase) ||
                                   s.GameId.Contains(search, StringComparison.OrdinalIgnoreCase)));
        }

        // Sorting
        var sortBy = request.SortBy?.Trim().ToLowerInvariant() ?? "rounds";
        var sortDesc = request.SortDesc;

        items = (sortBy, sortDesc) switch
        {
            ("rounds", true) => items.OrderByDescending(m => m.TotalRounds).ThenBy(m => m.MapName),
            ("rounds", false) => items.OrderBy(m => m.TotalRounds).ThenBy(m => m.MapName),
            ("name", true) => items.OrderByDescending(m => m.MapName),
            ("name", false) => items.OrderBy(m => m.MapName),
            ("lastseen", true) => items.OrderByDescending(m => m.LastSeen ?? Instant.MinValue),
            ("lastseen", false) => items.OrderBy(m => m.LastSeen ?? Instant.MinValue),
            ("servers", true) => items.OrderByDescending(m => m.ServerCount).ThenByDescending(m => m.TotalRounds),
            ("servers", false) => items.OrderBy(m => m.ServerCount).ThenBy(m => m.TotalRounds),
            _ => items.OrderByDescending(m => m.TotalRounds)
        };

        var itemList = items.ToList();
        var totalMatching = itemList.Count;
        var page = Math.Max(1, request.Page);
        var pageSize = Math.Clamp(request.PageSize, 1, 1000);
        var pagedItems = itemList.Skip((page - 1) * pageSize).Take(pageSize).ToList();

        List<MapReportModGroup>? modGroups = null;
        if (string.Equals(request.GroupBy, "mod", StringComparison.OrdinalIgnoreCase))
        {
            var modMapDict = new Dictionary<string, List<MapReportItem>>(StringComparer.OrdinalIgnoreCase);

            foreach (var item in itemList)
            {
                var itemMods = item.Servers
                    .Select(s => MapImageResolver.CanonicalizeMod(s.GameId))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (itemMods.Count == 0)
                {
                    itemMods.Add("bf1942");
                }

                foreach (var m in itemMods)
                {
                    if (!modMapDict.TryGetValue(m, out var list))
                    {
                        list = [];
                        modMapDict[m] = list;
                    }
                    list.Add(item);
                }
            }

            var modSummaryDict = baseReport.Mods.ToDictionary(m => m.GameId, StringComparer.OrdinalIgnoreCase);

            modGroups = modMapDict
                .Select(kvp =>
                {
                    var modId = kvp.Key;
                    var modMaps = kvp.Value.OrderByDescending(m => m.TotalRounds).ToList();
                    modSummaryDict.TryGetValue(modId, out var ms);

                    var isInstalled = ms?.IsInstalled ?? false;
                    var totalRounds = modMaps.Sum(m => m.TotalRounds);
                    var missingCount = modMaps.Count(m => !m.HasThumbnail);
                    var hasIconCount = modMaps.Count - missingCount;
                    var serverCount = ms?.ServerCount ?? modMaps.SelectMany(m => m.Servers).Select(s => s.ServerGuid).Distinct().Count();
                    var sampleServers = ms?.SampleServers ?? modMaps.SelectMany(m => m.Servers).Select(s => s.ServerName).Distinct().Take(3).ToList();

                    return new MapReportModGroup(
                        modId,
                        isInstalled,
                        modMaps.Count,
                        missingCount,
                        hasIconCount,
                        totalRounds,
                        serverCount,
                        sampleServers,
                        modMaps
                    );
                })
                .OrderBy(g => g.IsInstalled ? 1 : 0)
                .ThenByDescending(g => g.MissingMaps)
                .ThenByDescending(g => g.TotalRounds)
                .ToList();
        }

        return new MapReportResponse(
            baseReport.Summary,
            baseReport.Mods,
            pagedItems,
            totalMatching,
            page,
            pageSize,
            modGroups
        );
    }

    private async Task<CachedBaseMapReport> BuildBaseMapReportAsync(CancellationToken ct)
    {
        var rawServers = await dbContext.Servers
            .AsNoTracking()
            .Select(s => new
            {
                s.Guid,
                s.Name,
                s.Game,
                s.GameId,
                s.Ip,
                s.Port,
                s.IsOnline,
                s.LastSeenTime,
                s.CurrentMap
            })
            .ToListAsync(ct);

        // Filter out legacy unsupported games (fh2, bfvietnam, bfv)
        var servers = rawServers
            .Where(s => !IsIgnoredGame(s.Game, s.GameId))
            .ToDictionary(s => s.Guid, StringComparer.OrdinalIgnoreCase);

        var mapStats = await dbContext.ServerMapStats
            .AsNoTracking()
            .Select(sms => new
            {
                sms.ServerGuid,
                sms.MapName,
                sms.TotalRounds,
                sms.TotalPlayTimeMinutes,
                sms.UpdatedAt
            })
            .ToListAsync(ct);

        var knownMods = mapImageResolver?.GetKnownMods() ?? [];
        var knownModsSet = new HashSet<string>(knownMods, StringComparer.OrdinalIgnoreCase);

        var mapDict = new Dictionary<string, MapAccumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var stat in mapStats)
        {
            if (string.IsNullOrWhiteSpace(stat.MapName)) continue;
            // Exclude stats from servers belonging to ignored games (fh2, bfv) or unknown servers
            if (!servers.TryGetValue(stat.ServerGuid, out var serverInfo)) continue;

            var norm = NormalizeMapName(stat.MapName);
            if (!mapDict.TryGetValue(norm, out var acc))
            {
                acc = new MapAccumulator(stat.MapName, norm);
                mapDict[norm] = acc;
            }

            var serverName = serverInfo.Name;
            var gameId = string.IsNullOrWhiteSpace(serverInfo.GameId) ? "bf1942" : serverInfo.GameId.Trim().ToLowerInvariant();
            var ip = serverInfo.Ip ?? "";
            var port = serverInfo.Port;
            var isOnline = serverInfo.IsOnline;

            acc.AddServerStat(stat.ServerGuid, serverName, gameId, ip, port, isOnline,
                stat.TotalRounds, stat.TotalPlayTimeMinutes, stat.UpdatedAt);
        }

        // Include any currently active maps from Servers.CurrentMap
        foreach (var server in servers.Values)
        {
            if (string.IsNullOrWhiteSpace(server.CurrentMap)) continue;

            var norm = NormalizeMapName(server.CurrentMap);
            if (!mapDict.TryGetValue(norm, out var acc))
            {
                acc = new MapAccumulator(server.CurrentMap, norm);
                mapDict[norm] = acc;
            }

            var gameId = string.IsNullOrWhiteSpace(server.GameId) ? "bf1942" : server.GameId.Trim().ToLowerInvariant();
            var lastSeen = Instant.FromDateTimeUtc(DateTime.SpecifyKind(server.LastSeenTime, DateTimeKind.Utc));
            acc.EnsureServer(server.Guid, server.Name, gameId, server.Ip, server.Port, server.IsOnline, lastSeen);
        }

        var allMaps = new List<MapReportItem>(mapDict.Count);
        var modAggregates = new Dictionary<string, ModAccumulator>(StringComparer.OrdinalIgnoreCase);

        foreach (var acc in mapDict.Values)
        {
            var serverMods = acc.Servers.Values.Select(s => s.GameId).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (serverMods.Count == 0) serverMods.Add("bf1942");

            bool hasThumb = false;
            bool hasMinimap = false;
            bool hasDossier = false;
            string? resolvedMod = null;

            if (mapImageResolver != null)
            {
                foreach (var mod in serverMods)
                {
                    var thumbPath = mapImageResolver.Resolve(mod, acc.NormalizedName, MapImageKind.Thumbnail);
                    if (thumbPath != null)
                    {
                        hasThumb = true;
                        resolvedMod = Path.GetDirectoryName(thumbPath)?.Replace('\\', '/');
                        break;
                    }
                }

                if (!hasThumb)
                {
                    var thumbPath = mapImageResolver.Resolve("bf1942", acc.NormalizedName, MapImageKind.Thumbnail);
                    if (thumbPath != null)
                    {
                        hasThumb = true;
                        resolvedMod = Path.GetDirectoryName(thumbPath)?.Replace('\\', '/');
                    }
                }

                foreach (var mod in serverMods)
                {
                    if (mapImageResolver.Resolve(mod, acc.NormalizedName, MapImageKind.Minimap) != null)
                    {
                        hasMinimap = true;
                        break;
                    }
                }
                if (!hasMinimap && mapImageResolver.Resolve("bf1942", acc.NormalizedName, MapImageKind.Minimap) != null)
                {
                    hasMinimap = true;
                }
            }

            if (mapDossierResolver != null)
            {
                foreach (var mod in serverMods)
                {
                    if (mapDossierResolver.Resolve(mod, acc.NormalizedName) != null)
                    {
                        hasDossier = true;
                        break;
                    }
                }
            }

            var serverList = acc.Servers.Values
                .OrderByDescending(s => s.Rounds)
                .ThenByDescending(s => s.LastSeen ?? Instant.MinValue)
                .Select(s => new MapReportServerItem(
                    s.ServerGuid,
                    s.ServerName,
                    s.GameId,
                    s.Rounds,
                    s.TotalPlayTimeMinutes,
                    s.LastSeen,
                    s.IsOnline,
                    s.Ip,
                    s.Port
                ))
                .ToList();

            var mapItem = new MapReportItem(
                acc.DisplayName,
                acc.NormalizedName,
                hasThumb,
                hasMinimap,
                hasDossier,
                resolvedMod,
                acc.TotalRounds,
                acc.TotalPlayTimeMinutes,
                acc.LastSeen,
                serverList.Count,
                serverList
            );

            allMaps.Add(mapItem);

            foreach (var s in serverList)
            {
                var mod = MapImageResolver.CanonicalizeMod(s.GameId);
                if (!modAggregates.TryGetValue(mod, out var modAcc))
                {
                    var isInstalled = knownModsSet.Contains(mod);
                    modAcc = new ModAccumulator(mod, isInstalled);
                    modAggregates[mod] = modAcc;
                }

                modAcc.AddObservation(acc.NormalizedName, hasThumb, s.Rounds, s.ServerName);
            }
        }

        var mods = modAggregates.Values
            .OrderByDescending(m => m.TotalRounds)
            .ThenByDescending(m => m.TotalMaps)
            .Select(m => new MapReportModSummary(
                m.GameId,
                m.IsInstalled,
                m.Maps.Count,
                m.Maps.Count(k => !k.Value),
                m.Maps.Count(k => k.Value),
                m.TotalRounds,
                m.Servers.Count,
                m.Servers.Take(3).ToList()
            ))
            .ToList();

        var totalMaps = allMaps.Count;
        var missingIconMaps = allMaps.Count(m => !m.HasThumbnail);
        var hasIconMaps = totalMaps - missingIconMaps;
        var totalMods = mods.Count;
        var uninstalledMods = mods.Count(m => !m.IsInstalled);

        var summary = new MapReportSummary(
            totalMaps,
            missingIconMaps,
            hasIconMaps,
            totalMods,
            uninstalledMods
        );

        return new CachedBaseMapReport(summary, mods, allMaps);
    }

    private static string NormalizeMapName(string mapName)
    {
        var trimmed = mapName.Trim();
        if (trimmed.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[..^4];
        var lower = trimmed.ToLowerInvariant().Replace(' ', '_');
        return lower switch
        {
            "wake_island" => "wake",
            "huskies" => "husky",
            "santa_croce" => "santo_croce",
            _ => lower
        };
    }

    private class MapAccumulator(string initialRawName, string normalizedName)
    {
        public string DisplayName { get; set; } = initialRawName;
        public string NormalizedName { get; } = normalizedName;
        public int TotalRounds { get; set; }
        public int TotalPlayTimeMinutes { get; set; }
        public Instant? LastSeen { get; set; }
        public Dictionary<string, ServerAccumulator> Servers { get; } = new(StringComparer.OrdinalIgnoreCase);

        public void AddServerStat(string guid, string name, string gameId, string ip, int port, bool isOnline,
            int rounds, int playTime, Instant updatedAt)
        {
            TotalRounds += rounds;
            TotalPlayTimeMinutes += playTime;
            if (LastSeen == null || updatedAt > LastSeen.Value)
            {
                LastSeen = updatedAt;
            }

            if (!Servers.TryGetValue(guid, out var s))
            {
                s = new ServerAccumulator(guid, name, gameId, ip, port, isOnline);
                Servers[guid] = s;
            }
            s.Rounds += rounds;
            s.TotalPlayTimeMinutes += playTime;
            if (s.LastSeen == null || updatedAt > s.LastSeen.Value)
            {
                s.LastSeen = updatedAt;
            }
        }

        public void EnsureServer(string guid, string name, string gameId, string ip, int port, bool isOnline, Instant lastSeen)
        {
            if (!Servers.TryGetValue(guid, out var s))
            {
                s = new ServerAccumulator(guid, name, gameId, ip, port, isOnline);
                Servers[guid] = s;
            }
            if (s.LastSeen == null || lastSeen > s.LastSeen.Value)
            {
                s.LastSeen = lastSeen;
            }
            if (LastSeen == null || lastSeen > LastSeen.Value)
            {
                LastSeen = lastSeen;
            }
        }
    }

    private class ServerAccumulator(string guid, string name, string gameId, string ip, int port, bool isOnline)
    {
        public string ServerGuid { get; } = guid;
        public string ServerName { get; } = name;
        public string GameId { get; } = gameId;
        public string Ip { get; } = ip;
        public int Port { get; } = port;
        public bool IsOnline { get; } = isOnline;
        public int Rounds { get; set; }
        public int TotalPlayTimeMinutes { get; set; }
        public Instant? LastSeen { get; set; }
    }

    private class ModAccumulator(string gameId, bool isInstalled)
    {
        public string GameId { get; } = gameId;
        public bool IsInstalled { get; } = isInstalled;
        public int TotalRounds { get; set; }
        public Dictionary<string, bool> Maps { get; } = new(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> Servers { get; } = new(StringComparer.OrdinalIgnoreCase);
        public int TotalMaps => Maps.Count;

        public void AddObservation(string mapNorm, bool hasThumb, int rounds, string serverName)
        {
            TotalRounds += rounds;
            if (!string.IsNullOrWhiteSpace(serverName))
            {
                Servers.Add(serverName);
            }
            if (!Maps.TryGetValue(mapNorm, out var current) || (!current && hasThumb))
            {
                Maps[mapNorm] = hasThumb;
            }
        }
    }
}

public record CachedBaseMapReport(
    MapReportSummary Summary,
    List<MapReportModSummary> Mods,
    List<MapReportItem> AllMaps
);
