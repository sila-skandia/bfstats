namespace api.Recordings.Models;

/// <summary>An admin putting a recording in another's round: <see cref="With"/> is that
/// recording's slug, or any link to it (its page, its watch link, its file).</summary>
public record LinkRecordingRoundRequest(string? With);
