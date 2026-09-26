using System.Text.Json.Serialization;

namespace api.Armoury.Models;

/// <summary>One kit in a model tree's <c>kits.json</c>.</summary>
public record MeshKit
{
    /// <summary>Kit template, e.g. "Rus_Assault". Levels may spell it in another case.</summary>
    [JsonPropertyName("template")]
    public string Template { get; init; } = "";

    /// <summary>
    /// The weapon a soldier spawns holding (the kit's slot-3 <c>HandFireArms</c>), spelled as
    /// its own template, or null. Manifests written before the extractor recorded it have none.
    /// </summary>
    [JsonPropertyName("primary")]
    public string? Primary { get; init; }

    /// <summary>Weapons and tools in the order the kit declares them.</summary>
    [JsonPropertyName("items")]
    public IReadOnlyList<MeshKitItem> Items { get; init; } = [];

    [JsonPropertyName("worn")]
    public IReadOnlyList<MeshKitWornPart> Worn { get; init; } = [];
}
