namespace api.Armoury.Models;

/// <summary>
/// The extracted soldier for an army's uniform, with the pose to draw for each kit.
/// Every path is relative to the mesh asset root (<c>/stats/assets/mesh/</c>) and is known
/// to exist, so a client never probes for a file that is not there.
/// </summary>
/// <param name="Skin">Soldier template, as the mesh tree spells it, e.g. "RussianSoldier".</param>
/// <param name="Thumb">The mesh site's browse render of the soldier, or null.</param>
/// <param name="Kits">One entry per kit that has a posed weapon, in the level's kit order.</param>
public record ArmyFigure(string Skin, string? Thumb, IReadOnlyList<FigureKit> Kits);
