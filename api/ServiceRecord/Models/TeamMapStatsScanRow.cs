namespace api.ServiceRecord.Models;

/// <summary>One grouped row of a PlayerTeamMapStats scan, as SQLite returns it.</summary>
public class TeamMapStatsScanRow
{
    public string PlayerName { get; set; } = "";
    public int Year { get; set; }
    public int Month { get; set; }
    public string ServerGuid { get; set; } = "";
    public string MapName { get; set; } = "";
    public string? TeamLabel { get; set; }
    public int Sessions { get; set; }
    public int TotalKills { get; set; }
    public int TotalDeaths { get; set; }
    public int TotalScore { get; set; }
    public double TotalPlayTimeMinutes { get; set; }
    public int Wins { get; set; }
    public int Losses { get; set; }
    public DateTime FirstSessionStart { get; set; }
}
