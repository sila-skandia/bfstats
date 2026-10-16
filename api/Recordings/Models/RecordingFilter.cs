namespace api.Recordings.Models;

/// <summary>What the feed is narrowed to: the recordings made on one server, shared by one
/// player, with one player in the round (bfstats.io's server and player pages,
/// features/replay-on-stats-pages), or any of them together. A null value narrows nothing.</summary>
public record RecordingFilter(string? Server, string? Uploader, string? Player = null)
{
    public static readonly RecordingFilter None = new(null, null);

    /// <summary>The filter a query asks for: trimmed, as the names are stored; an empty
    /// value is none. A player name is kept as given: it is the player's key, spaces and all.</summary>
    public static RecordingFilter From(string? server, string? uploader, string? player = null) =>
        new(Clean(server), Clean(uploader), string.IsNullOrWhiteSpace(player) ? null : player);

    public bool IsEmpty => Server is null && Uploader is null && Player is null;

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
