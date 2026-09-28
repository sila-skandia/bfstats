using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace api.Recordings;

/// <summary>
/// Keeps the feed to what is on disk (features/replay-feed). The recordings live on the
/// node's root disk, which nothing backs up: a rebuilt node comes back with the database
/// (on its own volume) and none of the files. At start-up and every few hours this marks a
/// recording whose file has gone as missing, which takes it out of the feed, and one whose
/// file is back as present; it also clears out uploads that never finished.
/// </summary>
public sealed class RecordingFileReconciler(
    IServiceScopeFactory scopes,
    IRecordingStorage storage,
    ILogger<RecordingFileReconciler> logger) : BackgroundService
{
    private static readonly TimeSpan Every = TimeSpan.FromHours(6);
    private static readonly TimeSpan StaleUpload = TimeSpan.FromHours(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            // Out of the way of start-up's own work.
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await ReconcileAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogWarning(ex, "Recording file check failed; trying again in {Hours} hours", Every.TotalHours);
                }
                await Task.Delay(Every, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    internal async Task ReconcileAsync(CancellationToken ct)
    {
        // No directory at all is a volume not mounted, not every file gone: the
        // recordings stay as they are until it is back.
        if (!storage.Available)
        {
            logger.LogWarning("The recordings directory {Root} is not there; the file check waits for it", storage.Root);
            return;
        }
        var swept = storage.SweepIncoming(StaleUpload);
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
        var rows = await db.Recordings.Select(r => new { r.Id, r.Slug, r.FileMissing }).ToListAsync(ct);
        var gone = rows.Where(r => !r.FileMissing && !storage.Exists(r.Slug)).Select(r => r.Id).ToList();
        var back = rows.Where(r => r.FileMissing && storage.Exists(r.Slug)).Select(r => r.Id).ToList();
        if (gone.Count > 0)
        {
            await db.Recordings.Where(r => gone.Contains(r.Id))
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.FileMissing, true), ct);
        }
        if (back.Count > 0)
        {
            await db.Recordings.Where(r => back.Contains(r.Id))
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.FileMissing, false), ct);
        }
        if (gone.Count + back.Count + swept > 0)
        {
            logger.LogWarning(
                "Recordings: {Gone} files missing, {Back} back, {Swept} unfinished uploads removed",
                gone.Count, back.Count, swept);
        }
    }
}
