namespace api.Arcade.Models;

public record ArcadePlayerSearchDto(
    string Name,
    string Country,
    double PlayTimeHours,
    double KdRatio
);
