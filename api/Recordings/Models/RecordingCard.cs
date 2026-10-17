namespace api.Recordings.Models;

/// <summary>
/// One card of the whole feed (features/replay-feed, "Rounds"): a recording on its own or a
/// round of several, among the recordings whose file is there. Kept by triggers on
/// <c>Recordings</c> (<see cref="api.Recordings.RecordingCards"/>), so the unfiltered feed
/// pages by an index instead of grouping every recording on each request.
/// </summary>
public class RecordingCard
{
    /// <summary>The card's key: its round's id, or the recording's own while it is in none.</summary>
    public int CardKey { get; set; }

    /// <summary>The highest recording id on the card: its place among the newest.</summary>
    public int NewestId { get; set; }

    /// <summary>The views of the card's most-watched recording: its place among the most viewed.</summary>
    public int Views { get; set; }

    /// <summary>How many recordings are on the card.</summary>
    public int Recordings { get; set; }
}
