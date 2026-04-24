using api.PlayerRelationships.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.PlayerRelationships;

/// <summary>
/// Builds the data behind the server details "player proximity" orbit:
/// per-player average ping, session count and peak play hour on a server,
/// sourced from PlayerSessions and capped to the top-N regulars.
/// </summary>
public class ServerProximityService(
    PlayerTrackerDbContext dbContext,
    IRelationshipCacheService cacheService,
    ILogger<ServerProximityService> logger)
{
    public async Task<ServerProximityResponse> GetAsync(
        string serverGuid,
        int minPing,
        int maxPing,
        int limit,
        CancellationToken cancellationToken = default)
    {
        minPing = Math.Clamp(minPing, 0, 500);
        maxPing = Math.Clamp(maxPing, 10, 1000);
        if (minPing > maxPing) (minPing, maxPing) = (maxPing, minPing);
        limit = Math.Clamp(limit, 1, 200);

        var cacheKey = $"server:{serverGuid}:proximity:{minPing}:{maxPing}:{limit}";
        var cached = await cacheService.GetAsync<ServerProximityResponse>(cacheKey, cancellationToken);
        if (cached != null)
        {
            logger.LogDebug("Cache hit for proximity on server {ServerGuid}", serverGuid);
            return cached;
        }

        // One pass: per-player stats + peak hour, picked via ROW_NUMBER inside a CTE.
        // AveragePing can be null on in-flight sessions, so we filter those out.
        // Player-level filter: include a player only if their AVG ping on the server
        // falls inside [minPing, maxPing]. We check this via HAVING on the stats CTE.
        const string sql = """
            WITH sessions AS (
                SELECT
                    PlayerName,
                    AveragePing,
                    StartTime,
                    CAST(strftime('%H', StartTime) AS INTEGER) AS Hour
                FROM PlayerSessions
                WHERE ServerGuid = @serverGuid
                  AND IsDeleted = 0
                  AND AveragePing IS NOT NULL
                  AND AveragePing > 0
                  AND AveragePing <= @maxPing
            ),
            stats AS (
                SELECT
                    PlayerName,
                    AVG(AveragePing) AS AvgPing,
                    COUNT(*) AS SessionCount,
                    MAX(StartTime) AS LastPlayed
                FROM sessions
                GROUP BY PlayerName
                HAVING AVG(AveragePing) >= @minPing
                   AND AVG(AveragePing) <= @maxPing
            ),
            peak_hour AS (
                SELECT PlayerName, Hour, HourSessions,
                       ROW_NUMBER() OVER (PARTITION BY PlayerName ORDER BY HourSessions DESC, Hour ASC) AS Rn
                FROM (
                    SELECT PlayerName, Hour, COUNT(*) AS HourSessions
                    FROM sessions
                    GROUP BY PlayerName, Hour
                )
            ),
            total AS (
                SELECT COUNT(*) AS TotalRegulars FROM stats
            )
            SELECT
                s.PlayerName,
                s.AvgPing,
                s.SessionCount,
                ph.Hour AS PeakHourUtc,
                s.LastPlayed,
                (SELECT TotalRegulars FROM total) AS TotalRegulars
            FROM stats s
            JOIN peak_hour ph ON ph.PlayerName = s.PlayerName AND ph.Rn = 1
            ORDER BY s.SessionCount DESC
            LIMIT @limit
            """;

        var players = new List<ServerProximityEntry>();
        var totalRegulars = 0;

        var conn = dbContext.Database.GetDbConnection();
        var wasClosed = conn.State != System.Data.ConnectionState.Open;
        if (wasClosed) await conn.OpenAsync(cancellationToken);

        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            cmd.Parameters.Add(new SqliteParameter("@serverGuid", serverGuid));
            cmd.Parameters.Add(new SqliteParameter("@minPing", minPing));
            cmd.Parameters.Add(new SqliteParameter("@maxPing", maxPing));
            cmd.Parameters.Add(new SqliteParameter("@limit", limit));

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                players.Add(new ServerProximityEntry(
                    PlayerName: reader.GetString(0),
                    AvgPing: reader.GetDouble(1),
                    SessionCount: reader.GetInt32(2),
                    PeakHourUtc: reader.GetInt32(3),
                    LastPlayed: DateTime.SpecifyKind(reader.GetDateTime(4), DateTimeKind.Utc)));
                totalRegulars = reader.GetInt32(5);
            }
        }
        finally
        {
            if (wasClosed) await conn.CloseAsync();
        }

        var response = new ServerProximityResponse(players, totalRegulars);
        await cacheService.SetAsync(cacheKey, response, TimeSpan.FromHours(1), cancellationToken);
        return response;
    }
}
