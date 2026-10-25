using System.Text.Json.Serialization;

namespace api.GameProfiles.Models;

/// <summary>
/// The body of <c>PATCH stats/account/game-profiles/{name}</c>: <c>{ joinName }</c>, where
/// null or "" clears it. A body without the field is refused, so an empty body never clears.
/// </summary>
public sealed record SetJoinNameRequest
{
    private readonly string? joinName;
    private readonly bool hasJoinName;

    public string? JoinName
    {
        get => joinName;
        init
        {
            joinName = value;
            hasJoinName = true;
        }
    }

    /// <summary>Whether the body carried <c>joinName</c> at all.</summary>
    [JsonIgnore]
    public bool HasJoinName => hasJoinName;
}
