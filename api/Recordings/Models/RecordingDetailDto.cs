using NodaTime;

namespace api.Recordings.Models;

/// <summary>One recording's page: the feed's card and what else the file says, and whether
/// the viewer may rename or remove it (its uploader, or an admin). <see cref="UploaderPlayer"/>
/// is the uploader as bfstats.io has a player page for them, or null when it has none.</summary>
public record RecordingDetailDto(
    string Slug,
    string Title,
    string UploaderName,
    string Level,
    string Mod,
    string GameMode,
    string ServerName,
    string RecordedLocal,
    string RecordedBy,
    double DurationSeconds,
    IReadOnlyList<string> Players,
    int FormatVersion,
    long RecordingBytes,
    long RecordingRawBytes,
    int ViewCount,
    int CommentCount,
    Instant CreatedAt,
    string RecordingUrl,
    string? ServerLogUrl,
    string? ThumbnailUrl,
    bool CanManage,
    string? UploaderPlayer);
