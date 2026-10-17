namespace api.Recordings.Models;

/// <summary>
/// A running count over the whole feed, kept by the same triggers as <see cref="RecordingCard"/>:
/// the feed's cards and recordings (with an empty <see cref="Name"/>), and the cards each
/// server and uploader would show. A name whose count falls to nothing loses its row.
/// </summary>
public class RecordingTally
{
    public RecordingTallyKind Kind { get; set; }

    public string Name { get; set; } = "";

    public int Count { get; set; }
}
