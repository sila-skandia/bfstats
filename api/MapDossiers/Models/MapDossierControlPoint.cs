using System.Text.Json.Serialization;

namespace api.MapDossiers.Models;

/// <summary>
/// A capturable flag, with its position expressed as a fraction of the minimap so a
/// caller can plot it over the map image without knowing the world scale.
/// </summary>
public record MapDossierControlPoint
{
    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    /// <summary>Raw level-editor identifier, unique within the map.</summary>
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    /// <summary>Team holding the flag at round start; 0 when it starts neutral.</summary>
    [JsonPropertyName("team")]
    public int Team { get; init; }

    /// <summary>Left-to-right position, 0..1. Null when the level declares no world size.</summary>
    [JsonPropertyName("x")]
    public double? X { get; init; }

    /// <summary>Top-to-bottom position, 0..1. Null when the level declares no world size.</summary>
    [JsonPropertyName("y")]
    public double? Y { get; init; }
}
