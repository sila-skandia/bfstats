using api.PlayerTracking;
using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// One account's reaction to a comment on a shared recording (features/replay-feed,
/// "Likes and reactions"): a like, or one of the other <see cref="RecordingReactions.Kinds"/>.
/// An account has each kind on a comment once, and may have several kinds on it.
/// </summary>
public class RecordingCommentReaction
{
    public int CommentId { get; set; }
    public int UserId { get; set; }

    /// <summary>One of <see cref="RecordingReactions.Kinds"/>.</summary>
    public string Kind { get; set; } = "";

    public Instant CreatedAt { get; set; }

    public RecordingComment Comment { get; set; } = null!;
    public User User { get; set; } = null!;
}
