namespace api.Recordings.Models;

/// <summary>What the uploader changes: each one given, the rest left as they are.</summary>
public record UpdateRecordingRequest(string? Title, string? Description = null, string? Visibility = null);
