using NodaTime;

namespace api.Dogfights.Models;

/// <summary>A recorded fight as bfstats.io's server and player pages list it
/// (features/dogfights-on-stats-pages). <see cref="Id"/> opens it in the dogfight school
/// (<c>https://play.bfstats.io/dogfight.html?fight=&lt;id&gt;</c>); <see cref="Slug"/> is the
/// recording it came from. <see cref="Kind"/> is <c>dogfight</c> (both fought) or
/// <c>bounce</c> (one attacked). <see cref="Clip"/>: the fight's own slice of the recording
/// was kept, so it can be watched in the 3D replay too.</summary>
public record DogfightDto(
    string Id,
    string Slug,
    string Mod,
    string Level,
    LocalDate? Recorded,
    string ServerName,
    string? Source,
    double Duration,
    string Kind,
    bool Mutual,
    double? Closest,
    DogfightKillDto? Kill,
    DogfightEndDto? End,
    IReadOnlyList<DogfightSideDto> Sides,
    bool Clip);
