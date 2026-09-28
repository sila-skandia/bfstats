namespace api.Recordings;

/// <summary>
/// Where shared recordings live and how much of the disk they may take (features/replay-feed).
/// Bound from the <c>Recordings</c> section, so <c>Recordings__Path</c> in the environment.
/// </summary>
public record RecordingsOptions
{
    public const string Section = "Recordings";

    private const long MiB = 1024L * 1024;
    private const long GiB = 1024 * MiB;

    /// <summary>The directory the files go in. Production: the host root volume's PV, mounted
    /// at <c>/mnt/recordings</c>. Empty means a <c>bfstats-recordings</c> folder in the temp dir.</summary>
    public string Path { get; init; } = "";

    /// <summary>Every shared file together, gzipped, may take no more than this.</summary>
    public long QuotaBytes { get; init; } = 20 * GiB;

    /// <summary>One recording as stored (gzipped). Cloudflare refuses a request body over
    /// 100 MB, which caps what a browser can send in any case.</summary>
    public long MaxRecordingBytes { get; init; } = 95 * MiB;

    /// <summary>One recording unpacked: a bound on what a small file may expand to.</summary>
    public long MaxRecordingRawBytes { get; init; } = GiB;

    public long MaxServerLogBytes { get; init; } = 20 * MiB;

    public long MaxServerLogRawBytes { get; init; } = 256 * MiB;

    /// <summary>The volume keeps at least this much free, and at least
    /// <see cref="MinFreeFraction"/> of itself: it is the node's root disk, where the kubelet
    /// garbage-collects images at 85% and evicts pods at 90%.</summary>
    public long MinFreeBytes { get; init; } = 8 * GiB;

    public double MinFreeFraction { get; init; } = 0.15;

    /// <summary>A viewer's watching counts once in this many hours.</summary>
    public double ViewWindowHours { get; init; } = 6;
}
