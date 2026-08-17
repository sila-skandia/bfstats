using NodaTime;

namespace api.GameTrends.Models;

public record PlayerTrendPoint(Instant Timestamp, double AvgPlayers, int PeakPlayers);

public record PlayerTrendResponse(
    string Scope,
    string? Game,
    string? ServerGuid,
    Instant Start,
    Instant End,
    int ServerCount,
    IReadOnlyList<PlayerTrendPoint> Points);
