using System.Text.Json.Serialization;

namespace api.GameProfiles.Models;

/// <summary>
/// The body of <c>PUT stats/account/game-profiles/{name}</c>. <see cref="Files"/>
/// replaces the stored set; <see cref="PlayerName"/>, when missing, is read from
/// <c>GeneralOptions.con</c>. <see cref="JoinName"/> changes the stored one only
/// when the body names it (null or "" clears it): a re-import that leaves it out keeps it.
/// </summary>
public sealed record UpsertGameProfileRequest(
    string? PlayerName,
    Dictionary<string, string?>? Files,
    bool MakeActive = false)
{
    private readonly string? joinName;
    private readonly bool hasJoinName;

    /// <summary>The join name to store; only read when <see cref="HasJoinName"/>.</summary>
    public string? JoinName
    {
        get => joinName;
        init
        {
            joinName = value;
            hasJoinName = true;
        }
    }

    /// <summary>Whether the body carried <c>joinName</c> at all (the JSON reader sets it only then).</summary>
    [JsonIgnore]
    public bool HasJoinName => hasJoinName;
}
