namespace api.Recordings.Models;

/// <summary>A server or uploader the feed can be narrowed to, and how many recordings that
/// would show.</summary>
public record RecordingFilterChoiceDto(string Name, int Count);
