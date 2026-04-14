using NodaTime;

namespace api.Social.Models;

public record PlayerCommentDto(
    int Id,
    string PlayerName,
    string Content,
    string AuthorPlayerName,
    Instant CreatedAt,
    Instant UpdatedAt
);
