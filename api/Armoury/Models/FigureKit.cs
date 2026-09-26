namespace api.Armoury.Models;

/// <summary>
/// A kit as the figure wears it: the monolithic pose holding the kit's weapon, and the
/// helmet, packs and radio to graft onto the pose's bones.
/// </summary>
/// <param name="Template">Kit template, matching one of the army's kits.</param>
/// <param name="Weapon">The kit's first item that has a pose, spelled as the pose file spells it.</param>
/// <param name="Pose">e.g. "models/poses/RussianSoldier__DP.pose.glb".</param>
/// <param name="Worn">Parts to graft, each found in the first tree of the search path that has it.</param>
public record FigureKit(string Template, string Weapon, string Pose, IReadOnlyList<FigureWornPart> Worn);
