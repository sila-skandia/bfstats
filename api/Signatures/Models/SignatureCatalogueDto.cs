namespace api.Signatures.Models;

/// <summary>What the signature builders offer: every mod with art and its scenes.</summary>
public sealed record SignatureCatalogueDto(IReadOnlyList<SignatureMod> Mods);
