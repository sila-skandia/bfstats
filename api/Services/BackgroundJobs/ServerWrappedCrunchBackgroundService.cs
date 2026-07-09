using System;
using System.Threading;
using System.Threading.Tasks;
using api.Wrapped;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Services.BackgroundJobs;

/// <summary>
/// Background service that schedules and executes the Server Wrapped stats calculations.
/// Runs once daily at 5 AM UTC (1 hour after the daily aggregates refresh).
/// </summary>
public class ServerWrappedCrunchBackgroundService(
    IServiceScopeFactory scopeFactory,
    ILogger<ServerWrappedCrunchBackgroundService> logger
) : BackgroundService
{
    private static readonly TimeSpan RunTime = TimeSpan.FromHours(5); // 5 AM UTC
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ServerWrappedCrunchBackgroundService started");

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
                logger.LogInformation("Next Server Wrapped pre-computation scheduled for {NextRun} (in {Delay})", nextRun, delay);

                await Task.Delay(delay, stoppingToken);

                logger.LogInformation("Starting scheduled Server Wrapped pre-computation...");
                using var scope = scopeFactory.CreateScope();
                var wrappedService = scope.ServiceProvider.GetRequiredService<IWrappedService>();
                
                // Crunch stats for the current year (2026)
                await wrappedService.CrunchAllServersWrappedAsync(2026, stoppingToken);
                logger.LogInformation("Scheduled Server Wrapped pre-computation finished.");
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error occurred in ServerWrappedCrunchBackgroundService");
                await Task.Delay(CheckInterval, stoppingToken);
            }
        }

        logger.LogInformation("ServerWrappedCrunchBackgroundService stopped");
    }
}
