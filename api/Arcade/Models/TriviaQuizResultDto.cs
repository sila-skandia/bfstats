namespace api.Arcade.Models;

public record TriviaQuizResultDto(
    int TotalQuestions,
    int CorrectCount,
    double ScorePercentage,
    string RankTitle,
    string SummaryMessage,
    IReadOnlyList<TriviaQuestionResultDto> QuestionResults
);
