namespace api.Arcade.Models;

public record MysteryClueDto(
    string Key,
    string Label,
    string Value,
    string? Category = null
);
