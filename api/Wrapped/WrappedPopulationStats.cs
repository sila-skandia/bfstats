using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using api.PlayerTracking;
using api.Telemetry;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NodaTime;

namespace api.Wrapped;

/// <summary>
/// Population-wide leaderboards for a single Wrapped year, computed once and shared by every
/// player's calculation.
///
/// Every rank/percentile in Player Wrapped is "how many other players beat this number" — the
/// underlying aggregate is identical for all players in a run, only the comparison threshold
/// changes. Computing it per player meant ~40 whole-table GROUP BY scans per player (six over
/// PlayerStatsMonthly alone), which is what made a single on-demand Wrapped take ~20s and would
/// make a 30k-player crunch take days. Here each population aggregate is one scan per run, the
/// results are held as sorted arrays, and each player's rank becomes a binary search.
///
/// Ranks use standard competition ranking: (count of players strictly better) + 1, so ties share
/// a rank.
/// </summary>
public sealed class WrappedPopulationStats
{
    public required int Year { get; init; }

    // --- PlayerStatsMonthly, whole population for the year -------------------------------------

    /// <summary>Per-player SUM(TotalScore), ascending. Drives the global score rank.</summary>
    public required int[] GlobalScoresAsc { get; init; }

    /// <summary>Per-player SUM(TotalKills), ascending. Drives the global kills rank.</summary>
    public required int[] GlobalKillsAsc { get; init; }

    /// <summary>SUM(TotalRounds) for players with >= 5 rounds, ascending. Percentile cohort.</summary>
    public required int[] EligibleRoundsAsc { get; init; }

    /// <summary>SUM(TotalKills) for players with >= 5 rounds, ascending.</summary>
    public required int[] EligibleKillsAsc { get; init; }

    /// <summary>SUM(TotalPlayTimeMinutes) for players with >= 5 rounds, ascending.</summary>
    public required double[] EligiblePlaytimeAsc { get; init; }

    /// <summary>K/D for players with >= 5 rounds and >= 20 kills, ascending. Its own cohort.</summary>
    public required double[] EligibleKdAsc { get; init; }

    // --- PlayerServerStats, per server for the year ---------------------------------------------

    /// <summary>Per-server, per-player SUM(TotalScore) ascending. Drives the per-server score rank.</summary>
    public required Dictionary<string, int[]> ServerScoresAsc { get; init; }

    /// <summary>Per-server, per-player SUM(TotalKills) ascending.</summary>
    public required Dictionary<string, int[]> ServerKillsAsc { get; init; }

    // --- PlayerAchievements: round placements in the year ---------------------------------------

    /// <summary>Per-player round_placement counts across all servers, ascending.</summary>
    public required int[] GlobalPlacementCountsAsc { get; init; }

    /// <summary>Per-server round_placement counts per player, ascending.</summary>
    public required Dictionary<string, int[]> ServerPlacementCountsAsc { get; init; }

    /// <summary>Each player's own round_placement count, all servers. Saves a per-player COUNT.</summary>
    public required Dictionary<string, int> PlayerPlacementTotals { get; init; }

    /// <summary>Each player's own round_placement count keyed by "serverGuid\nplayerName".</summary>
    public required Dictionary<string, int> PlayerPlacementsByServer { get; init; }

    // --- PlayerAchievements: kill streaks in the year -------------------------------------------

    /// <summary>Every resolved kill-streak value in the year across all servers, ascending.</summary>
    public required int[] GlobalStreakValuesAsc { get; init; }

    /// <summary>Every resolved kill-streak value in the year, per server, ascending.</summary>
    public required Dictionary<string, int[]> ServerStreakValuesAsc { get; init; }

    // --- ServerPlayerRankings, all-time (not year-scoped, matching the existing behaviour) -------

    /// <summary>Per-server, per-player SUM(TotalScore) ascending, all-time.</summary>
    public required Dictionary<string, int[]> RankingScoresAsc { get; init; }

    /// <summary>Server guid -> display name, so the rankings section needs no extra query.</summary>
    public required Dictionary<string, string> ServerNames { get; init; }

    public int EligiblePlayerCount => EligibleRoundsAsc.Length;

    public int KdEligiblePlayerCount => EligibleKdAsc.Length;

    public static string ServerPlayerKey(string serverGuid, string playerName) => $"{serverGuid}\n{playerName}";

    /// <summary>Number of entries strictly less than <paramref name="value"/>.</summary>
    public static int CountLess<T>(T[] sortedAsc, T value) where T : IComparable<T>
    {
        int lo = 0, hi = sortedAsc.Length;
        while (lo < hi)
        {
            int mid = (int)(((uint)lo + (uint)hi) >> 1);
            if (sortedAsc[mid].CompareTo(value) < 0) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }

    /// <summary>Number of entries strictly greater than <paramref name="value"/>.</summary>
    public static int CountGreater<T>(T[] sortedAsc, T value) where T : IComparable<T>
    {
        int lo = 0, hi = sortedAsc.Length;
        while (lo < hi)
        {
            int mid = (int)(((uint)lo + (uint)hi) >> 1);
            if (sortedAsc[mid].CompareTo(value) <= 0) lo = mid + 1;
            else hi = mid;
        }
        return sortedAsc.Length - lo;
    }

    /// <summary>Percentage of the cohort scoring strictly below <paramref name="value"/>.</summary>
    public static double Percentile<T>(T[] cohortAsc, T value, int cohortSize) where T : IComparable<T>
    {
        if (cohortSize <= 0) return 0.0;
        return CountLess(cohortAsc, value) * 100.0 / cohortSize;
    }

    public static int[] SortedAsc(IEnumerable<int> values)
    {
        var arr = values.ToArray();
        Array.Sort(arr);
        return arr;
    }

    public static double[] SortedAsc(IEnumerable<double> values)
    {
        var arr = values.ToArray();
        Array.Sort(arr);
        return arr;
    }
}

/// <summary>
/// Builds <see cref="WrappedPopulationStats"/> straight off the ADO.NET reader. These are
/// whole-table aggregates whose rows are consumed once into primitive arrays, so EF entity
/// materialisation and change tracking would be pure overhead here.
/// </summary>
public static class WrappedPopulationStatsBuilder
{
    public static async Task<WrappedPopulationStats> BuildAsync(
        PlayerTrackerDbContext dbContext,
        int year,
        ILogger? logger = null,
        CancellationToken ct = default)
    {
        using var activity = ActivitySources.Wrapped.StartActivity("Wrapped.BuildPopulationStats");
        activity?.SetTag("wrapped.year", year);
        var sw = Stopwatch.StartNew();

        var startInstant = Instant.FromDateTimeUtc(new DateTime(year, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var endInstant = Instant.FromDateTimeUtc(new DateTime(year + 1, 1, 1, 0, 0, 0, DateTimeKind.Utc));
        var startText = InstantText(startInstant);
        var endText = InstantText(endInstant);

        var connection = dbContext.Database.GetDbConnection();
        bool wasClosed = connection.State == System.Data.ConnectionState.Closed;
        if (wasClosed) await connection.OpenAsync(ct);

        try
        {
            var monthly = await BuildMonthlyAsync(connection, year, ct);
            var serverStats = await BuildServerStatsAsync(connection, year, ct);
            var placements = await BuildPlacementsAsync(connection, startText, endText, ct);
            var streaks = await BuildStreaksAsync(connection, startText, endText, ct);
            var rankings = await BuildRankingScoresAsync(connection, ct);
            var serverNames = await BuildServerNamesAsync(connection, ct);

            var stats = new WrappedPopulationStats
            {
                Year = year,
                GlobalScoresAsc = monthly.ScoresAsc,
                GlobalKillsAsc = monthly.KillsAsc,
                EligibleRoundsAsc = monthly.EligibleRoundsAsc,
                EligibleKillsAsc = monthly.EligibleKillsAsc,
                EligiblePlaytimeAsc = monthly.EligiblePlaytimeAsc,
                EligibleKdAsc = monthly.EligibleKdAsc,
                ServerScoresAsc = serverStats.ScoresAsc,
                ServerKillsAsc = serverStats.KillsAsc,
                GlobalPlacementCountsAsc = placements.GlobalCountsAsc,
                ServerPlacementCountsAsc = placements.ServerCountsAsc,
                PlayerPlacementTotals = placements.PlayerTotals,
                PlayerPlacementsByServer = placements.PlayerByServer,
                GlobalStreakValuesAsc = streaks.GlobalAsc,
                ServerStreakValuesAsc = streaks.ServerAsc,
                RankingScoresAsc = rankings,
                ServerNames = serverNames
            };

            activity?.SetTag("wrapped.population.player_count", stats.GlobalScoresAsc.Length);
            activity?.SetTag("wrapped.population.eligible_count", stats.EligiblePlayerCount);
            activity?.SetTag("wrapped.population.streak_count", stats.GlobalStreakValuesAsc.Length);
            activity?.SetTag("wrapped.population.build_ms", sw.Elapsed.TotalMilliseconds);
            logger?.LogInformation(
                "Built Wrapped population stats for {Year} in {ElapsedMs}ms ({PlayerCount} players, {StreakCount} kill streaks)",
                year, (long)sw.Elapsed.TotalMilliseconds, stats.GlobalScoresAsc.Length, stats.GlobalStreakValuesAsc.Length);

            return stats;
        }
        finally
        {
            if (wasClosed) await connection.CloseAsync();
        }
    }

    /// <summary>
    /// Matches the Instant -> TEXT conversion configured in PlayerTrackerDbContext, so raw SQL
    /// compares against AchievedAt the same way EF does.
    /// </summary>
    private static string InstantText(Instant instant) =>
        NodaTime.Text.InstantPattern.ExtendedIso.Format(instant);

    private sealed record MonthlyArrays(
        int[] ScoresAsc,
        int[] KillsAsc,
        int[] EligibleRoundsAsc,
        int[] EligibleKillsAsc,
        double[] EligiblePlaytimeAsc,
        double[] EligibleKdAsc);

    private static async Task<MonthlyArrays> BuildMonthlyAsync(DbConnection connection, int year, CancellationToken ct)
    {
        // One scan replaces six per-player scans (score rank, kills rank, and the four
        // percentiles). The eligibility filters are applied here rather than in SQL so a single
        // pass feeds every cohort.
        var scores = new List<int>();
        var kills = new List<int>();
        var eligibleRounds = new List<int>();
        var eligibleKills = new List<int>();
        var eligiblePlaytime = new List<double>();
        var eligibleKd = new List<double>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT
                SUM(TotalScore)            AS s,
                SUM(TotalKills)            AS k,
                SUM(TotalRounds)           AS r,
                SUM(TotalDeaths)           AS d,
                SUM(TotalPlayTimeMinutes)  AS pt
            FROM PlayerStatsMonthly
            WHERE Year = $year
            GROUP BY PlayerName";
        AddParam(cmd, "$year", year);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            int s = reader.IsDBNull(0) ? 0 : reader.GetInt32(0);
            int k = reader.IsDBNull(1) ? 0 : reader.GetInt32(1);
            int r = reader.IsDBNull(2) ? 0 : reader.GetInt32(2);
            int d = reader.IsDBNull(3) ? 0 : reader.GetInt32(3);
            double pt = reader.IsDBNull(4) ? 0.0 : reader.GetDouble(4);

            scores.Add(s);
            kills.Add(k);

            if (r >= 5)
            {
                eligibleRounds.Add(r);
                eligibleKills.Add(k);
                eligiblePlaytime.Add(pt);

                if (k >= 20)
                {
                    // Same expression as the SQL it replaces: CAST(kills AS REAL) / MAX(1, deaths).
                    eligibleKd.Add((double)k / Math.Max(1, d));
                }
            }
        }

        return new MonthlyArrays(
            WrappedPopulationStats.SortedAsc(scores),
            WrappedPopulationStats.SortedAsc(kills),
            WrappedPopulationStats.SortedAsc(eligibleRounds),
            WrappedPopulationStats.SortedAsc(eligibleKills),
            WrappedPopulationStats.SortedAsc(eligiblePlaytime),
            WrappedPopulationStats.SortedAsc(eligibleKd));
    }

    private sealed record ServerStatArrays(
        Dictionary<string, int[]> ScoresAsc,
        Dictionary<string, int[]> KillsAsc);

    private static async Task<ServerStatArrays> BuildServerStatsAsync(DbConnection connection, int year, CancellationToken ct)
    {
        var scores = new Dictionary<string, List<int>>();
        var kills = new Dictionary<string, List<int>>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT ServerGuid, SUM(TotalScore) AS s, SUM(TotalKills) AS k
            FROM PlayerServerStats
            WHERE Year = $year
            GROUP BY ServerGuid, PlayerName";
        AddParam(cmd, "$year", year);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var guid = reader.GetString(0);
            Add(scores, guid, reader.IsDBNull(1) ? 0 : reader.GetInt32(1));
            Add(kills, guid, reader.IsDBNull(2) ? 0 : reader.GetInt32(2));
        }

        return new ServerStatArrays(Freeze(scores), Freeze(kills));
    }

    private sealed record PlacementArrays(
        int[] GlobalCountsAsc,
        Dictionary<string, int[]> ServerCountsAsc,
        Dictionary<string, int> PlayerTotals,
        Dictionary<string, int> PlayerByServer);

    private static async Task<PlacementArrays> BuildPlacementsAsync(
        DbConnection connection, string startText, string endText, CancellationToken ct)
    {
        var playerTotals = new Dictionary<string, int>();
        var playerByServer = new Dictionary<string, int>();
        var perServer = new Dictionary<string, List<int>>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT ServerGuid, PlayerName, COUNT(*) AS c
            FROM PlayerAchievements
            WHERE AchievementType = 'round_placement'
              AND AchievedAt >= $start AND AchievedAt < $end
            GROUP BY ServerGuid, PlayerName";
        AddParam(cmd, "$start", startText);
        AddParam(cmd, "$end", endText);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var guid = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var name = reader.GetString(1);
            var count = reader.GetInt32(2);

            Add(perServer, guid, count);
            playerByServer[WrappedPopulationStats.ServerPlayerKey(guid, name)] = count;
            playerTotals[name] = playerTotals.GetValueOrDefault(name) + count;
        }

        return new PlacementArrays(
            WrappedPopulationStats.SortedAsc(playerTotals.Values),
            Freeze(perServer),
            playerTotals,
            playerByServer);
    }

    private sealed record StreakArrays(int[] GlobalAsc, Dictionary<string, int[]> ServerAsc);

    private static async Task<StreakArrays> BuildStreaksAsync(
        DbConnection connection, string startText, string endText, CancellationToken ct)
    {
        // Deliberately LIKE rather than a range over AchievementId. A range does let SQLite seek
        // IX_PlayerAchievements_AchievementId - but the kill_streak_* prefix matches ~65k rows,
        // each then needing a random row lookup for Metadata. Driving off the AchievedAt range
        // instead keeps those lookups in rowid order, which is roughly insertion order here.
        // Measured on production data: LIKE 72ms, range 700ms.
        var global = new List<int>();
        var perServer = new Dictionary<string, List<int>>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT ServerGuid, AchievementId, Metadata
            FROM PlayerAchievements
            WHERE AchievedAt >= $start AND AchievedAt < $end
              AND AchievementId LIKE 'kill\_streak\_%' ESCAPE '\'";
        AddParam(cmd, "$start", startText);
        AddParam(cmd, "$end", endText);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var guid = reader.IsDBNull(0) ? "" : reader.GetString(0);
            var achievementId = reader.GetString(1);
            var metadata = reader.IsDBNull(2) ? null : reader.GetString(2);

            var value = ResolveStreakValue(achievementId, metadata);
            global.Add(value);
            Add(perServer, guid, value);
        }

        return new StreakArrays(WrappedPopulationStats.SortedAsc(global), Freeze(perServer));
    }

    /// <summary>
    /// The achievement id only records the tier crossed (kill_streak_25), so the real streak comes
    /// from the metadata when it's there. Same resolution the per-player path uses.
    /// </summary>
    public static int ResolveStreakValue(string achievementId, string? metadata)
    {
        var actual = WrappedService.GetStreakValueFromId(achievementId);
        if (!string.IsNullOrEmpty(metadata))
        {
            try
            {
                var doc = JsonDocument.Parse(metadata);
                if (doc.RootElement.TryGetProperty("actual_streak", out var val)) actual = val.GetInt32();
            }
            catch { }
        }
        return actual;
    }

    private static async Task<Dictionary<string, int[]>> BuildRankingScoresAsync(DbConnection connection, CancellationToken ct)
    {
        // Deliberately not year-scoped - ServerPlayerRankings ranks are all-time, matching the
        // per-server query this replaces.
        var scores = new Dictionary<string, List<int>>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = @"
            SELECT ServerGuid, SUM(TotalScore) AS t
            FROM ServerPlayerRankings
            GROUP BY ServerGuid, PlayerName";

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            Add(scores, reader.GetString(0), reader.IsDBNull(1) ? 0 : reader.GetInt32(1));
        }

        return Freeze(scores);
    }

    private static async Task<Dictionary<string, string>> BuildServerNamesAsync(DbConnection connection, CancellationToken ct)
    {
        var names = new Dictionary<string, string>();

        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT Guid, Name FROM Servers";

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            names[reader.GetString(0)] = reader.IsDBNull(1) ? "Unknown Server" : reader.GetString(1);
        }

        return names;
    }

    private static void Add(Dictionary<string, List<int>> map, string key, int value)
    {
        if (!map.TryGetValue(key, out var list))
        {
            list = new List<int>();
            map[key] = list;
        }
        list.Add(value);
    }

    private static Dictionary<string, int[]> Freeze(Dictionary<string, List<int>> map)
    {
        var result = new Dictionary<string, int[]>(map.Count);
        foreach (var (key, list) in map)
        {
            result[key] = WrappedPopulationStats.SortedAsc(list);
        }
        return result;
    }

    private static void AddParam(DbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
