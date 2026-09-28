namespace api.Recordings.Models;

/// <summary>
/// The upload's <c>meta</c> part: the title, whom it is shared as, and what the uploader's
/// browser read of the file. The API reads the file too and its own reading wins; these
/// fill in what the file does not say (the level of a recording begun mid-round, which the
/// browser recognised by its flags or asked for). <see cref="AuthorName"/> is optional: a
/// recording is shared under the name of the player who recorded it unless it names one of
/// the account's linked names instead.
/// </summary>
public record RecordingUploadMeta(
    string? Title,
    string? AuthorName,
    string? Level,
    string? Mod,
    string? GameMode,
    string? ServerName,
    string? RecordedBy,
    string? Start,
    double? DurationSeconds,
    IReadOnlyList<string>? Players);
