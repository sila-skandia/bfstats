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
    string PosterUrl)
{
    public static ShortDto From(ReplayShort s) => new(
        s.Slug, s.RecordingSlug, s.KillTime, s.VictimPid, s.Key, s.Kind, s.Title, s.Killer, s.Victim, s.Weapon,
        s.KillerVehicle, s.VictimVehicle, s.Distance, s.LengthSeconds, s.Level, s.Mod, s.CreatedAt, s.Views,
        $"/stats/shorts/{s.Slug}.mp4", $"/stats/shorts/{s.Slug}.jpg");
}
