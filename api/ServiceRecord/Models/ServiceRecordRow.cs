namespace api.ServiceRecord.Models;

/// <summary>
/// A player's sessions on one (gameId, map, team label), summed by the database.
/// </summary>
/// <param name="GameId">Server gameId, trimmed and lowercased.</param>
/// <param name="MapName">Map name as the server reported it.</param>
/// <param name="TeamLabel">The session's team label, trimmed: "Axis", "Allied", or noise.</param>
/// <param name="Rounds">Sessions in the group.</param>
/// <param name="Minutes">Summed session length, never negative.</param>
/// <param name="Wins">Sessions whose finished round the label's team won on tickets.</param>
/// <param name="Losses">Sessions whose finished round the label's team lost on tickets.</param>
/// <param name="OldestStart">The earliest session start in the group, UTC.</param>
public record ServiceRecordRow(
    string GameId,
    string MapName,
    string TeamLabel,
    int Rounds,
    int Kills,
    int Deaths,
    int Score,
    double Minutes,
    int Wins,
    int Losses,
    DateTime? OldestStart = null);
