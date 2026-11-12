using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;

namespace api.Recordings;

/// <summary>
/// The bytes on the recordings volume, as the quota counts them: every recording on disk (its
/// file, server log and thumbnail, shared or not) and every Short (video, HD copy and poster), which live
/// under the same root (<see cref="api.Shorts.ShortStorage"/>). One sum for the feed's meter and
/// every upload's room check: the meter and the recording uploads once counted the recordings
/// alone and showed 241 MB of a volume holding about 3.3 GB (2026-11-11).
/// </summary>
public static class VolumeUsage
{
    public static async Task<long> StoredBytesAsync(PlayerTrackerDbContext db, CancellationToken ct)
    {
        var recordings = await db.Recordings.Where(r => !r.FileMissing)
            .SumAsync(r => r.RecordingBytes + r.ServerLogBytes + r.ThumbnailBytes, ct);
        var shorts = await db.ReplayShorts.SumAsync(s => s.VideoBytes + s.HdVideoBytes + s.LinkVideoBytes + s.PosterBytes, ct);
        return recordings + shorts;
    }
}
