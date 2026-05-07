using api.AdminData.Models;

namespace api.AdminData;

public interface IServerMergeService
{
    /// <summary>
    /// Find groups of GameServer rows that share (Game, Ip, Port, Name) — likely the same physical
    /// server that was re-registered with a new GUID by upstream bflist.io.
    /// </summary>
    /// <param name="game">Optional game filter (bf1942, fh2, bfvietnam). Null/empty = all games.</param>
    Task<IReadOnlyList<ServerMergeCandidate>> FindDuplicateCandidatesAsync(string? game);

    /// <summary>
    /// Merge duplicate GameServer rows into the chosen primary GUID. Re-points all foreign keys,
    /// hard-deletes the duplicate Server rows, removes affected aggregate rows so they get rebuilt,
    /// writes an audit log entry, and queues background recalculation.
    /// </summary>
    Task<MergeServersResponse> MergeServersAsync(string primaryGuid, IReadOnlyList<string> duplicateGuids, string adminEmail);
}
