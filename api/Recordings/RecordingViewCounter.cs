using System.Threading.Channels;
using api.PlayerTracking;
using api.Recordings.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NodaTime;

namespace api.Recordings;

/// <summary>Counts a recording's views (features/replay-feed).</summary>
public interface IRecordingViewCounter
{
    /// <summary>Queues one watching. False when the queue is full: a view is dropped rather
    /// than a request slowed.</summary>
    bool Enqueue(int recordingId, string viewerKey);
}

/// <summary>
/// Views are written in batches, a few seconds apart, not one UPDATE per request: the
/// hourly aggregate sweeps hold long write transactions on this database, and a request
/// waiting out one would hold a pooled connection with it (deploy/PRODUCTION_ISSUES.md). A
/// batch that meets a busy database tries again; one that still cannot land is dropped
/// with a warning. A viewer counts once per <see cref="RecordingsOptions.ViewWindowHours"/>.
/// </summary>
public sealed class RecordingViewCounter(
    IServiceScopeFactory scopes,
    IClock clock,
    IOptions<RecordingsOptions> options,
    ILogger<RecordingViewCounter> logger) : BackgroundService, IRecordingViewCounter
{
    private const int MaxBatch = 500;
    private static readonly TimeSpan Gather = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan[] Retries = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(30)];

    private readonly Channel<(int RecordingId, string ViewerKey)> queue =
        Channel.CreateBounded<(int RecordingId, string ViewerKey)>(new BoundedChannelOptions(10_000)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        });

    public bool Enqueue(int recordingId, string viewerKey) => queue.Writer.TryWrite((recordingId, viewerKey));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var batch = new List<(int RecordingId, string ViewerKey)>();
        try
        {
            while (await queue.Reader.WaitToReadAsync(stoppingToken))
            {
                // A moment for the rest of a burst, so that it lands as one transaction.
                await Task.Delay(Gather, stoppingToken);
                while (batch.Count < MaxBatch && queue.Reader.TryRead(out var view)) batch.Add(view);
                await FlushWithRetriesAsync(batch, stoppingToken);
                batch.Clear();
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    private async Task FlushWithRetriesAsync(List<(int RecordingId, string ViewerKey)> batch, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await FlushAsync(batch, ct);
                return;
            }
            catch (Exception ex) when (IsBusy(ex) && attempt < Retries.Length)
            {
                await Task.Delay(Retries[attempt], ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Dropped {Count} recording views the database would not take", batch.Count);
                return;
            }
        }
    }

    private static bool IsBusy(Exception ex) =>
        ex is SqliteException { SqliteErrorCode: 5 or 6 } || ex.InnerException is SqliteException { SqliteErrorCode: 5 or 6 };

    /// <summary>Counts the batch: each viewer once a window, per recording still there.
    /// Returns how many counted.</summary>
    internal async Task<int> FlushAsync(IReadOnlyCollection<(int RecordingId, string ViewerKey)> views, CancellationToken ct)
    {
        if (views.Count == 0) return 0;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
        var now = clock.GetCurrentInstant();
        var window = Duration.FromHours(options.Value.ViewWindowHours);

        var distinct = views.Distinct().ToList();
        var recordingIds = distinct.Select(v => v.RecordingId).Distinct().ToList();
        var keys = distinct.Select(v => v.ViewerKey).Distinct().ToList();
        var live = (await db.Recordings.Where(r => recordingIds.Contains(r.Id)).Select(r => r.Id).ToListAsync(ct))
            .ToHashSet();
        var seen = (await db.RecordingViews
                .Where(v => recordingIds.Contains(v.RecordingId) && keys.Contains(v.ViewerKey))
                .ToListAsync(ct))
            .ToDictionary(v => (v.RecordingId, v.ViewerKey));

        var counted = new Dictionary<int, int>();
        foreach (var view in distinct)
        {
            if (!live.Contains(view.RecordingId)) continue;
            if (seen.TryGetValue(view, out var last))
            {
                if (now - last.LastCountedAt < window) continue;
                last.LastCountedAt = now;
            }
            else
            {
                db.RecordingViews.Add(new RecordingView
                {
                    RecordingId = view.RecordingId,
                    ViewerKey = view.ViewerKey,
                    LastCountedAt = now,
                });
            }
            counted[view.RecordingId] = counted.GetValueOrDefault(view.RecordingId) + 1;
        }
        if (counted.Count == 0) return 0;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.SaveChangesAsync(ct);
        foreach (var (recordingId, count) in counted)
        {
            await db.Recordings
                .Where(r => r.Id == recordingId)
                .ExecuteUpdateAsync(set => set.SetProperty(r => r.ViewCount, r => r.ViewCount + count), ct);
        }
        await transaction.CommitAsync(ct);
        return counted.Values.Sum();
    }
}
