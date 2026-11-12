using api.Shorts.Models;

namespace api.Shorts;

/// <summary>Replay Shorts (features/replay-shorts): the week's strip, one Short, and the render
/// job's uploads.</summary>
public interface IShortService
{
    /// <summary>Shorts made in the last <paramref name="days"/> days (1 to 3650), newest first,
    /// or most viewed first for <paramref name="sort"/> <c>views</c>.</summary>
    Task<PagedShortsDto> ListAsync(int days, string? sort, int page, int pageSize, CancellationToken ct, string? kind = null,
        string? player = null, string? server = null);
    Task<ShortPlayersDto> PlayersAsync(int days, CancellationToken ct);

    Task<ShortDto?> GetAsync(string slug, CancellationToken ct);

    /// <summary>The keys of the kills already clipped from one recording.</summary>
    Task<ShortKeysDto> KeysAsync(string? recordingSlug, CancellationToken ct);

    /// <summary>
    /// Reads a <c>multipart/form-data</c> body: <c>meta</c> (JSON, <see cref="ShortUploadMeta"/>),
    /// <c>video</c> (MP4), optionally <c>videoHd</c> (MP4, a smaller copy), either video as a chunked
    /// upload's id instead (<c>videoUpload</c>, <c>videoHdUpload</c>), and <c>poster</c> (JPEG). A kill clipped already is the Short there,
    /// and nothing is written. Throws <see cref="api.Recordings.RecordingRejectedException"/>
    /// with the reason for anything it will not keep.
    /// </summary>
    Task<ShortUploadResult> UploadAsync(string? contentType, Stream body, long? contentLength, CancellationToken ct);

    /// <summary>One part of a chunked upload, the raw bytes in <paramref name="body"/>, kept as
    /// <c>&lt;upload&gt;.&lt;index&gt;.part</c> until an upload's <c>videoUpload</c> or
    /// <c>videoHdUpload</c> part names it (<see cref="UploadAsync"/>).</summary>
    Task<ShortPartDto> ReceivePartAsync(string? upload, int index, Stream body, long? contentLength, CancellationToken ct);

    /// <summary>A signed-in player's clip from the studio, shared as a Short under his linked
    /// in-game name (<see cref="ShortKinds.Creator"/>), live at once.</summary>
    Task<ShortUploadResult> ShareAsync(string? contentType, Stream body, long? contentLength, int userId, CancellationToken ct);

    /// <summary>Whether <paramref name="userId"/> shared the Short <paramref name="slug"/>.</summary>
    Task<bool> SharedByAsync(string slug, int userId, CancellationToken ct);

    /// <summary>Replaces a Short's poster with the JPEG in <paramref name="body"/>: the Short with
    /// its new poster link, or null when there is none.</summary>
    Task<ShortDto?> SetPosterAsync(string slug, Stream body, CancellationToken ct);

    /// <summary>Flattens a Short's video when it is a fragmented MP4 (<see cref="IVideoFlattener"/>):
    /// the Short, its video link new when it was rewritten, or null when there is none.</summary>
    /// <summary>Puts a small link copy beside a Short (an MP4 in the body), the video its share
    /// link names; null when there is no such Short.</summary>
    Task<ShortDto?> SetLinkVideoAsync(string slug, Stream body, CancellationToken ct);

    Task<ShortDto?> FlattenVideoAsync(string slug, CancellationToken ct);

    /// <summary>Takes a Short down, row and files. False when there is none.</summary>
    Task<bool> DeleteAsync(string slug, CancellationToken ct);

    /// <summary>Takes down every Short <see cref="ShortsOptions.RetentionDays"/> days old or more
    /// with <see cref="ShortsOptions.RetentionMaxViews"/> views or fewer, except a creator's share:
    /// its files go, and its row stays as a tombstone (<see cref="Models.ReplayShort.PrunedAt"/>)
    /// whose key <see cref="KeysAsync"/> still names. Then sweeps the chunked uploads left
    /// unjoined for <see cref="ShortsOptions.PartsMaxAgeHours"/>. On a dry run it only lists what
    /// it would take, and sweeps nothing. Never runs by itself: the nightly Shorts job calls it.</summary>
    Task<ShortPruneDto> PruneUnwatchedAsync(bool dryRun, CancellationToken ct);

    /// <summary>A Short's id and its views as counted so far, or null when there is none.</summary>
    Task<(int Id, int Views)?> WatchableAsync(string slug, CancellationToken ct);
}
