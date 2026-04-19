namespace api.PlayerBanners.Models;

public record BannerStats(
    string PlayerName,
    string? ServerName,
    int TotalKills,
    int TotalScore,
    double KdRatio,
    double TotalHours);
