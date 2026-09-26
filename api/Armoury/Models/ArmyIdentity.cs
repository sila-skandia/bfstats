namespace api.Armoury.Models;

/// <summary>
/// Which army a dossier team is: the level's team skin and flag, named the way a player
/// would recognise it.
/// </summary>
/// <param name="Key">Stable identifier, e.g. "bf1942:rus:RussianSoldier" or "fhsw:ger".</param>
/// <param name="Name">Display name, e.g. "Red Army".</param>
/// <param name="Nation">The level's nation code ("rus", "can"), or null when the mod's skin has none.</param>
/// <param name="NationLabel">The dossier's team label, e.g. "Soviet Union".</param>
/// <param name="Side">"axis" for team 1, "allied" for team 2.</param>
/// <param name="Family">Roster the army belongs to: "bf1942" for all three WWII packs, "eod", or the mod itself.</param>
public record ArmyIdentity(
    string Key,
    string Name,
    string? Nation,
    string NationLabel,
    string Side,
    string Family);
