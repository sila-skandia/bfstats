using api.PlayerTracking;
using NodaTime;

namespace api.GameProfiles.Models;

/// <summary>
/// A BF1942 profile stored on an account (features/game-profiles): the profile
/// folder's name, the player name it plays as, and the five files the viewer
/// reads (<see cref="GameProfileRules.AllowedFiles"/>), as text.
/// </summary>
public class GameProfile
{
    public int Id { get; set; }

    public int UserId { get; set; }

    /// <summary>The profile folder's name, as the game wrote it.</summary>
    public string Name { get; set; } = "";

    /// <summary><see cref="Name"/> upper-cased: the per-user unique key, so names match case-insensitively.</summary>
    public string NormalizedName { get; set; } = "";

    /// <summary>Raw, as the game stores it (cp1252 text); decode for display only.</summary>
    public string PlayerName { get; set; } = "";

    /// <summary>
    /// The name to play as through the sidecar, when it differs from <see cref="PlayerName"/>
    /// (features/game-profiles, "Sidecar name"); null plays as <see cref="PlayerName"/>.
    /// Set by PATCH; a re-import keeps it.
    /// </summary>
    public string? SidecarName { get; set; }

    public bool IsActive { get; set; }

    /// <summary>The files as a JSON object, file key to text. At most 5 x 64 KB.</summary>
    public string FilesJson { get; set; } = "{}";

    public Instant CreatedAt { get; set; }

    public Instant UpdatedAt { get; set; }

    public User User { get; set; } = null!;
}
