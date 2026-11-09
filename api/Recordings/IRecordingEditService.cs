using api.Recordings.Models;

namespace api.Recordings;

/// <summary>Creators' edits of clips of shared recordings (features/replay-creator-view,
/// "Sharing an edit").</summary>
public interface IRecordingEditService
{
    /// <summary>Keeps <paramref name="actor"/>'s edit of recording <paramref name="slug"/> and
    /// answers it with its link; null for no such recording. Throws
    /// <see cref="RecordingRejectedException"/> for an edit that is not a JSON object or is too
    /// big, and for a name the account has not linked.</summary>
    Task<RecordingEditDto?> ShareAsync(string slug, RecordingActor actor, ShareRecordingEditRequest request, CancellationToken ct);

    /// <summary>The edit with this <paramref name="code"/>, or null.</summary>
    Task<RecordingEditDto?> GetAsync(string code, CancellationToken ct);
}
