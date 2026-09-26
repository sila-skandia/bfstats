using api.Armoury.Models;

namespace api.ServiceRecord.Models;

/// <summary>
/// One army the player served in, with where they fought for it and what it fielded there.
/// </summary>
/// <param name="Key">Stable army identifier, e.g. "bf1942:rus:RussianSoldier".</param>
/// <param name="Mod">The roster the army belongs to: "bf1942" for all three WWII packs, "eod", or the mod.</param>
/// <param name="Maps">The five maps with the most minutes.</param>
/// <param name="Kits">The kits of the army's most-played map, with their HUD icons.</param>
/// <param name="Figure">The soldier of the army's most-played map, or null when none was extracted.</param>
/// <param name="Vehicles">The motor pool: the eight machines with the most exposure.</param>
public record ServiceRecordArmy(
    string Key,
    string Name,
    string? Nation,
    string NationLabel,
    string Side,
    string Mod,
    double Minutes,
    int Rounds,
    int Kills,
    int Deaths,
    int Score,
    int Wins,
    int Losses,
    IReadOnlyList<ServiceRecordMap> Maps,
    IReadOnlyList<ArmyKit> Kits,
    ArmyFigure? Figure,
    IReadOnlyList<ServiceRecordVehicle> Vehicles);
