using api.PlayerTracking;
using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// A creator's edit of a clip of a shared recording (features/replay-creator-view, "Sharing an
/// edit"): the clip's ends, its cameras, slow motion, the hit's pin, the look, text and effects,
/// as the studio keeps them, so someone else can open it from a link and carry on. The song a
/// clip was cut to is named in it, never sent.
/// </summary>
public class RecordingEdit
{
    public int Id { get; set; }

    /// <summary>The public id, in the edit's link: eight characters, lower case.</summary>
    public string Code { get; set; } = "";

    public int RecordingId { get; set; }
    public int AuthorUserId { get; set; }

    /// <summary>The linked player name the author shared it as; empty for an account with none.</summary>
    public string AuthorName { get; set; } = "";

    public string Name { get; set; } = "";

    /// <summary>The studio's edit, as JSON. The studio reads it; the API only keeps it.</summary>
    public string Payload { get; set; } = "";

    public Instant CreatedAt { get; set; }

    public Recording Recording { get; set; } = null!;
    public User Author { get; set; } = null!;
}
