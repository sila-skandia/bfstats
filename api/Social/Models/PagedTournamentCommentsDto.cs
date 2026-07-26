namespace api.Social.Models;

public record PagedTournamentCommentsDto(
    IReadOnlyList<TournamentCommentDto> Items,
    int TotalCount,
    int Page,
    int PageSize,
    int TotalPages);
