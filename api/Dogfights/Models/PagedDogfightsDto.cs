namespace api.Dogfights.Models;

/// <summary>A page of recorded fights, with how many there are of each kind in all.</summary>
public record PagedDogfightsDto(
    IReadOnlyList<DogfightDto> Items,
    int Total,
    int Page,
    int PageSize,
    int Dogfights,
    int Kills);
