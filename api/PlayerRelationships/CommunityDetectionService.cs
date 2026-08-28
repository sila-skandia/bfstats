using api.Telemetry;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.PlayerRelationships;

/// <summary>
/// Background service that periodically runs community detection algorithms on the player network.
/// </summary>
public class CommunityDetectionService(
    IServiceProvider serviceProvider,
    ILogger<CommunityDetectionService> logger) : BackgroundService
{
    private static readonly TimeSpan RunTime = TimeSpan.FromHours(2); // 2 AM UTC
    private static readonly TimeSpan RetryInterval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Clear any inherited activity context from hosting startup
        System.Diagnostics.Activity.Current = null;

        logger.LogInformation("Community Detection Service started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var now = DateTime.UtcNow;
                var targetToday = now.Date.Add(RunTime);

                var nextRun = now >= targetToday
                    ? targetToday.AddDays(1)
                    : targetToday;

                var delay = nextRun - now;
                logger.LogInformation("Next community detection scheduled for {NextRun} (in {Delay})", nextRun, delay);

                await Task.Delay(delay, stoppingToken);
                
                using var bulkScope = BulkOperationContext.Begin();
                using var scope = serviceProvider.CreateScope();
                var relationshipService = scope.ServiceProvider.GetRequiredService<IPlayerRelationshipService>();
                
                logger.LogInformation("Running community detection");
                var result = await relationshipService.DetectAndStoreCommunities(stoppingToken);
                logger.LogInformation("Community detection completed: {Result}", result);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // DetectAndStoreCommunities already logged the exception; attaching it
                // here would fire a second Seq @Exception event for the same failure.
                logger.LogError("Error in community detection service: {Message}", ex.Message);
                await Task.Delay(RetryInterval, stoppingToken);
            }
        }

        logger.LogInformation("Community Detection Service stopped");
    }
}