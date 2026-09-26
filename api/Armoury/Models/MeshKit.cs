using System.Text.Json.Serialization;

namespace api.Armoury.Models;

/// <summary>One kit in a model tree's <c>kits.json</c>.</summary>
public record MeshKit
{
    /// <summary>Kit template, e.g. "Rus_Assault". Levels may spell it in another case.</summary>
    [JsonPropertyName("template")]
    public string Template { get; init; } = "";

    /// <summary>Weapons and tools in the order the kit hands them out; the first is the primary.</summary>
    [JsonPropertyName("items")]
    public IReadOnlyList<MeshKitItem> Items { get; init; } = [];

    [JsonPropertyName("worn")]
    public IReadOnlyList<MeshKitWornPart> Worn { get; init; } = [];
}
