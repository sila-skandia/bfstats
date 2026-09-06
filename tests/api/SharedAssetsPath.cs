namespace api.tests;

/// <summary>
/// Serialises the test classes that point ASSETS_STORAGE_PATH at their own temp tree.
///
/// That variable is process-global and xUnit runs test classes in parallel, so without
/// this the asset-resolving classes overwrite each other's root mid-run and fail in ways
/// that vanish when the test is run on its own.
/// </summary>
[CollectionDefinition(Name)]
public sealed class SharedAssetsPath
{
    public const string Name = "assets-storage-path";
}
