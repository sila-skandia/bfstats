namespace api.Armoury.Models;

/// <summary>
/// One piece of kit worn on the body, placed exactly as the kit manifest places it.
/// </summary>
/// <param name="Path">e.g. "models/Russ_Helmet.kit.glb".</param>
/// <param name="Bone">Bone to attach to: "A", "backpack" or "HipPack".</param>
/// <param name="Slot">"head", "back" or "hip".</param>
/// <param name="Position">Offset from the bone, [0, 0, 0] when the manifest gives none.</param>
/// <param name="Rotation">Rotation from the bone, [0, 0, 0] when the manifest gives none.</param>
public record FigureWornPart(
    string Path,
    string? Bone,
    string? Slot,
    IReadOnlyList<double> Position,
    IReadOnlyList<double> Rotation);
