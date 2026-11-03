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

    public long MaxVideoBytes { get; init; } = 40 * MiB;

    public long MaxPosterBytes { get; init; } = 2 * MiB;
}
