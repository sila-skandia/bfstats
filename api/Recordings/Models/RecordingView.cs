using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// When a viewer's watching of a recording last counted: a view counts once per viewer per
/// <see cref="api.Recordings.RecordingsOptions.ViewWindowHours"/>. The viewer is a signed-in user's id, else
/// a keyed hash of the address and browser, so no address is kept.
/// </summary>
public class RecordingView
{
    public long Id { get; set; }
    public int RecordingId { get; set; }
    public string ViewerKey { get; set; } = "";
    public Instant LastCountedAt { get; set; }

    public Recording Recording { get; set; } = null!;
}
