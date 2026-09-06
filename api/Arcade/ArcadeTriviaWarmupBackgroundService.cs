using System.Diagnostics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Arcade;

/// <summary>
/// Keeps the global arcade trivia pool built, so no visitor ever pays to build it.
///
/// The pool build is inherently expensive — it aggregates the whole of PlayerStatsMonthly and
/// PlayerMapStats to rank the top 150 players, and a full GROUP BY cannot be indexed away.
/// The fix is therefore not to make the build cheap enough to sit on a request, it is to keep
/// the build off requests entirely. <see cref="ArcadeTriviaPoolCache"/> serves a stale pool
/// while refreshing behind, which leaves exactly one gap: a pod that has just started has no
/// pool at all, and whoever arrives first would build it synchronously. This service closes
/// that gap by building it during startup.
///
/// Server-scoped pools are not warmed. There is one per tracked server, they are far cheaper
/// (every query is filtered to a single ServerGuid), and warming them all would mean a burst
/// of full-table work against a volume that serves ~691 IOPS. They rely on the cache's
/// serve-stale-and-refresh-behind path instead.
/// </summary>
public class ArcadeTriviaWarmupBackgroundService(
    ArcadeTriviaPoolCache poolCache,
    ILogger<ArcadeTriviaWarmupBackgroundService> logger
) : BackgroundService
{
    /// <summary>
    /// Long enough to stay clear of startup migrations — which may be building indexes — and
    /// the initial burst of traffic, short enough that a freshly rolled pod is serving trivia
    /// from cache within a minute.
    /// </summary>
    private static readonly TimeSpan InitialDelay = TimeSpan.FromSeconds(45);

    /// <summary>
    /// Comfortably inside <see cref="ArcadeTriviaPoolCache.RetainFor"/>, so the cached pool is
    /// replaced long before it could expire and force a request to build one.
    /// </summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Clear any inherited activity context from hosting startup to prevent
        // background job traces from being correlated with unrelated HTTP requests.
        Activity.Current = null;

        logger.LogInformation("ArcadeTriviaWarmupBackgroundService started");

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
            await WarmAsync(stoppingToken);

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

    private async Task WarmAsync(CancellationToken stoppingToken)
    {
        var timer = Stopwatch.StartNew();
        try
        {
            await poolCache.RefreshAsync(null, stoppingToken);
            logger.LogInformation(
                "Arcade trivia global pool warmed in {ElapsedMs}ms", timer.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down.
        }
        catch (Exception ex)
        {
            // A failed warm is not fatal — the request path can still build the pool itself,
            // and the next interval will try again.
            logger.LogWarning(
                "Arcade trivia pool warm failed after {ElapsedMs}ms ({ExceptionType}: {Message})",
                timer.ElapsedMilliseconds, ex.GetType().Name, ex.Message);
        }
    }
}
