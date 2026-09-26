namespace api.ServiceRecord.Models;

/// <summary>
/// A player's session groups, and whether older sessions fell outside the window.
/// </summary>
/// <param name="Rows">One row per (gameId, map, team label) within the window.</param>
/// <param name="Capped">True when the player has BF1942 sessions older than the window.</param>
public record ServiceRecordRows(IReadOnlyList<ServiceRecordRow> Rows, bool Capped);
