using System.Diagnostics;
using System.Data;
using api.Gamification.Models;
using api.PlayerTracking;
using api.Servers.Models;
using api.Telemetry;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace api.PlayerStats;

/// <summary>
/// SQLite-based leaderboard service that queries pre-computed weekly aggregates.
/// Aggregates PlayerServerStats records across weeks for the requested time period.
/// </summary>
public class SqliteLeaderboardService(PlayerTrackerDbContext dbContext) : ISqliteLeaderboardService
{
    private const int MinRoundsDefault = 3;

    /// <inheritdoc/>
    public async Task<List<TopScore>> GetTopScoresAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10,
        int? minRoundsOverride = null)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetTopScoresAsync");
        activity?.SetTag("query.name", "GetTopScores");
        activity?.SetTag("query.filters", $"server:{serverGuid},limit:{limit}");

        var stopwatch = Stopwatch.StartNew();
        var minRounds = minRoundsOverride ?? MinRoundsDefault;

        var (startYear, startWeek) = GetIsoWeek(startPeriod);
        var (endYear, endWeek) = GetIsoWeek(endPeriod);

        var result = await dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid &&
                         ((pss.Year > startYear || (pss.Year == startYear && pss.Week >= startWeek)) &&
                          (pss.Year < endYear || (pss.Year == endYear && pss.Week <= endWeek))))
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalScore = g.Sum(pss => pss.TotalScore),
                TotalKills = g.Sum(pss => pss.TotalKills),
                TotalDeaths = g.Sum(pss => pss.TotalDeaths),
                TotalRounds = g.Sum(pss => pss.TotalRounds)
            })
            .Where(x => x.TotalRounds >= minRounds && x.TotalScore > 0)
            .OrderByDescending(x => x.TotalScore)
            .Take(limit)
            .Select(x => new TopScore
            {
                PlayerName = x.PlayerName,
                Score = x.TotalScore,
                Kills = x.TotalKills,
                Deaths = x.TotalDeaths,
                MapName = "",
                Timestamp = DateTime.MinValue,
                SessionId = 0
            })
            .ToListAsync();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", result.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerServerStats");

        return result;
    }

    /// <inheritdoc/>
    public async Task<List<TopKDRatio>> GetTopKDRatiosAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10,
        int? minRoundsOverride = null)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetTopKDRatiosAsync");
        activity?.SetTag("query.name", "GetTopKDRatios");
        activity?.SetTag("query.filters", $"server:{serverGuid},limit:{limit}");

        var stopwatch = Stopwatch.StartNew();
        var minRounds = minRoundsOverride ?? MinRoundsDefault;

        var (startYear, startWeek) = GetIsoWeek(startPeriod);
        var (endYear, endWeek) = GetIsoWeek(endPeriod);

        // Need to fetch and compute K/D ratio in memory since SQLite can't do division in aggregate
        var data = await dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid &&
                         ((pss.Year > startYear || (pss.Year == startYear && pss.Week >= startWeek)) &&
                          (pss.Year < endYear || (pss.Year == endYear && pss.Week <= endWeek))))
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalKills = g.Sum(pss => pss.TotalKills),
                TotalDeaths = g.Sum(pss => pss.TotalDeaths),
                TotalRounds = g.Sum(pss => pss.TotalRounds)
            })
            .Where(x => x.TotalRounds >= minRounds && (x.TotalKills > 0 || x.TotalDeaths > 0))
            .ToListAsync();

        var result = data
            .Select(x => new TopKDRatio
            {
                PlayerName = x.PlayerName,
                Kills = x.TotalKills,
                Deaths = x.TotalDeaths,
                KDRatio = x.TotalDeaths > 0
                    ? Math.Round((double)x.TotalKills / x.TotalDeaths, 3)
                    : x.TotalKills,
                TotalRounds = x.TotalRounds
            })
            .OrderByDescending(x => x.KDRatio)
            .Take(limit)
            .ToList();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", result.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerServerStats");

        return result;
    }

    /// <inheritdoc/>
    public async Task<List<TopKillRate>> GetTopKillRatesAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10,
        int? minRoundsOverride = null)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetTopKillRatesAsync");
        activity?.SetTag("query.name", "GetTopKillRates");
        activity?.SetTag("query.filters", $"server:{serverGuid},limit:{limit}");

        var stopwatch = Stopwatch.StartNew();
        var minRounds = minRoundsOverride ?? MinRoundsDefault;

        var (startYear, startWeek) = GetIsoWeek(startPeriod);
        var (endYear, endWeek) = GetIsoWeek(endPeriod);

        // Need to fetch and compute kill rate in memory
        var data = await dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid &&
                         ((pss.Year > startYear || (pss.Year == startYear && pss.Week >= startWeek)) &&
                          (pss.Year < endYear || (pss.Year == endYear && pss.Week <= endWeek))))
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalKills = g.Sum(pss => pss.TotalKills),
                TotalDeaths = g.Sum(pss => pss.TotalDeaths),
                TotalPlayTimeMinutes = g.Sum(pss => pss.TotalPlayTimeMinutes),
                TotalRounds = g.Sum(pss => pss.TotalRounds)
            })
            .Where(x => x.TotalRounds >= minRounds && x.TotalKills > 0 && x.TotalPlayTimeMinutes > 0)
            .ToListAsync();

        var result = data
            .Select(x => new TopKillRate
            {
                PlayerName = x.PlayerName,
                Kills = x.TotalKills,
                Deaths = x.TotalDeaths,
                PlayTimeMinutes = (int)x.TotalPlayTimeMinutes,
                KillRate = x.TotalPlayTimeMinutes > 0
                    ? Math.Round(x.TotalKills / x.TotalPlayTimeMinutes, 3)
                    : 0,
                TotalRounds = x.TotalRounds
            })
            .OrderByDescending(x => x.KillRate)
            .Take(limit)
            .ToList();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", result.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerServerStats");

        return result;
    }

    /// <inheritdoc/>
    public async Task<List<PlayerActivity>> GetMostActivePlayersAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetMostActivePlayersAsync");
        activity?.SetTag("query.name", "GetMostActivePlayers");
        activity?.SetTag("query.filters", $"server:{serverGuid},limit:{limit}");

        var stopwatch = Stopwatch.StartNew();

        var (startYear, startWeek) = GetIsoWeek(startPeriod);
        var (endYear, endWeek) = GetIsoWeek(endPeriod);

        var result = await dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid &&
                         ((pss.Year > startYear || (pss.Year == startYear && pss.Week >= startWeek)) &&
                          (pss.Year < endYear || (pss.Year == endYear && pss.Week <= endWeek))))
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new PlayerActivity
            {
                PlayerName = g.Key,
                MinutesPlayed = (int)g.Sum(pss => pss.TotalPlayTimeMinutes),
                TotalKills = g.Sum(pss => pss.TotalKills),
                TotalDeaths = g.Sum(pss => pss.TotalDeaths)
            })
            .Where(x => x.MinutesPlayed > 0)
            .OrderByDescending(x => x.MinutesPlayed)
            .Take(limit)
            .ToListAsync();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", result.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);
        activity?.SetTag("result.table", "PlayerServerStats");

        return result;
    }

    /// <inheritdoc/>
    public async Task<ServerPlayerRankingsResponse> GetServerPlayerRankingsAsync(
        string serverGuid,
        string serverName,
        int days,
        DateTime startPeriod,
        DateTime endPeriod,
        int page = 1,
        int pageSize = 20,
        string sortBy = "active",
        int minRounds = 1,
        string? searchQuery = null)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetServerPlayerRankingsAsync");
        activity?.SetTag("query.name", "GetServerPlayerRankings");
        activity?.SetTag("query.filters", $"server:{serverGuid},page:{page},size:{pageSize},sort:{sortBy},minRounds:{minRounds}");

        var stopwatch = Stopwatch.StartNew();

        var (startYear, startWeek) = GetIsoWeek(startPeriod);
        var (endYear, endWeek) = GetIsoWeek(endPeriod);

        var query = dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid &&
                         ((pss.Year > startYear || (pss.Year == startYear && pss.Week >= startWeek)) &&
                          (pss.Year < endYear || (pss.Year == endYear && pss.Week <= endWeek))));

        var aggregated = await query
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                MinutesPlayed = (int)g.Sum(pss => pss.TotalPlayTimeMinutes),
                TotalKills = g.Sum(pss => pss.TotalKills),
                TotalDeaths = g.Sum(pss => pss.TotalDeaths),
                TotalScore = g.Sum(pss => pss.TotalScore),
                TotalRounds = g.Sum(pss => pss.TotalRounds)
            })
            .Where(x => x.TotalRounds >= minRounds && (x.MinutesPlayed > 0 || x.TotalScore > 0 || x.TotalKills > 0 || x.TotalDeaths > 0))
            .ToListAsync();

        if (!string.IsNullOrWhiteSpace(searchQuery))
        {
            var term = searchQuery.Trim().ToLowerInvariant();
            aggregated = aggregated.Where(x => x.PlayerName.ToLowerInvariant().Contains(term)).ToList();
        }

        // Fetch placement medals for this server and period
        var startInstant = Instant.FromDateTimeUtc(DateTime.SpecifyKind(startPeriod, DateTimeKind.Utc));
        var endInstant = Instant.FromDateTimeUtc(DateTime.SpecifyKind(endPeriod, DateTimeKind.Utc));

        var placementData = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.AchievementType == AchievementTypes.Placement
                         && pa.ServerGuid == serverGuid
                         && pa.AchievedAt >= startInstant
                         && pa.AchievedAt < endInstant)
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                FirstPlaces = g.Count(pa => pa.Tier == "gold"),
                SecondPlaces = g.Count(pa => pa.Tier == "silver"),
                ThirdPlaces = g.Count(pa => pa.Tier == "bronze")
            })
            .ToDictionaryAsync(x => x.PlayerName, x => (x.FirstPlaces, x.SecondPlaces, x.ThirdPlaces));

        var items = aggregated.Select(x =>
        {
            var (first, second, third) = placementData.TryGetValue(x.PlayerName, out var p) ? p : (0, 0, 0);
            var totalPlacements = first + second + third;
            var placementPoints = first * 3 + second * 2 + third * 1;
            var kd = x.TotalDeaths > 0 ? Math.Round((double)x.TotalKills / x.TotalDeaths, 2) : x.TotalKills;
            var killRate = x.MinutesPlayed > 0 ? Math.Round((double)x.TotalKills / x.MinutesPlayed, 2) : 0;

            return new ServerPlayerRankingItem
            {
                PlayerName = x.PlayerName,
                MinutesPlayed = x.MinutesPlayed,
                TotalKills = x.TotalKills,
                TotalDeaths = x.TotalDeaths,
                KdRatio = kd,
                KillRate = killRate,
                TotalScore = x.TotalScore,
                TotalRounds = x.TotalRounds,
                FirstPlaces = first,
                SecondPlaces = second,
                ThirdPlaces = third,
                TotalPlacements = totalPlacements,
                PlacementPoints = placementPoints
            };
        });

        IEnumerable<ServerPlayerRankingItem> sorted = (sortBy ?? "active").ToLowerInvariant() switch
        {
            "score" => items.OrderByDescending(x => x.TotalScore).ThenByDescending(x => x.MinutesPlayed),
            "kd" => items.OrderByDescending(x => x.KdRatio).ThenByDescending(x => x.TotalKills),
            "killrate" => items.OrderByDescending(x => x.KillRate).ThenByDescending(x => x.TotalKills),
            "placement" => items.OrderByDescending(x => x.PlacementPoints).ThenByDescending(x => x.FirstPlaces).ThenByDescending(x => x.TotalPlacements),
            _ => items.OrderByDescending(x => x.MinutesPlayed).ThenByDescending(x => x.TotalScore)
        };

        var sortedList = sorted.ToList();
        var totalCount = sortedList.Count;
        var effectivePage = Math.Max(1, page);
        var effectivePageSize = Math.Clamp(pageSize, 1, 100);
        var totalPages = (int)Math.Ceiling((double)totalCount / effectivePageSize);

        var pagedItems = sortedList
            .Skip((effectivePage - 1) * effectivePageSize)
            .Take(effectivePageSize)
            .Select((item, idx) =>
            {
                item.Rank = (effectivePage - 1) * effectivePageSize + idx + 1;
                return item;
            })
            .ToList();

        stopwatch.Stop();
        activity?.SetTag("result.row_count", pagedItems.Count);
        activity?.SetTag("result.total_count", totalCount);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);

        return new ServerPlayerRankingsResponse
        {
            ServerGuid = serverGuid,
            ServerName = serverName,
            Days = days,
            Page = effectivePage,
            PageSize = effectivePageSize,
            TotalCount = totalCount,
            TotalPages = totalPages,
            SortBy = sortBy ?? "active",
            MinRounds = minRounds,
            Rankings = pagedItems
        };
    }

    /// <inheritdoc/>
    public async Task<ServerRankDistributionResponse> GetServerRankDistributionAsync(
        string serverGuid,
        string serverName,
        int days,
        DateTime startPeriod,
        DateTime endPeriod,
        int minRounds = 1)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetServerRankDistributionAsync");
        activity?.SetTag("query.name", "GetServerRankDistribution");
        activity?.SetTag("query.filters", $"server:{serverGuid},minRounds:{minRounds}");

        var stopwatch = Stopwatch.StartNew();

        var (startYear, startWeek) = GetIsoWeek(startPeriod);
        var (endYear, endWeek) = GetIsoWeek(endPeriod);

        var aggregated = await dbContext.PlayerServerStats
            .Where(pss => pss.ServerGuid == serverGuid &&
                         ((pss.Year > startYear || (pss.Year == startYear && pss.Week >= startWeek)) &&
                          (pss.Year < endYear || (pss.Year == endYear && pss.Week <= endWeek))))
            .GroupBy(pss => pss.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                MinutesPlayed = (int)g.Sum(pss => pss.TotalPlayTimeMinutes),
                TotalKills = g.Sum(pss => pss.TotalKills),
                TotalDeaths = g.Sum(pss => pss.TotalDeaths),
                TotalScore = g.Sum(pss => pss.TotalScore),
                TotalRounds = g.Sum(pss => pss.TotalRounds)
            })
            .Where(x => x.TotalRounds >= minRounds && (x.MinutesPlayed > 0 || x.TotalScore > 0 || x.TotalKills > 0 || x.TotalDeaths > 0))
            .ToListAsync();

        var response = new ServerRankDistributionResponse
        {
            ServerGuid = serverGuid,
            ServerName = serverName,
            Days = days,
            MinRounds = minRounds,
            TotalPlayers = aggregated.Count
        };

        if (aggregated.Count == 0)
        {
            response.KdDistribution = CreateEmptyDistribution("K/D ratio", KdBandDefs);
            response.ScoreDistribution = CreateEmptyDistribution("Score", ScoreBandDefs);
            response.KillsDistribution = CreateEmptyDistribution("Kills", KillsBandDefs);
            response.PlayTimeDistribution = CreateEmptyDistribution("Hours played", HoursBandDefs);
            response.KillRateDistribution = CreateEmptyDistribution("Kill rate", KillRateBandDefs);
            return response;
        }

        var kdValues = aggregated.Select(x => x.TotalDeaths > 0 ? (double)x.TotalKills / x.TotalDeaths : x.TotalKills).ToList();
        var scoreValues = aggregated.Select(x => (double)x.TotalScore).ToList();
        var killValues = aggregated.Select(x => (double)x.TotalKills).ToList();
        var hoursValues = aggregated.Select(x => x.MinutesPlayed / 60.0).ToList();
        var killRateValues = aggregated.Select(x => x.MinutesPlayed > 0 ? (double)x.TotalKills / x.MinutesPlayed : 0.0).ToList();

        response.KdDistribution = ComputeDistribution("K/D ratio", kdValues, KdBandDefs, 2);
        response.ScoreDistribution = ComputeDistribution("Score", scoreValues, ScoreBandDefs, 0);
        response.KillsDistribution = ComputeDistribution("Kills", killValues, KillsBandDefs, 0);
        response.PlayTimeDistribution = ComputeDistribution("Hours played", hoursValues, HoursBandDefs, 1);
        response.KillRateDistribution = ComputeDistribution("Kill rate", killRateValues, KillRateBandDefs, 2);

        stopwatch.Stop();
        activity?.SetTag("result.player_count", aggregated.Count);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);

        return response;
    }

    private static readonly (string Label, double Min, double? Max)[] KdBandDefs =
    [
        ("< 0.5", 0.0, 0.5),
        ("0.5 – 0.75", 0.5, 0.75),
        ("0.75 – 1.0", 0.75, 1.0),
        ("1.0 – 1.25", 1.0, 1.25),
        ("1.25 – 1.5", 1.25, 1.5),
        ("1.5 – 2.0", 1.5, 2.0),
        ("2.0 – 3.0", 2.0, 3.0),
        ("3.0+", 3.0, null)
    ];

    private static readonly (string Label, double Min, double? Max)[] ScoreBandDefs =
    [
        ("< 500", 0, 500),
        ("500 – 1k", 500, 1000),
        ("1k – 2.5k", 1000, 2500),
        ("2.5k – 5k", 2500, 5000),
        ("5k – 10k", 5000, 10000),
        ("10k – 25k", 10000, 25000),
        ("25k+", 25000, null)
    ];

    private static readonly (string Label, double Min, double? Max)[] KillsBandDefs =
    [
        ("< 25", 0, 25),
        ("25 – 50", 25, 50),
        ("50 – 100", 50, 100),
        ("100 – 250", 100, 250),
        ("250 – 500", 250, 500),
        ("500 – 1k", 500, 1000),
        ("1k+", 1000, null)
    ];

    private static readonly (string Label, double Min, double? Max)[] HoursBandDefs =
    [
        ("< 1h", 0, 1),
        ("1h – 5h", 1, 5),
        ("5h – 10h", 5, 10),
        ("10h – 20h", 10, 20),
        ("20h – 50h", 20, 50),
        ("50h+", 50, null)
    ];

    private static readonly (string Label, double Min, double? Max)[] KillRateBandDefs =
    [
        ("< 0.2", 0.0, 0.2),
        ("0.2 – 0.4", 0.2, 0.4),
        ("0.4 – 0.6", 0.4, 0.6),
        ("0.6 – 0.8", 0.6, 0.8),
        ("0.8 – 1.0", 0.8, 1.0),
        ("1.0 – 1.5", 1.0, 1.5),
        ("1.5+", 1.5, null)
    ];

    private static MetricDistribution CreateEmptyDistribution(
        string metricName,
        (string Label, double Min, double? Max)[] bandDefs)
    {
        return new MetricDistribution
        {
            MetricName = metricName,
            Average = 0,
            Median = 0,
            P75 = 0,
            P90 = 0,
            P95 = 0,
            P99 = 0,
            Min = 0,
            Max = 0,
            Bands = bandDefs.Select(b => new DistributionBand
            {
                Label = b.Label,
                MinValue = b.Min,
                MaxValue = b.Max,
                Count = 0,
                Percentage = 0
            }).ToList()
        };
    }

    private static MetricDistribution ComputeDistribution(
        string metricName,
        List<double> values,
        (string Label, double Min, double? Max)[] bandDefs,
        int roundDecimals)
    {
        if (values.Count == 0)
            return CreateEmptyDistribution(metricName, bandDefs);

        var sorted = values.OrderBy(v => v).ToList();
        var total = (double)sorted.Count;

        var bands = bandDefs.Select(b =>
        {
            int count = b.Max.HasValue
                ? sorted.Count(v => v >= b.Min && v < b.Max.Value)
                : sorted.Count(v => v >= b.Min);

            return new DistributionBand
            {
                Label = b.Label,
                MinValue = b.Min,
                MaxValue = b.Max,
                Count = count,
                Percentage = total > 0 ? Math.Round((count / total) * 100.0, 1) : 0.0
            };
        }).ToList();

        return new MetricDistribution
        {
            MetricName = metricName,
            Average = Math.Round(sorted.Average(), roundDecimals),
            Median = Math.Round(CalculatePercentile(sorted, 50), roundDecimals),
            P75 = Math.Round(CalculatePercentile(sorted, 75), roundDecimals),
            P90 = Math.Round(CalculatePercentile(sorted, 90), roundDecimals),
            P95 = Math.Round(CalculatePercentile(sorted, 95), roundDecimals),
            P99 = Math.Round(CalculatePercentile(sorted, 99), roundDecimals),
            Min = Math.Round(sorted.First(), roundDecimals),
            Max = Math.Round(sorted.Last(), roundDecimals),
            Bands = bands
        };
    }

    private static double CalculatePercentile(List<double> sortedValues, double percentile)
    {
        if (sortedValues.Count == 0) return 0;
        if (sortedValues.Count == 1) return sortedValues[0];
        if (percentile <= 0) return sortedValues[0];
        if (percentile >= 100) return sortedValues[^1];

        double realIndex = (percentile / 100.0) * (sortedValues.Count - 1);
        int lowerIndex = (int)Math.Floor(realIndex);
        int upperIndex = (int)Math.Ceiling(realIndex);

        if (lowerIndex == upperIndex) return sortedValues[lowerIndex];

        double fraction = realIndex - lowerIndex;
        return sortedValues[lowerIndex] + fraction * (sortedValues[upperIndex] - sortedValues[lowerIndex]);
    }

    /// <inheritdoc/>
    public async Task<Models.GlobalLeaderboardResponse> GetGlobalLeaderboardAsync(
        int page = 1,
        int pageSize = 50,
        string sortBy = "score",
        string sortDir = "desc",
        string? searchQuery = null,
        string? server = null,
        string? map = null,
        int days = 30,
        int minRounds = 1,
        int minPlay = 0,
        string? game = "bf1942",
        string? exclude = null,
        bool populatedOnly = false)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("GetGlobalLeaderboardAsync");
        activity?.SetTag("query.name", "GetGlobalLeaderboard");
        activity?.SetTag("query.filters", $"page:{page},pageSize:{pageSize},sortBy:{sortBy},sortDir:{sortDir},q:{searchQuery},server:{server},exclude:{exclude},populatedOnly:{populatedOnly},map:{map},days:{days},minRounds:{minRounds},minPlay:{minPlay}");

        var stopwatch = Stopwatch.StartNew();

        var scopedToServer = !string.IsNullOrWhiteSpace(server);
        if (!scopedToServer && (days <= 0 || days > 365))
            days = 365;

        var serverMap = await dbContext.Servers
            .AsNoTracking()
            .Select(s => new { s.Guid, s.Name, s.Country, s.Game })
            .ToDictionaryAsync(s => s.Guid);

        var occupancyDays = days > 0 ? Math.Min(days, 90) : 90;
        var occupancyCutoff = Instant.FromDateTimeUtc(
            DateTime.SpecifyKind(DateTime.UtcNow.AddDays(-occupancyDays), DateTimeKind.Utc));

        var occupancyQuery = dbContext.ServerOnlineCounts
            .AsNoTracking()
            .Where(soc => soc.HourTimestamp >= occupancyCutoff);

        if (!string.IsNullOrWhiteSpace(game))
        {
            occupancyQuery = occupancyQuery.Where(soc => soc.Game == game);
        }

        var occupancyRows = await occupancyQuery
            .GroupBy(soc => soc.ServerGuid)
            .Select(g => new { ServerGuid = g.Key, AvgPlayers = g.Average(soc => soc.AvgPlayers) })
            .ToListAsync();

        var occupancy = occupancyRows
            .Select(o => new ServerOccupancy(o.ServerGuid, o.AvgPlayers))
            .ToList();

        var occupancyByGuid = occupancy.ToDictionary(o => o.ServerGuid, o => o.AvgPlayers, StringComparer.OrdinalIgnoreCase);
        var populatedGuids = IdentifyPopulatedServers(occupancy);

        var serverLookup = serverMap.Select(kv => (kv.Value.Guid, kv.Value.Name));
        var excludeGuids = ResolveServerGuids(ParseExcludeTerms(exclude), serverLookup);
        var hasExplicitInclude = !string.IsNullOrWhiteSpace(server);
        var effectiveGame = !string.IsNullOrWhiteSpace(game) &&
                            serverMap.Values.Any(s => string.Equals(s.Game, game, StringComparison.OrdinalIgnoreCase))
            ? game
            : null;
        var includeGuids = hasExplicitInclude
            ? ResolveServerGuids([server!.Trim()], serverLookup)
            : [];

        var isAsc = string.Equals(sortDir, "asc", StringComparison.OrdinalIgnoreCase);
        var normSort = (sortBy ?? "score").Trim().ToLowerInvariant();
        var effectivePage = Math.Max(1, page);
        var effectivePageSize = Math.Clamp(pageSize, 1, 100);
        var offset = (effectivePage - 1) * effectivePageSize;

        var populatedFilter = !hasExplicitInclude && populatedOnly && occupancy.Count > 0
            ? populatedGuids
            : [];
        var excludedFilter = hasExplicitInclude ? [] : excludeGuids;
        var queryResult = await ExecuteGlobalLeaderboardQueryAsync(
            days,
            effectiveGame,
            map,
            searchQuery,
            includeGuids,
            excludedFilter,
            populatedFilter,
            minRounds,
            minPlay,
            normSort,
            isAsc,
            offset,
            effectivePageSize);

        var totalPlayers = queryResult.TotalPlayers;
        var totalPages = totalPlayers > 0 ? (int)Math.Ceiling((double)totalPlayers / effectivePageSize) : 1;
        var pagedRows = queryResult.Players;

        var playerSource = dbContext.PlayerMapStats
            .AsNoTracking()
            .Where(pms => pms.ServerGuid != "");

        if (days > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-days);
            var now = DateTime.UtcNow;
            playerSource = playerSource.Where(pms =>
                (pms.Year > cutoff.Year || (pms.Year == cutoff.Year && pms.Month >= cutoff.Month)) &&
                (pms.Year < now.Year || (pms.Year == now.Year && pms.Month <= now.Month)));
        }

        if (!string.IsNullOrWhiteSpace(effectiveGame))
        {
            playerSource = playerSource.Where(pms =>
                dbContext.Servers.Any(s => s.Guid == pms.ServerGuid && s.Game == effectiveGame));
        }

        if (!string.IsNullOrWhiteSpace(map))
        {
            var cleanMap = map.Trim().ToLowerInvariant();
            playerSource = playerSource.Where(pms => pms.MapName.ToLower() == cleanMap);
        }

        if (includeGuids.Count > 0)
        {
            playerSource = playerSource.Where(pms => includeGuids.Contains(pms.ServerGuid));
        }
        else
        {
            if (populatedFilter.Count > 0)
            {
                playerSource = playerSource.Where(pms => populatedFilter.Contains(pms.ServerGuid));
            }

            if (excludedFilter.Count > 0)
            {
                playerSource = playerSource.Where(pms => !excludedFilter.Contains(pms.ServerGuid));
            }
        }

        if (!string.IsNullOrWhiteSpace(searchQuery))
        {
            var term = searchQuery.Trim().ToLowerInvariant();
            var matchingNames = playerSource
                .Where(pms =>
                    pms.PlayerName.ToLower().Contains(term) ||
                    pms.MapName.ToLower().Contains(term) ||
                    dbContext.Servers.Any(s => s.Guid == pms.ServerGuid && s.Name.ToLower().Contains(term)))
                .Select(pms => pms.PlayerName);
            playerSource = playerSource.Where(pms => matchingNames.Contains(pms.PlayerName));
        }

        var favs = await LoadFavouriteServersAndMapsAsync(playerSource, pagedRows.Select(p => p.Name).ToList());

        var pagedPlayers = pagedRows.Select((row, idx) =>
        {
            favs.TryGetValue(row.Name, out var fav);
            serverMap.TryGetValue(fav.ServerGuid ?? "", out var srv);
            var srvCountry = srv?.Country ?? "";
            var kills = row.Kills;
            var deaths = row.Deaths;
            var playMin = (int)row.PlayMin;

            return new Models.LeaderboardPlayerDto
            {
                Rank = offset + idx + 1,
                Name = row.Name,
                Tag = ExtractClanTag(row.Name),
                Kills = kills,
                Deaths = deaths,
                Kd = deaths > 0 ? Math.Round((double)kills / deaths, 2) : kills,
                Score = row.Score,
                Kpm = playMin > 0 ? Math.Round((double)kills / playMin, 2) : 0,
                PlayMin = playMin,
                Rounds = row.Rounds,
                FavServer = srv?.Name ?? fav.ServerGuid,
                FavServerGuid = fav.ServerGuid,
                FavServerCountry = srvCountry,
                FavServerFlag = CountryCodeToFlag(srvCountry),
                FavMap = FormatMapDisplayName(fav.MapName)
            };
        }).ToList();

        var catalog = serverMap.Values.AsEnumerable();
        if (!string.IsNullOrWhiteSpace(game))
        {
            catalog = catalog.Where(s => string.Equals(s.Game, game, StringComparison.OrdinalIgnoreCase));
        }

        var occupancyGuids = new HashSet<string>(occupancyByGuid.Keys, StringComparer.OrdinalIgnoreCase);
        if (occupancyGuids.Count > 0)
        {
            catalog = catalog.Where(s => occupancyGuids.Contains(s.Guid));
        }

        var servers = catalog
            .Select(s =>
            {
                occupancyByGuid.TryGetValue(s.Guid, out var avgPlayers);
                return new Models.LeaderboardServerDto
                {
                    Guid = s.Guid,
                    Name = s.Name,
                    ShortName = CleanServerShortName(s.Name),
                    Country = s.Country ?? "",
                    Flag = CountryCodeToFlag(s.Country),
                    PlayerCount = 0,
                    AvgPlayers = Math.Round(avgPlayers, 1),
                    IsPopulated = populatedGuids.Contains(s.Guid)
                };
            })
            .OrderByDescending(s => s.IsPopulated)
            .ThenByDescending(s => s.AvgPlayers)
            .ThenBy(s => s.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var maps = queryResult.Maps
            .Select(m => new Models.LeaderboardMapDto
            {
                Name = m.Name,
                DisplayName = FormatMapDisplayName(m.Name),
                PlayerCount = m.PlayerCount
            })
            .OrderByDescending(m => m.PlayerCount)
            .ToList();

        stopwatch.Stop();
        activity?.SetTag("result.player_count", pagedPlayers.Count);
        activity?.SetTag("result.total_players", totalPlayers);
        activity?.SetTag("result.duration_ms", stopwatch.ElapsedMilliseconds);

        return new Models.GlobalLeaderboardResponse
        {
            Days = days,
            MinRounds = minRounds,
            MinPlay = minPlay,
            Server = server,
            Exclude = exclude,
            PopulatedOnly = populatedOnly,
            Map = map,
            SearchQuery = searchQuery,
            SortBy = normSort,
            SortDir = isAsc ? "asc" : "desc",
            Page = effectivePage,
            PageSize = effectivePageSize,
            TotalPages = totalPages,
            TotalPlayers = totalPlayers,
            Players = pagedPlayers,
            Servers = servers,
            Maps = maps,
            GeneratedAt = DateTime.UtcNow
        };
    }

    private async Task<GlobalLeaderboardQueryResult> ExecuteGlobalLeaderboardQueryAsync(
        int days,
        string? game,
        string? map,
        string? searchQuery,
        IReadOnlyCollection<string> includeGuids,
        IReadOnlyCollection<string> excludeGuids,
        IReadOnlyCollection<string> populatedGuids,
        int minRounds,
        int minPlay,
        string sort,
        bool isAscending,
        int offset,
        int pageSize)
    {
        var filters = new List<string> { """p."ServerGuid" <> ''""" };
        var parameters = new List<SqliteParameter>();

        if (days > 0)
        {
            var cutoff = DateTime.UtcNow.AddDays(-days);
            var current = new DateTime(cutoff.Year, cutoff.Month, 1);
            var end = new DateTime(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
            var monthFilters = new List<string>();
            var monthIndex = 0;

            while (current <= end)
            {
                var yearParameter = $"@year{monthIndex}";
                var monthParameter = $"@month{monthIndex}";
                monthFilters.Add($"""(p."Year" = {yearParameter} AND p."Month" = {monthParameter})""");
                parameters.Add(new SqliteParameter(yearParameter, current.Year));
                parameters.Add(new SqliteParameter(monthParameter, current.Month));
                current = current.AddMonths(1);
                monthIndex++;
            }

            filters.Add($"({string.Join(" OR ", monthFilters)})");
        }

        if (!string.IsNullOrWhiteSpace(game))
        {
            filters.Add("""s."Game" = @game COLLATE NOCASE""");
            parameters.Add(new SqliteParameter("@game", game.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(map))
        {
            filters.Add("""p."MapName" = @map COLLATE NOCASE""");
            parameters.Add(new SqliteParameter("@map", map.Trim()));
        }

        AddGuidFilter(filters, parameters, includeGuids, "include", negate: false);
        AddGuidFilter(filters, parameters, populatedGuids, "populated", negate: false);
        AddGuidFilter(filters, parameters, excludeGuids, "exclude", negate: true);

        var baseQuery = $$"""
            SELECT
                p."PlayerName",
                p."ServerGuid",
                p."MapName",
                p."TotalKills",
                p."TotalDeaths",
                p."TotalScore",
                p."TotalPlayTimeMinutes",
                p."TotalRounds",
                s."Name" AS "ServerName"
            FROM "PlayerMapStats" AS p
            LEFT JOIN "Servers" AS s ON s."Guid" = p."ServerGuid"
            WHERE {{string.Join(" AND ", filters)}}
            """;

        string filteredCte;
        if (string.IsNullOrWhiteSpace(searchQuery))
        {
            filteredCte = $"filtered AS MATERIALIZED ({baseQuery})";
        }
        else
        {
            parameters.Add(new SqliteParameter("@search", searchQuery.Trim().ToLowerInvariant()));
            filteredCte = $$"""
                scoped AS MATERIALIZED ({{baseQuery}}),
                filtered AS MATERIALIZED (
                    SELECT *
                    FROM scoped
                    WHERE "PlayerName" IN (
                        SELECT "PlayerName"
                        FROM scoped
                        WHERE instr(lower("PlayerName"), @search) > 0
                           OR instr(lower("MapName"), @search) > 0
                           OR instr(lower(COALESCE("ServerName", '')), @search) > 0
                    )
                )
                """;
        }

        parameters.Add(new SqliteParameter("@minRounds", minRounds));
        parameters.Add(new SqliteParameter("@minPlay", minPlay));
        parameters.Add(new SqliteParameter("@offset", offset));
        parameters.Add(new SqliteParameter("@pageSize", pageSize));

        var direction = isAscending ? "ASC" : "DESC";
        var favoriteCte = "";
        var rankedSource = "eligible AS e";

        if (sort is "favserver" or "server" or "favmap" or "map")
        {
            var favoriteColumn = sort is "favserver" or "server" ? "ServerGuid" : "MapName";
            favoriteCte = $$"""
                ,
                favorite_values AS MATERIALIZED (
                    SELECT "PlayerName", "Value"
                    FROM (
                        SELECT
                            "PlayerName",
                            "{{favoriteColumn}}" AS "Value",
                            ROW_NUMBER() OVER (
                                PARTITION BY "PlayerName"
                                ORDER BY SUM("TotalRounds") DESC,
                                         SUM("TotalPlayTimeMinutes") DESC,
                                         "{{favoriteColumn}}" COLLATE NOCASE
                            ) AS "FavoriteRank"
                        FROM filtered
                        GROUP BY "PlayerName", "{{favoriteColumn}}"
                    )
                    WHERE "FavoriteRank" = 1
                )
                """;
            rankedSource = "eligible AS e LEFT JOIN favorite_values AS fv ON fv.\"PlayerName\" = e.\"Name\"";
        }

        var orderBy = sort switch
        {
            "kd" => $"""CASE WHEN e."Deaths" = 0 THEN e."Kills" ELSE CAST(e."Kills" AS REAL) / e."Deaths" END {direction}, e."Kills" {direction}""",
            "kills" => $"""e."Kills" {direction}, e."Score" {direction}""",
            "deaths" => $"""e."Deaths" {direction}, e."Name" COLLATE NOCASE ASC""",
            "kpm" => $"""CASE WHEN e."PlayMin" = 0 THEN 0 ELSE e."Kills" / e."PlayMin" END {direction}, e."Kills" {direction}""",
            "playmin" or "time" => $"""e."PlayMin" {direction}, e."Score" {direction}""",
            "rounds" => $"""e."Rounds" {direction}, e."Score" {direction}""",
            "player" or "name" => $"""e."Name" COLLATE NOCASE {direction}""",
            "favserver" or "server" or "favmap" or "map" =>
                $"""fv."Value" COLLATE NOCASE {direction}, e."Score" DESC""",
            _ => $"""e."Score" {direction}, e."Kills" {direction}"""
        };

        var sql = $$"""
            WITH
            {{filteredCte}},
            player_aggregates AS MATERIALIZED (
                SELECT
                    "PlayerName" AS "Name",
                    SUM("TotalKills") AS "Kills",
                    SUM("TotalDeaths") AS "Deaths",
                    SUM("TotalScore") AS "Score",
                    SUM("TotalPlayTimeMinutes") AS "PlayMin",
                    SUM("TotalRounds") AS "Rounds"
                FROM filtered
                GROUP BY "PlayerName"
            ),
            eligible AS MATERIALIZED (
                SELECT *
                FROM player_aggregates
                WHERE "Rounds" >= @minRounds AND "PlayMin" >= @minPlay
            )
            {{favoriteCte}},
            ranked AS (
                SELECT
                    e.*,
                    ROW_NUMBER() OVER (ORDER BY {{orderBy}}, e."Name" ASC) AS "Rank"
                FROM {{rankedSource}}
            )
            SELECT
                0 AS "RowType",
                (SELECT COUNT(*) FROM eligible) AS "TotalPlayers",
                0 AS "Rank",
                '' AS "Name",
                0 AS "Kills",
                0 AS "Deaths",
                0 AS "Score",
                0.0 AS "PlayMin",
                0 AS "Rounds",
                '' AS "MapName",
                0 AS "MapPlayerCount"
            UNION ALL
            SELECT
                1,
                0,
                "Rank",
                "Name",
                "Kills",
                "Deaths",
                "Score",
                "PlayMin",
                "Rounds",
                '',
                0
            FROM ranked
            WHERE "Rank" > @offset AND "Rank" <= @offset + @pageSize
            UNION ALL
            SELECT
                2,
                0,
                0,
                '',
                0,
                0,
                0,
                0.0,
                0,
                "MapName",
                COUNT(*)
            FROM filtered
            GROUP BY "MapName"
            ORDER BY "RowType", "Rank", "MapPlayerCount" DESC, "MapName"
            """;

        var result = new GlobalLeaderboardQueryResult();
        var connection = dbContext.Database.GetDbConnection();
        var shouldClose = connection.State != ConnectionState.Open;

        if (shouldClose)
        {
            await connection.OpenAsync();
        }

        try
        {
            await using var command = connection.CreateCommand();
#pragma warning disable CA2100 // SQL fragments are generated from allow-listed branches; request values are parameters.
            command.CommandText = sql;
#pragma warning restore CA2100
            command.CommandTimeout = 60;
            foreach (var parameter in parameters)
            {
                command.Parameters.Add(parameter);
            }

            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                switch (reader.GetInt32(0))
                {
                    case 0:
                        result.TotalPlayers = reader.GetInt32(1);
                        break;
                    case 1:
                        result.Players.Add(new PlayerAggRow
                        {
                            Rank = reader.GetInt32(2),
                            Name = reader.GetString(3),
                            Kills = reader.GetInt32(4),
                            Deaths = reader.GetInt32(5),
                            Score = reader.GetInt32(6),
                            PlayMin = reader.GetDouble(7),
                            Rounds = reader.GetInt32(8)
                        });
                        break;
                    case 2:
                        result.Maps.Add(new LeaderboardMapCountRow(
                            reader.GetString(9),
                            reader.GetInt32(10)));
                        break;
                }
            }
        }
        finally
        {
            if (shouldClose)
            {
                await connection.CloseAsync();
            }
        }

        return result;
    }

    private static void AddGuidFilter(
        List<string> filters,
        List<SqliteParameter> parameters,
        IReadOnlyCollection<string> guids,
        string parameterPrefix,
        bool negate)
    {
        if (guids.Count == 0)
        {
            return;
        }

        var parameterNames = new List<string>(guids.Count);
        var index = 0;
        foreach (var guid in guids)
        {
            var parameterName = $"@{parameterPrefix}{index}";
            parameterNames.Add(parameterName);
            parameters.Add(new SqliteParameter(parameterName, guid));
            index++;
        }

        filters.Add($"""p."ServerGuid" {(negate ? "NOT IN" : "IN")} ({string.Join(", ", parameterNames)})""");
    }

    private sealed class GlobalLeaderboardQueryResult
    {
        public int TotalPlayers { get; set; }
        public List<PlayerAggRow> Players { get; } = [];
        public List<LeaderboardMapCountRow> Maps { get; } = [];
    }

    private sealed class PlayerAggRow
    {
        public int Rank { get; set; }
        public required string Name { get; set; }
        public int Kills { get; set; }
        public int Deaths { get; set; }
        public int Score { get; set; }
        public double PlayMin { get; set; }
        public int Rounds { get; set; }
    }

    private readonly record struct LeaderboardMapCountRow(string Name, int PlayerCount);

    private static async Task<Dictionary<string, (string ServerGuid, string MapName)>> LoadFavouriteServersAndMapsAsync(
        IQueryable<api.Data.Entities.PlayerMapStats> playerSource,
        List<string> names)
    {
        var result = new Dictionary<string, (string ServerGuid, string MapName)>(StringComparer.Ordinal);
        if (names.Count == 0) return result;

        var rows = await playerSource
            .Where(pms => names.Contains(pms.PlayerName))
            .GroupBy(pms => new { pms.PlayerName, pms.ServerGuid, pms.MapName })
            .Select(g => new
            {
                g.Key.PlayerName,
                g.Key.ServerGuid,
                g.Key.MapName,
                Rounds = g.Sum(x => x.TotalRounds),
                PlayMin = g.Sum(x => x.TotalPlayTimeMinutes)
            })
            .ToListAsync();

        foreach (var playerRows in rows.GroupBy(r => r.PlayerName))
        {
            var topServer = playerRows
                .GroupBy(x => x.ServerGuid)
                .Select(sg => new { ServerGuid = sg.Key, Rounds = sg.Sum(x => x.Rounds), PlayMin = sg.Sum(x => x.PlayMin) })
                .OrderByDescending(x => x.Rounds)
                .ThenByDescending(x => x.PlayMin)
                .First();

            var topMap = playerRows
                .GroupBy(x => x.MapName)
                .Select(mg => new { MapName = mg.Key, Rounds = mg.Sum(x => x.Rounds), PlayMin = mg.Sum(x => x.PlayMin) })
                .OrderByDescending(x => x.Rounds)
                .ThenByDescending(x => x.PlayMin)
                .First();

            result[playerRows.Key] = (topServer.ServerGuid, topMap.MapName);
        }

        return result;
    }

    private readonly record struct ServerOccupancy(string ServerGuid, double AvgPlayers);

    private static List<string> ParseExcludeTerms(string? exclude)
    {
        if (string.IsNullOrWhiteSpace(exclude)) return [];
        return exclude
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => s.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static HashSet<string> ResolveServerGuids(
        List<string> terms,
        IEnumerable<(string Guid, string Name)> servers)
    {
        var guids = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (terms.Count == 0) return guids;

        var list = servers.ToList();
        foreach (var term in terms)
        {
            foreach (var s in list)
            {
                if (s.Guid.Equals(term, StringComparison.OrdinalIgnoreCase) ||
                    s.Name.Equals(term, StringComparison.OrdinalIgnoreCase))
                {
                    guids.Add(s.Guid);
                }
            }
        }

        return guids;
    }

    // Occupancy is bimodal: a few regularly populated servers sit well above a
    // 0–3 avg tail of empty/bot boxes. The largest gap is that split.
    private static HashSet<string> IdentifyPopulatedServers(
        IReadOnlyList<ServerOccupancy> occupancy,
        double emptyFloor = 3.0,
        double minGap = 3.0)
    {
        var populated = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (occupancy.Count == 0) return populated;

        var sorted = occupancy.OrderBy(o => o.AvgPlayers).ToList();
        var bestGap = 0.0;
        var splitIndex = -1;
        for (var i = 1; i < sorted.Count; i++)
        {
            var gap = sorted[i].AvgPlayers - sorted[i - 1].AvgPlayers;
            if (gap > bestGap)
            {
                bestGap = gap;
                splitIndex = i;
            }
        }

        var candidates = sorted.AsEnumerable();
        if (splitIndex > 0 && bestGap >= minGap)
        {
            var lowerMax = sorted[splitIndex - 1].AvgPlayers;
            if (lowerMax <= emptyFloor)
            {
                candidates = sorted.Skip(splitIndex);
            }
        }

        foreach (var row in candidates.Where(o => o.AvgPlayers > emptyFloor))
        {
            populated.Add(row.ServerGuid);
        }

        return populated;
    }

    private static string FormatMapDisplayName(string? mapName)
    {
        if (string.IsNullOrWhiteSpace(mapName)) return "";
        var words = mapName.Split([' ', '_'], StringSplitOptions.RemoveEmptyEntries);
        for (int i = 0; i < words.Length; i++)
        {
            var word = words[i].ToLowerInvariant();
            if (i > 0 && (word == "of" || word == "the" || word == "and" || word == "in"))
            {
                words[i] = word;
            }
            else
            {
                words[i] = char.ToUpperInvariant(word[0]) + (word.Length > 1 ? word[1..] : "");
            }
        }
        return string.Join(" ", words);
    }

    private static string ExtractClanTag(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var match = System.Text.RegularExpressions.Regex.Match(name, @"^([=\[|#~·].*?[=\]|#~·]|\w+\|)");
        return match.Success ? match.Value : "";
    }

    private static string CleanServerShortName(string name)
    {
        if (string.IsNullOrWhiteSpace(name)) return "";
        var clean = System.Text.RegularExpressions.Regex.Replace(name, @"^\S+\s", "");
        return clean.Length > 20 ? clean[..20] + "…" : clean;
    }

    private static string CountryCodeToFlag(string? countryCode)
    {
        if (string.IsNullOrWhiteSpace(countryCode) || countryCode.Length != 2) return "";
        var code = countryCode.ToUpperInvariant();
        var first = 0x1F1E6 + (code[0] - 'A');
        var second = 0x1F1E6 + (code[1] - 'A');
        return char.ConvertFromUtf32(first) + char.ConvertFromUtf32(second);
    }

    /// <summary>
    /// Gets the ISO week number for a given date.
    /// ISO weeks start on Monday and the first week contains January 4th.
    /// </summary>
    private static (int Year, int Week) GetIsoWeek(DateTime date)
    {
        // Use .NET's ISOWeek helper
        var week = System.Globalization.ISOWeek.GetWeekOfYear(date);
        var year = System.Globalization.ISOWeek.GetYear(date);
        return (year, week);
    }
}
