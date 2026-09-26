namespace api.ServiceRecord.Models;

/// <summary>
/// A map the player fought on for an army, addressed the way bflist reports it.
/// </summary>
/// <param name="GameId">Server gameId, lowercased, e.g. "bf1942".</param>
/// <param name="MapName">Map name as the server reported it, e.g. "battle of the bulge".</param>
/// <param name="DisplayName">The dossier's display name.</param>
public record ServiceRecordMap(
    string GameId,
    string MapName,
    string DisplayName,
    double Minutes,
    int Rounds);
