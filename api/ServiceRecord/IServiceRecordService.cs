using api.ServiceRecord.Models;

namespace api.ServiceRecord;

public interface IServiceRecordService
{
    /// <summary>
    /// The armies <paramref name="playerName"/> has served in, or null when there is no such
    /// player. A player with no bf1942 sessions gets a record with no armies.
    /// </summary>
    Task<PlayerServiceRecord?> GetAsync(string playerName, CancellationToken cancellationToken = default);
}
