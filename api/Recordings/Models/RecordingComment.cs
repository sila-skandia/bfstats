using api.PlayerTracking;
using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// A comment on a shared recording. Plain text; a time in it (<c>0:21 get rekt</c>) is a
/// place in the recording, and the first one is kept in <see cref="AtSeconds"/> for the
/// replay's timeline.
/// </summary>
public class RecordingComment
{
    public int Id { get; set; }
    public int RecordingId { get; set; }
    public int AuthorUserId { get; set; }

    /// <summary>The linked player name the author posted as.</summary>
    public string AuthorName { get; set; } = "";

    public string Content { get; set; } = "";

    /// <summary>The first time the comment names, in recording seconds; null for none.</summary>
    public double? AtSeconds { get; set; }

    public Instant CreatedAt { get; set; }

    public Recording Recording { get; set; } = null!;
    public User Author { get; set; } = null!;
}
