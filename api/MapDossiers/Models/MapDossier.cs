using System.Text.Json.Serialization;

namespace api.MapDossiers.Models;

/// <summary>
/// The battle intel for one map, read out of the level's own .con configuration:
/// who fights, what they start with, where the flags are, and what they can field.
/// </summary>
public record MapDossier
{
    /// <summary>Mod folder the level was found in, which may be a parent of the requested one.</summary>
    [JsonPropertyName("mod")]
    public string Mod { get; init; } = "";

    /// <summary>Level folder name, lowercased (e.g. "battle_of_the_bulge").</summary>
    [JsonPropertyName("map")]
    public string Map { get; init; } = "";

    [JsonPropertyName("displayName")]
    public string DisplayName { get; init; } = "";

    /// <summary>Terrain edge length in world units, the scale control point positions are given in.</summary>
    [JsonPropertyName("worldSize")]
    public double? WorldSize { get; init; }

    [JsonPropertyName("teams")]
    public IReadOnlyList<MapDossierTeam> Teams { get; init; } = [];

    [JsonPropertyName("controlPoints")]
    public IReadOnlyList<MapDossierControlPoint> ControlPoints { get; init; } = [];

    /// <summary>
    /// False when the minimap texture is framed differently from the terrain, which
    /// would scatter the flags across unrelated ground. Callers should list the control
    /// points rather than plot them.
    /// </summary>
    [JsonPropertyName("controlPointsPlottable")]
    public bool ControlPointsPlottable { get; init; }

    [JsonPropertyName("arsenal")]
    public IReadOnlyList<MapDossierArsenalEntry> Arsenal { get; init; } = [];
}
