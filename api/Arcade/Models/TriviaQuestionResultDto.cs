namespace api.Arcade.Models;

public record TriviaQuestionResultDto(
    string QuestionId,
    string Question,
    string SelectedAnswer,
    string CorrectAnswer,
    bool IsCorrect,
    string Explanation,
    string? TargetPlayerName = null,
    string? TargetRoundId = null,
    string? TargetMapName = null,
    string? TargetServerName = null,
    IReadOnlyList<string>? Highlights = null
);
