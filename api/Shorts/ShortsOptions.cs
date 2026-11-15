namespace api.Shorts;

/// <summary>
/// Replay Shorts (features/replay-shorts). Bound from the <c>Shorts</c> section, so
/// <c>Shorts__UploadKey</c> in the environment.
/// </summary>
public record ShortsOptions
{
    public const string Section = "Shorts";

    private const long MiB = 1024L * 1024;

    /// <summary>The render job's key, sent as <c>X-Shorts-Key</c>. Empty turns that way in off:
    /// only a signed-in admin can upload or delete.</summary>
    public string UploadKey { get; init; } = "";

    /// <summary>Just under what the edge (Cloudflare) passes in one request, 100 MB: a
    /// minute-long compilation is 30-65 MB, and squeezing it under the old 40 MiB took
    /// twenty minutes of re-encoding (2026-11-04). The volume is not the limit.</summary>
    public long MaxVideoBytes { get; init; } = 90 * MiB;

    public long MaxPosterBytes { get; init; } = 2 * MiB;

    /// <summary>A roll's or a recap's video (<see cref="ShortKinds.IsLandscape"/>): 60-90 s of
    /// 4K is 320-450 MB (features/action-roll), a recap of up to 3 minutes up to about 900
    /// (features/match-recap).</summary>
    public long MaxRollVideoBytes { get; init; } = 1000 * MiB;

    /// <summary>A Short's optional HD copy (<c>videoHd</c>), a roll's 1080p take of 80-110 MB, a
    /// recap's of up to about 250.
    /// Another kind's HD copy is held to <see cref="MaxVideoBytes"/> as well.</summary>
    public long MaxHdVideoBytes { get; init; } = 320 * MiB;

    /// <summary>A Short's optional link copy (<c>PUT /stats/shorts/&lt;slug&gt;/link-video</c>), the
    /// video the share link names: under what Discord embeds from a link, about 50 MB.</summary>
    public long MaxLinkVideoBytes { get; init; } = 48 * MiB;

    /// <summary>One part of a chunked upload (<c>POST /stats/shorts/parts</c>): under what the
    /// edge (Cloudflare) passes in one request, 100 MB, so a 4K roll goes up in pieces.</summary>
    public long MaxPartBytes { get; init; } = 90 * MiB;

    /// <summary>The most parts one chunked upload may have.</summary>
    public int MaxParts { get; init; } = 64;

    /// <summary>A chunked upload not joined this long after its first part is swept by the prune.</summary>
    public int PartsMaxAgeHours { get; init; } = 24;

    /// <summary>A Short this many days old or more is weighed for retention
    /// (<c>POST /stats/shorts/prune</c>, run by the nightly Shorts job; the owner, 2026-11-11:
    /// "for any short >= week old with 0-1 views we get rid of").</summary>
    public int RetentionDays { get; init; } = 7;

    /// <summary>A Short weighed for retention with this many views or fewer is taken down.</summary>
    public int RetentionMaxViews { get; init; } = 1;

    /// <summary>The largest video a Short of <paramref name="kind"/> may have.</summary>
    public long VideoLimit(string? kind) => ShortKinds.IsLandscape(kind) ? MaxRollVideoBytes : MaxVideoBytes;

    /// <summary>The largest HD copy a Short of <paramref name="kind"/> may have.</summary>
    public long HdVideoLimit(string? kind) => ShortKinds.IsLandscape(kind) ? MaxHdVideoBytes : Math.Min(MaxHdVideoBytes, MaxVideoBytes);
}
