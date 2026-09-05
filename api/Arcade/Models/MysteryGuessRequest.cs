namespace api.Arcade.Models;

public record MysteryGuessRequest(
    string DossierToken,
    string GuessedPlayerName
);
