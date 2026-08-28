namespace api.Services;

/// <summary>
/// In-process locks for aggregate recalculation and background jobs.
/// Serializes work that touches PlayerStatsMonthly/PlayerServerStats/PlayerMapStats/PlayerBestScores,
/// ServerMapStats, and ServerPlayerRankings to avoid conflicts between scheduled jobs and
/// delete/undelete-triggered recalculations.
/// </summary>
public interface IAggregateConcurrencyService
{
    /// <summary>
    /// Runs work while holding the player-aggregates lock
    /// (PlayerStatsMonthly, PlayerServerStats, PlayerMapStats, PlayerBestScores).
    /// </summary>
    Task ExecuteWithPlayerAggregatesLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the player-aggregates lock and returns a value.
    /// </summary>
    Task<T> ExecuteWithPlayerAggregatesLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the ServerMapStats lock.
    /// </summary>
    Task ExecuteWithServerMapStatsLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the ServerMapStats lock and returns a value.
    /// </summary>
    Task<T> ExecuteWithServerMapStatsLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the ServerPlayerRankings lock.
    /// </summary>
    Task ExecuteWithServerPlayerRankingsLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the ServerPlayerRankings lock and returns a value.
    /// </summary>
    Task<T> ExecuteWithServerPlayerRankingsLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the Neo4j relationship-sync lock. Writers that share
    /// this lock: the daily relationship ETL, the admin "sync pending" endpoint, the
    /// admin backfill job, and nightly community detection. Without it, two of them
    /// running at once race on the SyncedToNeo4jAt watermark and/or collide on the
    /// same Player/Server node locks in Neo4j, which surfaces as a Forseti deadlock
    /// and aborts the transaction.
    /// </summary>
    Task ExecuteWithNeo4jRelationshipSyncLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default);

    /// <summary>
    /// Runs work while holding the Neo4j relationship-sync lock and returns a value.
    /// </summary>
    Task<T> ExecuteWithNeo4jRelationshipSyncLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default);
}
