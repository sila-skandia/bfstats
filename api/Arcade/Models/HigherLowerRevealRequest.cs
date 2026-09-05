namespace api.Arcade.Models;

public record HigherLowerRevealRequest(
    string RoundToken,
    string Guess
);
