namespace api.DataExplorer.Models;

/// <summary>
/// Response for the map popularity analysis endpoint.
/// Contains timeline data, round info, and per-map summaries.
/// </summary>
public record MapPopularityResponse(
    List<PopulationTimelinePoint> Timeline,
    List<MapPopularityRound> Rounds,
    List<MapPopularitySummary> MapSummaries
);

/// <summary>
/// A single point in the population timeline (sampled at regular intervals).
/// </summary>
public record PopulationTimelinePoint(
    DateTime Timestamp,
    int PlayerCount,
    string? MapName
);

/// <summary>
/// A round for display in the timeline background bands.
/// </summary>
public record MapPopularityRound(
    string RoundId,
    string MapName,
    DateTime StartTime,
    DateTime? EndTime,
    int? ParticipantCount
);

/// <summary>
/// Per-map summary with popularity metrics.
/// </summary>
public record MapPopularitySummary(
    string MapName,
    int TotalRounds,
    double AvgConcurrentPlayers,
    double AvgPlayerDelta,
    double[] HourlyAvgPlayers
);
