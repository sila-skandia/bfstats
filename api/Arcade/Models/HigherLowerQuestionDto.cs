namespace api.Arcade.Models;

public record HigherLowerQuestionDto(
    string Metric,
    string MetricLabel,
    CombatantDto PlayerA,
    CombatantDto PlayerB,
    string RoundToken,
    string Prompt,
    string? MapName = null
);
