using System.Text.Json.Serialization;

namespace api.GameProfiles.Models;

/// <summary>
/// The body of <c>PUT stats/account/game-profiles/{name}</c>. <see cref="Files"/>
/// replaces the stored set; <see cref="PlayerName"/>, when missing, is read from
/// <c>GeneralOptions.con</c>. <see cref="SidecarName"/> changes the stored one only
/// when the body names it (null or "" clears it): a re-import that leaves it out keeps it.
/// </summary>
public sealed record UpsertGameProfileRequest(
    string? PlayerName,
    Dictionary<string, string?>? Files,
    bool MakeActive = false)
{
    private readonly string? sidecarName;
    private readonly bool hasSidecarName;

    /// <summary>The sidecar name to store; only read when <see cref="HasSidecarName"/>.</summary>
    public string? SidecarName
    {
        get => sidecarName;
        init
        {
            sidecarName = value;
            hasSidecarName = true;
        }
    }

    /// <summary>Whether the body carried <c>sidecarName</c> at all (the JSON reader sets it only then).</summary>
    [JsonIgnore]
    public bool HasSidecarName => hasSidecarName;
}
