using api.Shorts.Models;

namespace api.Shorts;

/// <summary>Replay Shorts (features/replay-shorts): the week's strip, one Short, and the render
/// job's uploads.</summary>
public interface IShortService
{
    /// <summary>Shorts made in the last <paramref name="days"/> days (1 to 60), newest first,
    /// or most viewed first for <paramref name="sort"/> <c>views</c>.</summary>
    Task<PagedShortsDto> ListAsync(int days, string? sort, int page, int pageSize, CancellationToken ct, string? kind = null);

    Task<ShortDto?> GetAsync(string slug, CancellationToken ct);

    /// <summary>The keys of the kills already clipped from one recording.</summary>
    Task<ShortKeysDto> KeysAsync(string? recordingSlug, CancellationToken ct);

    /// <summary>
    /// Reads a <c>multipart/form-data</c> body: <c>meta</c> (JSON, <see cref="ShortUploadMeta"/>),
    /// <c>video</c> (MP4) and <c>poster</c> (JPEG). A kill clipped already is the Short there,
    /// and nothing is written. Throws <see cref="api.Recordings.RecordingRejectedException"/>
    /// with the reason for anything it will not keep.
    /// </summary>
    Task<ShortUploadResult> UploadAsync(string? contentType, Stream body, long? contentLength, CancellationToken ct);

    /// <summary>Takes a Short down, row and files. False when there is none.</summary>
    Task<bool> DeleteAsync(string slug, CancellationToken ct);

    /// <summary>A Short's id and its views as counted so far, or null when there is none.</summary>
    Task<(int Id, int Views)?> WatchableAsync(string slug, CancellationToken ct);
}
