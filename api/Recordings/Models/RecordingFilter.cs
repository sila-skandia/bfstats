namespace api.Recordings.Models;

/// <summary>What the feed is narrowed to: the recordings made on one server, shared by one
/// player, or both. A null value narrows nothing.</summary>
public record RecordingFilter(string? Server, string? Uploader)
{
    public static readonly RecordingFilter None = new(null, null);

    /// <summary>The filter a query asks for: trimmed, as the names are stored; an empty
    /// value is none.</summary>
    public static RecordingFilter From(string? server, string? uploader) => new(Clean(server), Clean(uploader));

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
