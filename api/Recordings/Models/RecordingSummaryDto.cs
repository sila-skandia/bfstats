using NodaTime;

namespace api.Recordings.Models;

/// <summary>A recording as the feed lists it. <see cref="RecordingUrl"/> is relative to the
/// API's host: <c>/stats/recordings/&lt;slug&gt;.ndjson</c>. <see cref="UploaderPlayer"/> is the
/// uploader as bfstats.io has a player page for them, or null when it has none.
/// <see cref="Round"/> is every recording of its round in the feed, itself among them, in the
/// order they began in the round; null while it is the only one. On a feed card that is a
/// round, this recording is the round's lead and <see cref="RoundCard"/> says what the card
/// shows of the whole round; the recording's own fields stay its own.</summary>
public record RecordingSummaryDto(
    string Slug,
    string Title,
    string UploaderName,
    string Level,
    string Mod,
    string GameMode,
    string ServerName,
    string RecordedLocal,
    double DurationSeconds,
    int PlayerCount,
    int ViewCount,
    int CommentCount,
    Instant CreatedAt,
    string RecordingUrl,
    string? ServerLogUrl,
    string? ThumbnailUrl,
    string? UploaderPlayer,
    IReadOnlyList<RecordingRoundMemberDto>? Round = null,
    RecordingRoundCardDto? RoundCard = null);
