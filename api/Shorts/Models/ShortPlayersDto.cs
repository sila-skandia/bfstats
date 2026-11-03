namespace api.Shorts.Models;

/// <summary>The players in the week's Shorts, most featured first: the strip's player filter.</summary>
public sealed record ShortPlayersDto(IReadOnlyList<ShortPlayerDto> Items);
