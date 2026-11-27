namespace api.Recordings.Models;

/// <summary>
/// Who finds a recording (features/bfv-through-bfstats, "Access"): everyone, in the feed and on
/// every page that lists recordings, or only those given its link. An unlisted recording is not
/// private: its link, its files and its page open for anyone who has them, as a password-locked
/// bfv upload did for anyone with its password. The uploader can change it.
/// </summary>
public enum RecordingVisibility
{
    /// <summary>In the feed, its counts and filters, server and player pages and round reports.</summary>
    Public = 0,

    /// <summary>In none of them; its link still opens it.</summary>
    Unlisted = 1,
}

/// <summary>A visibility as the API's JSON says it.</summary>
public static class RecordingVisibilities
{
    public const string Public = "public";
    public const string Unlisted = "unlisted";

    public static string Name(RecordingVisibility visibility) =>
        visibility == RecordingVisibility.Unlisted ? Unlisted : Public;

    /// <summary>The visibility a request names; null for none or one the API does not know.</summary>
    public static RecordingVisibility? Parse(string? value) => value?.Trim().ToLowerInvariant() switch
    {
        Public or "listed" => RecordingVisibility.Public,
        Unlisted or "private" => RecordingVisibility.Unlisted,
        _ => null,
    };
}
