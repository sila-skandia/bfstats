namespace api.Servers.Models;

public record LiveRoundSummary(
    string RoundId,
    string ServerGuid,
    string ServerName,
    string? ServerCountry,
    string MapName,
    string GameType,
    string Game,
    DateTime StartTime,
    int MinutesElapsed,
    int? RoundTimeRemain,
    int CurrentPlayers,
    int MaxPlayers,
    int? Tickets1,
    int? Tickets2,
    string? Team1Label,
    string? Team2Label,
    double DramaScore,
    List<LiveRoundTopPlayer> TopPlayers);

public record LiveRoundTopPlayer(
    string PlayerName,
    int Score,
    int Kills,
    int Deaths,
    int Team);
