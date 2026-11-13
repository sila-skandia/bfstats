using System.Text.Json;
using api.Signatures.Models;

namespace api.Signatures;

/// <summary>
/// The hero art the forum signatures are drawn with: posed soldiers, tanks and aircraft
/// rendered offline from the mesh viewer's models (scripts/signatures/render_signature_art.py)
/// and shipped in the API image under <c>Signatures/Art</c>, with <c>catalogue.json</c>
/// listing each mod's scenes. See features/forum-signatures/README.md.
/// </summary>
public sealed class SignatureArtCatalogue
{
    /// <summary>The mod a signature falls back to when none is asked for or known.</summary>
    public const string DefaultMod = "bf1942";

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private readonly string _root;
    private readonly IReadOnlyList<SignatureMod> _mods;

    public SignatureArtCatalogue() : this(Path.Combine(AppContext.BaseDirectory, "Signatures", "Art"))
    {
    }

    public SignatureArtCatalogue(string root)
    {
        _root = root;
        _mods = Load(Path.Combine(root, "catalogue.json"));
    }

    public IReadOnlyList<SignatureMod> Mods => _mods;

    /// <summary>
    /// The art for a signature: the mod asked for, else the one that plays <paramref name="gameId"/>,
    /// else <see cref="DefaultMod"/>; its scene asked for, else its first. Null only when the
    /// catalogue is empty (an image built without the art).
    /// </summary>
    public SignatureArt? Pick(string? modId, string? sceneId, string? gameId = null)
    {
        var mod = Find(modId) ?? ForGame(gameId) ?? Find(DefaultMod) ?? (_mods.Count > 0 ? _mods[0] : null);
        if (mod is null || mod.Scenes.Count == 0)
            return null;

        var scene = mod.Scenes.FirstOrDefault(s => s.Id.Equals(sceneId?.Trim(), StringComparison.OrdinalIgnoreCase))
                    ?? mod.Scenes[0];
        return new SignatureArt(mod, scene, Path.Combine(_root, mod.Id, $"{scene.Id}.webp"));
    }

    /// <summary>The mod whose art a server of this bflist game id plays.</summary>
    public SignatureMod? ForGame(string? gameId)
    {
        if (string.IsNullOrWhiteSpace(gameId))
            return null;
        var id = gameId.Trim();
        return _mods.FirstOrDefault(m => m.GameIds.Any(g => g.Equals(id, StringComparison.OrdinalIgnoreCase)))
               ?? Find(id);
    }

    private SignatureMod? Find(string? modId) =>
        string.IsNullOrWhiteSpace(modId)
            ? null
            : _mods.FirstOrDefault(m => m.Id.Equals(modId.Trim(), StringComparison.OrdinalIgnoreCase));

    private static IReadOnlyList<SignatureMod> Load(string path)
    {
        if (!File.Exists(path))
            return [];

        using var stream = File.OpenRead(path);
        var doc = JsonSerializer.Deserialize<CatalogueFile>(stream, JsonOptions);
        return doc?.Mods ?? [];
    }

    private sealed record CatalogueFile(List<SignatureMod> Mods);
}
