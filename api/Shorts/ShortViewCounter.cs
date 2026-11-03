using System.Threading.Channels;
using api.PlayerTracking;
using api.Recordings;
using api.Shorts.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using NodaTime;

namespace api.Shorts;

/// <summary>Counts a Short's views.</summary>
public interface IShortViewCounter
{
    /// <summary>Queues one watching. False when the queue is full: a view is dropped rather
    /// than a request slowed.</summary>
    bool Enqueue(int shortId, string viewerKey);
}

/// <summary>
/// As <see cref="RecordingViewCounter"/> counts recordings' views: in batches a few seconds
/// apart, never one UPDATE per request, and a viewer once per
/// <see cref="RecordingsOptions.ViewWindowHours"/>.
/// </summary>
public sealed class ShortViewCounter(
    IServiceScopeFactory scopes,
    IClock clock,
    IOptions<RecordingsOptions> options,
    ILogger<ShortViewCounter> logger) : BackgroundService, IShortViewCounter
{
    private const int MaxBatch = 500;
    private static readonly TimeSpan Gather = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan[] Retries = [TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(30)];

    private readonly Channel<(int ShortId, string ViewerKey)> queue =
        Channel.CreateBounded<(int ShortId, string ViewerKey)>(new BoundedChannelOptions(10_000)
        {
            FullMode = BoundedChannelFullMode.DropWrite,
            SingleReader = true,
        });

    public bool Enqueue(int shortId, string viewerKey) => queue.Writer.TryWrite((shortId, viewerKey));

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var batch = new List<(int ShortId, string ViewerKey)>();
        try
        {
            while (await queue.Reader.WaitToReadAsync(stoppingToken))
            {
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

    private async Task FlushWithRetriesAsync(List<(int ShortId, string ViewerKey)> batch, CancellationToken ct)
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
                logger.LogWarning(ex, "Dropped {Count} Short views the database would not take", batch.Count);
                return;
            }
        }
    }

    private static bool IsBusy(Exception ex) =>
        ex is SqliteException { SqliteErrorCode: 5 or 6 } || ex.InnerException is SqliteException { SqliteErrorCode: 5 or 6 };

    /// <summary>Counts the batch: each viewer once a window, per Short still there. Returns
    /// how many counted.</summary>
    internal async Task<int> FlushAsync(IReadOnlyCollection<(int ShortId, string ViewerKey)> views, CancellationToken ct)
    {
        if (views.Count == 0) return 0;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
        var now = clock.GetCurrentInstant();
        var window = Duration.FromHours(options.Value.ViewWindowHours);

        var distinct = views.Distinct().ToList();
        var shortIds = distinct.Select(v => v.ShortId).Distinct().ToList();
        var keys = distinct.Select(v => v.ViewerKey).Distinct().ToList();
        var live = (await db.ReplayShorts.Where(s => shortIds.Contains(s.Id)).Select(s => s.Id).ToListAsync(ct))
            .ToHashSet();
        var seen = (await db.ReplayShortViews
                .Where(v => shortIds.Contains(v.ShortId) && keys.Contains(v.ViewerKey))
                .ToListAsync(ct))
            .ToDictionary(v => (v.ShortId, v.ViewerKey));

        var counted = new Dictionary<int, int>();
        foreach (var view in distinct)
        {
            if (!live.Contains(view.ShortId)) continue;
            if (seen.TryGetValue(view, out var last))
            {
                if (now - last.LastCountedAt < window) continue;
                last.LastCountedAt = now;
            }
            else
            {
                db.ReplayShortViews.Add(new ReplayShortView
                {
                    ShortId = view.ShortId,
                    ViewerKey = view.ViewerKey,
                    LastCountedAt = now,
                });
            }
            counted[view.ShortId] = counted.GetValueOrDefault(view.ShortId) + 1;
        }
        if (counted.Count == 0) return 0;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.SaveChangesAsync(ct);
        foreach (var (shortId, count) in counted)
        {
            await db.ReplayShorts
                .Where(s => s.Id == shortId)
                .ExecuteUpdateAsync(set => set.SetProperty(s => s.Views, s => s.Views + count), ct);
        }
        await transaction.CommitAsync(ct);
        return counted.Values.Sum();
    }
}
