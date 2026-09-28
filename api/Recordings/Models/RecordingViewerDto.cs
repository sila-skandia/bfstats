namespace api.Recordings.Models;

/// <summary>The signed-in viewer as the feed needs them: the names they can post as.</summary>
public record RecordingViewerDto(int UserId, IReadOnlyList<string> Names, bool IsAdmin);
