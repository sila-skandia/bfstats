using api.PlayerRelationships.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.PlayerRelationships;

/// <summary>
/// Builds the data behind the server details "player proximity" orbit:
/// per-player average ping, session count and peak play hour on a server,
/// sourced from weekly PlayerServerStats plus a named PlayerSessions lookup.
/// </summary>
public class ServerProximityService(
    PlayerTrackerDbContext dbContext,
    IRelationshipCacheService cacheService,
    ILogger<ServerProximityService> logger)
{
    /// <summary>
    /// Over-fetch regulars from the weekly table so a tight ping window can
    /// still fill <c>limit</c> without scanning every session on the server.
    /// </summary>
    internal const int MaxRegularCandidates = 200;

    private const string SessionSqlAll = """
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
        )
        SELECT
            s.PlayerName,
            s.AvgPing,
            s.SessionCount,
            ph.Hour AS PeakHourUtc,
            s.LastPlayed
        FROM stats s
        JOIN peak_hour ph ON ph.PlayerName = s.PlayerName AND ph.Rn = 1
        ORDER BY s.SessionCount DESC
        LIMIT @limit
        """;

    private const string SessionSqlNamed = """
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
              AND PlayerName IN (SELECT PlayerName FROM proximity_candidates)
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
        )
        SELECT
            s.PlayerName,
            s.AvgPing,
            s.SessionCount,
            ph.Hour AS PeakHourUtc,
            s.LastPlayed
        FROM stats s
        JOIN peak_hour ph ON ph.PlayerName = s.PlayerName AND ph.Rn = 1
        ORDER BY s.SessionCount DESC
        LIMIT @limit
        """;

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

        var totalRegulars = await dbContext.PlayerServerStats
            .AsNoTracking()
            .Where(s => s.ServerGuid == serverGuid)
            .Select(s => s.PlayerName)
            .Distinct()
            .CountAsync(cancellationToken);

        List<string> candidateNames;
        if (totalRegulars == 0)
        {
            candidateNames = [];
        }
        else
        {
            var candidateCap = Math.Min(MaxRegularCandidates, Math.Max(limit * 4, limit));
            candidateNames = await dbContext.PlayerServerStats
                .AsNoTracking()
                .Where(s => s.ServerGuid == serverGuid)
                .GroupBy(s => s.PlayerName)
                .Select(g => new { PlayerName = g.Key, Rounds = g.Sum(x => x.TotalRounds) })
                .OrderByDescending(x => x.Rounds)
                .Take(candidateCap)
                .Select(x => x.PlayerName)
                .ToListAsync(cancellationToken);
        }

        var players = await LoadFromSessionsAsync(
            serverGuid, minPing, maxPing, limit, candidateNames, cancellationToken);

        if (totalRegulars == 0)
            totalRegulars = players.Count;

        var response = new ServerProximityResponse(players, totalRegulars);
        await cacheService.SetAsync(cacheKey, response, TimeSpan.FromHours(1), cancellationToken);
        return response;
    }

    /// <summary>
    /// Ping, peak hour and last-played still live on PlayerSessions. Restricting
    /// to named regulars lets the planner use PlayerName+ServerGuid instead of
    /// walking every session on a busy server.
    /// </summary>
    private async Task<List<ServerProximityEntry>> LoadFromSessionsAsync(
        string serverGuid,
        int minPing,
        int maxPing,
        int limit,
        IReadOnlyList<string> playerNames,
        CancellationToken cancellationToken)
    {
        var players = new List<ServerProximityEntry>();

        var conn = dbContext.Database.GetDbConnection();
        var wasClosed = conn.State != System.Data.ConnectionState.Open;
        if (wasClosed) await conn.OpenAsync(cancellationToken);

        try
        {
            if (playerNames.Count > 0)
            {
                await using (var create = conn.CreateCommand())
                {
                    create.CommandText =
                        "CREATE TEMP TABLE IF NOT EXISTS proximity_candidates (PlayerName TEXT PRIMARY KEY)";
                    await create.ExecuteNonQueryAsync(cancellationToken);
                }

                await using (var clear = conn.CreateCommand())
                {
                    clear.CommandText = "DELETE FROM proximity_candidates";
                    await clear.ExecuteNonQueryAsync(cancellationToken);
                }

                await using var insert = conn.CreateCommand();
                insert.CommandText = "INSERT INTO proximity_candidates (PlayerName) VALUES (@name)";
                var nameParam = new SqliteParameter("@name", "");
                insert.Parameters.Add(nameParam);
                foreach (var name in playerNames)
                {
                    nameParam.Value = name;
                    await insert.ExecuteNonQueryAsync(cancellationToken);
                }
            }

            await using var cmd = conn.CreateCommand();
            if (playerNames.Count > 0)
                cmd.CommandText = SessionSqlNamed;
            else
                cmd.CommandText = SessionSqlAll;
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
            }
        }
        finally
        {
            if (wasClosed) await conn.CloseAsync();
        }

        return players;
    }
}
