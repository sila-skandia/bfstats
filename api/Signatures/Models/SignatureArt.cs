namespace api.Signatures.Models;

/// <summary>The mod and scene a signature is drawn with, and where its hero image is.</summary>
public sealed record SignatureArt(SignatureMod Mod, SignatureScene Scene, string HeroPath);
