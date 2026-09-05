using api.Data.Entities;
using api.PlayerTracking;
using api.Telemetry;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using NodaTime;
using Serilog.Context;
using System.Diagnostics;
using System.Text;

namespace api.StatsCollectors;

/// <summary>
/// Background service that periodically recalculates monthly aggregate statistics.
/// Uses idempotent delete + rebuild pattern per month to ensure data consistency.
/// </summary>
public class AggregateCalculationService(
    IServiceProvider services,
    api.Services.IAggregateConcurrencyService concurrency,
    ILogger<AggregateCalculationService> logger,
    IClock clock) : BackgroundService
{
    private static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Clear any inherited activity context from hosting startup to prevent
        // background job traces from being correlated with unrelated HTTP requests.
        Activity.Current = null;

        logger.LogInformation("AggregateCalculationService started, waiting {Delay} before first run", StartupDelay);

        // Delay startup to avoid blocking Kestrel initialization
        await Task.Delay(StartupDelay, stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            // Use explicit default parentContext to create a root activity with a fresh traceId.
            // Without this, StartActivity() inherits Activity.Current from the hosting context,
            // causing all background cycles to share a traceId with unrelated HTTP requests.
            using var activity = ActivitySources.AggregateCalculation.StartActivity(
                "AggregateCalculation.Cycle",
                ActivityKind.Internal,
                parentContext: default);
            activity?.SetTag("bulk_operation", "true");
            activity?.SetTag("AggregateCalculation.Cycle", "true"); // Explicit tag for filtering in Program.cs

            var cycleStopwatch = Stopwatch.StartNew();
            try
            {
                using (BulkOperationContext.Begin())
                using (LogContext.PushProperty("bulk_operation", true))
                using (var scope = services.CreateScope())
                {
                    var dbContext = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();

                    var now = clock.GetCurrentInstant().ToDateTimeUtc();
                    var currentYear = now.Year;
                    var currentMonth = now.Month;
                    var currentWeek = System.Globalization.ISOWeek.GetWeekOfYear(now);
                    var isoYear = System.Globalization.ISOWeek.GetYear(now);

                    var results = new Dictionary<string, int>();

                    await concurrency.ExecuteWithPlayerAggregatesLockAsync(async (_) =>
                    {
                        results["monthly"] = await CalculatePlayerStatsMonthly(dbContext, currentYear, currentMonth);
                        await Task.Delay(50, stoppingToken);

                        results["server"] = await CalculatePlayerServerStats(dbContext, isoYear, currentWeek);
                        await Task.Delay(50, stoppingToken);

                        results["map"] = await CalculatePlayerMapStats(dbContext, currentYear, currentMonth);
                    }, stoppingToken);

                    cycleStopwatch.Stop();
                    activity?.SetTag("cycle_duration_ms", cycleStopwatch.ElapsedMilliseconds);
                    activity?.SetTag("monthly_records", results.GetValueOrDefault("monthly"));
                    activity?.SetTag("server_records", results.GetValueOrDefault("server"));
                    activity?.SetTag("map_records", results.GetValueOrDefault("map"));

                    var totalRecords = results.Values.Sum();
                    logger.LogInformation(
                        "Aggregate calculation: {TotalRecords} records (monthly={Monthly}, server={Server}, map={Map}) for {Year}-{Month:00} in {Duration}ms",
                        totalRecords, results.GetValueOrDefault("monthly"), results.GetValueOrDefault("server"),
                        results.GetValueOrDefault("map"), currentYear, currentMonth, cycleStopwatch.ElapsedMilliseconds);
                }
            }
            catch (Exception ex) when (SqliteBusy.IsBusy(ex))
            {
                cycleStopwatch.Stop();
                activity?.SetTag("cycle_duration_ms", cycleStopwatch.ElapsedMilliseconds);
                activity?.SetTag("error", ex.Message);
                logger.LogWarning(
                    "Aggregate calculation skipped due to database lock ({SqliteError})",
                    SqliteBusy.Describe(ex));
            }
            catch (Exception ex)
            {
                cycleStopwatch.Stop();
                activity?.SetTag("cycle_duration_ms", cycleStopwatch.ElapsedMilliseconds);
                activity?.SetTag("error", ex.Message);
                activity?.SetStatus(ActivityStatusCode.Error, $"Aggregate calculation failed: {ex.Message}");
                logger.LogError(ex, "Error during aggregate calculation");
            }

            await Task.Delay(TimeSpan.FromHours(1), stoppingToken);
        }
    }

    /// <summary>
    /// Calculate PlayerStatsMonthly for all players active in the current month.
    /// </summary>
    private async Task<int> CalculatePlayerStatsMonthly(PlayerTrackerDbContext dbContext, int year, int month)
    {
        using var activity = ActivitySources.AggregateCalculation.StartActivity("AggregateCalculation.PlayerStatsMonthly");
        activity?.SetTag("year", year);
        activity?.SetTag("month", month);

        var monthString = month.ToString("00");
        var monthStart = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);
        var startString = monthStart.ToString("yyyy-MM-dd HH:mm:ss");
        var endString = monthEnd.ToString("yyyy-MM-dd HH:mm:ss");

        // Read and project OUTSIDE the transaction. See WriteLockNote at the bottom of
        // this file: the aggregate scan is the expensive half, and running it inside the
        // write transaction is what held the lock for minutes at a time.
        var playerData = await dbContext.Database.SqlQueryRaw<PlayerStatsAggregateData>(@"
            SELECT
                ps.PlayerName,
                COUNT(DISTINCT ps.RoundId) AS TotalRounds,
                SUM(ps.TotalKills) AS TotalKills,
                SUM(ps.TotalDeaths) AS TotalDeaths,
                SUM(ps.TotalScore) AS TotalScore,
                SUM((julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440) AS TotalPlayTimeMinutes,
                MIN(ps.StartTime) AS FirstRoundTime,
                MAX(ps.LastSeenTime) AS LastRoundTime
            FROM PlayerSessions ps
            INNER JOIN Players p ON ps.PlayerName = p.Name
            WHERE ps.StartTime >= {0}
              AND ps.StartTime < {1}
              AND p.AiBot = 0
              AND (ps.IsDeleted = 0 OR ps.IsDeleted IS NULL)
            GROUP BY ps.PlayerName",
            startString, endString).ToListAsync();

        activity?.SetTag("player_count", playerData.Count);

        var now = clock.GetCurrentInstant();
        var records = playerData.Select(p => new PlayerStatsMonthly
        {
            PlayerName = p.PlayerName,
            Year = year,
            Month = month,
            TotalRounds = p.TotalRounds,
            TotalKills = p.TotalKills,
            TotalDeaths = p.TotalDeaths,
            TotalScore = p.TotalScore,
            TotalPlayTimeMinutes = p.TotalPlayTimeMinutes,
            AvgScorePerRound = p.TotalRounds > 0 ? (double)p.TotalScore / p.TotalRounds : 0,
            KdRatio = p.TotalDeaths > 0 ? (double)p.TotalKills / p.TotalDeaths : p.TotalKills,
            KillRate = p.TotalPlayTimeMinutes > 0 ? p.TotalKills / p.TotalPlayTimeMinutes : 0,
            FirstRoundTime = Instant.FromDateTimeUtc(DateTime.SpecifyKind(p.FirstRoundTime, DateTimeKind.Utc)),
            LastRoundTime = Instant.FromDateTimeUtc(DateTime.SpecifyKind(p.LastRoundTime, DateTimeKind.Utc)),
            UpdatedAt = now
        }).ToList();

        await using var transaction = await dbContext.Database.BeginTransactionAsync();
        try
        {
            // Delete existing records for this month. Still atomic with the insert below:
            // readers never observe a half-rebuilt period.
            await dbContext.Database.ExecuteSqlRawAsync(@"
                DELETE FROM ""PlayerStatsMonthly""
                WHERE ""Year"" = {0} AND ""Month"" = {1}",
                year, month);

            // Deliberately still runs the DELETE when there is nothing to insert, so a
            // month that has lost all its sessions clears its stale rows.
            await BulkInsertPlayerStatsMonthly(dbContext, records);
            activity?.SetTag("records_inserted", records.Count);

            await transaction.CommitAsync();
            return records.Count;
        }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                activity?.SetTag("error", ex.Message);
                activity?.SetStatus(ActivityStatusCode.Error, $"Error calculating PlayerStatsMonthly: {ex.Message}");
                if (!SqliteBusy.IsBusy(ex))
                    logger.LogError(ex, "Error calculating PlayerStatsMonthly for {Year}-{Month}", year, monthString);
                throw;
            }
    }

    /// <summary>
    /// Calculate PlayerServerStats for all player-server combinations active in the current ISO week.
    /// Uses weekly buckets for finer granularity in leaderboard queries.
    /// </summary>
    private async Task<int> CalculatePlayerServerStats(PlayerTrackerDbContext dbContext, int year, int week)
    {
        using var activity = ActivitySources.AggregateCalculation.StartActivity("AggregateCalculation.PlayerServerStats");
        activity?.SetTag("year", year);
        activity?.SetTag("week", week);

        var weekString = week.ToString("00");

        // Query aggregated data from PlayerSessions for this ISO week, outside the
        // transaction — see WriteLockNote at the bottom of this file.
        var weekStart = System.Globalization.ISOWeek.ToDateTime(year, week, DayOfWeek.Monday);
        var weekEnd = weekStart.AddDays(7);

        var serverData = await dbContext.Database.SqlQueryRaw<PlayerServerStatsAggregateData>(@"
            SELECT
                ps.PlayerName,
                ps.ServerGuid,
                COUNT(DISTINCT ps.RoundId) AS TotalRounds,
                SUM(ps.TotalKills) AS TotalKills,
                SUM(ps.TotalDeaths) AS TotalDeaths,
                SUM(ps.TotalScore) AS TotalScore,
                SUM((julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440) AS TotalPlayTimeMinutes
            FROM PlayerSessions ps
            INNER JOIN Players p ON ps.PlayerName = p.Name
            WHERE ps.StartTime >= {0}
              AND ps.StartTime < {1}
              AND p.AiBot = 0
              AND (ps.IsDeleted = 0 OR ps.IsDeleted IS NULL)
            GROUP BY ps.PlayerName, ps.ServerGuid",
            weekStart.ToString("yyyy-MM-dd HH:mm:ss"),
            weekEnd.ToString("yyyy-MM-dd HH:mm:ss")).ToListAsync();

        activity?.SetTag("record_count", serverData.Count);

        var now = clock.GetCurrentInstant();
        var records = serverData.Select(p => new PlayerServerStats
        {
            PlayerName = p.PlayerName,
            ServerGuid = p.ServerGuid,
            Year = year,
            Week = week,
            TotalRounds = p.TotalRounds,
            TotalKills = p.TotalKills,
            TotalDeaths = p.TotalDeaths,
            TotalScore = p.TotalScore,
            TotalPlayTimeMinutes = p.TotalPlayTimeMinutes,
            UpdatedAt = now
        }).ToList();

        await using var transaction = await dbContext.Database.BeginTransactionAsync();
        try
        {
            // Delete existing records for this week
            await dbContext.Database.ExecuteSqlRawAsync(@"
                DELETE FROM ""PlayerServerStats""
                WHERE ""Year"" = {0} AND ""Week"" = {1}",
                year, week);

            await BulkInsertPlayerServerStats(dbContext, records);
            activity?.SetTag("records_inserted", records.Count);

            await transaction.CommitAsync();
            return records.Count;
        }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                activity?.SetTag("error", ex.Message);
                activity?.SetStatus(ActivityStatusCode.Error, $"Error calculating PlayerServerStats: {ex.Message}");
                if (!SqliteBusy.IsBusy(ex))
                    logger.LogError(ex, "Error calculating PlayerServerStats for {Year}-W{Week}", year, weekString);
                throw;
            }
    }

    /// <summary>
    /// Calculate PlayerMapStats for all player-map-server combinations active in the current month.
    /// Also calculates global (cross-server) map stats.
    /// </summary>
    private async Task<int> CalculatePlayerMapStats(PlayerTrackerDbContext dbContext, int year, int month)
    {
        using var activity = ActivitySources.AggregateCalculation.StartActivity("AggregateCalculation.PlayerMapStats");
        activity?.SetTag("year", year);
        activity?.SetTag("month", month);

        var monthString = month.ToString("00");
        var monthStart = new DateTime(year, month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd = monthStart.AddMonths(1);
        var startString = monthStart.ToString("yyyy-MM-dd HH:mm:ss");
        var endString = monthEnd.ToString("yyyy-MM-dd HH:mm:ss");

        // Both aggregate scans run outside the transaction — see WriteLockNote at the
        // bottom of this file. This method is the worst offender of the three: it scans
        // PlayerSessions twice, once per-server and once cross-server.
        var mapData = await dbContext.Database.SqlQueryRaw<PlayerMapStatsAggregateData>(@"
                SELECT
                    ps.PlayerName,
                    ps.MapName,
                    ps.ServerGuid,
                    COUNT(DISTINCT ps.RoundId) AS TotalRounds,
                    SUM(ps.TotalKills) AS TotalKills,
                    SUM(ps.TotalDeaths) AS TotalDeaths,
                    SUM(ps.TotalScore) AS TotalScore,
                    SUM((julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440) AS TotalPlayTimeMinutes
                FROM PlayerSessions ps
                INNER JOIN Players p ON ps.PlayerName = p.Name
                WHERE ps.StartTime >= {0}
                  AND ps.StartTime < {1}
                  AND p.AiBot = 0
                  AND (ps.IsDeleted = 0 OR ps.IsDeleted IS NULL)
                GROUP BY ps.PlayerName, ps.MapName, ps.ServerGuid",
                startString, endString).ToListAsync();

        activity?.SetTag("per_server_record_count", mapData.Count);

        // Also query global (cross-server) map stats
        var globalMapData = await dbContext.Database.SqlQueryRaw<PlayerMapStatsAggregateData>(@"
                SELECT
                    ps.PlayerName,
                    ps.MapName,
                    '' AS ServerGuid,
                    COUNT(DISTINCT ps.RoundId) AS TotalRounds,
                    SUM(ps.TotalKills) AS TotalKills,
                    SUM(ps.TotalDeaths) AS TotalDeaths,
                    SUM(ps.TotalScore) AS TotalScore,
                    SUM((julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440) AS TotalPlayTimeMinutes
                FROM PlayerSessions ps
                INNER JOIN Players p ON ps.PlayerName = p.Name
                WHERE ps.StartTime >= {0}
                  AND ps.StartTime < {1}
                  AND p.AiBot = 0
                  AND (ps.IsDeleted = 0 OR ps.IsDeleted IS NULL)
                GROUP BY ps.PlayerName, ps.MapName",
                startString, endString).ToListAsync();

        activity?.SetTag("global_record_count", globalMapData.Count);

        var allMapData = mapData.Concat(globalMapData).ToList();

        var now = clock.GetCurrentInstant();
        var records = allMapData.Select(p => new PlayerMapStats
        {
            PlayerName = p.PlayerName,
            MapName = p.MapName,
            ServerGuid = p.ServerGuid,
            Year = year,
            Month = month,
            TotalRounds = p.TotalRounds,
            TotalKills = p.TotalKills,
            TotalDeaths = p.TotalDeaths,
            TotalScore = p.TotalScore,
            TotalPlayTimeMinutes = p.TotalPlayTimeMinutes,
            UpdatedAt = now
        }).ToList();

        await using var transaction = await dbContext.Database.BeginTransactionAsync();
        try
        {
            // Delete existing records for this month
            await dbContext.Database.ExecuteSqlRawAsync(@"
                DELETE FROM ""PlayerMapStats""
                WHERE ""Year"" = {0} AND ""Month"" = {1}",
                year, month);

            await BulkInsertPlayerMapStats(dbContext, records);
            activity?.SetTag("records_inserted", records.Count);

            await transaction.CommitAsync();
            return records.Count;
        }
            catch (Exception ex)
            {
                await transaction.RollbackAsync();
                activity?.SetTag("error", ex.Message);
                activity?.SetStatus(ActivityStatusCode.Error, $"Error calculating PlayerMapStats: {ex.Message}");
                if (!SqliteBusy.IsBusy(ex))
                    logger.LogError(ex, "Error calculating PlayerMapStats for {Year}-{Month}", year, monthString);
                throw;
            }
    }

    private async Task BulkInsertPlayerStatsMonthly(PlayerTrackerDbContext dbContext, List<PlayerStatsMonthly> records)
    {
        if (records.Count == 0) return;

        const int batchSize = 100;
        for (int batch = 0; batch < records.Count; batch += batchSize)
        {
            var batchRecords = records.Skip(batch).Take(batchSize).ToList();
            var sql = new StringBuilder(@"
                INSERT INTO ""PlayerStatsMonthly""
                (""PlayerName"", ""Year"", ""Month"", ""TotalRounds"", ""TotalKills"", ""TotalDeaths"", ""TotalScore"",
                 ""TotalPlayTimeMinutes"", ""AvgScorePerRound"", ""KdRatio"", ""KillRate"", ""FirstRoundTime"", ""LastRoundTime"", ""UpdatedAt"")
                VALUES ");

            var parameters = new List<object>();
            for (int i = 0; i < batchRecords.Count; i++)
            {
                var r = batchRecords[i];
                if (i > 0) sql.Append(", ");
                var pi = i * 14;
                sql.Append($"(@p{pi}, @p{pi + 1}, @p{pi + 2}, @p{pi + 3}, @p{pi + 4}, @p{pi + 5}, @p{pi + 6}, @p{pi + 7}, @p{pi + 8}, @p{pi + 9}, @p{pi + 10}, @p{pi + 11}, @p{pi + 12}, @p{pi + 13})");
                parameters.AddRange([
                    r.PlayerName, r.Year, r.Month, r.TotalRounds, r.TotalKills, r.TotalDeaths, r.TotalScore,
                    r.TotalPlayTimeMinutes, r.AvgScorePerRound, r.KdRatio, r.KillRate,
                    r.FirstRoundTime.ToString(), r.LastRoundTime.ToString(), r.UpdatedAt.ToString()
                ]);
            }
            sql.Append(';');
            await dbContext.Database.ExecuteSqlRawAsync(sql.ToString(), parameters.ToArray());
        }
    }

    private async Task BulkInsertPlayerServerStats(PlayerTrackerDbContext dbContext, List<PlayerServerStats> records)
    {
        if (records.Count == 0) return;

        const int batchSize = 200;
        for (int batch = 0; batch < records.Count; batch += batchSize)
        {
            var batchRecords = records.Skip(batch).Take(batchSize).ToList();
            var sql = new StringBuilder(@"
                INSERT INTO ""PlayerServerStats""
                (""PlayerName"", ""ServerGuid"", ""Year"", ""Week"", ""TotalRounds"", ""TotalKills"", ""TotalDeaths"", ""TotalScore"", ""TotalPlayTimeMinutes"", ""UpdatedAt"")
                VALUES ");

            var parameters = new List<object>();
            for (int i = 0; i < batchRecords.Count; i++)
            {
                var r = batchRecords[i];
                if (i > 0) sql.Append(", ");
                var pi = i * 10;
                sql.Append($"(@p{pi}, @p{pi + 1}, @p{pi + 2}, @p{pi + 3}, @p{pi + 4}, @p{pi + 5}, @p{pi + 6}, @p{pi + 7}, @p{pi + 8}, @p{pi + 9})");
                parameters.AddRange([
                    r.PlayerName, r.ServerGuid, r.Year, r.Week, r.TotalRounds, r.TotalKills, r.TotalDeaths,
                    r.TotalScore, r.TotalPlayTimeMinutes, r.UpdatedAt.ToString()
                ]);
            }
            sql.Append(';');
            await dbContext.Database.ExecuteSqlRawAsync(sql.ToString(), parameters.ToArray());
        }
    }

    private async Task BulkInsertPlayerMapStats(PlayerTrackerDbContext dbContext, List<PlayerMapStats> records)
    {
        if (records.Count == 0) return;

        const int batchSize = 200;
        for (int batch = 0; batch < records.Count; batch += batchSize)
        {
            var batchRecords = records.Skip(batch).Take(batchSize).ToList();
            var sql = new StringBuilder(@"
                INSERT INTO ""PlayerMapStats""
                (""PlayerName"", ""MapName"", ""ServerGuid"", ""Year"", ""Month"", ""TotalRounds"", ""TotalKills"", ""TotalDeaths"", ""TotalScore"", ""TotalPlayTimeMinutes"", ""UpdatedAt"")
                VALUES ");

            var parameters = new List<object>();
            for (int i = 0; i < batchRecords.Count; i++)
            {
                var r = batchRecords[i];
                if (i > 0) sql.Append(", ");
                var pi = i * 11;
                sql.Append($"(@p{pi}, @p{pi + 1}, @p{pi + 2}, @p{pi + 3}, @p{pi + 4}, @p{pi + 5}, @p{pi + 6}, @p{pi + 7}, @p{pi + 8}, @p{pi + 9}, @p{pi + 10})");
                parameters.AddRange([
                    r.PlayerName, r.MapName, r.ServerGuid, r.Year, r.Month, r.TotalRounds, r.TotalKills,
                    r.TotalDeaths, r.TotalScore, r.TotalPlayTimeMinutes, r.UpdatedAt.ToString()
                ]);
            }
            sql.Append(';');
            await dbContext.Database.ExecuteSqlRawAsync(sql.ToString(), parameters.ToArray());
        }
    }
}

// ---------------------------------------------------------------------------------
// WriteLockNote — why the aggregate scans run outside the transaction.
//
// Each Calculate* method used to open a transaction, DELETE the period, then run its
// aggregate scan of PlayerSessions, then insert. In SQLite a deferred BEGIN takes no
// lock until the first write, so the DELETE acquired the write lock and the scan then
// ran while holding it. SQLite allows exactly one writer, so for the whole duration of
// that scan every other writer in the process was blocked.
//
// Measured in production on the Hetzner volume, 2026-08-15:
//   105,128ms / 75,035ms / 150,098ms per cycle
// against a busy_timeout of 5,000ms. Every stats-collection cycle, ranking
// recalculation and "mark servers offline" that landed in those windows failed with
// SQLITE_BUSY ("database is locked"). The scans are the expensive half — they are
// non-sargable (strftime() per row, so no index is usable) and sweep ~1.7M sessions,
// and on network-attached storage that is minutes of I/O, not seconds.
//
// Reading first and writing second keeps the lock held only for DELETE + INSERT.
// Atomicity is unchanged: the delete and the rebuild are still one transaction, so
// readers never see a half-rebuilt period. The trade is that the data is now read
// slightly before it is written, so a session landing mid-scan lands in the next hourly
// cycle instead of this one — which was already true of anything arriving after the scan.
//
// Still outstanding: the strftime() predicates cannot use an index. Rewriting them as
// range comparisons on StartTime (it is stored as ISO text, so lexicographic ordering
// holds) would let an index serve them, but PlayerSessions currently has no index
// leading with StartTime, so that needs an index to go with it.
// ---------------------------------------------------------------------------------

// DTOs for raw SQL query results
public class PlayerStatsAggregateData
{
    public string PlayerName { get; set; } = string.Empty;
    public int TotalRounds { get; set; }
    public int TotalKills { get; set; }
    public int TotalDeaths { get; set; }
    public int TotalScore { get; set; }
    public double TotalPlayTimeMinutes { get; set; }
    public DateTime FirstRoundTime { get; set; }
    public DateTime LastRoundTime { get; set; }
}

public class PlayerServerStatsAggregateData
{
    public string PlayerName { get; set; } = string.Empty;
    public string ServerGuid { get; set; } = string.Empty;
    public int TotalRounds { get; set; }
    public int TotalKills { get; set; }
    public int TotalDeaths { get; set; }
    public int TotalScore { get; set; }
    public double TotalPlayTimeMinutes { get; set; }
}

public class PlayerMapStatsAggregateData
{
    public string PlayerName { get; set; } = string.Empty;
    public string MapName { get; set; } = string.Empty;
    public string ServerGuid { get; set; } = string.Empty;
    public int TotalRounds { get; set; }
    public int TotalKills { get; set; }
    public int TotalDeaths { get; set; }
    public int TotalScore { get; set; }
    public double TotalPlayTimeMinutes { get; set; }
}
