using System.Threading;
using System.Threading.Tasks;
using api.Wrapped.Models;

namespace api.Wrapped;

public interface IWrappedService
{
    /// <summary>
    /// Gets pre-computed or computed-on-demand Wrapped statistics for a given server and year.
    /// </summary>
    Task<ServerWrappedResponseDto?> GetServerWrappedAsync(string serverGuid, int year = 2026, bool bypassCache = false);

    /// <summary>
    /// Background job method to compute and store Server Wrapped aggregates in the database cache.
    /// </summary>
    Task CrunchAllServersWrappedAsync(int year, CancellationToken ct);

    /// <summary>
    /// Gets pre-computed or computed-on-demand Wrapped statistics for a given player, server (or "global" for all servers), and year.
    /// </summary>
    Task<PlayerWrappedResponseDto?> GetPlayerWrappedAsync(string playerName, string serverGuid, int year = 2026, bool bypassCache = false);

    /// <summary>
    /// Background job method to compute and store Player Wrapped aggregates in the database cache.
    /// </summary>
    Task CrunchAllPlayersWrappedAsync(int year, CancellationToken ct);

    /// <summary>
    /// Gets a combined "Your Year in Review" Wrapped for all of a user's registered aliases,
    /// merging each alias's own (cached) Player Wrapped into one aggregate.
    /// </summary>
    Task<ProfileWrappedResponseDto?> GetProfileWrappedAsync(int userId, int year = 2026, bool bypassCache = false);

    /// <summary>
    /// Background job method to pre-compute and cache Player Wrapped data (global, per-alias)
    /// for every alias registered across all users, so Profile Wrapped reads are served from cache.
    /// </summary>
    Task CrunchAllProfilesWrappedAsync(int year, CancellationToken ct);
}
