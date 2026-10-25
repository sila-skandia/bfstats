using api.GameProfiles.Models;

namespace api.GameProfiles;

/// <summary>The account's stored BF1942 profiles (features/game-profiles, "API contract").</summary>
public interface IGameProfileService
{
    /// <summary>Every profile of <paramref name="userId"/>, by name.</summary>
    Task<IReadOnlyList<GameProfileResponse>> ListAsync(int userId, CancellationToken cancellationToken = default);

    /// <summary>Creates or replaces the profile called <paramref name="name"/> (case-insensitively).</summary>
    Task<GameProfileResult> UpsertAsync(int userId, string name, UpsertGameProfileRequest request, CancellationToken cancellationToken = default);

    /// <summary>Makes <paramref name="name"/> the one active profile.</summary>
    Task<GameProfileResult> ActivateAsync(int userId, string name, CancellationToken cancellationToken = default);

    /// <summary>Deletes <paramref name="name"/>; when it was active, the most recently updated remaining one becomes active.</summary>
    Task<GameProfileResult> DeleteAsync(int userId, string name, CancellationToken cancellationToken = default);
}
