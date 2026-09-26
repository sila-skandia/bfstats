using System.Text.Json.Serialization;

namespace api.Armoury.Models;

/// <summary>A part a kit's soldier wears, as <c>kits.json</c> places it.</summary>
public record MeshKitWornPart
{
    [JsonPropertyName("template")]
    public string Template { get; init; } = "";

    [JsonPropertyName("slot")]
    public string? Slot { get; init; }

    [JsonPropertyName("bone")]
    public string? Bone { get; init; }

    [JsonPropertyName("position")]
    public IReadOnlyList<double>? Position { get; init; }

    [JsonPropertyName("rotation")]
    public IReadOnlyList<double>? Rotation { get; init; }

    /// <summary>The part's own glb file name, or null when the extractor produced none.</summary>
    [JsonPropertyName("glb")]
    public string? Glb { get; init; }
}
