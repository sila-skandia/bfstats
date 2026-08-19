namespace api.Services;

/// <summary>
/// In-memory locks (SemaphoreSlim) for aggregate recalculation. Single process only.
/// </summary>
public sealed class AggregateConcurrencyService : IAggregateConcurrencyService, IDisposable
{
    private readonly SemaphoreSlim _playerAggregates = new(1, 1);
    private readonly SemaphoreSlim _serverMapStats = new(1, 1);
    private readonly SemaphoreSlim _serverPlayerRankings = new(1, 1);
    private readonly SemaphoreSlim _neo4jRelationshipSync = new(1, 1);

    public async Task ExecuteWithPlayerAggregatesLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default)
    {
        await _playerAggregates.WaitAsync(ct);
        try
        {
            await work(ct);
        }
        finally
        {
            _playerAggregates.Release();
        }
    }

    public async Task<T> ExecuteWithPlayerAggregatesLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        await _playerAggregates.WaitAsync(ct);
        try
        {
            return await work(ct);
        }
        finally
        {
            _playerAggregates.Release();
        }
    }

    public async Task ExecuteWithServerMapStatsLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default)
    {
        await _serverMapStats.WaitAsync(ct);
        try
        {
            await work(ct);
        }
        finally
        {
            _serverMapStats.Release();
        }
    }

    public async Task<T> ExecuteWithServerMapStatsLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        await _serverMapStats.WaitAsync(ct);
        try
        {
            return await work(ct);
        }
        finally
        {
            _serverMapStats.Release();
        }
    }

    public async Task ExecuteWithServerPlayerRankingsLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default)
    {
        await _serverPlayerRankings.WaitAsync(ct);
        try
        {
            await work(ct);
        }
        finally
        {
            _serverPlayerRankings.Release();
        }
    }

    public async Task<T> ExecuteWithServerPlayerRankingsLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        await _serverPlayerRankings.WaitAsync(ct);
        try
        {
            return await work(ct);
        }
        finally
        {
            _serverPlayerRankings.Release();
        }
    }

    public async Task ExecuteWithNeo4jRelationshipSyncLockAsync(Func<CancellationToken, Task> work, CancellationToken ct = default)
    {
        await _neo4jRelationshipSync.WaitAsync(ct);
        try
        {
            await work(ct);
        }
        finally
        {
            _neo4jRelationshipSync.Release();
        }
    }

    public async Task<T> ExecuteWithNeo4jRelationshipSyncLockAsync<T>(Func<CancellationToken, Task<T>> work, CancellationToken ct = default)
    {
        await _neo4jRelationshipSync.WaitAsync(ct);
        try
        {
            return await work(ct);
        }
        finally
        {
            _neo4jRelationshipSync.Release();
        }
    }

    public void Dispose()
    {
        _playerAggregates.Dispose();
        _serverMapStats.Dispose();
        _serverPlayerRankings.Dispose();
        _neo4jRelationshipSync.Dispose();
    }
}
