namespace api.Recordings;

/// <summary>
/// The reactions a comment on a recording can have (features/replay-feed, "Likes and
/// reactions"). Names, not emoji: the pages draw each as their own glyph. The order here is
/// the order a comment lists them in.
/// </summary>
public static class RecordingReactions
{
    public const string Like = "like";

    private static readonly string[] kinds = [Like, "love", "haha", "wow", "fire", "rip"];

    public static IReadOnlyList<string> Kinds => kinds;

    /// <summary>The kind as stored, or null for one that is not a reaction.</summary>
    public static string? Clean(string? kind) =>
        kind?.Trim().ToLowerInvariant() is { } k && kinds.Contains(k) ? k : null;

    public static int Order(string kind) => Array.IndexOf(kinds, kind) is var i and >= 0 ? i : kinds.Length;
}
