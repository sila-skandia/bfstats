namespace api.Arcade.Models;

public record CombatantDto(
    string Name,
    string Country,
    string FavoriteMap,
    double? Value = null,
    string? FormattedValue = null
);
