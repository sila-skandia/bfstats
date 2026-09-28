namespace api.Recordings.Models;

public record PagedRecordingsDto(
    IReadOnlyList<RecordingSummaryDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages,
    RecordingStorageDto Storage);
