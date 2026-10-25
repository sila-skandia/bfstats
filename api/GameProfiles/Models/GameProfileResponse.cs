using NodaTime;

namespace api.GameProfiles.Models;

/// <summary>One profile, as <c>stats/account/game-profiles</c> answers it. <see cref="JoinName"/> is
/// null when the profile plays through the relay as <see cref="PlayerName"/>.</summary>
public sealed record GameProfileResponse(
    string Name,
    string PlayerName,
    bool IsActive,
    Instant UpdatedAt,
    IReadOnlyDictionary<string, string> Files,
    string? JoinName = null);
