namespace api.ServerBanners.Models;

public record ServerBannerStats(
    string ServerName,
    string IpPort,
    string? Map,
    string? GameMode,
    int NumPlayers,
    int MaxPlayers,
    bool IsOnline,
    ServerBannerTickets? Tickets,
    string? GameId = null);

/// <summary>
/// Live team ticket scoreboard for the banner footer. Team1 renders in the "kill"
/// red, Team2 in the olive-green "success" tint (Axis-red / Allies-olive convention).
/// Populated from the BFList live feed; null when ticket data is unavailable or the
/// caller opted out.
/// </summary>
public record ServerBannerTickets(
    string Team1Label,
    string Team2Label,
    int Team1Tickets,
    int Team2Tickets);
