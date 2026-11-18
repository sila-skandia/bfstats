using api.Dogfights.Models;

namespace api.Dogfights;

/// <summary>Recorded fights (features/dogfights-on-stats-pages) for bfstats.io's server and player pages.</summary>
public interface IDogfightService
{
    /// <summary>A page of the fights recorded on <paramref name="server"/>, or flown by
    /// <paramref name="player"/> (either pilot), by the site's or the recording's form of the
    /// name; every fight when both are null. <paramref name="kind"/> <c>dogfight</c> or
    /// <c>bounce</c> narrows it. Dogfights first, then kills, then the newest.</summary>
    Task<PagedDogfightsDto> ListAsync(string? server, string? player, string? kind, int page, int pageSize, CancellationToken ct);

    /// <summary>Every fight, newest recording first.</summary>
    Task<IReadOnlyList<DogfightDto>> AllAsync(CancellationToken ct);
}
