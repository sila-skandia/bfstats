namespace api.GameTrends.Models;

public record ServerWeeklyPatternSlot(
    int DayOfWeek,
    int HourOfDay,
    double AvgPlayers,
    double MaxPlayers,
    double MedianPlayers,
    int DataPoints);

public record ServerWeeklyPatternResponse(
    string ServerGuid,
    string? ServerName,
    int? PeakDayOfWeek,
    int? PeakHourOfDay,
    double PeakAvgPlayers,
    double OverallAvgPlayers,
    int TotalDataPoints,
    IReadOnlyList<ServerWeeklyPatternSlot> Slots);
