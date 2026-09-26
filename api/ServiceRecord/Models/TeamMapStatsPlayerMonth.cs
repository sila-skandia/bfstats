namespace api.ServiceRecord.Models;

/// <summary>A player with a session in a month whose PlayerTeamMapStats rows need rewriting.</summary>
public class TeamMapStatsPlayerMonth
{
    public string PlayerName { get; set; } = "";
    public int Year { get; set; }
    public int Month { get; set; }
}
