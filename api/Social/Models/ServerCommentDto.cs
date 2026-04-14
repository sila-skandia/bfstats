using NodaTime;

namespace api.Social.Models;

public record ServerCommentDto(
    int Id,
    string ServerName,
    string Content,
    string AuthorPlayerName,
    Instant CreatedAt,
    Instant UpdatedAt);
