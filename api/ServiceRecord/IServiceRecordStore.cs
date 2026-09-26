using api.ServiceRecord.Models;

namespace api.ServiceRecord;

/// <summary>Reads what a service record is built from.</summary>
public interface IServiceRecordStore
{
    /// <summary>True when <paramref name="playerName"/> has a Players row.</summary>
    Task<bool> PlayerExistsAsync(string playerName, CancellationToken cancellationToken = default);

    /// <summary>
    /// The player's most recent bf1942 sessions, up to <see cref="ServiceRecordStore.SessionWindow"/>,
    /// summed per (gameId, map, team label).
    /// </summary>
    Task<ServiceRecordRows> GetRowsAsync(string playerName, CancellationToken cancellationToken = default);
}
