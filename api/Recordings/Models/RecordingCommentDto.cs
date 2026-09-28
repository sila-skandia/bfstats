using NodaTime;

namespace api.Recordings.Models;

public record RecordingCommentDto(
    int Id,
    string AuthorName,
    string Content,
    double? AtSeconds,
    Instant CreatedAt,
    bool CanDelete);
