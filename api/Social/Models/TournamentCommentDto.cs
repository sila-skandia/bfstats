using NodaTime;

namespace api.Social.Models;

public record TournamentCommentDto(
    int Id,
    int TournamentId,
    int? MatchId,
    string Content,
    string AuthorPlayerName,
    Instant CreatedAt,
    Instant UpdatedAt
);
