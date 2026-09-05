namespace api.Arcade.Models;

public record ArcadeServerDto(
    string Guid,
    string Name,
    string Country,
    int CurrentPlayers,
    int TotalCandidates,
    double TotalPlayTimeHours = 0
);
