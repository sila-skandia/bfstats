using NodaTime;

namespace api.Recordings.Models;

/// <summary>A comment on a recording, with its reactions in <see cref="RecordingReactions.Kinds"/>
/// order (only the kinds it has, and any the viewer gave).</summary>
public record RecordingCommentDto(
    int Id,
    string AuthorName,
    string Content,
    double? AtSeconds,
    Instant CreatedAt,
    bool CanDelete,
    IReadOnlyList<RecordingCommentReactionDto> Reactions);
