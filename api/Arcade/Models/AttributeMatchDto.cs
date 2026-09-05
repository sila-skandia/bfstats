namespace api.Arcade.Models;

public record AttributeMatchDto(
    string Value,
    bool IsMatch,
    string? Indicator = null
);
