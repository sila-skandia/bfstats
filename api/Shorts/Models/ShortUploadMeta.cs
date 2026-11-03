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
    string? Mod);
