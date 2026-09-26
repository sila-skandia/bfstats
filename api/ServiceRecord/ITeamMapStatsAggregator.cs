namespace api.ServiceRecord;

/// <summary>Maintains PlayerTeamMapStats; see <see cref="TeamMapStatsAggregator"/>.</summary>
public interface ITeamMapStatsAggregator
{
    /// <summary>
    /// The hourly step: the rows of everyone seen since the last refresh, then a few more
    /// months of history until the backfill is complete. Returns the rows written.
    /// </summary>
    Task<int> RefreshAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Rebuilds every month of <paramref name="playerNames"/> from their sessions, after an
    /// admin edit (a deleted round, a merged player or server) changed them.
    /// </summary>
    Task<int> RecomputePlayersAsync(IReadOnlyCollection<string> playerNames, CancellationToken cancellationToken = default);
}
