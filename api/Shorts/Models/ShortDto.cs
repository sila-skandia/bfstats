using NodaTime;

namespace api.Shorts.Models;

/// <summary>A Short as the REPLAY tab's strip reads it. The URLs are relative to the API's origin.</summary>
public sealed record ShortDto(
    string Slug,
    string RecordingSlug,
    double KillTime,
    int VictimPid,
    string Key,
    string Kind,
    string Title,
    string Killer,
    string Victim,
    string Weapon,
    string? KillerVehicle,
    string? VictimVehicle,
    double Distance,
    double LengthSeconds,
    string Level,
    string Mod,
    Instant CreatedAt,
    int Views,
    string VideoUrl,
    string PosterUrl,
    string? CreatorName = null,
    // The HD copy's link, null when there is none (an action roll's 1080p take).
    string? HdVideoUrl = null,
    // 16:9 rather than 9:16: an action roll.
    bool Landscape = false,
    // The small copy the share link names, null when there is none (features/action-roll).
    string? LinkVideoUrl = null)
{
    /// <summary>The video's and the poster's links carry their sizes as a version (<c>?v=</c>):
    /// they are served for a year, and one replaced (a new poster, a video flattened) is a new
    /// link.</summary>
    public static ShortDto From(ReplayShort s) => new(
        s.Slug, s.RecordingSlug, s.KillTime, s.VictimPid, s.Key, s.Kind, s.Title, s.Killer, s.Victim, s.Weapon,
        s.KillerVehicle, s.VictimVehicle, s.Distance, s.LengthSeconds, s.Level, s.Mod, s.CreatedAt, s.Views,
        $"/stats/shorts/{s.Slug}.mp4?v={s.VideoBytes}", $"/stats/shorts/{s.Slug}.jpg?v={s.PosterBytes}", s.CreatorName,
        s.HdVideoBytes > 0 ? $"/stats/shorts/{s.Slug}.hd.mp4?v={s.HdVideoBytes}" : null,
        ShortKinds.IsLandscape(s.Kind),
        s.LinkVideoBytes > 0 ? $"/stats/shorts/{s.Slug}.link.mp4?v={s.LinkVideoBytes}" : null);
}
