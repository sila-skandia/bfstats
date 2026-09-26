using System.Text.Json.Serialization;

namespace api.Armoury.Models;

/// <summary>
/// A model tree's <c>kits.json</c>, written by the kit extractor: every kit the tree's mod
/// declares, with the items it carries and the parts its soldier wears. Only the fields
/// the armoury reads are mapped.
/// </summary>
public record MeshKitManifest
{
    [JsonPropertyName("kits")]
    public IReadOnlyList<MeshKit> Kits { get; init; } = [];
}
