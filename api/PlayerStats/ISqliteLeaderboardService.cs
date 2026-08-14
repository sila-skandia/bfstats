using api.Servers.Models;

namespace api.PlayerStats;

/// <summary>
/// SQLite-based leaderboard service that queries pre-computed leaderboard entries.
/// </summary>
public interface ISqliteLeaderboardService
{
    /// <summary>
    /// Gets top players by score for a server.
    /// </summary>
    Task<List<TopScore>> GetTopScoresAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10,
        int? minRoundsOverride = null);

    /// <summary>
    /// Gets top players by K/D ratio for a server.
    /// </summary>
    Task<List<TopKDRatio>> GetTopKDRatiosAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10,
        int? minRoundsOverride = null);

    /// <summary>
    /// Gets top players by kills per minute for a server.
    /// </summary>
    Task<List<TopKillRate>> GetTopKillRatesAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10,
        int? minRoundsOverride = null);

    /// <summary>
    /// Gets most active players by playtime for a server.
    /// </summary>
    Task<List<PlayerActivity>> GetMostActivePlayersAsync(
        string serverGuid,
        DateTime startPeriod,
        DateTime endPeriod,
        int limit = 10);

    /// <summary>
    /// Gets paged player rankings for a server with custom sort and search.
    /// </summary>
    Task<ServerPlayerRankingsResponse> GetServerPlayerRankingsAsync(
        string serverGuid,
        string serverName,
        int days,
        DateTime startPeriod,
        DateTime endPeriod,
        int page = 1,
        int pageSize = 20,
        string sortBy = "active",
        int minRounds = 1,
        string? searchQuery = null);

    /// <summary>
    /// Gets rank distribution across K/D, score, kills, playtime, and kill rate for a server.
    /// </summary>
    Task<ServerRankDistributionResponse> GetServerRankDistributionAsync(
        string serverGuid,
        string serverName,
        int days,
        DateTime startPeriod,
        DateTime endPeriod,
        int minRounds = 1);

    /// <summary>
    /// Gets paged global player leaderboard with filtering, search, and sort applied in SQL
    /// (GROUP BY + LIMIT/OFFSET). Does not materialize the full ranking set.
    /// </summary>
    Task<Models.GlobalLeaderboardResponse> GetGlobalLeaderboardAsync(
        int page = 1,
        int pageSize = 50,
        string sortBy = "score",
        string sortDir = "desc",
        string? searchQuery = null,
        string? server = null,
        string? map = null,
        int days = 30,
        int minRounds = 1,
        int minPlay = 0,
        string? game = "bf1942",
        string? exclude = null,
        bool populatedOnly = false);
}
