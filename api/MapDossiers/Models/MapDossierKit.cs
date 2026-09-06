using System.Text.Json.Serialization;

namespace api.MapDossiers.Models;

/// <summary>
/// One kit a side can spawn with.
///
/// The base game has five roles and mods do not — FHSW declares 571 distinct kits — so
/// the level's own kit template is kept whole rather than flattened onto the stock five.
/// <see cref="Role"/> is a best-effort mapping used only to pick fallback art.
/// </summary>
public record MapDossierKit
{
    /// <summary>Kit template the level names, e.g. "Iraq_Sniper", "1Auss_CloseQuartersOwenSmoke".</summary>
    [JsonPropertyName("template")]
    public string Template { get; init; } = "";

    [JsonPropertyName("name")]
    public string Name { get; init; } = "";

    /// <summary>"scout", "assault", "at", "medic", "engineer", or null for a kit outside the stock five.</summary>
    [JsonPropertyName("role")]
    public string? Role { get; init; }

    /// <summary>Icon lookup key; resolved to <see cref="IconPath"/> before the response is returned.</summary>
    [JsonPropertyName("icon")]
    public string Icon { get; init; } = "";

    /// <summary>
    /// Path under the hud asset route for this kit's in-game icon
    /// (e.g. "kits/desertcombat/assaultaxis.png"), or null when nothing matches.
    /// </summary>
    [JsonPropertyName("iconPath")]
    public string? IconPath { get; init; }
}
