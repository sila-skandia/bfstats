namespace api.Shorts.Models;

/// <summary>The <c>meta</c> part of a Short's upload.</summary>
public sealed record ShortUploadMeta(
    string? RecordingSlug,
    double KillTime,
    int VictimPid,
    string? Kind,
    string? Title,
    string? Killer,
    string? Victim,
    string? Weapon,
    string? KillerVehicle,
    string? VictimVehicle,
    double Distance,
    double LengthSeconds,
    string? Level,
    string? Mod,
    // Every man killed in it beyond <see cref="Victim"/>: a compilation's victims, a crash
    // reel's pilots. Optional; the strip's player filter reads them.
    IReadOnlyList<string>? Victims = null);
