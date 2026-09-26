using NodaTime;

namespace api.Data.Entities;

/// <summary>
/// A player's sessions per server, map and team label, one row per month. Summing a
/// player's rows is their whole career, which is what the service record needs
/// (features/service-record): reading their sessions instead costs a random read each on
/// the production volume.
///
/// Bucketed by the month a session was <em>last seen</em>, not the month it started as
/// <see cref="PlayerMapStats"/> is. Every session then sits in exactly one bucket that
/// <c>IX_PlayerSessions_LastSeenTime_WhereNotDeleted</c> reaches by range; a start-time
/// month cannot be bounded on that index, since a session can run for three weeks.
/// Maintained by <c>api.ServiceRecord.TeamMapStatsAggregator</c>.
/// </summary>
public class PlayerTeamMapStats
{
    public required string PlayerName { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public required string ServerGuid { get; set; }
    public required string MapName { get; set; }

    /// <summary>The session's team label, trimmed: "Axis", "Allied", or whatever else the server sent.</summary>
    public required string TeamLabel { get; set; }

    public int Sessions { get; set; }
    public int TotalKills { get; set; }
    public int TotalDeaths { get; set; }
    public int TotalScore { get; set; }
    public double TotalPlayTimeMinutes { get; set; }

    /// <summary>Sessions whose finished round this label's team won on tickets.</summary>
    public int Wins { get; set; }

    /// <summary>Sessions whose finished round this label's team lost on tickets.</summary>
    public int Losses { get; set; }

    /// <summary>The earliest session start in the row.</summary>
    public Instant FirstSessionStart { get; set; }

    public Instant UpdatedAt { get; set; }
}
