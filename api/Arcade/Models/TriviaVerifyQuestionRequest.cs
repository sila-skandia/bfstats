namespace api.Arcade.Models;

public record TriviaVerifyQuestionRequest(
    string QuizToken,
    string QuestionId,
    string Answer
);
