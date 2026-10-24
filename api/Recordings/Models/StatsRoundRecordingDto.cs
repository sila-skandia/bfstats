using NodaTime;

namespace api.Recordings.Models;

/// <summary>
/// A shared recording of a bfstats.io round, as the round's report shows it
/// (features/recording-stats-round). <see cref="RecordedAt"/> is when the recording began, in
/// UTC, when the match settled its PC's zone: the report opens the replay at one of its
/// moments by it (the replay's <c>t</c> is seconds since then). <see cref="Group"/> is the
/// feed's round the recording is in (features/replay-feed, "Rounds"): recordings of one group
/// play merged. <see cref="UploaderPlayer"/> is the uploader as bfstats.io has a player page
/// for them, or null. The links are relative to the API's host.
/// </summary>
public record StatsRoundRecordingDto(
    string Slug,
    string Title,
    string UploaderName,
    string? UploaderPlayer,
    string RecordedBy,
    string Mod,
    string Level,
    double DurationSeconds,
    Instant? RecordedAt,
    int ViewCount,
    int CommentCount,
    Instant CreatedAt,
    string RecordingUrl,
    string? ServerLogUrl,
    string? ThumbnailUrl,
    int Group);
