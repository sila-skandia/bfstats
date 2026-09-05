namespace api.Arcade.Models;

public record TriviaQuestionVerificationDto(
    string QuestionId,
    bool IsCorrect,
    string SelectedAnswer,
    string CorrectAnswer,
    string Explanation,
    string? TargetPlayerName = null,
    string? TargetRoundId = null,
    string? TargetMapName = null,
    string? TargetServerName = null,
    IReadOnlyList<string>? Highlights = null
);
