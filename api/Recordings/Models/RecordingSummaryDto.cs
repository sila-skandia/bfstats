using NodaTime;

namespace api.Recordings.Models;

/// <summary>A recording as the feed lists it. <see cref="RecordingUrl"/> is relative to the
/// API's host: <c>/stats/recordings/&lt;slug&gt;.ndjson</c>.</summary>
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
    string? ThumbnailUrl);
