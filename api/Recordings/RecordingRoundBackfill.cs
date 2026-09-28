using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Recordings;

/// <summary>
/// Keeps the rounds up to date in the background (features/replay-feed, "Rounds"): a minute
/// after start-up and every six hours, the recordings shared before there were fingerprints,
/// or under an older version of one, have theirs read from their files, one at a time; every
/// recording not yet compared under the current settings is compared; and every round is
/// checked against its links. An upload finds its own round at once; this catches what came
/// before, what an upload's own attempt missed, and a change of settings.
/// </summary>
public sealed class RecordingRoundBackfill(
    IServiceScopeFactory scopes,
    ILogger<RecordingRoundBackfill> logger) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromHours(6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Out of the way of start-up's own work and the file check's.
            await Task.Delay(TimeSpan.FromMinutes(1), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await using var scope = scopes.CreateAsyncScope();
                    await scope.ServiceProvider.GetRequiredService<IRecordingRoundService>().BackfillAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Recording rounds: the background pass failed; trying again in {Hours} hours", Every.TotalHours);
                }
                await Task.Delay(Every, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }
}
