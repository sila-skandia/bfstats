using System.Text.Json.Serialization;

namespace api.MapDossiers.Models;

/// <summary>
/// One side of a map, as the level declares it. bflist only ever reports "Axis" and
/// "Allied", so the nationality here is information the live server feed does not carry.
/// </summary>
public record MapDossierTeam
{
    /// <summary>Refractor team number, 1 or 2.</summary>
    [JsonPropertyName("index")]
    public int Index { get; init; }

    /// <summary>Nation code ("us", "ger", "jp", "rus", "brit", "can"), or null for a mod skin we cannot place.</summary>
    [JsonPropertyName("nation")]
    public string? Nation { get; init; }

    [JsonPropertyName("label")]
    public string Label { get; init; } = "";

    /// <summary>Soldier model the level names, e.g. "GermanDesertSoldier".</summary>
    [JsonPropertyName("skin")]
    public string? Skin { get; init; }

    /// <summary>Tickets this side starts the round with.</summary>
    [JsonPropertyName("tickets")]
    public int? Tickets { get; init; }

    /// <summary>Tickets lost per minute while the other side holds the majority of flags.</summary>
    [JsonPropertyName("ticketLossPerMin")]
    public int? TicketLossPerMin { get; init; }

    /// <summary>True when the level designates this side the attacker.</summary>
    [JsonPropertyName("isAssault")]
    public bool IsAssault { get; init; }

    /// <summary>
    /// Kits this side can spawn with, as the level declares them. Mods field their own
    /// class systems, so these are not limited to the base game's five roles.
    /// </summary>
    [JsonPropertyName("kits")]
    public IReadOnlyList<MapDossierKit> Kits { get; init; } = [];
}
