namespace api.Arcade.Models;

public record MysteryDossierDto(
    string DossierToken,
    string Mode,
    string KillsBracket,
    string PlayTimeBracket,
    string KdBracket,
    string FavoriteMap,
    string FavoriteServer,
    string? SignatureBadge,
    int TotalCandidates,
    IReadOnlyList<string> CandidateOptions
);
