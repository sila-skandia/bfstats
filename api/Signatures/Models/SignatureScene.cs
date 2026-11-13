namespace api.Signatures.Models;

/// <summary>
/// One posed hero a mod offers: a soldier, tank or aircraft caught in a moment of
/// action, drawn from the mesh viewer's models (scripts/signatures/scenes.json).
/// </summary>
/// <param name="Id">Stable id used in signature URLs (<c>scene=armour</c>).</param>
/// <param name="Label">Short caption for the picker ("Tiger fires").</param>
/// <param name="Kind">soldier, vehicle or plane.</param>
/// <param name="Backdrop">The level whose loading screen sits behind it by default.</param>
public sealed record SignatureScene(string Id, string Label, string Kind, string? Backdrop);
