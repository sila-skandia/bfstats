using System.Text.Json;

namespace api.ImageStorage;

/// <summary>
/// Reads the name -> sha tables the content-addressed glb store records in a model tree's
/// manifests (features/mesh-asset-size, phase 5; written by
/// <c>tools/bf1942-models/store_glbs.py</c>). Each distinct model, rig or pose glb is stored
/// once as <c>glbs/&lt;sha256&gt;.glb</c> under the mesh root, and the manifests say which blob
/// a per-tree name resolves to: <c>models.json</c> rows carry <c>sha</c>, <c>cockpitSha</c> and
/// a <c>sha</c> per variant; <c>viewmodels/index.json</c> and <c>poses/index.json</c> carry a
/// <c>"sha"</c> object keyed by the file's path under their directory.
/// </summary>
public static class MeshGlbStore
{
    /// <summary>The store directory under the mesh root.</summary>
    public const string StoreDirectory = "glbs";

    /// <summary>The blob's path under the mesh root.</summary>
    public static string BlobPath(string sha) => $"{StoreDirectory}/{sha}.glb";

    /// <summary>
    /// A sha256 as the store spells blob names: 64 lowercase hex digits. Manifest values are
    /// data off the volume and become path segments, so anything else is ignored.
    /// </summary>
    public static bool IsSha(string? value)
    {
        if (value is not { Length: 64 })
            return false;

        foreach (var c in value)
        {
            if (c is not ((>= '0' and <= '9') or (>= 'a' and <= 'f')))
                return false;
        }

        return true;
    }

    /// <summary>
    /// Name -> sha over a tree's <c>models.json</c>: each row's <c>glb</c>/<c>sha</c>,
    /// <c>cockpit</c>/<c>cockpitSha</c>, and <c>glb</c>/<c>sha</c> per <c>variants[]</c> entry.
    /// A row the store has not hashed contributes nothing. Throws on an unreadable file.
    /// </summary>
    public static Dictionary<string, string> ReadModelShas(string manifestPath)
    {
        using var stream = File.OpenRead(manifestPath);
        using var document = JsonDocument.Parse(stream);
        var table = NewTable();
        if (document.RootElement.ValueKind is not JsonValueKind.Array)
            return table;

        foreach (var row in document.RootElement.EnumerateArray())
        {
            if (row.ValueKind is not JsonValueKind.Object)
                continue;

            Add(table, row, "glb", "sha");
            Add(table, row, "cockpit", "cockpitSha");
            if (!row.TryGetProperty("variants", out var variants) || variants.ValueKind is not JsonValueKind.Array)
                continue;

            foreach (var variant in variants.EnumerateArray())
            {
                if (variant.ValueKind is JsonValueKind.Object)
                    Add(table, variant, "glb", "sha");
            }
        }

        return table;
    }

    /// <summary>
    /// Name -> sha over a manifest's <c>"sha"</c> object, the form <c>viewmodels/index.json</c>
    /// and <c>poses/index.json</c> share. The bare-array rig index an untreated tree still
    /// carries has no shas and reads as empty. Throws on an unreadable file.
    /// </summary>
    public static Dictionary<string, string> ReadShaTable(string manifestPath)
    {
        using var stream = File.OpenRead(manifestPath);
        using var document = JsonDocument.Parse(stream);
        var table = NewTable();
        if (document.RootElement.ValueKind is not JsonValueKind.Object
            || !document.RootElement.TryGetProperty("sha", out var shas)
            || shas.ValueKind is not JsonValueKind.Object)
            return table;

        foreach (var entry in shas.EnumerateObject())
        {
            if (entry.Name.Length > 0 && entry.Value.ValueKind is JsonValueKind.String
                && entry.Value.GetString() is { } sha && IsSha(sha))
                table.TryAdd(entry.Name, sha);
        }

        return table;
    }

    private static void Add(Dictionary<string, string> table, JsonElement row, string nameKey, string shaKey)
    {
        if (row.TryGetProperty(nameKey, out var name) && name.ValueKind is JsonValueKind.String
            && name.GetString() is { Length: > 0 } file
            && row.TryGetProperty(shaKey, out var hash) && hash.ValueKind is JsonValueKind.String
            && hash.GetString() is { } sha && IsSha(sha))
            table.TryAdd(file, sha);
    }

    // Exact names, as the viewer's glb-store.js matches them: a path in the wrong case 404s
    // off the volume today, and the fallback must not resolve what the path never served.
    private static Dictionary<string, string> NewTable() => new(StringComparer.Ordinal);
}
