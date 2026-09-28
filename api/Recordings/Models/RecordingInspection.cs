namespace api.Recordings.Models;

/// <summary>
/// What the API reads out of a shared recording itself (<see cref="RecordingInspector"/>).
/// Fields a file does not carry are empty: a recording begun mid-round names no level, and
/// the oldest formats hold their events as raw packets the API does not decode. The
/// uploader's browser, which reads the whole file, fills those in. <see cref="Fingerprint"/>
/// is what finds the other recordings of its round (features/replay-feed, "Rounds").
/// </summary>
public sealed record RecordingInspection(
    int Version,
    string Start,
    string Level,
    string GameMode,
    string Mod,
    string ServerName,
    string RecordedBy,
    double DurationSeconds,
    IReadOnlyList<string> Players,
    long RawBytes,
    string ContentHash,
    RoundFingerprint Fingerprint);
