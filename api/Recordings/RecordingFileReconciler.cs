using api.PlayerTracking;
using api.Recordings.Models;
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
/// file is back as present; it also clears out uploads that never finished. Then it reads which
/// recorder wrote each recording shared before that was kept (features/recording-source): the
/// first line of each file, a few KB however large the file is.
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
                    await BackfillSourcesAsync(stoppingToken);
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

    /// <summary>
    /// The source of every recording on disk whose source is not known yet, from its header
    /// (features/recording-source). One file at a time, its first line only; a file that cannot
    /// be read stays unknown and is tried again next pass. The number of rows given a source.
    /// </summary>
    internal async Task<int> BackfillSourcesAsync(CancellationToken ct)
    {
        if (!storage.Available) return 0;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
        var unread = await db.Recordings.AsNoTracking()
            .Where(r => r.Source == RecordingSource.Unknown && !r.FileMissing)
            .Select(r => new { r.Id, r.Slug })
            .ToListAsync(ct);
        if (unread.Count == 0) return 0;
        var found = new Dictionary<RecordingSource, List<int>>();
        foreach (var row in unread)
        {
            var source = await RecordingInspector.ReadSourceAsync(storage.RecordingPath(row.Slug), ct);
            if (source == RecordingSource.Unknown) continue;
            (found.TryGetValue(source, out var ids) ? ids : found[source] = []).Add(row.Id);
        }
        foreach (var (source, ids) in found)
        {
            await db.Recordings.Where(r => ids.Contains(r.Id))
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.Source, source), ct);
        }
        var given = found.Values.Sum(ids => ids.Count);
        logger.LogInformation(
            "Recordings: read the source of {Given} of {Unread} recordings ({Servers} server)",
            given, unread.Count, found.GetValueOrDefault(RecordingSource.Server)?.Count ?? 0);
        return given;
    }
}
