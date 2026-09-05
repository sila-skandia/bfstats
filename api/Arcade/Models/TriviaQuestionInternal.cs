namespace api.Arcade.Models;

internal sealed record TriviaQuestionInternal(
    string Id,
    string Category,
    string Question,
    List<string> Options,
    string CorrectAnswer,
    string Explanation,
    string? TargetPlayerName = null,
    string? TargetRoundId = null,
    string? TargetMapName = null,
    string? TargetServerName = null
);
