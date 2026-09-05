namespace api.Arcade.Models;

public record TriviaQuizDto(
    string QuizToken,
    IReadOnlyList<TriviaQuestionDto> Questions
);
