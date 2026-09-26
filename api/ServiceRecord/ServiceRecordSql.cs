namespace api.ServiceRecord;

/// <summary>
/// The sums a service record is made of, shared by the live query over a player's sessions
/// (<see cref="ServiceRecordStore"/>) and the monthly aggregate
/// (<see cref="TeamMapStatsAggregator"/>), so the two can never count differently. Each
/// expects <c>ps</c> as a PlayerSessions row and <c>r</c> as its round, LEFT JOINed.
/// </summary>
internal static class ServiceRecordSql
{
    /// <summary>Summed session length in minutes; a clock that ran backwards counts as nothing.</summary>
    public const string Minutes = "SUM(max(0, (julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440))";

    /// <summary>
    /// Sessions whose own round finished with both ticket counts recorded and unequal, won by
    /// the session's team label. Ties and unfinished rounds are neither a win nor a loss.
    /// </summary>
    public const string Wins = """
        SUM(CASE WHEN r.IsActive = 0
                  AND r.Tickets1 IS NOT NULL AND r.Tickets2 IS NOT NULL
                  AND r.Tickets1 <> r.Tickets2
                  AND lower(trim(CASE WHEN r.Tickets1 > r.Tickets2 THEN r.Team1Label ELSE r.Team2Label END))
                      = lower(trim(ps.CurrentTeamLabel))
                 THEN 1 ELSE 0 END)
        """;

    /// <summary>The mirror of <see cref="Wins"/>.</summary>
    public const string Losses = """
        SUM(CASE WHEN r.IsActive = 0
                  AND r.Tickets1 IS NOT NULL AND r.Tickets2 IS NOT NULL
                  AND r.Tickets1 <> r.Tickets2
                  AND lower(trim(CASE WHEN r.Tickets1 > r.Tickets2 THEN r.Team2Label ELSE r.Team1Label END))
                      = lower(trim(ps.CurrentTeamLabel))
                 THEN 1 ELSE 0 END)
        """;
}
