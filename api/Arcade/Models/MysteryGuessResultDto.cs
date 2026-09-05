namespace api.Arcade.Models;

public record MysteryGuessResultDto(
    string GuessedPlayerName,
    bool IsCorrect,
    AttributeMatchDto Kills,
    AttributeMatchDto PlayTime,
    AttributeMatchDto KdRatio,
    AttributeMatchDto FavoriteMap,
    AttributeMatchDto FavoriteServer,
    string? TargetPlayerName = null,
    string? Message = null
);
