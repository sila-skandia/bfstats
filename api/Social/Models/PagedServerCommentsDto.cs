namespace api.Social.Models;

public record PagedServerCommentsDto(
    IReadOnlyList<ServerCommentDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages);
