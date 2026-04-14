namespace api.Social.Models;

public record PagedCommentsDto(
    IReadOnlyList<PlayerCommentDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages);
