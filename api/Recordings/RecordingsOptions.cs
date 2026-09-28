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

    /// <summary>One recording unpacked. Every byte of it is read, hashed, parsed and gzipped
    /// again on upload, 11 to 19 ms of CPU a megabyte (measured), so this is also what one
    /// upload can cost. Real recordings run 0.75 to 1.6 MB a minute: this is over five hours
    /// of play, past what a browser could replay, and most reach
    /// <see cref="MaxRecordingBytes"/> gzipped first.</summary>
    public long MaxRecordingRawBytes { get; init; } = 512 * MiB;

    public long MaxServerLogBytes { get; init; } = 20 * MiB;

    public long MaxServerLogRawBytes { get; init; } = 256 * MiB;

    /// <summary>The volume keeps at least this much free, and at least
    /// <see cref="MinFreeFraction"/> of itself: it is the node's root disk, where the kubelet
    /// garbage-collects images at 85% and evicts pods at 90%.</summary>
    public long MinFreeBytes { get; init; } = 8 * GiB;

    public double MinFreeFraction { get; init; } = 0.15;

    /// <summary>A viewer's watching counts once in this many hours.</summary>
    public double ViewWindowHours { get; init; } = 6;

    // Rounds (features/replay-feed, "Rounds"): how two recordings are found to be one round.
    // Measured on real rounds and a real round split by side; the README has the numbers.

    /// <summary>A key either recording has more copies of than this proposes no offset.</summary>
    public int RoundRareKey { get; init; } = 4;

    /// <summary>The offset the most keys agree on within this many seconds is taken.</summary>
    public double RoundWindowSeconds { get; init; } = 1.0;

    /// <summary>Two copies of a key pair when this close once the offset is applied: a
    /// player's own chat line is on his screen up to 0.6 s before anyone else's.</summary>
    public double RoundPairSeconds { get; init; } = 1.0;

    /// <summary>Fewer keys of every kind paired than this, and two recordings are not one round.</summary>
    public int RoundMinMatches { get; init; } = 8;

    /// <summary>Fewer kills, joins, leaves and chat lines paired than this, and they are not.</summary>
    public int RoundMinPlayerKeys { get; init; } = 3;

    /// <summary>The paired player keys must be at least this share of the fewer player keys
    /// either recording has over the stretch both cover.</summary>
    public double RoundMinPlayerShare { get; init; } = 0.5;

    /// <summary>Recordings whose headers' local starts are further apart than this, plus the
    /// longer one's length, are not compared: each header is its own PC's clock with no zone,
    /// and the world's zones span 26 hours.</summary>
    public double RoundCandidateHours { get; init; } = 26;

    /// <summary>The settings a recording's rounds were last worked out under: a change to any
    /// of them compares every recording again.</summary>
    public string RoundSettings =>
        FormattableString.Invariant(
            $"v{RoundDetectionVersion};{RoundRareKey};{RoundWindowSeconds};{RoundPairSeconds};{RoundMinMatches};{RoundMinPlayerKeys};{RoundMinPlayerShare};{RoundCandidateHours}");

    /// <summary>Raised when the way recordings are compared changes.</summary>
    public const int RoundDetectionVersion = 1;
}
