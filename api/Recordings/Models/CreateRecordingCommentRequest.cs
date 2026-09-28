namespace api.Recordings.Models;

/// <summary>A comment, posted as one of the author's linked player names.</summary>
public record CreateRecordingCommentRequest(string Content, string AuthorName);
