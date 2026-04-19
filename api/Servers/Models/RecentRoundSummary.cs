namespace api.Servers.Models;

public record RecentRoundSummary(
    string RoundId,
    string ServerGuid,
    string ServerName,
    string MapName,
    string GameType,
    string Game,
    DateTime StartTime,
    DateTime EndTime,
    int DurationMinutes,
    int ParticipantCount,
    int? Tickets1,
    int? Tickets2,
    string? Team1Label,
    string? Team2Label,
    string? WinnerLabel,
    int? TicketMargin,
    RecentRoundMvp? Mvp);

public record RecentRoundMvp(
    string PlayerName,
    int Score,
    int Kills,
    int Deaths);
