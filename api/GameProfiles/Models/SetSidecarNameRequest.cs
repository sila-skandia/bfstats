using System.Text.Json.Serialization;

namespace api.GameProfiles.Models;

/// <summary>
/// The body of <c>PATCH stats/account/game-profiles/{name}</c>: <c>{ sidecarName }</c>, where
/// null or "" clears it. A body without the field is refused, so an empty body never clears.
/// </summary>
public sealed record SetSidecarNameRequest
{
    private readonly string? sidecarName;
    private readonly bool hasSidecarName;

    public string? SidecarName
    {
        get => sidecarName;
        init
        {
            sidecarName = value;
            hasSidecarName = true;
        }
    }

    /// <summary>Whether the body carried <c>sidecarName</c> at all.</summary>
    [JsonIgnore]
    public bool HasSidecarName => hasSidecarName;
}
