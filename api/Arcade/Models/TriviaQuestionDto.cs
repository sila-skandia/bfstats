namespace api.Arcade.Models;

public record TriviaQuestionDto(
    string Id,
    string Category,
    string Question,
    IReadOnlyList<string> Options,
    string? TargetPlayerName = null,
    string? TargetRoundId = null,
    string? TargetMapName = null,
    string? TargetServerName = null
);
