using System.Text.Json.Serialization;

namespace api.MapDossiers.Models;

/// <summary>
/// One machine a side can field on this map, and how many spawn points supply it.
/// The count is spawn points rather than simultaneous vehicles: a spawner refills once
/// its previous vehicle has been destroyed or abandoned long enough.
/// </summary>
public record MapDossierArsenalEntry
{
    [JsonPropertyName("team")]
    public int Team { get; init; }

    /// <summary>Object template the spawner names, e.g. "chi-ha".</summary>
    [JsonPropertyName("template")]
    public string Template { get; init; } = "";

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    /// <summary>Template name flattened to lowercase alphanumerics, unique within a team.</summary>
    [JsonPropertyName("key")]
    public string Key { get; init; } = "";

    /// <summary>Icon lookup key; resolved to <see cref="IconPath"/> before the response is returned.</summary>
    [JsonPropertyName("icon")]
    public string Icon { get; init; } = "";

    /// <summary>"land", "air", "sea", "emplacement", or "unknown" for mod content we cannot classify.</summary>
    [JsonPropertyName("category")]
    public string Category { get; init; } = "";

    [JsonPropertyName("spawnPoints")]
    public int SpawnPoints { get; init; }

    /// <summary>
    /// Path under the hud asset route for this machine's in-game icon
    /// (e.g. "vehicles/bf1942/sherman.png"), or null when the game ships no art for it.
    /// </summary>
    [JsonPropertyName("iconPath")]
    public string? IconPath { get; init; }
}
