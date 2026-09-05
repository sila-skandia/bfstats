namespace api.Arcade.Models;

public record MysteryAttributeMatchDto(
    string Key,
    string Label,
    string Value,
    bool IsMatch,
    string? Indicator = null
);
