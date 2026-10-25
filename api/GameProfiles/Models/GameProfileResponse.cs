using NodaTime;

namespace api.GameProfiles.Models;

/// <summary>One profile, as <c>stats/account/game-profiles</c> answers it.</summary>
public sealed record GameProfileResponse(
    string Name,
    string PlayerName,
    bool IsActive,
    Instant UpdatedAt,
    IReadOnlyDictionary<string, string> Files);
