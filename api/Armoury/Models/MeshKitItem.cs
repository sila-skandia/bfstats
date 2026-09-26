using System.Text.Json.Serialization;

namespace api.Armoury.Models;

/// <summary>One item a kit carries, e.g. "DP" or "MP18".</summary>
public record MeshKitItem
{
    [JsonPropertyName("template")]
    public string Template { get; init; } = "";
}
