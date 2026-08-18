using api.Services.BackgroundJobs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;

namespace api.Controllers;

/// <summary>
/// Admin endpoints for triggering background jobs on-demand.
/// Useful for testing and debugging during development.
/// </summary>
[ApiController]
[Route("stats/admin/jobs")]
[Authorize(Policy = "Admin")]
public class AdminJobsController(
    IDailyAggregateRefreshBackgroundService dailyAggregateRunner,
    IWeeklyCleanupBackgroundService weeklyCleanupRunner,
    IAggregateBackfillBackgroundService aggregateBackfillRunner,
    IServiceScopeFactory scopeFactory,
    ILogger<AdminJobsController> logger
) : ControllerBase
{
    /// <summary>
    /// Trigger the daily aggregate refresh job.
    /// Refreshes: ServerHourlyPatterns, HourlyPlayerPredictions, MapGlobalAverages
    /// </summary>
    [HttpPost("daily-aggregate-refresh")]
    public async Task<IActionResult> TriggerDailyAggregateRefresh(CancellationToken ct)
    {
        logger.LogInformation("Manual trigger: DailyAggregateRefresh");

        try
        {
            await dailyAggregateRunner.RunAsync(ct);
            return Ok(new { message = "Daily aggregate refresh completed successfully" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to run DailyAggregateRefresh");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Trigger the weekly cleanup job.
    /// Removes stale "this_week" best scores and prunes old ServerOnlineCounts.
    /// </summary>
    [HttpPost("weekly-cleanup")]
    public async Task<IActionResult> TriggerWeeklyCleanup(CancellationToken ct)
    {
        logger.LogInformation("Manual trigger: WeeklyCleanup");

        try
        {
            await weeklyCleanupRunner.RunAsync(ct);
            return Ok(new { message = "Weekly cleanup completed successfully" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to run WeeklyCleanup");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    /// <summary>
    /// Trigger aggregate backfill for a specific tier (fire-and-forget).
    /// Tier 1: Players active within 7 days (prioritized)
    /// Tier 2: Players active within 30 days
    /// Tier 3: Players active within 90 days
    /// Tier 4: All remaining players
    /// Returns immediately - check logs for progress.
    /// </summary>
    [HttpPost("aggregate-backfill/{tier:int}")]
    public IActionResult TriggerAggregateBackfillTier(int tier)
    {
        if (tier < 1 || tier > 4)
        {
            return BadRequest(new { error = "Tier must be between 1 and 4" });
        }

        logger.LogInformation("Manual trigger: AggregateBackfill tier {Tier} (fire-and-forget)", tier);

        _ = Task.Run(async () =>
        {
            try
            {
                await aggregateBackfillRunner.RunTierAsync(tier);
                logger.LogInformation("AggregateBackfill tier {Tier} completed successfully", tier);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "AggregateBackfill tier {Tier} failed", tier);
            }
        });

        return Accepted(new { message = $"Aggregate backfill tier {tier} started in background. Check logs for progress." });
    }

    /// <summary>
    /// Trigger full aggregate backfill (all tiers) - fire-and-forget.
    /// This is a long-running operation that processes all historical data.
    /// Returns immediately - check logs for progress.
    /// </summary>
    [HttpPost("aggregate-backfill")]
    public IActionResult TriggerAggregateBackfill()
    {
        logger.LogInformation("Manual trigger: AggregateBackfill (all tiers, fire-and-forget)");

        _ = Task.Run(async () =>
        {
            try
            {
                await aggregateBackfillRunner.RunAsync();
                logger.LogInformation("Full aggregate backfill completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Full aggregate backfill failed");
            }
        });

        return Accepted(new { message = "Full aggregate backfill started in background. Check logs for progress." });
    }

    /// <summary>
    /// Trigger full ServerMapStats backfill from all historical Rounds data (fire-and-forget).
    /// Use this for initial population - daily refresh only updates last 2 months.
    /// Returns immediately - check logs for progress.
    /// </summary>
    [HttpPost("server-map-stats-backfill")]
    public IActionResult TriggerServerMapStatsBackfill()
    {
        logger.LogInformation("Manual trigger: ServerMapStats full backfill (fire-and-forget)");

        _ = Task.Run(async () =>
        {
            try
            {
                await dailyAggregateRunner.BackfillServerMapStatsAsync();
                logger.LogInformation("ServerMapStats full backfill completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "ServerMapStats full backfill failed");
            }
        });

        return Accepted(new { message = "ServerMapStats full backfill started in background. Check logs for progress." });
    }

    /// <summary>
    /// Trigger full MapHourlyPatterns backfill from all historical Rounds data (fire-and-forget).
    /// Use this for initial population - daily refresh only updates last 60 days.
    /// Returns immediately - check logs for progress.
    /// </summary>
    [HttpPost("map-hourly-patterns-backfill")]
    public IActionResult TriggerMapHourlyPatternsBackfill()
    {
        logger.LogInformation("Manual trigger: MapHourlyPatterns full backfill (fire-and-forget)");

        _ = Task.Run(async () =>
        {
            try
            {
                await dailyAggregateRunner.BackfillMapHourlyPatternsAsync();
                logger.LogInformation("MapHourlyPatterns full backfill completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "MapHourlyPatterns full backfill failed");
            }
        });

        return Accepted(new { message = "MapHourlyPatterns full backfill started in background. Check logs for progress." });
    }

    /// <summary>
    /// Trigger all background jobs in sequence (fire-and-forget).
    /// Returns immediately - check logs for progress.
    /// </summary>
    [HttpPost("run-all")]
    public IActionResult TriggerAllJobs()
    {
        logger.LogInformation("Manual trigger: All jobs (fire-and-forget)");

        _ = Task.Run(async () =>
        {
            try
            {
                await dailyAggregateRunner.RunAsync();
                logger.LogInformation("DailyAggregateRefresh completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "DailyAggregateRefresh failed");
            }

            try
            {
                await weeklyCleanupRunner.RunAsync();
                logger.LogInformation("WeeklyCleanup completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "WeeklyCleanup failed");
            }

            logger.LogInformation("All jobs run completed");
        });

        return Accepted(new { message = "All jobs started in background. Check logs for progress." });
    }

    /// <summary>
    /// Trigger manual Server Wrapped aggregate crunching for 2026 (fire-and-forget).
    /// </summary>
    [HttpPost("server-wrapped-crunch")]
    public IActionResult TriggerServerWrappedCrunch()
    {
        logger.LogInformation("Manual trigger: ServerWrappedCrunch (fire-and-forget)");

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<api.Wrapped.IWrappedService>();
            try
            {
                await service.CrunchAllServersWrappedAsync(2026, System.Threading.CancellationToken.None);
                logger.LogInformation("ServerWrappedCrunch completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "ServerWrappedCrunch failed");
            }
        });

        return Accepted(new { message = "Server Wrapped crunching job started in the background." });
    }

    /// <summary>
    /// Trigger manual Player Wrapped aggregate crunching for 2026 (fire-and-forget).
    /// </summary>
    /// <param name="topPlayers">
    /// Optional. Crunch the busiest N players of 2026 by total playtime instead of the configured
    /// allowlist — e.g. <c>?topPlayers=1000</c> to rehearse a full run at a manageable size.
    /// </param>
    [HttpPost("player-wrapped-crunch")]
    public IActionResult TriggerPlayerWrappedCrunch([FromQuery] int? topPlayers = null)
    {
        logger.LogInformation("Manual trigger: PlayerWrappedCrunch (fire-and-forget), topPlayers={TopPlayers}",
            topPlayers?.ToString() ?? "allowlist");

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<api.Wrapped.IWrappedService>();
            try
            {
                await service.CrunchAllPlayersWrappedAsync(2026, System.Threading.CancellationToken.None, topPlayers);
                logger.LogInformation("PlayerWrappedCrunch completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "PlayerWrappedCrunch failed");
            }
        });

        return Accepted(new
        {
            message = topPlayers is > 0
                ? $"Player Wrapped crunching job started in the background for the top {topPlayers} players by playtime."
                : "Player Wrapped crunching job started in the background."
        });
    }

    /// <summary>
    /// Repair tool (fire-and-forget): resets the Neo4j sync watermark for every round/session
    /// on or after <paramref name="fromDate"/>, then drains the resulting backlog through the
    /// normal incremental sync. Intended to be run once, right after the Neo4j PLAYED_WITH /
    /// PLAYS_ON data has been wiped, to rebuild player-relationship data from
    /// <paramref name="fromDate"/> onward using the corrected co-play logic.
    /// Returns immediately - check logs for progress ("Neo4j relationship sync: N rounds
    /// processed so far").
    /// </summary>
    [HttpPost("neo4j-relationships-backfill")]
    public IActionResult TriggerNeo4jRelationshipsBackfill([FromQuery] DateTime? fromDate = null)
    {
        var since = fromDate ?? new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        logger.LogInformation("Manual trigger: Neo4j relationships backfill from {FromDate} (fire-and-forget)", since);

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var relationshipEtl = scope.ServiceProvider.GetRequiredService<api.PlayerRelationships.PlayerRelationshipEtlService>();
            try
            {
                var (roundsReset, sessionsReset) = await relationshipEtl.ResetNeo4jSyncWatermarkAsync(since);
                logger.LogInformation(
                    "Neo4j relationships backfill: reset watermark for {RoundsReset} rounds, {SessionsReset} sessions; draining backlog",
                    roundsReset, sessionsReset);

                var result = await relationshipEtl.SyncPendingRelationshipsAsync();
                await relationshipEtl.SyncPlayerServerRelationshipsAsync();

                logger.LogInformation(
                    "Neo4j relationships backfill completed: {RoundsProcessed} rounds, {RelationshipsProcessed} relationships in {Duration}s",
                    result.RoundsProcessed, result.RelationshipsProcessed, result.Duration.TotalSeconds);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Neo4j relationships backfill failed");
            }
        });

        return Accepted(new { message = $"Neo4j relationships backfill started in background from {since:yyyy-MM-dd}. Check logs for progress." });
    }

    /// <summary>
    /// Trigger manual Profile Wrapped alias-cache crunching for 2026 (fire-and-forget).
    /// Pre-computes and caches Player Wrapped data for every registered alias so
    /// "Your Year in Review" reads are served from cache.
    /// </summary>
    [HttpPost("profile-wrapped-crunch")]
    public IActionResult TriggerProfileWrappedCrunch()
    {
        logger.LogInformation("Manual trigger: ProfileWrappedCrunch (fire-and-forget)");

        _ = Task.Run(async () =>
        {
            using var scope = scopeFactory.CreateScope();
            var service = scope.ServiceProvider.GetRequiredService<api.Wrapped.IWrappedService>();
            try
            {
                await service.CrunchAllProfilesWrappedAsync(2026, System.Threading.CancellationToken.None);
                logger.LogInformation("ProfileWrappedCrunch completed successfully");
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "ProfileWrappedCrunch failed");
            }
        });

        return Accepted(new { message = "Profile Wrapped crunching job started in the background." });
    }
}
