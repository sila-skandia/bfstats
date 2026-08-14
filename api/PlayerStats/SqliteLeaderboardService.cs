using System.Diagnostics;
using api.Constants;
using api.Gamification.Models;
using api.PlayerTracking;
using api.Servers.Models;
using api.Telemetry;
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

        var kdValues = aggregated.Select(x => x.TotalDeaths > 0 ? (double)x.TotalKills / x.TotalDeaths : (double)x.TotalKills).ToList();
        var scoreValues = aggregated.Select(x => (double)x.TotalScore).ToList();
        var killValues = aggregated.Select(x => (double)x.TotalKills).ToList();
        var hoursValues = aggregated.Select(x => (double)x.MinutesPlayed / 60.0).ToList();
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
