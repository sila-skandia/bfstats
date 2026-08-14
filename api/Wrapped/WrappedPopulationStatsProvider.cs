using System.Collections.Concurrent;
using api.PlayerTracking;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace api.Wrapped;

public interface IWrappedPopulationStatsProvider
{
    /// <summary>
    /// Returns the population-wide leaderboards for <paramref name="year"/>, building them on
    /// first use and reusing them for every subsequent caller until the entry expires.
    /// </summary>
    Task<WrappedPopulationStats> GetAsync(int year, CancellationToken ct = default);

    /// <summary>Drops any cached snapshot so the next caller rebuilds it.</summary>
    void Invalidate(int? year = null);
}

/// <summary>
/// Singleton cache in front of <see cref="WrappedPopulationStatsBuilder"/>.
///
/// A 30k-player crunch and the on-demand endpoint both want the same snapshot, so it lives
/// outside any request/crunch scope and is built at most once per TTL. Concurrent callers share
/// one build via <see cref="Lazy{T}"/> rather than each kicking off their own table scans; if a
/// build fails the entry is evicted so the failure isn't cached.
/// </summary>
public sealed class WrappedPopulationStatsProvider(
    IServiceScopeFactory scopeFactory,
    ILogger<WrappedPopulationStatsProvider> logger) : IWrappedPopulationStatsProvider
{
    /// <summary>
    /// Wrapped covers a year that is over (or nearly), so the population barely moves. Long
    /// enough that a whole crunch run reuses one snapshot; short enough that a day's new rounds
    /// show up in on-demand results.
    /// </summary>
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(1);

    private readonly ConcurrentDictionary<int, Entry> _entries = new();

    private sealed record Entry(Lazy<Task<WrappedPopulationStats>> Value, DateTime CreatedUtc);

    public async Task<WrappedPopulationStats> GetAsync(int year, CancellationToken ct = default)
    {
        while (true)
        {
            var entry = _entries.GetOrAdd(year, y => new Entry(
                new Lazy<Task<WrappedPopulationStats>>(() => BuildAsync(y), LazyThreadSafetyMode.ExecutionAndPublication),
                DateTime.UtcNow));

            if (DateTime.UtcNow - entry.CreatedUtc > Ttl)
            {
                _entries.TryRemove(new KeyValuePair<int, Entry>(year, entry));
                continue;
            }

            try
            {
                return await entry.Value.Value;
            }
            catch
            {
                // Don't let one failed build poison every later caller.
                _entries.TryRemove(new KeyValuePair<int, Entry>(year, entry));
                throw;
            }
        }
    }

    public void Invalidate(int? year = null)
    {
        if (year.HasValue) _entries.TryRemove(year.Value, out _);
        else _entries.Clear();
    }

    private async Task<WrappedPopulationStats> BuildAsync(int year)
    {
        // Its own scope: the snapshot outlives whichever request or crunch triggered the build,
        // so it must not hold onto that caller's DbContext.
        using var scope = scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<PlayerTrackerDbContext>();
        return await WrappedPopulationStatsBuilder.BuildAsync(dbContext, year, logger);
    }
}
