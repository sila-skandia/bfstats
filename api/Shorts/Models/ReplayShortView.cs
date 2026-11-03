using NodaTime;

namespace api.Shorts.Models;

/// <summary>When a viewer's watching of a Short last counted, as <see cref="api.Recordings.Models.RecordingView"/>
/// is for a recording.</summary>
public class ReplayShortView
{
    public long Id { get; set; }
    public int ShortId { get; set; }
    public string ViewerKey { get; set; } = "";
    public Instant LastCountedAt { get; set; }

    public ReplayShort Short { get; set; } = null!;
}
