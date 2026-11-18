namespace api.Dogfights;

/// <summary>
/// Where the dogfight school's list of recorded fights is read from
/// (features/dogfights-on-stats-pages). The <c>bfstats-dogfights</c> CronJob writes it to the
/// assets volume's <c>mesh/replays/dogfights/index.json</c> (features/dogfight-recordings), the
/// volume the API already mounts under <c>ASSETS_STORAGE_PATH</c>. Bound from the
/// <c>Dogfights</c> section, so <c>Dogfights__IndexUrl</c> in the environment.
/// </summary>
public record DogfightsOptions
{
    public const string Section = "Dogfights";

    /// <summary>The index on disk. Empty: <c>&lt;ASSETS_STORAGE_PATH&gt;/mesh/replays/dogfights/index.json</c>
    /// when that is set.</summary>
    public string IndexPath { get; init; } = "";

    /// <summary>The index over HTTP, used when there is no file (a developer's machine:
    /// <c>https://play.bfstats.io/replays/dogfights/index.json</c>). Empty reads no further.</summary>
    public string IndexUrl { get; init; } = "";

    /// <summary>How often the file's time is looked at, or the URL fetched again.</summary>
    public int RefreshSeconds { get; init; } = 120;

    /// <summary>The index path the options resolve to, or null for none.</summary>
    public string? ResolvedIndexPath()
    {
        if (!string.IsNullOrWhiteSpace(IndexPath)) return IndexPath;
        var assets = Environment.GetEnvironmentVariable("ASSETS_STORAGE_PATH");
        return string.IsNullOrWhiteSpace(assets) ? null : Path.Combine(assets, "mesh", "replays", "dogfights", "index.json");
    }
}
