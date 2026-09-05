namespace api.Arcade.Models;

public record TriviaVerifyRequest(
    string QuizToken,
    Dictionary<string, string> Answers
);
