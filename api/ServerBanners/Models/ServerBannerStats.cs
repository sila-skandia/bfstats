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
    ServerBannerActivity? Activity = null);

/// <summary>
/// Population timeline driving the Waveform art panel: the typical player count for
/// the past few hours, the current hour, and the forecast for the next few hours.
/// Built from the pre-computed hourly busy patterns. Null when unavailable.
/// </summary>
public record ServerBannerActivity(IReadOnlyList<ServerBannerActivityBar> Bars);

/// <summary>
/// One hour in the activity timeline. <see cref="Players"/> is the typical (average)
/// count for that hour-of-day — except the current bar, which carries the live count.
/// </summary>
public record ServerBannerActivityBar(double Players, bool IsCurrent, bool IsFuture);

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
