using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace api.ImageStorage;

/// <summary>
/// Resolves a per-tree glb path through the tree's manifest to its store blob, exactly as the
/// viewer's <c>glb-store.js</c> does: the path names the tree (<c>models</c> or
/// <c>models/mods/&lt;m&gt;</c>) and the manifest that answers for it — <c>models.json</c> for a
/// root glb, <c>viewmodels/index.json</c> for a first-person rig, <c>poses/index.json</c> for
/// anything under <c>poses/</c> — and the name's recorded sha gives the blob. The route asks
/// only after the per-tree path itself missed, so while the files are still on the volume
/// nothing changes, and after GC the names keep serving.
///
/// Parsed tables are cached against the manifest file's stamp (modification time and length):
/// the armoury pulls a figure's every part through this route, and a manifest only changes on
/// a republish. Only manifests that exist on the volume are cached — a few per published tree,
/// a few MB of names and hashes in all — and the cache is capped outright, per the deployment
/// rules on memory.
/// </summary>
public sealed class MeshGlbStoreResolver(ILogger<MeshGlbStoreResolver> logger) : IMeshGlbStoreResolver
{
    private const int MaxCachedManifests = 128;

    private readonly ConcurrentDictionary<string, CachedManifest> manifests = new(StringComparer.Ordinal);

    public string? ResolveBlobPath(string meshRoot, string relativePath)
    {
        if (string.IsNullOrEmpty(meshRoot) || string.IsNullOrEmpty(relativePath))
            return null;

        if (Locate(relativePath) is not { } manifest)
            return null;

        var table = Table(Path.Combine(meshRoot, manifest.RelativePath), manifest.Kind);
        return table is not null && table.TryGetValue(manifest.Key, out var sha)
            ? MeshGlbStore.BlobPath(sha)
            : null;
    }

    /// <summary>
    /// The manifest that answers for this path and the name to look up in it, or null for a
    /// path the store has no say over (a level scene, a texture, a kit glb, a blob already).
    /// </summary>
    private static (string RelativePath, string Key, ManifestKind Kind)? Locate(string relativePath)
    {
        if (!relativePath.EndsWith(".glb", StringComparison.Ordinal))
            return null;

        // The store covers the model trees alone: `models`, or `models/mods/<m>`.
        var parts = relativePath.Split('/');
        if (parts is not ["models", .. var rest] || rest.Length == 0)
            return null;

        var tree = "models";
        if (rest is ["mods", { Length: > 0 } mod, .. var inner] && inner.Length > 0)
        {
            tree = $"models/mods/{mod}";
            rest = inner;
        }

        var rel = string.Join('/', rest);
        if (rel.StartsWith("poses/", StringComparison.Ordinal))
            return ($"{tree}/poses/index.json", rel["poses/".Length..], ManifestKind.ShaTable);

        if (rel.StartsWith("viewmodels/", StringComparison.Ordinal))
        {
            var stem = rel["viewmodels/".Length..];
            return stem.EndsWith(".fp.glb", StringComparison.Ordinal) && !stem.Contains('/')
                ? ($"{tree}/viewmodels/index.json", stem, ManifestKind.ShaTable)
                : null;        // viewmodels/skins/ and friends: no manifest names them
        }

        return rel.Contains('/') ? null : ($"{tree}/models.json", rel, ManifestKind.Models);
    }

    private Dictionary<string, string>? Table(string manifestPath, ManifestKind kind)
    {
        try
        {
            var info = new FileInfo(manifestPath);
            if (!info.Exists)
            {
                manifests.TryRemove(manifestPath, out _);
                return null;
            }

            var ticks = info.LastWriteTimeUtc.Ticks;
            if (manifests.TryGetValue(manifestPath, out var held)
                && held.Ticks == ticks && held.Length == info.Length)
                return held.Table;

            Dictionary<string, string> table;
            try
            {
                table = kind is ManifestKind.Models
                    ? MeshGlbStore.ReadModelShas(manifestPath)
                    : MeshGlbStore.ReadShaTable(manifestPath);
            }
            catch (Exception ex)
            {
                // An unreadable manifest costs the fallback, not the route — the request
                // 404s as it would without a store — and the empty table is held against
                // this stamp rather than re-parsed per request.
                logger.LogWarning(ex, "Could not read the glb store manifest {Path}", manifestPath);
                table = new Dictionary<string, string>(StringComparer.Ordinal);
            }

            if (manifests.Count >= MaxCachedManifests && !manifests.ContainsKey(manifestPath))
            {
                // A volume holds a few dozen manifests; only something pathological gets
                // here, and starting over is cheaper than an eviction policy.
                logger.LogWarning("Glb store manifest cache hit its cap of {Cap}; clearing", MaxCachedManifests);
                manifests.Clear();
            }

            manifests[manifestPath] = new CachedManifest(ticks, info.Length, table);
            return table;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not resolve through the glb store manifest {Path}", manifestPath);
            return null;
        }
    }

    private enum ManifestKind { Models, ShaTable }

    private readonly record struct CachedManifest(long Ticks, long Length, Dictionary<string, string> Table);
}
