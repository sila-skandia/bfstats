namespace api.Dogfights.Models;

/// <summary>One row of the dogfight index as <c>tools/bf1942-models/extract_dogfights.mjs</c>
/// writes it: a fight found in a shared recording. Names are the recording's bytes.</summary>
public record DogfightIndexRow(
    string Id,
    string Slug,
    string? Mod,
    string? Level,
    string? Recorded,
    string? Server,
    string? Source,
    double T0,
    double Duration,
    string Kind,
    bool Mutual,
    double? Closest,
    DogfightKillDto? Kill,
    DogfightEndDto? End,
    IReadOnlyList<DogfightSideDto> Sides,
    bool Clip = false);
