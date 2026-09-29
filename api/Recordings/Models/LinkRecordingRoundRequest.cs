namespace api.Recordings.Models;

/// <summary>An admin putting a recording in another's round: <see cref="With"/> is that
/// recording's slug, or any link to it (its page, its watch link, its file).
/// <see cref="Confirm"/> links them even when their files fall short of what detection needs
/// (<see cref="RecordingRoundEvidenceDto"/>); without it such a link is refused with the
/// evidence, for the admin to read first.</summary>
public record LinkRecordingRoundRequest(string? With, bool Confirm = false);
