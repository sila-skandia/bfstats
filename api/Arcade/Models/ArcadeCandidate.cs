namespace api.Arcade.Models;

public record ArcadeCandidate(
    string PlayerName,
    string Country,
    int TotalKills,
    int TotalScore,
    double PlayTimeHours,
    double KdRatio,
    string FavoriteMap,
    string FavoriteServer,
    string? SignatureBadge
);
