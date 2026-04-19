namespace api.Landing.Models;

public record NetworkPulseResponse(
    string? Game,
    DateTime GeneratedAt,
    List<NetworkPulseHourlyPoint> RecentTrend,
    List<NetworkPulseHeatmapCell> WeeklyHeatmap,
    NetworkPulsePeakInfo? PeakToday,
    NetworkPulsePeakInfo? PeakWeek);

public record NetworkPulseHourlyPoint(
    DateTime HourUtc,
    double AvgPlayers,
    int PeakPlayers);

public record NetworkPulseHeatmapCell(
    int DayOfWeek,
    int HourOfDay,
    double AvgPlayers);

public record NetworkPulsePeakInfo(
    double AvgPlayers,
    int PeakPlayers,
    DateTime HourUtc);
