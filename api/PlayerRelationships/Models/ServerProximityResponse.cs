namespace api.PlayerRelationships.Models;

/// <summary>
/// Players visualised on the server proximity orbit plus the underlying
/// population size so the UI can tell the user "showing 50 of N regulars".
/// </summary>
public record ServerProximityResponse(
    IReadOnlyList<ServerProximityEntry> Players,
    int TotalRegulars);
