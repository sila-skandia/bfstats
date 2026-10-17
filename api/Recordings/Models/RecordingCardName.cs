namespace api.Recordings.Models;

/// <summary>A server or uploader one of a card's recordings names, once per card
/// (<see cref="RecordingCard"/>). Feeds the counts behind the feed's filter choices.</summary>
public class RecordingCardName
{
    public int CardKey { get; set; }

    /// <summary><see cref="RecordingTallyKind.Server"/> or <see cref="RecordingTallyKind.Uploader"/>.</summary>
    public RecordingTallyKind Kind { get; set; }

    public string Name { get; set; } = "";
}
