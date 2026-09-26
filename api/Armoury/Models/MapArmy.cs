namespace api.Armoury.Models;

/// <summary>
/// One side of a map as an army: who they are, what they carry, and the soldier to draw.
/// </summary>
public record MapArmy(
    int Index,
    string Side,
    string Key,
    string Name,
    string? Nation,
    string NationLabel,
    IReadOnlyList<ArmyKit> Kits,
    ArmyFigure? Figure);
