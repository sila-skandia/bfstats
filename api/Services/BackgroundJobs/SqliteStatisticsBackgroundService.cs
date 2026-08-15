using System.Diagnostics;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Services.BackgroundJobs;

/// <summary>
/// Keeps the SQLite query planner's statistics current by running PRAGMA optimize.
///
/// Why this exists: the database shipped for years with no sqlite_stat1 table at all —
/// ANALYZE had never been run. Without it SQLite falls back to hardcoded selectivity
/// guesses, and it guesses badly here. The player page's average-ping query
/// (PlayerStatsService.GetAveragePingFromSessions) was driven off
/// IX_PlayerSessions_ServerGuid_StartTime_MapName, walking every session on the server
/// for six months — 19,400 rows — to average the 19 rows that actually belonged to the
/// player. Measured in production: 6,018ms of a 6,240ms request. With statistics present
/// the planner switches to IX_PlayerSessions_PlayerName_ServerGuid_SessionId and touches
/// those 19 rows.
///
/// That mis-plan was survivable on the old OS disk and is not on the network-attached
/// volume: the same 19,400 row fetches cost ~8ms warm on local NVMe and ~6s cold when
/// every miss is a network round trip. Correct plans matter far more than they used to.
///
/// PRAGMA optimize (rather than a bare ANALYZE) only re-analyses tables whose statistics
/// are missing or whose row counts have moved materially, so steady-state runs are close
/// to free. PRAGMA analysis_limit is set per-connection by
/// <see cref="SqliteConnectionInterceptor"/> and bounds the sampling.
/// </summary>
public class SqliteStatisticsBackgroundService(
    IServiceScopeFactory scopeFactory,
    ILogger<SqliteStatisticsBackgroundService> logger
) : BackgroundService
{
    /// <summary>
    /// Delay before the first run. Long enough to stay clear of startup migrations and
    /// the initial burst of traffic, short enough that a pod that has just been rolled
    /// is planning properly within a couple of minutes.
    /// </summary>
    private static readonly TimeSpan InitialDelay = TimeSpan.FromMinutes(2);

    private static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Clear any inherited activity context from hosting startup to prevent
        // background job traces from being correlated with unrelated HTTP requests.
        Activity.Current = null;

        logger.LogInformation("SqliteStatisticsBackgroundService started");

        try
        {
            await Task.Delay(InitialDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunOptimizeAsync(stoppingToken);

            try
            {
                await Task.Delay(Interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    private async Task RunOptimizeAsync(CancellationToken stoppingToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();

            var stopwatch = Stopwatch.StartNew();
            await dbContext.Database.ExecuteSqlRawAsync("PRAGMA optimize;", stoppingToken);
            stopwatch.Stop();

            logger.LogInformation(
                "SQLite PRAGMA optimize completed in {ElapsedMs}ms",
                stopwatch.ElapsedMilliseconds);
        }
        catch (OperationCanceledException)
        {
            // Shutting down — nothing to report.
        }
        catch (Exception ex)
        {
            // Statistics are an optimisation, never a correctness requirement. A failure
            // here must not take the service down or stop later attempts.
            logger.LogWarning(ex, "SQLite PRAGMA optimize failed; query plans may be stale");
        }
    }
}
