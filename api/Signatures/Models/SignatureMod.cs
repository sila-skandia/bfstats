namespace api.Signatures.Models;

/// <summary>A mod the signatures can be drawn from, and the scenes it has art for.</summary>
/// <param name="Id">The mesh tree's mod id (<c>bf1942</c>, <c>fhsw</c>, <c>gcmod</c>...).</param>
/// <param name="GameIds">The bflist game ids that play this mod's art (DC Final plays Desert Combat's).</param>
/// <param name="Accent">The mod's accent colour as <c>#rrggbb</c>, used for its tag and rules.</param>
public sealed record SignatureMod(
    string Id,
    string Name,
    string Short,
    IReadOnlyList<string> GameIds,
    string Accent,
    IReadOnlyList<SignatureScene> Scenes);
