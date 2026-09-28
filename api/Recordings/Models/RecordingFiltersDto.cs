namespace api.Recordings.Models;

/// <summary>The servers and uploaders the feed can be narrowed to, by name, ignoring case.</summary>
public record RecordingFiltersDto(
    IReadOnlyList<RecordingFilterChoiceDto> Servers,
    IReadOnlyList<RecordingFilterChoiceDto> Uploaders);
