namespace api.Shorts.Models;

public sealed record PagedShortsDto(IReadOnlyList<ShortDto> Items, int Total, int Page, int PageSize);
