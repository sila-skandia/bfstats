namespace api.Recordings.Models;

/// <summary>How many accounts gave a comment this <paramref name="Kind"/> of reaction, and
/// whether the viewer is one of them.</summary>
public record RecordingCommentReactionDto(string Kind, int Count, bool Mine);
