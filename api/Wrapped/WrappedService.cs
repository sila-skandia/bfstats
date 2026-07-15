using api.Data.Entities;
using api.PlayerTracking;
using api.Wrapped.Models;
using api.Utils;
using api.PlayerRelationships;
using api.Players;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;
using NodaTime.Serialization.SystemTextJson;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

using Microsoft.Extensions.Configuration;

namespace api.Wrapped;

public class WrappedService(
    PlayerTrackerDbContext dbContext,
    IConfiguration configuration,
    IServiceProvider serviceProvider,
    ILogger<WrappedService> logger) : IWrappedService
{
    private readonly IPlayerRelationshipService? _relationshipService = 
        (IPlayerRelationshipService?)serviceProvider.GetService(typeof(IPlayerRelationshipService));

    private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions 
    { 
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase 
    }.ConfigureForNodaTime(DateTimeZoneProviders.Tzdb);

    private List<string> GetAllowedGuids()
    {
        var section = configuration.GetSection("ServerWrapped:AllowedGuids");
        var list = section.Get<List<string>>();
        if (list != null && list.Count > 0)
        {
            return list;
        }

        // Fallback defaults for short-term testing (the target active servers)
        return new List<string>
        {
            "7b3a63-12e36b3-6dac2c-8c0a76c", // MoonGamers.com | Est. 2004
            "42b98b-61f0b93-183a06c-49be6b0"  // *NEW* SiMPLE | BF1942
        };
    }

    private List<string> GetAllowedPlayerNames()
    {
        var section = configuration.GetSection("PlayerWrapped:AllowedPlayerNames");
        var list = section.Get<List<string>>();
        if (list != null && list.Count > 0)
        {
            return list.Select(name => name.Trim()).ToList();
        }

        // Default testing fallback players
        return new List<string> { "Werwolf" };
    }

    public async Task<ServerWrappedResponseDto?> GetServerWrappedAsync(string serverGuid, int year = 2026, bool bypassCache = false)
    {
        var allowedGuids = GetAllowedGuids();
        if (!allowedGuids.Contains(serverGuid))
        {
            logger.LogWarning("Access blocked. Server Wrapped is not enabled for server GUID {ServerGuid}", serverGuid);
            return null;
        }

        if (!bypassCache)
        {
            var cached = await dbContext.ServerWrappedCaches
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.ServerGuid == serverGuid && c.Year == year);

            if (cached != null)
            {
                logger.LogDebug("Cache hit for Server Wrapped GUID {ServerGuid}, year {Year}", serverGuid, year);
                try
                {
                    var dto = JsonSerializer.Deserialize<ServerWrappedResponseDto>(cached.JsonData, JsonOptions);
                    if (dto != null) return dto;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Failed to deserialize cached Server Wrapped data for {ServerGuid}", serverGuid);
                }
            }
        }

        logger.LogInformation("Cache miss. Calculating Server Wrapped for {ServerGuid}, year {Year}...", serverGuid, year);
        var calculated = await CalculateServerWrappedInternalAsync(serverGuid, year);
        if (calculated != null)
        {
            await SaveToCacheAsync(serverGuid, year, calculated);
        }
        return calculated;
    }

    public async Task CrunchAllServersWrappedAsync(int year, CancellationToken ct)
    {
        var allowedGuids = GetAllowedGuids();
        var servers = await dbContext.Servers
            .AsNoTracking()
            .Where(s => allowedGuids.Contains(s.Guid))
            .ToListAsync(ct);
        logger.LogInformation("Starting pre-computation of Wrapped data for {Count} whitelisted servers for year {Year}", servers.Count, year);

        foreach (var server in servers)
        {
            if (ct.IsCancellationRequested) break;
            logger.LogDebug("Crunching wrapped data for: {ServerName} ({Guid})", server.Name, server.Guid);

            try
            {
                var data = await CalculateServerWrappedInternalAsync(server.Guid, year);
                if (data != null)
                {
                    await SaveToCacheAsync(server.Guid, year, data);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to pre-compute wrapped data for server: {ServerName} ({Guid})", server.Name, server.Guid);
            }
        }
        logger.LogInformation("Wrapped pre-computation completed successfully.");
    }

    private async Task SaveToCacheAsync(string serverGuid, int year, ServerWrappedResponseDto dto)
    {
        var jsonData = JsonSerializer.Serialize(dto, JsonOptions);
        var existing = await dbContext.ServerWrappedCaches
            .FirstOrDefaultAsync(c => c.ServerGuid == serverGuid && c.Year == year);

        if (existing != null)
        {
            existing.JsonData = jsonData;
            existing.CalculatedAt = SystemClock.Instance.GetCurrentInstant();
        }
        else
        {
            dbContext.ServerWrappedCaches.Add(new ServerWrappedCache
            {
                ServerGuid = serverGuid,
                Year = year,
                JsonData = jsonData,
                CalculatedAt = SystemClock.Instance.GetCurrentInstant()
            });
        }
        await dbContext.SaveChangesAsync();
    }

    private async Task<ServerWrappedResponseDto?> CalculateServerWrappedInternalAsync(string serverGuid, int year)
    {
        var server = await dbContext.Servers
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Guid == serverGuid);

        if (server == null) return null;

        var startYear = new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var endYear = new DateTime(year + 1, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var startInstant = Instant.FromDateTimeUtc(startYear);
        var endInstant = Instant.FromDateTimeUtc(endYear);

        // Timezone setup
        var tzProvider = DateTimeZoneProviders.Tzdb;
        var timezone = !string.IsNullOrEmpty(server.Timezone)
            ? (tzProvider.GetZoneOrNull(server.Timezone) ?? tzProvider["UTC"])
            : tzProvider["UTC"];

        // 1. Year in Numbers
        var roundsCount = await dbContext.Rounds.CountAsync(r => r.ServerGuid == serverGuid && r.StartTime >= startYear && r.StartTime < endYear && !r.IsDeleted);
        var uniqueSoldiers = await dbContext.PlayerSessions.Where(ps => ps.ServerGuid == serverGuid && ps.StartTime >= startYear && ps.StartTime < endYear && !ps.IsDeleted).Select(ps => ps.PlayerName).Distinct().CountAsync();
        var hoursInCombat = await dbContext.PlayerServerStats.Where(pss => pss.ServerGuid == serverGuid && pss.Year == year).SumAsync(pss => pss.TotalPlayTimeMinutes) / 60.0;
        
        var peakRecord = await dbContext.ServerOnlineCounts
            .Where(soc => soc.ServerGuid == serverGuid && soc.HourTimestamp >= startInstant && soc.HourTimestamp < endInstant)
            .OrderByDescending(soc => soc.PeakPlayers)
            .FirstOrDefaultAsync();
        var peakPopulation = peakRecord?.PeakPlayers ?? 0;
        var peakTimestamp = peakRecord?.HourTimestamp ?? Instant.MinValue;

        var totalDecorations = await dbContext.PlayerAchievements.CountAsync(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant);

        var yearInNumbers = new YearInNumbersDto(roundsCount, uniqueSoldiers, hoursInCombat, peakPopulation, peakTimestamp, totalDecorations);

        // 2. Busiest Hours / Heatmap (Timezone-Aware)
        var onlineCounts = await dbContext.ServerOnlineCounts
            .Where(soc => soc.ServerGuid == serverGuid && soc.HourTimestamp >= startInstant && soc.HourTimestamp < endInstant)
            .ToListAsync();

        var cells = onlineCounts
            .GroupBy(soc => {
                var localTime = soc.HourTimestamp.InZone(timezone).LocalDateTime;
                var day = localTime.DayOfWeek switch {
                    IsoDayOfWeek.Sunday => 0,
                    IsoDayOfWeek.Monday => 1,
                    IsoDayOfWeek.Tuesday => 2,
                    IsoDayOfWeek.Wednesday => 3,
                    IsoDayOfWeek.Thursday => 4,
                    IsoDayOfWeek.Friday => 5,
                    IsoDayOfWeek.Saturday => 6,
                    _ => 0
                };
                return new { Day = day, Hour = localTime.Hour };
            })
            .Select(g => new HeatmapCellDto(g.Key.Day, g.Key.Hour, g.Average(soc => soc.AvgPlayers)))
            .ToList();

        var hourlyAverages = Enumerable.Range(0, 24)
            .Select(h => cells.Where(c => c.HourOfDay == h).Select(c => c.AvgPlayers).DefaultIfEmpty(0.0).Average())
            .ToList();

        var busiestHours = new BusiestHoursDto(cells, hourlyAverages);

        var mapStatsData = await dbContext.ServerMapStats
            .Where(sms => sms.ServerGuid == serverGuid && sms.Year == year)
            .GroupBy(sms => sms.MapName)
            .Select(g => new {
                MapName = g.Key,
                RoundsPlayed = g.Sum(sms => sms.TotalRounds),
                PlayTimeMinutes = g.Sum(sms => sms.TotalPlayTimeMinutes)
            })
            .OrderByDescending(m => m.RoundsPlayed)
            .ToListAsync();

        // Fetch top 3 users with the most 1st place finishes per map
        var goldAchievements = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.ServerGuid == serverGuid 
                && pa.AchievementType == "round_placement" 
                && pa.Tier == "gold" 
                && pa.AchievedAt >= startInstant 
                && pa.AchievedAt < endInstant)
            .ToListAsync();

        var topPlacementsByMap = goldAchievements
            .GroupBy(pa => pa.MapName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.GroupBy(pa => pa.PlayerName)
                    .Select(pg => new MapTopPlacementDto(pg.Key, pg.Count()))
                    .OrderByDescending(tp => tp.FirstPlaceCount)
                    .ThenBy(tp => tp.PlayerName)
                    .Take(3)
                    .ToList(),
                StringComparer.OrdinalIgnoreCase
            );

        var mapStats = mapStatsData.Select(m => {
            topPlacementsByMap.TryGetValue(m.MapName, out var placements);
            return new MapRotationDto(
                m.MapName,
                m.RoundsPlayed,
                m.PlayTimeMinutes,
                0.0,
                placements ?? new List<MapTopPlacementDto>()
            );
        }).ToList();

        var totalMapPlayTime = mapStats.Sum(m => m.PlayTimeMinutes);
        mapStats = mapStats.Select(m => m with { PlayTimePercentage = totalMapPlayTime > 0 ? Math.Round(m.PlayTimeMinutes * 100.0 / totalMapPlayTime, 2) : 0 }).ToList();

        var mostPlayed = mapStats.FirstOrDefault();
        var rotation = new RotationDto(
            mapStats,
            mostPlayed?.MapName ?? "",
            mostPlayed?.RoundsPlayed ?? 0,
            mostPlayed?.PlayTimePercentage ?? 0.0
        );

        // 4. Honours (PlayerServerStats)
        var playerStats = await dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid && pss.Year == year)
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new {
                PlayerName = g.Key,
                Rounds = g.Sum(pss => pss.TotalRounds),
                Kills = g.Sum(pss => pss.TotalKills),
                Deaths = g.Sum(pss => pss.TotalDeaths),
                Score = g.Sum(pss => pss.TotalScore),
                PlayTimeMinutes = g.Sum(pss => pss.TotalPlayTimeMinutes)
            })
            .ToListAsync();

        // Dynamic round threshold logic for skill boards
        int honoursThreshold = 100;
        if (playerStats.Count(p => p.Rounds >= honoursThreshold) < 5) honoursThreshold = 50;
        if (playerStats.Count(p => p.Rounds >= honoursThreshold) < 5) honoursThreshold = 20;
        if (playerStats.Count(p => p.Rounds >= honoursThreshold) < 5) honoursThreshold = 5;

        var topKDRatios = playerStats
            .Where(p => p.Rounds >= honoursThreshold && (p.Kills > 0 || p.Deaths > 0))
            .Select(p => new PlayerKDRatioDto(
                PlayerNameDecoder.Decode(p.PlayerName),
                p.Rounds,
                p.Kills,
                p.Deaths,
                p.Deaths > 0 ? Math.Round((double)p.Kills / p.Deaths, 2) : p.Kills,
                0
            ))
            .OrderByDescending(p => p.KDRatio)
            .Take(10)
            .Select((p, idx) => p with { Rank = idx + 1 })
            .ToList();

        var topKillRates = playerStats
            .Where(p => p.Rounds >= honoursThreshold && p.Kills > 0 && p.PlayTimeMinutes > 0)
            .Select(p => new PlayerKillRateDto(
                PlayerNameDecoder.Decode(p.PlayerName),
                p.Rounds,
                p.Kills,
                (int)p.PlayTimeMinutes,
                Math.Round((double)p.Kills / p.PlayTimeMinutes, 2),
                0
            ))
            .OrderByDescending(p => p.KillRate)
            .Take(10)
            .Select((p, idx) => p with { Rank = idx + 1 })
            .ToList();

        var topScorePlayer = playerStats.OrderByDescending(p => p.Score).FirstOrDefault();
        var topKillsPlayer = playerStats.OrderByDescending(p => p.Kills).FirstOrDefault();
        var topHoursPlayer = playerStats.OrderByDescending(p => p.PlayTimeMinutes).FirstOrDefault();

        var volumeBoards = new VolumeBoardsDto(
            new PlayerVolumeDto(PlayerNameDecoder.Decode(topScorePlayer?.PlayerName ?? ""), topScorePlayer?.Score ?? 0),
            new PlayerVolumeDto(PlayerNameDecoder.Decode(topKillsPlayer?.PlayerName ?? ""), topKillsPlayer?.Kills ?? 0),
            new PlayerVolumeDto(PlayerNameDecoder.Decode(topHoursPlayer?.PlayerName ?? ""), Math.Round((topHoursPlayer?.PlayTimeMinutes ?? 0) / 60.0, 1))
        );

        var honours = new HonoursDto(topKDRatios, topKillRates, volumeBoards);

        // 5. Decorations (Milestones & Streaks with fallback)
        var streaks = await dbContext.PlayerAchievements
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant &&
                         (pa.AchievementId == "kill_streak_25" || pa.AchievementId == "kill_streak_30" || pa.AchievementId == "kill_streak_50"))
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .FirstOrDefaultAsync();

        PlayerVolumeDto streaksDto;
        if (streaks != null)
        {
            streaksDto = new PlayerVolumeDto(PlayerNameDecoder.Decode(streaks.PlayerName), streaks.Count);
        }
        else
        {
            var lowerStreak = await dbContext.PlayerAchievements
                .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant && pa.AchievementId.StartsWith("kill_streak_"))
                .GroupBy(pa => new { pa.PlayerName, pa.AchievementId })
                .Select(g => new { g.Key.PlayerName, g.Key.AchievementId, Count = g.Count() })
                .ToListAsync();

            var bestLower = lowerStreak
                .OrderByDescending(x => GetStreakValueFromId(x.AchievementId))
                .ThenByDescending(x => x.Count)
                .FirstOrDefault();

            streaksDto = new PlayerVolumeDto(PlayerNameDecoder.Decode(bestLower?.PlayerName ?? ""), bestLower?.Count ?? 0);
        }

        var legendStreak = await dbContext.PlayerAchievements
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant && pa.AchievementId.StartsWith("kill_streak_"))
            .ToListAsync();

        StreakOfTheYearDto? streakOfTheYear = null;
        if (legendStreak.Count > 0)
        {
            var bestStreak = legendStreak
                .Select(s => {
                    var actual = GetStreakValueFromId(s.AchievementId);
                    if (!string.IsNullOrEmpty(s.Metadata)) {
                        try {
                            var doc = JsonDocument.Parse(s.Metadata);
                            if (doc.RootElement.TryGetProperty("actual_streak", out var val)) actual = val.GetInt32();
                        } catch {}
                    }
                    return new { s.PlayerName, Streak = actual, s.MapName, Date = s.AchievedAt };
                })
                .OrderByDescending(x => x.Streak)
                .FirstOrDefault();

            if (bestStreak != null)
            {
                streakOfTheYear = new StreakOfTheYearDto(
                    PlayerNameDecoder.Decode(bestStreak.PlayerName),
                    bestStreak.Streak,
                    bestStreak.MapName,
                    bestStreak.Date
                );
            }
        }

        var podiums = await dbContext.PlayerAchievements
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant && pa.AchievementId == "round_placement_1")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .FirstOrDefaultAsync();

        var podiumsDto = new PlayerVolumeDto(PlayerNameDecoder.Decode(podiums?.PlayerName ?? ""), podiums?.Count ?? 0);

        var achievedPrestigious = await dbContext.PlayerAchievements
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant)
            .ToListAsync();

        var allMilestones = achievedPrestigious
            .Where(pa => pa.AchievementType == "milestone" || pa.AchievementId.StartsWith("total_kills_") || pa.AchievementId.StartsWith("total_score_") || pa.AchievementId.StartsWith("milestone_playtime_") || pa.AchievementId.Contains("legend"))
            .ToList();

        var topPrestigious = allMilestones
            .OrderByDescending(pa => GetPrestigeWeight(pa.AchievementId))
            .ThenBy(pa => pa.AchievedAt)
            .FirstOrDefault();

        PrestigiousMilestoneDto? prestigiousDto = null;
        if (topPrestigious != null)
        {
            var (name, desc) = GetAchievementInfo(topPrestigious.AchievementId);
            prestigiousDto = new PrestigiousMilestoneDto(
                topPrestigious.AchievementId,
                PlayerNameDecoder.Decode(topPrestigious.PlayerName),
                name,
                desc
            );
        }

        // Calculate Elite Warrior moving window streaks for this server in the given year
        var sessions = await dbContext.PlayerSessions
            .AsNoTracking()
            .Where(ps => ps.ServerGuid == serverGuid && ps.StartTime >= startYear && ps.StartTime < endYear && !ps.IsDeleted)
            .OrderBy(ps => ps.PlayerName)
            .ThenBy(ps => ps.StartTime)
            .Select(ps => new { ps.PlayerName, ps.TotalKills, ps.TotalDeaths })
            .ToListAsync();

        PlayerVolumeDto? eliteWarriorGold = null;
        PlayerVolumeDto? eliteWarriorLegend = null;

        var playerGroups = sessions.GroupBy(ps => ps.PlayerName);
        var goldStreaksList = new List<(string PlayerName, int Streak)>();
        var legendStreaksList = new List<(string PlayerName, int Streak)>();

        foreach (var group in playerGroups)
        {
            var pName = group.Key;
            var sessList = group.ToList();

            // Gold: KD >= 4.0 over last 100 rounds
            var windowGoldK = new int[100];
            var windowGoldD = new int[100];
            int windowGoldIndex = 0;
            int windowGoldCount = 0;
            int currentStreakGold = 0;
            int maxStreakGold = 0;

            // Legend: KD >= 5.0 over last 200 rounds
            var windowLegendK = new int[200];
            var windowLegendD = new int[200];
            int windowLegendIndex = 0;
            int windowLegendCount = 0;
            int currentStreakLegend = 0;
            int maxStreakLegend = 0;

            foreach (var s in sessList)
            {
                // Gold Update
                if (windowGoldCount < 100)
                {
                    windowGoldK[windowGoldCount] = s.TotalKills;
                    windowGoldD[windowGoldCount] = s.TotalDeaths;
                    windowGoldCount++;
                }
                else
                {
                    windowGoldK[windowGoldIndex] = s.TotalKills;
                    windowGoldD[windowGoldIndex] = s.TotalDeaths;
                    windowGoldIndex = (windowGoldIndex + 1) % 100;
                }

                // Legend Update
                if (windowLegendCount < 200)
                {
                    windowLegendK[windowLegendCount] = s.TotalKills;
                    windowLegendD[windowLegendCount] = s.TotalDeaths;
                    windowLegendCount++;
                }
                else
                {
                    windowLegendK[windowLegendIndex] = s.TotalKills;
                    windowLegendD[windowLegendIndex] = s.TotalDeaths;
                    windowLegendIndex = (windowLegendIndex + 1) % 200;
                }

                // Gold Evaluation
                if (windowGoldCount == 100)
                {
                    int totK = 0, totD = 0;
                    for (int i = 0; i < 100; i++)
                    {
                        totK += windowGoldK[i];
                        totD += windowGoldD[i];
                    }
                    double kd = (double)totK / Math.Max(1, totD);
                    if (kd >= 4.0)
                    {
                        currentStreakGold++;
                        if (currentStreakGold > maxStreakGold) maxStreakGold = currentStreakGold;
                    }
                    else
                    {
                        currentStreakGold = 0;
                    }
                }

                // Legend Evaluation
                if (windowLegendCount == 200)
                {
                    int totK = 0, totD = 0;
                    for (int i = 0; i < 200; i++)
                    {
                        totK += windowLegendK[i];
                        totD += windowLegendD[i];
                    }
                    double kd = (double)totK / Math.Max(1, totD);
                    if (kd >= 5.0)
                    {
                        currentStreakLegend++;
                        if (currentStreakLegend > maxStreakLegend) maxStreakLegend = currentStreakLegend;
                    }
                    else
                    {
                        currentStreakLegend = 0;
                    }
                }
            }

            if (maxStreakGold > 0) goldStreaksList.Add((pName, maxStreakGold));
            if (maxStreakLegend > 0) legendStreaksList.Add((pName, maxStreakLegend));
        }

        var topGold = goldStreaksList.OrderByDescending(x => x.Streak).FirstOrDefault();
        if (topGold.PlayerName != null)
        {
            eliteWarriorGold = new PlayerVolumeDto(PlayerNameDecoder.Decode(topGold.PlayerName), topGold.Streak);
        }

        var topLegend = legendStreaksList.OrderByDescending(x => x.Streak).FirstOrDefault();
        if (topLegend.PlayerName != null)
        {
            eliteWarriorLegend = new PlayerVolumeDto(PlayerNameDecoder.Decode(topLegend.PlayerName), topLegend.Streak);
        }

        // Calculate player with the most Legend (or fallback tiers) achievements (excluding team_victory and kill_streak_50)
        var tiersToCheck = new[] { "legend", "gold", "silver", "bronze" };
        string? activeTier = null;
        foreach (var tier in tiersToCheck)
        {
            var exists = await dbContext.PlayerAchievements
                .AnyAsync(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant 
                    && pa.Tier == tier && pa.AchievementId != "team_victory" && pa.AchievementId != "team_victory_switched" && pa.AchievementId != "kill_streak_50");
            if (exists)
            {
                activeTier = tier;
                break;
            }
        }

        LegendAchievementDto? mostLegendAchievements = null;
        if (activeTier != null)
        {
            var topRecord = await dbContext.PlayerAchievements
                .AsNoTracking()
                .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant 
                    && pa.Tier == activeTier && pa.AchievementId != "team_victory" && pa.AchievementId != "team_victory_switched" && pa.AchievementId != "kill_streak_50")
                .GroupBy(pa => pa.PlayerName)
                .Select(g => new { PlayerName = g.Key, Count = g.Count() })
                .OrderByDescending(x => x.Count)
                .FirstOrDefaultAsync();

            if (topRecord != null)
            {
                var repAchievement = (await dbContext.PlayerAchievements
                    .AsNoTracking()
                    .Where(pa => pa.ServerGuid == serverGuid && pa.PlayerName == topRecord.PlayerName && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant 
                        && pa.Tier == activeTier && pa.AchievementId != "team_victory" && pa.AchievementId != "team_victory_switched" && pa.AchievementId != "kill_streak_50")
                    .ToListAsync())
                    .OrderByDescending(pa => GetPrestigeWeight(pa.AchievementId))
                    .FirstOrDefault();

                if (repAchievement != null)
                {
                    var (repName, repDesc) = GetAchievementInfo(repAchievement.AchievementId);
                    mostLegendAchievements = new LegendAchievementDto(
                        repAchievement.AchievementId,
                        PlayerNameDecoder.Decode(topRecord.PlayerName),
                        repName,
                        repDesc,
                        topRecord.Count,
                        activeTier
                    );
                }
            }
        }

        var milestones = allMilestones.Count;

        var decorations = new DecorationsDto(
            streaksDto, 
            streakOfTheYear, 
            podiumsDto, 
            milestones, 
            prestigiousDto, 
            eliteWarriorGold, 
            eliteWarriorLegend, 
            mostLegendAchievements
        );

        // 6. Dishonours
        var cannonFodderPlayer = playerStats.OrderByDescending(p => p.Deaths).FirstOrDefault();
        var cannonFodder = new PlayerVolumeDto(PlayerNameDecoder.Decode(cannonFodderPlayer?.PlayerName ?? ""), cannonFodderPlayer?.Deaths ?? 0);

        var winAchievements = await dbContext.PlayerAchievements
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant 
                && (pa.AchievementId == "team_victory" || pa.AchievementId == "team_victory_switched"))
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Wins = g.Count() })
            .ToDictionaryAsync(x => x.PlayerName, x => x.Wins);

        // Dynamic loss rate round threshold fallback
        int lossThreshold = 50;
        if (playerStats.Count(p => p.Rounds >= lossThreshold) < 3) lossThreshold = 20;
        if (playerStats.Count(p => p.Rounds >= lossThreshold) < 3) lossThreshold = 5;

        PlayerLossRateDto? hardLuck = null;
        var hardLuckPlayer = playerStats
            .Where(p => p.Rounds >= lossThreshold)
            .Select(p => {
                var wins = winAchievements.TryGetValue(p.PlayerName, out var w) ? w : 0;
                var losses = p.Rounds - wins;
                return new {
                    p.PlayerName,
                    p.Rounds,
                    Losses = losses,
                    LossRate = p.Rounds > 0 ? (double)losses / p.Rounds : 0.0
                };
            })
            .OrderByDescending(x => x.LossRate)
            .FirstOrDefault();

        if (hardLuckPlayer != null)
        {
            hardLuck = new PlayerLossRateDto(
                PlayerNameDecoder.Decode(hardLuckPlayer.PlayerName),
                hardLuckPlayer.Rounds,
                hardLuckPlayer.Losses,
                Math.Round(hardLuckPlayer.LossRate, 3)
            );
        }

        // Dynamic ping session count fallback
        int pingThreshold = 30;
        if (await dbContext.PlayerSessions.CountAsync(ps => ps.ServerGuid == serverGuid && ps.StartTime >= startYear && ps.StartTime < endYear && ps.AveragePing != null) < 5) pingThreshold = 10;
        if (await dbContext.PlayerSessions.CountAsync(ps => ps.ServerGuid == serverGuid && ps.StartTime >= startYear && ps.StartTime < endYear && ps.AveragePing != null) < 5) pingThreshold = 3;

        var dialUpPlayer = await dbContext.PlayerSessions
            .Where(ps => ps.ServerGuid == serverGuid && ps.StartTime >= startYear && ps.StartTime < endYear && ps.AveragePing != null)
            .GroupBy(ps => ps.PlayerName)
            .Select(g => new {
                PlayerName = g.Key,
                Sessions = g.Count(),
                AvgPing = g.Average(ps => ps.AveragePing!.Value)
            })
            .Where(x => x.Sessions >= pingThreshold)
            .OrderByDescending(x => x.AvgPing)
            .FirstOrDefaultAsync();

        PlayerAvgPingDto? dialUp = null;
        if (dialUpPlayer != null)
        {
            dialUp = new PlayerAvgPingDto(
                PlayerNameDecoder.Decode(dialUpPlayer.PlayerName),
                dialUpPlayer.Sessions,
                Math.Round(dialUpPlayer.AvgPing, 1)
            );
        }

        var touristPlayer = playerStats
            .Where(p => p.Rounds > 3 && p.Rounds < honoursThreshold && (p.Kills > 0 || p.Deaths > 0))
            .Select(p => new PlayerKDRatioDto(
                PlayerNameDecoder.Decode(p.PlayerName),
                p.Rounds,
                p.Kills,
                p.Deaths,
                p.Deaths > 0 ? Math.Round((double)p.Kills / p.Deaths, 2) : p.Kills,
                0
            ))
            .OrderByDescending(x => x.KDRatio)
            .FirstOrDefault();

        var dishonours = new DishonoursDto(cannonFodder, hardLuck, dialUp, touristPlayer);

        // 7. Closest Battles (dynamic player threshold fallback)
        int minClosestPlayers = 50;
        var roundsQuery = dbContext.Rounds.Where(r => 
            r.ServerGuid == serverGuid && 
            r.StartTime >= startYear && 
            r.StartTime < endYear && 
            r.Tickets1 != null && 
            r.Tickets2 != null && 
            r.Tickets1.Value != r.Tickets2.Value &&
            r.GameType != "ctf" && 
            r.GameType != "gpm_ctf" && 
            r.GameType != "CTF" && 
            r.GameType != "GPM_CTF" &&
            !r.IsDeleted);
        
        if (await roundsQuery.CountAsync(r => r.ParticipantCount >= minClosestPlayers) < 3) minClosestPlayers = 20;
        if (await roundsQuery.CountAsync(r => r.ParticipantCount >= minClosestPlayers) < 3) minClosestPlayers = 0;

        var closestBattles = await roundsQuery
            .Where(r => r.ParticipantCount >= minClosestPlayers)
            .OrderBy(r => Math.Abs(r.Tickets1!.Value - r.Tickets2!.Value))
            .ThenByDescending(r => r.ParticipantCount)
            .Take(3)
            .Select(r => new ClosestBattleDto(
                r.MapName,
                Instant.FromDateTimeUtc(DateTime.SpecifyKind(r.StartTime, DateTimeKind.Utc)),
                r.ParticipantCount ?? 0,
                Math.Abs(r.Tickets1!.Value - r.Tickets2!.Value),
                r.DurationMinutes ?? 0,
                r.RoundId,
                r.Tickets1.Value > r.Tickets2.Value ? (r.Team1Label ?? "Allies") : (r.Team2Label ?? "Axis")
            ))
            .ToListAsync();

        return new ServerWrappedResponseDto(
            serverGuid,
            server.Name,
            year,
            yearInNumbers,
            busiestHours,
            rotation,
            honours,
            decorations,
            dishonours,
            closestBattles
        );
    }

    public async Task<PlayerWrappedResponseDto?> GetPlayerWrappedAsync(string playerName, string serverGuid, int year = 2026, bool bypassCache = false)
    {
        if (!bypassCache)
        {
            var cached = await dbContext.PlayerWrappedCaches
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.PlayerName == playerName && c.ServerGuid == serverGuid && c.Year == year);

            if (cached != null)
            {
                logger.LogDebug("Cache hit for Player Wrapped Name {PlayerName}, GUID {ServerGuid}, year {Year}", playerName, serverGuid, year);
                try
                {
                    var dto = JsonSerializer.Deserialize<PlayerWrappedResponseDto>(cached.JsonData, JsonOptions);
                    if (dto != null) return dto;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Failed to deserialize cached Player Wrapped data for {PlayerName}", playerName);
                }
            }
        }

        logger.LogInformation("Cache miss. Calculating Player Wrapped for {PlayerName}, GUID {ServerGuid}, year {Year}...", playerName, serverGuid, year);
        var calculated = await CalculatePlayerWrappedInternalAsync(playerName, serverGuid, year);
        if (calculated != null)
        {
            await SavePlayerToCacheAsync(playerName, serverGuid, year, calculated);
        }
        return calculated;
    }

    public async Task CrunchAllPlayersWrappedAsync(int year, CancellationToken ct)
    {
        var allowedGuids = GetAllowedGuids();
        var allowedPlayerNames = GetAllowedPlayerNames();

        if (allowedPlayerNames.Count == 0)
        {
            logger.LogWarning("No players configured in PlayerWrapped:AllowedPlayerNames. Skipping Player Wrapped crunching job.");
            return;
        }

        var activePlayers = await dbContext.PlayerServerStats
            .Where(pss => pss.Year == year && allowedGuids.Contains(pss.ServerGuid) && allowedPlayerNames.Contains(pss.PlayerName))
            .GroupBy(pss => new { pss.PlayerName, pss.ServerGuid })
            .Select(g => new { g.Key.PlayerName, g.Key.ServerGuid, Rounds = g.Sum(pss => pss.TotalRounds) })
            .Where(x => x.Rounds >= 20)
            .ToListAsync(ct);

        logger.LogInformation("Starting pre-computation of Wrapped data for {Count} active player-server pairs for year {Year}", activePlayers.Count, year);

        foreach (var p in activePlayers)
        {
            if (ct.IsCancellationRequested) break;
            logger.LogDebug("Crunching player wrapped for: {PlayerName} on server {ServerGuid}", p.PlayerName, p.ServerGuid);

            try
            {
                var serverData = await CalculatePlayerWrappedInternalAsync(p.PlayerName, p.ServerGuid, year);
                if (serverData != null)
                {
                    await SavePlayerToCacheAsync(p.PlayerName, p.ServerGuid, year, serverData);
                }

                var globalData = await CalculatePlayerWrappedInternalAsync(p.PlayerName, "global", year);
                if (globalData != null)
                {
                    await SavePlayerToCacheAsync(p.PlayerName, "global", year, globalData);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to pre-compute wrapped data for player: {PlayerName}", p.PlayerName);
            }
        }
        logger.LogInformation("Player Wrapped pre-computation completed successfully.");
    }

    public async Task<ProfileWrappedResponseDto?> GetProfileWrappedAsync(int userId, int year = 2026, bool bypassCache = false)
    {
        var aliases = await dbContext.UserPlayerNames
            .Where(x => x.UserId == userId)
            .Select(x => x.PlayerName)
            .ToListAsync();

        if (aliases.Count == 0) return null;

        // Each alias reuses the existing (already cached) single-player computation as-is —
        // aliases with no activity this year are dropped rather than diluting the aggregate.
        var aliasResults = new List<PlayerWrappedResponseDto>();
        foreach (var alias in aliases)
        {
            var result = await GetPlayerWrappedAsync(alias, "global", year, bypassCache);
            if (result != null && result.YearInNumbers.RoundsPlayed > 0)
            {
                aliasResults.Add(result);
            }
        }

        if (aliasResults.Count == 0) return null;

        return MergeProfileWrapped(userId, year, aliasResults);
    }

    private static ProfileWrappedResponseDto MergeProfileWrapped(int userId, int year, List<PlayerWrappedResponseDto> aliasResults)
    {
        var mostActive = aliasResults.OrderByDescending(a => a.YearInNumbers.RoundsPlayed).First();

        var yearInNumbers = MergeYearInNumbers(aliasResults);
        var trend = MergeTrend(aliasResults, mostActive);
        var favouriteMap = MergeFavouriteMap(aliasResults, mostActive);
        var medals = MergeMedals(aliasResults, year);
        var bestMoments = aliasResults
            .SelectMany(a => a.BestMoments)
            .OrderByDescending(m => m.Value)
            .Take(3)
            .ToList();
        var squad = aliasResults
            .SelectMany(a => a.Squad)
            .GroupBy(t => t.Name)
            .Select(g => new PlayerTeammateDto(g.Key, g.Sum(t => t.SharedRounds)))
            .OrderByDescending(t => t.SharedRounds)
            .Take(10)
            .ToList();
        var serverRankings = aliasResults
            .SelectMany(a => a.ServerRankings)
            .GroupBy(r => r.ServerGuid)
            .Select(g => g.OrderBy(r => r.Rank).First())
            .OrderBy(r => r.Rank)
            .Take(2)
            .ToList();
        var relations = MergeRelations(aliasResults);
        var bestAliases = MergeBestAliases(aliasResults);
        var aliasCredits = aliasResults
            .Select(a => new ProfileAliasCreditDto(
                a.PlayerName,
                a.YearInNumbers.RoundsPlayed,
                a.YearInNumbers.TotalKills,
                a.YearInNumbers.TotalDeaths,
                a.YearInNumbers.HoursInCombat,
                a.YearInNumbers.KdRatio
            ))
            .OrderByDescending(c => c.RoundsPlayed)
            .ToList();

        return new ProfileWrappedResponseDto(
            userId,
            year,
            yearInNumbers,
            trend,
            favouriteMap,
            medals,
            bestMoments,
            squad,
            serverRankings,
            relations,
            bestAliases,
            aliasCredits
        );
    }

    private static PlayerYearInNumbersDto MergeYearInNumbers(List<PlayerWrappedResponseDto> aliasResults)
    {
        int roundsPlayed = aliasResults.Sum(a => a.YearInNumbers.RoundsPlayed);
        int totalKills = aliasResults.Sum(a => a.YearInNumbers.TotalKills);
        int totalDeaths = aliasResults.Sum(a => a.YearInNumbers.TotalDeaths);
        double hoursInCombat = aliasResults.Sum(a => a.YearInNumbers.HoursInCombat);
        double kdRatio = totalDeaths > 0 ? Math.Round((double)totalKills / totalDeaths, 2) : totalKills;

        return new PlayerYearInNumbersDto(
            roundsPlayed,
            totalKills,
            totalDeaths,
            Math.Round(hoursInCombat, 1),
            kdRatio,
            aliasResults.Min(a => a.YearInNumbers.ServerRank),
            aliasResults.Min(a => a.YearInNumbers.KillsRank),
            aliasResults.Min(a => a.YearInNumbers.PlacementsRank),
            aliasResults.Max(a => a.YearInNumbers.RoundsPercentile),
            aliasResults.Max(a => a.YearInNumbers.KillsPercentile),
            aliasResults.Max(a => a.YearInNumbers.PlayTimePercentile),
            aliasResults.Max(a => a.YearInNumbers.KdPercentile)
        );
    }

    private static PlayerTrendDto MergeTrend(List<PlayerWrappedResponseDto> aliasResults, PlayerWrappedResponseDto mostActive)
    {
        // Monthly KD/kill-rate are pre-computed ratios per alias (no raw monthly kill/death
        // counts survive in the DTO), so the closest we can get without re-querying is a
        // kills-weighted average across aliases for each month.
        var monthlyKDs = new List<double>();
        var monthlyKillRates = new List<double>();
        for (int m = 0; m < 12; m++)
        {
            double weight = aliasResults.Sum(a => (double)a.YearInNumbers.TotalKills);
            if (weight > 0)
            {
                monthlyKDs.Add(Math.Round(aliasResults.Sum(a => a.Trend.MonthlyKDs[m] * a.YearInNumbers.TotalKills) / weight, 2));
                monthlyKillRates.Add(Math.Round(aliasResults.Sum(a => a.Trend.MonthlyKillRates[m] * a.YearInNumbers.TotalKills) / weight, 2));
            }
            else
            {
                monthlyKDs.Add(0.0);
                monthlyKillRates.Add(0.0);
            }
        }

        return new PlayerTrendDto(monthlyKDs, monthlyKillRates, mostActive.Trend.TopMaps);
    }

    private static PlayerFavouriteMapDto MergeFavouriteMap(List<PlayerWrappedResponseDto> aliasResults, PlayerWrappedResponseDto mostActive)
    {
        var mapRounds = aliasResults
            .SelectMany(a => a.FavouriteMap.TopMaps5)
            .GroupBy(m => m.MapName)
            .Select(g => new { MapName = g.Key, Rounds = g.Sum(m => m.Rounds) })
            .OrderByDescending(x => x.Rounds)
            .ToList();

        var totalRounds = mapRounds.Take(5).Sum(x => x.Rounds);
        var topMaps5 = mapRounds.Take(5).Select((m, idx) => new PlayerMapProgressDto(
            m.MapName,
            m.Rounds,
            totalRounds > 0 ? Math.Round(m.Rounds * 100.0 / totalRounds, 1) : 0.0,
            idx == 0 ? "var(--mm-kd-elite)" : "var(--mm-accent)"
        )).ToList();

        var topMap = mapRounds.FirstOrDefault();
        var topMapName = topMap?.MapName ?? "";

        // Per-map kills/deaths/score are only available on the alias(es) for which this map
        // was already their own favourite map — sum across those, since finer per-map
        // breakdowns for every alias aren't exposed by the per-alias DTO.
        var contributing = aliasResults.Where(a => a.FavouriteMap.MapName == topMapName).ToList();
        if (contributing.Count == 0) contributing = new List<PlayerWrappedResponseDto> { mostActive };

        int kills = contributing.Sum(a => a.FavouriteMap.TotalKills);
        int deaths = contributing.Sum(a => a.FavouriteMap.TotalDeaths);
        int score = contributing.Sum(a => a.FavouriteMap.TotalScore);
        double playTimeMinutes = contributing.Sum(a => a.FavouriteMap.PlayTimeMinutes);
        double kdRatio = deaths > 0 ? Math.Round((double)kills / deaths, 2) : kills;

        var roundsForWinRate = contributing.Sum(a => a.FavouriteMap.Rounds);
        double winRate = roundsForWinRate > 0
            ? Math.Round(contributing.Sum(a => a.FavouriteMap.WinRate * a.FavouriteMap.Rounds) / roundsForWinRate, 2)
            : 0.0;

        double playerKPM = playTimeMinutes > 0 ? kills / playTimeMinutes : 0.0;
        double globalKPM = mostActive.FavouriteMap.GlobalKPM;
        double kpmMultiplier = globalKPM > 0 ? playerKPM / globalKPM : 0.0;

        return new PlayerFavouriteMapDto(
            topMapName,
            topMap?.Rounds ?? 0,
            winRate,
            topMaps5,
            mostActive.FavouriteMap.HomeServerName,
            mostActive.FavouriteMap.HomeServerLocation,
            Math.Round(playerKPM, 3),
            Math.Round(globalKPM, 3),
            Math.Round(kpmMultiplier, 2),
            kills,
            deaths,
            kdRatio,
            score,
            playTimeMinutes
        );
    }

    private static PlayerMedalsDto MergeMedals(List<PlayerWrappedResponseDto> aliasResults, int year)
    {
        int killStreaks25 = aliasResults.Sum(a => a.Medals.KillStreaks25);
        int podiumFinishes = aliasResults.Sum(a => a.Medals.PodiumFinishes);
        int bestStreak = aliasResults.Max(a => a.Medals.BestStreak);

        var bestBadgeAlias = aliasResults
            .OrderByDescending(a => GetTierWeight(a.Medals.EliteWarriorTier.Replace(" TIER", "")))
            .First();

        int totalMilestones = aliasResults.Sum(a =>
        {
            var match = System.Text.RegularExpressions.Regex.Match(a.Medals.LifetimeMilestoneText, @"\d+");
            return match.Success ? int.Parse(match.Value) : 0;
        });
        string lifetimeMilestoneText = $"CROSSED {totalMilestones} GLOBAL LIFETIME MILESTONES IN {year}";

        var achievementTypes = aliasResults
            .SelectMany(a => a.Medals.AchievementTypes)
            .GroupBy(t => t.Type)
            .Select(g => new PlayerAchievementTypeCountDto(g.Key, g.Sum(t => t.Count)))
            .OrderByDescending(t => t.Count)
            .ToList();

        var achievementsBreakdown = aliasResults
            .SelectMany(a => a.Medals.AchievementsBreakdown)
            .GroupBy(a => a.AchievementId)
            .Select(g =>
            {
                var best = g.OrderByDescending(a => GetTierWeight(a.Tier)).First();
                return new PlayerAchievementCountDto(best.AchievementId, best.Name, best.Type, best.Tier, g.Sum(a => a.Count));
            })
            .OrderByDescending(a => a.Count)
            .ToList();

        return new PlayerMedalsDto(
            killStreaks25,
            podiumFinishes,
            bestBadgeAlias.Medals.EliteWarriorBadgeName,
            bestBadgeAlias.Medals.EliteWarriorTier,
            bestStreak,
            lifetimeMilestoneText,
            achievementTypes,
            achievementsBreakdown
        );
    }

    private static PlayerRelationsDto MergeRelations(List<PlayerWrappedResponseDto> aliasResults)
    {
        var wins = new Dictionary<string, int>();
        var losses = new Dictionary<string, int>();

        foreach (var a in aliasResults)
        {
            var r = a.Relations;
            if (r.LuckyCharmName != null) wins[r.LuckyCharmName] = wins.GetValueOrDefault(r.LuckyCharmName) + (r.LuckyCharmWins ?? 0);
            if (r.TwoFaceName != null) wins[r.TwoFaceName] = wins.GetValueOrDefault(r.TwoFaceName) + (r.TwoFaceWins ?? 0);
            if (r.ArchNemesisName != null) losses[r.ArchNemesisName] = losses.GetValueOrDefault(r.ArchNemesisName) + (r.ArchNemesisLosses ?? 0);
            if (r.TwoFaceName != null) losses[r.TwoFaceName] = losses.GetValueOrDefault(r.TwoFaceName) + (r.TwoFaceLosses ?? 0);
        }

        var topCharm = wins.OrderByDescending(x => x.Value).FirstOrDefault();
        var topNemesis = losses.OrderByDescending(x => x.Value).FirstOrDefault();

        if (topCharm.Key != null && topNemesis.Key != null && topCharm.Key == topNemesis.Key && topCharm.Value >= 3 && topNemesis.Value >= 3)
        {
            return new PlayerRelationsDto(null, null, null, null, topCharm.Key, topCharm.Value, topNemesis.Value);
        }

        string? luckyCharmName = null;
        int? luckyCharmWins = null;
        string? archNemesisName = null;
        int? archNemesisLosses = null;

        if (topCharm.Key != null && topCharm.Value >= 2)
        {
            luckyCharmName = topCharm.Key;
            luckyCharmWins = topCharm.Value;
        }
        if (topNemesis.Key != null && topNemesis.Value >= 2)
        {
            archNemesisName = topNemesis.Key;
            archNemesisLosses = topNemesis.Value;
        }

        return new PlayerRelationsDto(luckyCharmName, luckyCharmWins, archNemesisName, archNemesisLosses, null, null, null);
    }

    private static ProfileBestAliasesDto MergeBestAliases(List<PlayerWrappedResponseDto> aliasResults)
    {
        var bestKd = aliasResults.OrderByDescending(a => a.YearInNumbers.KdRatio).First();
        var bestKillRate = aliasResults
            .OrderByDescending(a => a.YearInNumbers.HoursInCombat > 0 ? a.YearInNumbers.TotalKills / (a.YearInNumbers.HoursInCombat * 60.0) : 0.0)
            .First();
        double bestKillRateValue = bestKillRate.YearInNumbers.HoursInCombat > 0
            ? Math.Round(bestKillRate.YearInNumbers.TotalKills / (bestKillRate.YearInNumbers.HoursInCombat * 60.0), 2)
            : 0.0;

        return new ProfileBestAliasesDto(
            bestKd.PlayerName,
            bestKd.YearInNumbers.KdRatio,
            bestKillRate.PlayerName,
            bestKillRateValue
        );
    }

    private async Task SavePlayerToCacheAsync(string playerName, string serverGuid, int year, PlayerWrappedResponseDto dto)
    {
        var jsonData = JsonSerializer.Serialize(dto, JsonOptions);
        var existing = await dbContext.PlayerWrappedCaches
            .FirstOrDefaultAsync(c => c.PlayerName == playerName && c.ServerGuid == serverGuid && c.Year == year);

        if (existing != null)
        {
            existing.JsonData = jsonData;
            existing.CalculatedAt = SystemClock.Instance.GetCurrentInstant();
        }
        else
        {
            dbContext.PlayerWrappedCaches.Add(new PlayerWrappedCache
            {
                PlayerName = playerName,
                ServerGuid = serverGuid,
                Year = year,
                JsonData = jsonData,
                CalculatedAt = SystemClock.Instance.GetCurrentInstant()
            });
        }
        await dbContext.SaveChangesAsync();
    }

    private record StreakInstanceDto(int Streak, string MapName, Instant Date, string RoundId);

    private async Task<PlayerWrappedResponseDto?> CalculatePlayerWrappedInternalAsync(string playerName, string serverGuid, int year)
    {
        var startYear = new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var endYear = new DateTime(year + 1, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var startInstant = Instant.FromDateTimeUtc(startYear);
        var endInstant = Instant.FromDateTimeUtc(endYear);

        string serverName = "Global (All Servers)";
        if (serverGuid != "global")
        {
            var server = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid);
            if (server == null) return null;
            serverName = server.Name;
        }

        // 1. Year in Numbers
        var serverStatsQuery = dbContext.PlayerServerStats
            .Where(pss => pss.PlayerName == playerName && pss.Year == year);

        if (serverGuid != "global")
        {
            serverStatsQuery = serverStatsQuery.Where(pss => pss.ServerGuid == serverGuid);
        }

        var serverStats = await serverStatsQuery.ToListAsync();

        int roundsPlayed = serverStats.Sum(s => s.TotalRounds);
        int totalKills = serverStats.Sum(s => s.TotalKills);
        int totalDeaths = serverStats.Sum(s => s.TotalDeaths);
        double hoursInCombat = serverStats.Sum(s => s.TotalPlayTimeMinutes) / 60.0;
        double kdRatio = totalDeaths > 0 ? Math.Round((double)totalKills / totalDeaths, 2) : totalKills;

        int serverRank = 1;
        if (roundsPlayed > 0)
        {
            if (serverGuid != "global")
            {
                var playerTotalScore = serverStats.Sum(s => s.TotalScore);
                var higherScoreCount = await dbContext.PlayerServerStats
                    .Where(pss => pss.ServerGuid == serverGuid && pss.Year == year)
                    .GroupBy(pss => pss.PlayerName)
                    .Select(g => new { PlayerName = g.Key, Score = g.Sum(pss => pss.TotalScore) })
                    .CountAsync(x => x.Score > playerTotalScore);
                serverRank = higherScoreCount + 1;
            }
            else
            {
                var playerTotalScore = serverStats.Sum(s => s.TotalScore);
                var higherScoreCount = await dbContext.PlayerStatsMonthly
                    .Where(psm => psm.Year == year)
                    .GroupBy(psm => psm.PlayerName)
                    .Select(g => new { PlayerName = g.Key, Score = g.Sum(psm => psm.TotalScore) })
                    .CountAsync(x => x.Score > playerTotalScore);
                serverRank = higherScoreCount + 1;
            }
        }

        int killsRank = 1;
        if (totalKills > 0)
        {
            if (serverGuid != "global")
            {
                var higherKillsCount = await dbContext.PlayerServerStats
                    .Where(pss => pss.ServerGuid == serverGuid && pss.Year == year)
                    .GroupBy(pss => pss.PlayerName)
                    .Select(g => new { PlayerName = g.Key, Kills = g.Sum(pss => pss.TotalKills) })
                    .CountAsync(x => x.Kills > totalKills);
                killsRank = higherKillsCount + 1;
            }
            else
            {
                var higherKillsCount = await dbContext.PlayerStatsMonthly
                    .Where(psm => psm.Year == year)
                    .GroupBy(psm => psm.PlayerName)
                    .Select(g => new { PlayerName = g.Key, Kills = g.Sum(psm => psm.TotalKills) })
                    .CountAsync(x => x.Kills > totalKills);
                killsRank = higherKillsCount + 1;
            }
        }

        var playerPlacementsQuery = dbContext.PlayerAchievements
            .Where(pa => pa.PlayerName == playerName && pa.AchievementType == "round_placement" && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant);

        if (serverGuid != "global")
        {
            playerPlacementsQuery = playerPlacementsQuery.Where(pa => pa.ServerGuid == serverGuid);
        }

        int playerPlacements = await playerPlacementsQuery.CountAsync();

        int placementsRank = 1;
        if (playerPlacements > 0)
        {
            var higherPlacementsQuery = dbContext.PlayerAchievements
                .Where(pa => pa.AchievementType == "round_placement" && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant);

            if (serverGuid != "global")
            {
                higherPlacementsQuery = higherPlacementsQuery.Where(pa => pa.ServerGuid == serverGuid);
            }

            var higherPlacementsCount = await higherPlacementsQuery
                .GroupBy(pa => pa.PlayerName)
                .Select(g => new { PlayerName = g.Key, Count = g.Count() })
                .CountAsync(x => x.Count > playerPlacements);
            placementsRank = higherPlacementsCount + 1;
        }

        double roundsPercentile = 0.0;
        double killsPercentile = 0.0;
        double playtimePercentile = 0.0;
        double kdPercentile = 0.0;

        if (roundsPlayed > 0)
        {
            var connection = dbContext.Database.GetDbConnection();
            bool wasClosed = connection.State == System.Data.ConnectionState.Closed;
            if (wasClosed) await connection.OpenAsync();

            try
            {
                double SafeConvertDouble(object? obj) => (obj == null || obj == DBNull.Value) ? 0.0 : Convert.ToDouble(obj);

                // Rounds Percentile
                await using (var cmd = connection.CreateCommand())
                {
                    cmd.CommandText = @"
                        SELECT 
                            (COUNT(*) * 100.0) / (
                                SELECT COUNT(*) 
                                FROM (
                                    SELECT SUM(TotalRounds) as r 
                                    FROM PlayerStatsMonthly 
                                    WHERE Year = $year 
                                    GROUP BY PlayerName 
                                    HAVING r >= 5
                                )
                            ) 
                        FROM (
                            SELECT SUM(TotalRounds) as r 
                            FROM PlayerStatsMonthly 
                            WHERE Year = $year 
                            GROUP BY PlayerName 
                            HAVING r >= 5
                        ) 
                        WHERE r < $val";
                    
                    var pYear = cmd.CreateParameter(); pYear.ParameterName = "$year"; pYear.Value = year; cmd.Parameters.Add(pYear);
                    var pVal = cmd.CreateParameter(); pVal.ParameterName = "$val"; pVal.Value = roundsPlayed; cmd.Parameters.Add(pVal);
                    roundsPercentile = SafeConvertDouble(await cmd.ExecuteScalarAsync());
                }

                // Kills Percentile
                await using (var cmd = connection.CreateCommand())
                {
                    cmd.CommandText = @"
                        SELECT 
                            (COUNT(*) * 100.0) / (
                                SELECT COUNT(*) 
                                FROM (
                                    SELECT SUM(TotalRounds) as r 
                                    FROM PlayerStatsMonthly 
                                    WHERE Year = $year 
                                    GROUP BY PlayerName 
                                    HAVING r >= 5
                                )
                            ) 
                        FROM (
                            SELECT SUM(TotalKills) as k, SUM(TotalRounds) as r 
                            FROM PlayerStatsMonthly 
                            WHERE Year = $year 
                            GROUP BY PlayerName 
                            HAVING r >= 5
                        ) 
                        WHERE k < $val";
                    
                    var pYear = cmd.CreateParameter(); pYear.ParameterName = "$year"; pYear.Value = year; cmd.Parameters.Add(pYear);
                    var pVal = cmd.CreateParameter(); pVal.ParameterName = "$val"; pVal.Value = totalKills; cmd.Parameters.Add(pVal);
                    killsPercentile = SafeConvertDouble(await cmd.ExecuteScalarAsync());
                }

                // Playtime Percentile
                await using (var cmd = connection.CreateCommand())
                {
                    cmd.CommandText = @"
                        SELECT 
                            (COUNT(*) * 100.0) / (
                                SELECT COUNT(*) 
                                FROM (
                                    SELECT SUM(TotalRounds) as r 
                                    FROM PlayerStatsMonthly 
                                    WHERE Year = $year 
                                    GROUP BY PlayerName 
                                    HAVING r >= 5
                                )
                            ) 
                        FROM (
                            SELECT SUM(TotalPlayTimeMinutes) as pt, SUM(TotalRounds) as r 
                            FROM PlayerStatsMonthly 
                            WHERE Year = $year 
                            GROUP BY PlayerName 
                            HAVING r >= 5
                        ) 
                        WHERE pt < $val";
                    
                    var pYear = cmd.CreateParameter(); pYear.ParameterName = "$year"; pYear.Value = year; cmd.Parameters.Add(pYear);
                    var pVal = cmd.CreateParameter(); pVal.ParameterName = "$val"; pVal.Value = hoursInCombat * 60.0; cmd.Parameters.Add(pVal);
                    playtimePercentile = SafeConvertDouble(await cmd.ExecuteScalarAsync());
                }

                // K/D Percentile
                if (totalKills >= 20)
                {
                    await using (var cmd = connection.CreateCommand())
                    {
                        cmd.CommandText = @"
                            SELECT 
                                (COUNT(*) * 100.0) / (
                                    SELECT COUNT(*) 
                                    FROM (
                                        SELECT SUM(TotalKills) as k 
                                        FROM PlayerStatsMonthly 
                                        WHERE Year = $year 
                                        GROUP BY PlayerName 
                                        HAVING SUM(TotalRounds) >= 5 AND k >= 20
                                    )
                                ) 
                            FROM (
                                SELECT SUM(TotalKills) as k, (CAST(SUM(TotalKills) AS REAL) / MAX(1, SUM(TotalDeaths))) as kd 
                                FROM PlayerStatsMonthly 
                                WHERE Year = $year 
                                GROUP BY PlayerName 
                                HAVING SUM(TotalRounds) >= 5 AND k >= 20
                            ) 
                            WHERE kd < $val";
                        
                        var pYear = cmd.CreateParameter(); pYear.ParameterName = "$year"; pYear.Value = year; cmd.Parameters.Add(pYear);
                        var pVal = cmd.CreateParameter(); pVal.ParameterName = "$val"; pVal.Value = kdRatio; cmd.Parameters.Add(pVal);
                        kdPercentile = SafeConvertDouble(await cmd.ExecuteScalarAsync());
                    }
                }
            }
            finally
            {
                if (wasClosed) await connection.CloseAsync();
            }
        }

        var yearInNumbers = new PlayerYearInNumbersDto(
            roundsPlayed, 
            totalKills, 
            totalDeaths, 
            Math.Round(hoursInCombat, 1), 
            kdRatio, 
            serverRank, 
            killsRank, 
            placementsRank,
            Math.Round(roundsPercentile, 2),
            Math.Round(killsPercentile, 2),
            Math.Round(playtimePercentile, 2),
            Math.Round(kdPercentile, 2)
        );

        // 2. Trend
        List<double> monthlyKDs = new();
        List<double> monthlyKillRates = new();

        if (serverGuid != "global")
        {
            var sessionStats = await dbContext.PlayerSessions
                .Where(ps => ps.PlayerName == playerName && ps.ServerGuid == serverGuid && ps.StartTime >= startYear && ps.StartTime < endYear && !ps.IsDeleted)
                .GroupBy(ps => ps.StartTime.Month)
                .Select(g => new {
                    Month = g.Key,
                    Kills = g.Sum(ps => ps.TotalKills),
                    Deaths = g.Sum(ps => ps.TotalDeaths),
                    Rounds = g.Count()
                })
                .ToListAsync();

            for (int m = 1; m <= 12; m++)
            {
                var monthStat = sessionStats.FirstOrDefault(s => s.Month == m);
                if (monthStat != null && monthStat.Rounds > 0)
                {
                    double kd = monthStat.Deaths > 0 ? Math.Round((double)monthStat.Kills / monthStat.Deaths, 2) : monthStat.Kills;
                    double kr = Math.Round((double)monthStat.Kills / monthStat.Rounds, 2);
                    monthlyKDs.Add(kd);
                    monthlyKillRates.Add(kr);
                }
                else
                {
                    monthlyKDs.Add(0.0);
                    monthlyKillRates.Add(0.0);
                }
            }
        }
        else
        {
            var monthlyStats = await dbContext.PlayerStatsMonthly
                .Where(psm => psm.PlayerName == playerName && psm.Year == year)
                .OrderBy(psm => psm.Month)
                .ToListAsync();

            for (int m = 1; m <= 12; m++)
            {
                var monthStat = monthlyStats.FirstOrDefault(s => s.Month == m);
                monthlyKDs.Add(monthStat?.KdRatio ?? 0.0);
                monthlyKillRates.Add(monthStat?.KillRate ?? 0.0);
            }
        }

        var mapStatsQuery = dbContext.PlayerMapStats
            .Where(pms => pms.PlayerName == playerName && pms.Year == year);

        if (serverGuid != "global")
        {
            mapStatsQuery = mapStatsQuery.Where(pms => pms.ServerGuid == serverGuid);
        }
        else
        {
            mapStatsQuery = mapStatsQuery.Where(pms => pms.ServerGuid == PlayerMapStats.GlobalServerGuid);
        }

        var mapStats = await mapStatsQuery
            .GroupBy(pms => pms.MapName)
            .Select(g => new {
                MapName = g.Key,
                TotalRounds = g.Sum(pms => pms.TotalRounds),
                TotalKills = g.Sum(pms => pms.TotalKills),
                TotalDeaths = g.Sum(pms => pms.TotalDeaths)
            })
            .ToListAsync();

        var topMaps = new List<PlayerMapRankDto>();

        // 1. Most Kills Map
        var mostKillsMap = mapStats.OrderByDescending(x => x.TotalKills).FirstOrDefault();
        if (mostKillsMap != null && mostKillsMap.TotalKills > 0)
        {
            topMaps.Add(new PlayerMapRankDto("MOST KILLS", mostKillsMap.MapName, $"{mostKillsMap.TotalKills:N0} Kills"));
        }

        // 2. Highest K/D Map (min 3 rounds if any map has >=3 rounds, else >=1 round)
        var kdEligible = mapStats.Where(x => x.TotalRounds >= 3).ToList();
        if (!kdEligible.Any()) kdEligible = mapStats;
        var highestKDMap = kdEligible
            .Select(x => new {
                x.MapName,
                KD = x.TotalDeaths > 0 ? (double)x.TotalKills / x.TotalDeaths : x.TotalKills
            })
            .OrderByDescending(x => x.KD)
            .FirstOrDefault();
        if (highestKDMap != null && highestKDMap.KD > 0)
        {
            topMaps.Add(new PlayerMapRankDto("HIGHEST K/D", highestKDMap.MapName, $"{highestKDMap.KD:F2} K/D"));
        }

        // 3. Highest Kill Rate Map (min 3 rounds if any map has >=3 rounds, else >=1 round)
        var krEligible = mapStats.Where(x => x.TotalRounds >= 3).ToList();
        if (!krEligible.Any()) krEligible = mapStats;
        var highestKRMap = krEligible
            .Select(x => new {
                x.MapName,
                KR = x.TotalRounds > 0 ? (double)x.TotalKills / x.TotalRounds : 0
            })
            .OrderByDescending(x => x.KR)
            .FirstOrDefault();
        if (highestKRMap != null && highestKRMap.KR > 0)
        {
            topMaps.Add(new PlayerMapRankDto("HIGHEST KILL RATE", highestKRMap.MapName, $"{highestKRMap.KR:F1} Kills/Rd"));
        }

        var trend = new PlayerTrendDto(monthlyKDs, monthlyKillRates, topMaps);

        // 3. Favourite Map
        var top5MapsData = await mapStatsQuery
            .GroupBy(pms => pms.MapName)
            .Select(g => new {
                MapName = g.Key,
                Rounds = g.Sum(pms => pms.TotalRounds),
                PlayTime = g.Sum(pms => pms.TotalPlayTimeMinutes),
                Kills = g.Sum(pms => pms.TotalKills),
                Deaths = g.Sum(pms => pms.TotalDeaths),
                Score = g.Sum(pms => pms.TotalScore)
            })
            .OrderByDescending(x => x.Rounds)
            .Take(5)
            .ToListAsync();

        var totalPlayTime = top5MapsData.Sum(m => m.PlayTime);
        var topMaps5 = top5MapsData.Select((m, idx) => new PlayerMapProgressDto(
            m.MapName,
            m.Rounds,
            totalPlayTime > 0 ? Math.Round(m.PlayTime * 100.0 / totalPlayTime, 1) : 0.0,
            idx == 0 ? "var(--mm-kd-elite)" : "var(--mm-accent)"
        )).ToList();

        var favMap = topMaps5.FirstOrDefault();
        double winRate = 0.0;
        if (favMap != null)
        {
            var winsQuery = dbContext.PlayerAchievements
                .Where(pa => pa.PlayerName == playerName && (pa.AchievementId == "team_victory" || pa.AchievementId == "team_victory_switched") && pa.MapName == favMap.MapName && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant);

            if (serverGuid != "global")
            {
                winsQuery = winsQuery.Where(pa => pa.ServerGuid == serverGuid);
            }

            var wins = await winsQuery.CountAsync();
            winRate = favMap.Rounds > 0 ? Math.Round((double)wins / favMap.Rounds, 2) : 0.0;
        }

        string homeServerName = serverName;
        string homeServerLocation = "FRANKFURT";
        if (serverGuid == "global" && serverStats.Count > 0)
        {
            var topServerGuid = serverStats.OrderByDescending(s => s.TotalPlayTimeMinutes).First().ServerGuid;
            var topServer = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == topServerGuid);
            if (topServer != null)
            {
                homeServerName = topServer.Name;
                homeServerLocation = !string.IsNullOrEmpty(topServer.Timezone) ? topServer.Timezone.Split('/').Last().ToUpper().Replace("_", " ") : "FRANKFURT";
            }
        }
        else if (serverGuid != "global")
        {
            var server = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid);
            if (server != null && !string.IsNullOrEmpty(server.Timezone))
            {
                homeServerLocation = server.Timezone.Split('/').Last().ToUpper().Replace("_", " ");
            }
        }

        double playerKPM = 0.0;
        double globalKPM = 0.0;
        double kpmMultiplier = 0.0;

        string favMapName = favMap?.MapName ?? "";
        if (!string.IsNullOrEmpty(favMapName))
        {
            var connection = dbContext.Database.GetDbConnection();
            bool wasClosed = connection.State == System.Data.ConnectionState.Closed;
            if (wasClosed) await connection.OpenAsync();

            try
            {
                await using (var cmd = connection.CreateCommand())
                {
                    cmd.CommandText = @"
                        SELECT 
                            (CAST(SUM(pms.TotalKills) AS REAL) / SUM(pms.TotalPlayTimeMinutes)) as PlayerKPM,
                            COALESCE(mga.AvgKillRate, 0.0) as GlobalKPM
                        FROM PlayerMapStats pms
                        LEFT JOIN MapGlobalAverages mga ON pms.MapName = mga.MapName
                        WHERE pms.PlayerName = $playerName 
                          AND pms.MapName = $mapName 
                          AND pms.Year = $year
                          AND pms.TotalPlayTimeMinutes > 0
                        GROUP BY pms.MapName, mga.AvgKillRate";
                    
                    var pPlayer = cmd.CreateParameter(); pPlayer.ParameterName = "$playerName"; pPlayer.Value = playerName; cmd.Parameters.Add(pPlayer);
                    var pMap = cmd.CreateParameter(); pMap.ParameterName = "$mapName"; pMap.Value = favMapName; cmd.Parameters.Add(pMap);
                    var pYear = cmd.CreateParameter(); pYear.ParameterName = "$year"; pYear.Value = year; cmd.Parameters.Add(pYear);

                    await using (var reader = await cmd.ExecuteReaderAsync())
                    {
                        if (await reader.ReadAsync())
                        {
                            playerKPM = reader.IsDBNull(0) ? 0.0 : reader.GetDouble(0);
                            globalKPM = reader.IsDBNull(1) ? 0.0 : reader.GetDouble(1);
                            if (globalKPM > 0.0)
                            {
                                kpmMultiplier = playerKPM / globalKPM;
                            }
                        }
                    }
                }
            }
            finally
            {
                if (wasClosed) await connection.CloseAsync();
            }
        }

        var favMapData = top5MapsData.FirstOrDefault();
        int favMapKills = favMapData?.Kills ?? 0;
        int favMapDeaths = favMapData?.Deaths ?? 0;
        double favMapKdRatio = favMapDeaths > 0 ? Math.Round((double)favMapKills / favMapDeaths, 2) : favMapKills;
        int favMapScore = favMapData?.Score ?? 0;
        double favMapPlayTime = favMapData?.PlayTime ?? 0.0;

        var favouriteMap = new PlayerFavouriteMapDto(
            favMap?.MapName ?? "",
            favMap?.Rounds ?? 0,
            winRate,
            topMaps5,
            homeServerName,
            homeServerLocation,
            Math.Round(playerKPM, 3),
            Math.Round(globalKPM, 3),
            Math.Round(kpmMultiplier, 2),
            favMapKills,
            favMapDeaths,
            favMapKdRatio,
            favMapScore,
            favMapPlayTime
        );

        // 4. Medals
        var achievementQuery = dbContext.PlayerAchievements
            .Where(pa => pa.PlayerName == playerName && pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant);

        if (serverGuid != "global")
        {
            achievementQuery = achievementQuery.Where(pa => pa.ServerGuid == serverGuid);
        }

        var playerAchievements = await achievementQuery.ToListAsync();

        int killStreaks25 = playerAchievements.Count(pa => pa.AchievementId.StartsWith("kill_streak_"));
        int podiumFinishes = playerAchievements.Count(pa => pa.AchievementId == "round_placement_1");

        var allMilestones = playerAchievements
            .Where(pa => pa.AchievementType == "milestone" || pa.AchievementId.StartsWith("total_kills_") || pa.AchievementId.StartsWith("total_score_") || pa.AchievementId.StartsWith("milestone_playtime_") || pa.AchievementId.Contains("legend"))
            .ToList();

        var topPrestigious = allMilestones
            .OrderByDescending(pa => GetPrestigeWeight(pa.AchievementId))
            .ThenBy(pa => pa.AchievedAt)
            .FirstOrDefault();

        string eliteWarriorBadgeName = "ELITE WARRIOR";
        string eliteWarriorTier = "LEGEND TIER";
        if (topPrestigious != null)
        {
            eliteWarriorBadgeName = topPrestigious.AchievementName;
            eliteWarriorTier = topPrestigious.Tier.ToUpper() + " TIER";
        }

        var streakAchievements = playerAchievements.Where(pa => pa.AchievementId.StartsWith("kill_streak_")).ToList();
        int bestStreak = 0;
        StreakInstanceDto? bestStreakInfo = null;
        var resolvedStreaks = new List<StreakInstanceDto>();

        if (streakAchievements.Count > 0)
        {
            resolvedStreaks = streakAchievements
                .Select(s => {
                    var actual = GetStreakValueFromId(s.AchievementId);
                    if (!string.IsNullOrEmpty(s.Metadata)) {
                        try {
                            var doc = JsonDocument.Parse(s.Metadata);
                            if (doc.RootElement.TryGetProperty("actual_streak", out var val)) actual = val.GetInt32();
                        } catch {}
                    }
                    return new StreakInstanceDto(actual, s.MapName, s.AchievedAt, s.RoundId);
                })
                .OrderByDescending(x => x.Streak)
                .ToList();

            var topStreak = resolvedStreaks.FirstOrDefault();
            if (topStreak != null)
            {
                bestStreak = topStreak.Streak;
                bestStreakInfo = topStreak;
            }
        }

        int totalMilestonesCrossed = allMilestones.Count;
        string lifetimeMilestoneText = $"CROSSED {totalMilestonesCrossed} LIFETIME MILESTONES ON THIS SERVER IN {year}";
        if (serverGuid == "global")
        {
            lifetimeMilestoneText = $"CROSSED {totalMilestonesCrossed} GLOBAL LIFETIME MILESTONES IN {year}";
        }

        var achievementTypes = playerAchievements
            .GroupBy(pa => pa.AchievementType)
            .Select(g => {
                string friendlyType = g.Key switch {
                    "kill_streak" => "Kill Streaks",
                    "badge" => "Badges",
                    "milestone" => "Milestones",
                    _ => string.IsNullOrEmpty(g.Key) ? "Other" : g.Key
                };
                return new PlayerAchievementTypeCountDto(friendlyType, g.Count());
            })
            .OrderByDescending(x => x.Count)
            .ToList();

        var achievementsBreakdown = playerAchievements
            .Select(pa => {
                if (pa.AchievementId == "team_victory_switched")
                {
                    return new PlayerAchievement
                    {
                        Id = pa.Id,
                        PlayerName = pa.PlayerName,
                        AchievementType = "team_victory",
                        AchievementId = "team_victory",
                        AchievementName = "Team Victory",
                        Tier = pa.Tier,
                        Value = pa.Value,
                        AchievedAt = pa.AchievedAt,
                        ProcessedAt = pa.ProcessedAt,
                        ServerGuid = pa.ServerGuid,
                        MapName = pa.MapName,
                        RoundId = pa.RoundId,
                        Metadata = pa.Metadata,
                        Game = pa.Game,
                        Version = pa.Version
                    };
                }
                return pa;
            })
            .GroupBy(pa => new { pa.AchievementId, pa.AchievementName, pa.AchievementType })
            .Select(g => {
                var highestTier = g
                    .Select(pa => pa.Tier)
                    .OrderByDescending(t => GetTierWeight(t))
                    .FirstOrDefault();

                return new PlayerAchievementCountDto(
                    g.Key.AchievementId,
                    g.Key.AchievementName ?? g.Key.AchievementId,
                    string.IsNullOrEmpty(g.Key.AchievementType) ? "Other" : g.Key.AchievementType,
                    string.IsNullOrEmpty(highestTier) ? "Bronze" : highestTier,
                    g.Count()
                );
            })
            .OrderByDescending(x => x.Count)
            .ToList();

        var medals = new PlayerMedalsDto(
            killStreaks25,
            podiumFinishes,
            eliteWarriorBadgeName,
            eliteWarriorTier,
            bestStreak,
            lifetimeMilestoneText,
            achievementTypes,
            achievementsBreakdown
        );

        // 5. Best Moments (Streak, Score, Kills)
        var bestMoments = new List<PlayerBestMomentDto>();

        // (1) Best Streak
        if (resolvedStreaks.Count > 0)
        {
            var streakInfo = resolvedStreaks.First();
            int estDuration = 0;
            var observations = await dbContext.PlayerObservations
                .Where(po => po.Session.PlayerName == playerName && po.Session.RoundId == streakInfo.RoundId)
                .OrderBy(po => po.Timestamp)
                .Select(po => po.Timestamp)
                .ToListAsync();

            if (observations.Count >= 2)
            {
                var dur = observations.Last() - observations.First();
                estDuration = (int)dur.TotalMinutes;
            }
            if (estDuration <= 0) estDuration = 11;

            var allServerStreaks = await dbContext.PlayerAchievements
                .Where(pa => pa.AchievedAt >= startInstant && pa.AchievedAt < endInstant && pa.AchievementId.StartsWith("kill_streak_"))
                .Where(pa => serverGuid == "global" || pa.ServerGuid == serverGuid)
                .ToListAsync();

            var sortedStreaks = allServerStreaks
                .Select(s => {
                    var actual = GetStreakValueFromId(s.AchievementId);
                    if (!string.IsNullOrEmpty(s.Metadata)) {
                        try {
                            var doc = JsonDocument.Parse(s.Metadata);
                            if (doc.RootElement.TryGetProperty("actual_streak", out var val)) actual = val.GetInt32();
                        } catch {}
                    }
                    return new { s.PlayerName, Streak = actual };
                })
                .OrderByDescending(x => x.Streak)
                .ToList();

            var playerIndex = sortedStreaks.FindIndex(x => x.PlayerName == playerName && x.Streak == streakInfo.Streak);
            int serverStreakRank = playerIndex >= 0 ? playerIndex + 1 : 1;

            bestMoments.Add(new PlayerBestMomentDto(
                "streak",
                streakInfo.Streak,
                streakInfo.MapName,
                streakInfo.Date,
                estDuration,
                serverStreakRank
            ));
        }

        // Fetch player sessions in 2026
        var sessionsQuery = dbContext.PlayerSessions
            .Where(ps => ps.PlayerName == playerName && ps.StartTime >= startYear && ps.StartTime < endYear && !ps.IsDeleted);

        if (serverGuid != "global")
        {
            sessionsQuery = sessionsQuery.Where(ps => ps.ServerGuid == serverGuid);
        }

        var sessionsList = await sessionsQuery.ToListAsync();

        if (sessionsList.Count > 0)
        {
            // (2) Highest Score
            var highestScoreSession = sessionsList.OrderByDescending(s => s.TotalScore).First();
            var highestScoreDate = Instant.FromDateTimeUtc(DateTime.SpecifyKind(highestScoreSession.StartTime, DateTimeKind.Utc));
            var highestScoreDuration = (int)(highestScoreSession.LastSeenTime - highestScoreSession.StartTime).TotalMinutes;
            if (highestScoreDuration <= 0) highestScoreDuration = 15;

            bestMoments.Add(new PlayerBestMomentDto(
                "score",
                highestScoreSession.TotalScore,
                highestScoreSession.MapName,
                highestScoreDate,
                highestScoreDuration,
                0
            ));

            // (3) Round with Most Kills
            var mostKillsSession = sessionsList.OrderByDescending(s => s.TotalKills).First();
            var mostKillsDate = Instant.FromDateTimeUtc(DateTime.SpecifyKind(mostKillsSession.StartTime, DateTimeKind.Utc));
            var mostKillsDuration = (int)(mostKillsSession.LastSeenTime - mostKillsSession.StartTime).TotalMinutes;
            if (mostKillsDuration <= 0) mostKillsDuration = 15;

            bestMoments.Add(new PlayerBestMomentDto(
                "kills",
                mostKillsSession.TotalKills,
                mostKillsSession.MapName,
                mostKillsDate,
                mostKillsDuration,
                0
            ));
        }

        // 6. Squad
        var squad = new List<PlayerTeammateDto>();
        if (_relationshipService != null)
        {
            try
            {
                var coPlayers = await _relationshipService.GetMostFrequentCoPlayersAsync(playerName, limit: 10);
                foreach (var p in coPlayers)
                {
                    squad.Add(new PlayerTeammateDto(PlayerNameDecoder.Decode(p.Player2Name), p.SessionCount));
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to load co-players from Neo4j for {PlayerName}", playerName);
            }
        }

        // 7. Server Rankings (Top 2)
        var serverRankings = new List<PlayerServerRankingDto>();
        try
        {
            var statsService = (IPlayerStatsService?)serviceProvider.GetService(typeof(IPlayerStatsService));
            if (statsService != null)
            {
                var insights = await statsService.GetPlayerInsights(playerName, daysToAnalyze: 1);
                if (insights?.ServerRankings != null)
                {
                    serverRankings = insights.ServerRankings
                        .OrderBy(r => r.Rank)
                        .Take(2)
                        .Select(r => new PlayerServerRankingDto(
                            r.ServerGuid,
                            r.ServerName,
                            r.Rank,
                            r.TotalScore,
                            r.TotalRankedPlayers,
                            r.AveragePing
                        ))
                        .ToList();
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to calculate server rankings for player wrapped of {PlayerName}", playerName);
        }


        string? luckyCharmName = null;
        int? luckyCharmWins = null;
        string? archNemesisName = null;
        int? archNemesisLosses = null;
        string? twoFaceName = null;
        int? twoFaceWins = null;
        int? twoFaceLosses = null;

        if (roundsPlayed > 0)
        {
            var connection = dbContext.Database.GetDbConnection();
            bool wasClosed = connection.State == System.Data.ConnectionState.Closed;
            if (wasClosed) await connection.OpenAsync();

            try
            {
                var winsDict = new Dictionary<string, int>();
                var lossesDict = new Dictionary<string, int>();

                await using (var cmd = connection.CreateCommand())
                {
                    cmd.CommandText = @"
                        SELECT 
                            ps.RoundId, 
                            ps.CurrentTeam, 
                            (SELECT 1 FROM PlayerAchievements pa 
                             WHERE pa.PlayerName = ps.PlayerName AND pa.RoundId = ps.RoundId 
                               AND pa.AchievementId IN ('team_victory', 'team_victory_switched') LIMIT 1) as IsWin
                        FROM PlayerSessions ps
                        WHERE ps.PlayerName = $playerName 
                          AND ps.StartTime >= $start 
                          AND ps.StartTime < $end 
                          AND ps.IsDeleted = 0 
                          AND ps.RoundId IS NOT NULL";
                    
                    var pPlayer = cmd.CreateParameter(); pPlayer.ParameterName = "$playerName"; pPlayer.Value = playerName; cmd.Parameters.Add(pPlayer);
                    var pStart = cmd.CreateParameter(); pStart.ParameterName = "$start"; pStart.Value = new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc); cmd.Parameters.Add(pStart);
                    var pEnd = cmd.CreateParameter(); pEnd.ParameterName = "$end"; pEnd.Value = new DateTime(year + 1, 1, 1, 0, 0, 0, DateTimeKind.Utc); cmd.Parameters.Add(pEnd);

                    await using (var reader = await cmd.ExecuteReaderAsync())
                    {
                        while (await reader.ReadAsync())
                        {
                            var rId = reader.GetString(0);
                            var team = reader.GetInt32(1);
                            var isWin = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
                            if (isWin == 1)
                            {
                                winsDict[rId] = team;
                            }
                            else
                            {
                                lossesDict[rId] = team;
                            }
                        }
                    }
                }

                var teammateWins = new Dictionary<string, int>();
                foreach (var kvp in winsDict)
                {
                    await using (var cmd = connection.CreateCommand())
                    {
                        cmd.CommandText = @"
                            SELECT PlayerName 
                            FROM PlayerSessions 
                            WHERE RoundId = $roundId 
                              AND CurrentTeam = $team 
                              AND PlayerName != $playerName 
                              AND IsDeleted = 0";
                        
                        var pRound = cmd.CreateParameter(); pRound.ParameterName = "$roundId"; pRound.Value = kvp.Key; cmd.Parameters.Add(pRound);
                        var pTeam = cmd.CreateParameter(); pTeam.ParameterName = "$team"; pTeam.Value = kvp.Value; cmd.Parameters.Add(pTeam);
                        var pPlayer = cmd.CreateParameter(); pPlayer.ParameterName = "$playerName"; pPlayer.Value = playerName; cmd.Parameters.Add(pPlayer);

                        await using (var reader = await cmd.ExecuteReaderAsync())
                        {
                            while (await reader.ReadAsync())
                            {
                                var name = reader.GetString(0);
                                teammateWins[name] = teammateWins.GetValueOrDefault(name, 0) + 1;
                            }
                        }
                    }
                }

                var nemesisLosses = new Dictionary<string, int>();
                foreach (var kvp in lossesDict)
                {
                    await using (var cmd = connection.CreateCommand())
                    {
                        cmd.CommandText = @"
                            SELECT ps.PlayerName 
                            FROM PlayerSessions ps
                            INNER JOIN PlayerAchievements pa ON ps.PlayerName = pa.PlayerName AND ps.RoundId = pa.RoundId
                            WHERE ps.RoundId = $roundId 
                              AND ps.CurrentTeam != $team 
                              AND ps.PlayerName != $playerName 
                              AND ps.IsDeleted = 0
                              AND pa.AchievementId IN ('team_victory', 'team_victory_switched')";
                        
                        var pRound = cmd.CreateParameter(); pRound.ParameterName = "$roundId"; pRound.Value = kvp.Key; cmd.Parameters.Add(pRound);
                        var pTeam = cmd.CreateParameter(); pTeam.ParameterName = "$team"; pTeam.Value = kvp.Value; cmd.Parameters.Add(pTeam);
                        var pPlayer = cmd.CreateParameter(); pPlayer.ParameterName = "$playerName"; pPlayer.Value = playerName; cmd.Parameters.Add(pPlayer);

                        await using (var reader = await cmd.ExecuteReaderAsync())
                        {
                            while (await reader.ReadAsync())
                            {
                                var name = reader.GetString(0);
                                nemesisLosses[name] = nemesisLosses.GetValueOrDefault(name, 0) + 1;
                            }
                        }
                    }
                }

                var topCharm = teammateWins.OrderByDescending(x => x.Value).FirstOrDefault();
                var topNemesis = nemesisLosses.OrderByDescending(x => x.Value).FirstOrDefault();

                if (topCharm.Key != null && topNemesis.Key != null && topCharm.Key == topNemesis.Key && topCharm.Value >= 3 && topNemesis.Value >= 3)
                {
                    twoFaceName = PlayerNameDecoder.Decode(topCharm.Key);
                    twoFaceWins = topCharm.Value;
                    twoFaceLosses = topNemesis.Value;
                }
                else
                {
                    if (topCharm.Key != null && topCharm.Value >= 2)
                    {
                        luckyCharmName = PlayerNameDecoder.Decode(topCharm.Key);
                        luckyCharmWins = topCharm.Value;
                    }
                    if (topNemesis.Key != null && topNemesis.Value >= 2)
                    {
                        archNemesisName = PlayerNameDecoder.Decode(topNemesis.Key);
                        archNemesisLosses = topNemesis.Value;
                    }
                }
            }
            finally
            {
                if (wasClosed) await connection.CloseAsync();
            }
        }

        var relations = new PlayerRelationsDto(
            luckyCharmName,
            luckyCharmWins,
            archNemesisName,
            archNemesisLosses,
            twoFaceName,
            twoFaceWins,
            twoFaceLosses
        );

        return new PlayerWrappedResponseDto(
            PlayerNameDecoder.Decode(playerName),
            serverGuid,
            homeServerName,
            year,
            yearInNumbers,
            trend,
            favouriteMap,
            medals,
            bestMoments,
            squad,
            serverRankings,
            relations
        );
    }

    private static int GetStreakValueFromId(string achievementId)
    {
        return achievementId switch
        {
            "kill_streak_50" => 50,
            "kill_streak_30" => 30,
            "kill_streak_25" => 25,
            "kill_streak_20" => 20,
            "kill_streak_15" => 15,
            "kill_streak_10" => 10,
            "kill_streak_5" => 5,
            _ => 0
        };
    }

    private static int GetPrestigeWeight(string achievementId)
    {
        if (achievementId.StartsWith("total_kills_"))
        {
            if (int.TryParse(achievementId.Replace("total_kills_", ""), out var kills))
            {
                return kills;
            }
        }
        if (achievementId.StartsWith("total_score_"))
        {
            if (int.TryParse(achievementId.Replace("total_score_", ""), out var score))
            {
                return score / 10; // priority given to kills, but 1M score has 100k weight
            }
        }
        if (achievementId.StartsWith("milestone_playtime_"))
        {
            if (int.TryParse(achievementId.Replace("milestone_playtime_", "").Replace("h", ""), out var hours))
            {
                return hours * 100;
            }
        }
        if (achievementId.Contains("legend")) return 20000;
        if (achievementId.Contains("gold")) return 5000;
        if (achievementId.Contains("silver")) return 1000;
        return 100;
    }

    private static int GetTierWeight(string tier)
    {
        return (tier?.ToLower()) switch
        {
            "legend" => 4,
            "gold" => 3,
            "silver" => 2,
            "bronze" => 1,
            _ => 0
        };
    }

    private static (string Name, string Description) GetAchievementInfo(string achievementId)
    {
        if (achievementId.StartsWith("total_kills_"))
        {
            var kills = achievementId.Replace("total_kills_", "");
            var title = kills switch
            {
                "100" => "Centurion",
                "500" => "Veteran",
                "1000" => "Elite",
                "2500" => "Master",
                "5000" => "Warlord",
                "10000" => "Legend",
                "25000" => "Immortal",
                "50000" => "God of War",
                "100000" => "Apocalypse",
                "750000" => "Grand Emperor",
                _ => "Slayer"
            };
            var valParsed = int.TryParse(kills, out var kVal) ? kVal : 0;
            return ($"{title} ({valParsed:N0} Kills)", $"Reached {valParsed:N0} total kills on the battlefield.");
        }
        if (achievementId.StartsWith("milestone_playtime_"))
        {
            var hours = achievementId.Replace("milestone_playtime_", "").Replace("h", "");
            var title = hours switch
            {
                "10" => "Recruit",
                "50" => "Soldier",
                "100" => "Veteran",
                "500" => "Elite",
                "1000" => "Legend",
                _ => "Veteran"
            };
            return ($"{title} ({hours}h Played)", $"Dedicated {hours} hours of active service.");
        }
        if (achievementId.StartsWith("total_score_"))
        {
            var score = achievementId.Replace("total_score_", "");
            var title = score switch
            {
                "10000" => "Bronze Scorer",
                "50000" => "Silver Scorer",
                "100000" => "Gold Scorer",
                "500000" => "Master Scorer",
                "1000000" => "Legendary Scorer",
                _ => "Tactician"
            };
            var scoreParsed = int.TryParse(score, out var sVal) ? sVal : 0;
            return ($"{title} ({scoreParsed:N0} Score)", $"Accumulated {scoreParsed:N0} total combat score.");
        }

        return achievementId switch
        {
            "elite_warrior_legend" => ("Elite Warrior (Legend)", "Crossed the ultimate threshold of combat efficiency."),
            "sharpshooter_legend" => ("Sharpshooter (Legend)", "Achieved master class accuracy and precision."),
            "team_victory_legendary" => ("Victory Vanguard (Legend)", "Led their division to legendary victory heights."),
            "team_victory_switched_legendary" => ("Turncoat Hero (Legend)", "Switched sides and still secured legendary victory."),
            _ => (achievementId.Replace("_", " ").ToUpper(), "Honoured for exemplary battlefield performance.")
        };
    }
}
