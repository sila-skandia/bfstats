namespace api.Arcade.Models;

public record HigherLowerRevealResultDto(
    bool IsCorrect,
    double PlayerAValue,
    double PlayerBValue,
    string FormattedPlayerBValue,
    string Message,
    HigherLowerQuestionDto? NextQuestion,
    string? FormattedPlayerAValue = null
);
