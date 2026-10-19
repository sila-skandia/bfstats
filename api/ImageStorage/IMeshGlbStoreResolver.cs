namespace api.ImageStorage;

/// <summary>
/// Resolves a per-tree model, rig or pose glb path (<c>models/Tiger.glb</c>,
/// <c>models/mods/fhsw/viewmodels/X.fp.glb</c>, <c>models/poses/A__B.pose.glb</c>) to the
/// content-addressed blob its tree's manifest records (<c>glbs/&lt;sha256&gt;.glb</c>), so the
/// mesh route keeps serving a name whose per-tree file the store superseded and a later GC
/// removed (features/mesh-asset-size, phase 5).
/// </summary>
public interface IMeshGlbStoreResolver
{
    /// <summary>
    /// The store blob path for <paramref name="relativePath"/>, both relative to
    /// <paramref name="meshRoot"/>, or null when no manifest hashes the name — an untreated
    /// tree, a file no manifest covers (a kit glb, a level scene), a missing manifest.
    /// </summary>
    string? ResolveBlobPath(string meshRoot, string relativePath);
}
