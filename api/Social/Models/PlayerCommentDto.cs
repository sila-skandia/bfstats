using NodaTime;

namespace api.Social.Models;

public record PlayerCommentDto(
    int Id,
    string PlayerName,
    string Content,
    string AuthorEmail,
    Instant CreatedAt,
    Instant UpdatedAt
);
