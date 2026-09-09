using System.Globalization;
using System.Text;
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

    private const string SessionCte = """
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
              {0}
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

    /// <summary>
    /// Parsed once rather than on every call — the statement is built twice per
    /// request and <see cref="SessionCte"/> never changes (CA1863).
    /// </summary>
    private static readonly CompositeFormat SessionCteFormat = CompositeFormat.Parse(SessionCte);

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

        var candidateCap = Math.Min(MaxRegularCandidates, Math.Max(limit * 4, limit));
        var candidateNames = await dbContext.PlayerServerStats
            .AsNoTracking()
            .Where(s => s.ServerGuid == serverGuid)
            .GroupBy(s => s.PlayerName)
            .Select(g => new { PlayerName = g.Key, Rounds = g.Sum(x => x.TotalRounds) })
            .OrderByDescending(x => x.Rounds)
            .Take(candidateCap)
            .Select(x => x.PlayerName)
            .ToListAsync(cancellationToken);

        // An empty candidate list (no weekly rows yet) makes LoadFromSessionsAsync fall
        // back to scanning every session on the server - a quiet server with little to scan.
        var (players, totalRegulars) = await LoadFromSessionsAsync(
            serverGuid, minPing, maxPing, limit, candidateNames, cancellationToken);

        var response = new ServerProximityResponse(players, totalRegulars);
        await cacheService.SetAsync(cacheKey, response, TimeSpan.FromHours(1), cancellationToken);
        return response;
    }

    /// <summary>
    /// Ping, peak hour and last-played still live on PlayerSessions. Restricting
    /// to named regulars lets the planner use PlayerName+ServerGuid instead of
    /// walking every session on a busy server. <paramref name="playerNames"/> is
    /// bound as individual parameters (bounded by <see cref="MaxRegularCandidates"/>,
    /// well under SQLite's variable limit) rather than a temp table, so this is a
    /// single round trip either way.
    /// </summary>
    private async Task<(List<ServerProximityEntry> Players, int TotalRegulars)> LoadFromSessionsAsync(
        string serverGuid,
        int minPing,
        int maxPing,
        int limit,
        IReadOnlyList<string> playerNames,
        CancellationToken cancellationToken)
    {
        var players = new List<ServerProximityEntry>();
        var totalRegulars = 0;

        var conn = dbContext.Database.GetDbConnection();
        var wasClosed = conn.State != System.Data.ConnectionState.Open;
        if (wasClosed) await conn.OpenAsync(cancellationToken);

        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.Parameters.Add(new SqliteParameter("@serverGuid", serverGuid));
            cmd.Parameters.Add(new SqliteParameter("@minPing", minPing));
            cmd.Parameters.Add(new SqliteParameter("@maxPing", maxPing));
            cmd.Parameters.Add(new SqliteParameter("@limit", limit));

            // CA2100/CA3001 flag these two assignments because the statement is
            // composed with string.Format. The only interpolated text is the
            // "@p0, @p1, …" placeholder list, generated from the loop index —
            // every value, playerNames included, is bound as a SqliteParameter
            // below, so no caller-supplied text ever reaches the SQL.
#pragma warning disable CA2100, CA3001
            if (playerNames.Count > 0)
            {
                var placeholders = string.Join(", ", playerNames.Select((_, i) => $"@p{i}"));
                cmd.CommandText = string.Format(
                    CultureInfo.InvariantCulture, SessionCteFormat, $"AND PlayerName IN ({placeholders})");
                for (var i = 0; i < playerNames.Count; i++)
                    cmd.Parameters.Add(new SqliteParameter($"@p{i}", playerNames[i]));
            }
            else
            {
                cmd.CommandText = string.Format(CultureInfo.InvariantCulture, SessionCteFormat, "");
            }
#pragma warning restore CA2100, CA3001

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

        return (players, totalRegulars);
    }
}
