using System.Collections.Concurrent;
using api.Arcade.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace api.Arcade;

/// <summary>
/// Builds a trivia question pool for the global scope or a single server.
/// </summary>
/// <remarks>
/// Separate from <see cref="IArcadeService"/> so <see cref="ArcadeTriviaPoolCache"/> — a
/// singleton — can resolve a scoped builder inside its own DI scope when it refreshes a pool
/// off the request path. Internal because <see cref="TriviaQuestionInternal"/> is.
/// </remarks>
internal interface IArcadeTriviaPoolBuilder
{
    Task<IReadOnlyList<TriviaQuestionInternal>> BuildTriviaPoolAsync(
        string? serverGuid,
        CancellationToken cancellationToken);
}

/// <summary>
/// Process-wide cache for arcade trivia question pools.
///
/// Building the global pool costs seconds — it aggregates the whole of PlayerStatsMonthly and
/// PlayerMapStats to find the top 150 players, and no index removes a full GROUP BY. The
/// previous 20-minute <c>IMemoryCache</c> entry meant one unlucky visitor every 20 minutes
/// absorbed that build in full (29.2s in the production trace this was written against), and
/// concurrent visitors on a cold cache each started their own copy of it.
///
/// Two properties fix that:
///
///   <b>Single flight.</b> One build per key at a time. Everyone else waits on the same
///   build and gets its result instead of starting another. Duplicate builds are the worst
///   possible behaviour on a node whose data volume serves ~691 IOPS.
///
///   <b>Serve stale, refresh behind.</b> Entries stay usable for <see cref="RetainFor"/> but
///   are considered stale after <see cref="FreshFor"/>. A stale hit returns immediately and
///   kicks off a refresh in the background, so a request pays the build cost only when
///   nothing is cached at all — a cold pod, which
///   <c>ArcadeTriviaWarmupBackgroundService</c> then covers.
///
/// Retention is deliberately long. Question *selection* is a fresh
/// <see cref="System.Security.Cryptography.RandomNumberGenerator"/> shuffle over the whole
/// pool on every request, so a long-lived pool cannot produce repetitive quizzes — only a
/// small pool can, and the global pool holds ~695 questions. The sole cost of a stale pool is
/// that the underlying stats drift, and these are monthly and career aggregates that barely
/// move within a day.
/// </summary>
public sealed class ArcadeTriviaPoolCache(
    IServiceScopeFactory scopeFactory,
    ILogger<ArcadeTriviaPoolCache> logger)
{
    /// <summary>How long a pool is served without triggering a background refresh.</summary>
    public static readonly TimeSpan FreshFor = TimeSpan.FromMinutes(30);

    /// <summary>
    /// How long a pool stays servable. Comfortably longer than both <see cref="FreshFor"/> and
    /// the warmup service's interval, so a pool never expires out from under the request path
    /// while a refresh is in flight.
    /// </summary>
    public static readonly TimeSpan RetainFor = TimeSpan.FromHours(12);

    public const string GlobalKey = "global";

    private sealed record Entry(IReadOnlyList<TriviaQuestionInternal> Questions, DateTimeOffset BuiltAt);

    private readonly ConcurrentDictionary<string, Entry> _entries = new();
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _gates = new();
    private readonly ConcurrentDictionary<string, byte> _refreshing = new();

    private static string KeyFor(string? serverGuid) =>
        string.IsNullOrWhiteSpace(serverGuid) ? GlobalKey : serverGuid;

    internal async Task<IReadOnlyList<TriviaQuestionInternal>> GetOrBuildAsync(
        string? serverGuid,
        IArcadeTriviaPoolBuilder builder,
        CancellationToken cancellationToken)
    {
        var key = KeyFor(serverGuid);
        var now = DateTimeOffset.UtcNow;

        if (_entries.TryGetValue(key, out var entry) && entry.Questions.Count > 0)
        {
            if (now - entry.BuiltAt <= RetainFor)
            {
                if (now - entry.BuiltAt > FreshFor)
                {
                    ScheduleRefresh(serverGuid);
                }

                return entry.Questions;
            }

            _entries.TryRemove(key, out _);
        }

        return await BuildExclusiveAsync(serverGuid, builder, cancellationToken);
    }

    /// <summary>
    /// Builds the pool with at most one build per key in flight. A caller that arrives while a
    /// build is running waits for it and takes its result rather than starting a second.
    /// </summary>
    private async Task<IReadOnlyList<TriviaQuestionInternal>> BuildExclusiveAsync(
        string? serverGuid,
        IArcadeTriviaPoolBuilder builder,
        CancellationToken cancellationToken)
    {
        var key = KeyFor(serverGuid);
        var gate = _gates.GetOrAdd(key, _ => new SemaphoreSlim(1, 1));

        await gate.WaitAsync(cancellationToken);
        try
        {
            // Someone else may have built it while we queued.
            if (_entries.TryGetValue(key, out var fresh)
                && fresh.Questions.Count > 0
                && DateTimeOffset.UtcNow - fresh.BuiltAt <= FreshFor)
            {
                return fresh.Questions;
            }

            var pool = await builder.BuildTriviaPoolAsync(serverGuid, cancellationToken);
            if (pool.Count > 0)
            {
                _entries[key] = new Entry(pool, DateTimeOffset.UtcNow);
            }

            return pool;
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>
    /// Rebuilds a pool off the request path, in its own DI scope — the caller's DbContext is
    /// disposed when its request ends, so the refresh cannot borrow it. Failures are logged
    /// and swallowed: the stale pool we just served is still perfectly playable.
    /// </summary>
    private void ScheduleRefresh(string? serverGuid)
    {
        var key = KeyFor(serverGuid);
        if (!_refreshing.TryAdd(key, 0))
        {
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await RefreshAsync(serverGuid, CancellationToken.None);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Background refresh of arcade trivia pool {PoolKey} failed.", key);
            }
            finally
            {
                _refreshing.TryRemove(key, out _);
            }
        });
    }

    /// <summary>
    /// Rebuilds a pool in a fresh scope and replaces the cached entry. Used by the background
    /// refresh above and by ArcadeTriviaWarmupBackgroundService.
    /// </summary>
    public async Task RefreshAsync(string? serverGuid, CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var builder = scope.ServiceProvider.GetRequiredService<IArcadeTriviaPoolBuilder>();
        await BuildExclusiveAsync(serverGuid, builder, cancellationToken);
    }

    /// <summary>True when the key has a pool that is still within <see cref="FreshFor"/>.</summary>
    public bool IsFresh(string? serverGuid) =>
        _entries.TryGetValue(KeyFor(serverGuid), out var entry)
        && entry.Questions.Count > 0
        && DateTimeOffset.UtcNow - entry.BuiltAt <= FreshFor;
}
