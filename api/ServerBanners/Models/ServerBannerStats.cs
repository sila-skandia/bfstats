namespace api.ServerBanners.Models;

public record ServerBannerStats(
    string ServerName,
    string IpPort,
    string? Map,
    string? GameMode,
    int NumPlayers,
    int MaxPlayers,
    bool IsOnline);
