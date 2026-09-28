namespace api.Recordings.Models;

public record PagedRecordingCommentsDto(
    IReadOnlyList<RecordingCommentDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages);
