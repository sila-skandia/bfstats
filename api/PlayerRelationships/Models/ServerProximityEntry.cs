namespace api.PlayerRelationships.Models;

/// <summary>
/// One regular on a server, plotted on the proximity orbit by ping (radius)
/// and peak hour of day (angle).
/// </summary>
public record ServerProximityEntry(
    string PlayerName,
    double AvgPing,
    int SessionCount,
    int PeakHourUtc,
    DateTime LastPlayed);
