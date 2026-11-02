namespace api.Recordings.Models;

/// <summary>What the feed is narrowed to: the recordings made on one server, shared by one
/// player, with one player in the round (bfstats.io's server and player pages,
/// features/replay-on-stats-pages), written by one kind of recorder (features/recording-source),
/// or any of them together. A null value narrows nothing.</summary>
public record RecordingFilter(string? Server, string? Uploader, string? Player = null, RecordingSource? Source = null)
{
    public static readonly RecordingFilter None = new(null, null);

    /// <summary>The filter a query asks for: trimmed, as the names are stored; an empty
    /// value is none. A player name is kept as given: it is the player's key, spaces and all.
    /// A source is <c>server</c>, or <c>client</c> (<c>player</c> says the same); anything
    /// else narrows nothing.</summary>
    public static RecordingFilter From(string? server, string? uploader, string? player = null, string? source = null) =>
        new(Clean(server), Clean(uploader), string.IsNullOrWhiteSpace(player) ? null : player, SourceOf(source));

    public bool IsEmpty => Server is null && Uploader is null && Player is null && Source is null;

    /// <summary>The source a query's <c>source</c> names, or null for none.</summary>
    public static RecordingSource? SourceOf(string? source) => source?.Trim().ToLowerInvariant() switch
    {
        "server" => RecordingSource.Server,
        "client" or "player" => RecordingSource.Client,
        _ => null,
    };

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
