using System.Diagnostics;
using System.Globalization;
using api.PlayerTracking;
using api.ServiceRecord.Models;
using api.Telemetry;
using Microsoft.EntityFrameworkCore;

namespace api.ServiceRecord;

/// <summary>
/// One grouped SQLite query over a player's most recent sessions; what comes back is a few
/// hundred rows.
/// </summary>
public class ServiceRecordStore(PlayerTrackerDbContext dbContext) : IServiceRecordStore
{
    /// <summary>
    /// How many of a player's most recent sessions a record covers.
    /// <para>
    /// Each session costs a random read for its row and another for its round, and the
    /// production volume answers about 700 of those a second (deploy/NODE_TUNING.md). On a
    /// 25 GB copy of the database the busiest regular has 9,408 sessions: a whole career is
    /// over a second cold even on local NVMe, which puts it at tens of seconds in production.
    /// A thousand covers everyone's whole history but for ~500 of 61k players, and costs
    /// those a second or two cold. A monthly aggregate by team, maintained like
    /// PlayerMapStats, would lift the window; see features/service-record.
    /// </para>
    /// </summary>
    public const int SessionWindow = 1000;

    /// <summary>
    /// <para>
    /// The window is walked newest first on <c>IX_PlayerSessions_PlayerName_LastSeenTime</c>,
    /// with the other games' servers filtered out inside it so a player who also plays FH2
    /// still gets a thousand BF1942 sessions.
    /// </para>
    /// <para>
    /// <c>CROSS JOIN</c> is SQLite's documented way to pin the join order: the window is the
    /// outer loop and each session looks up its server and round by primary key. Left to
    /// itself the planner may drive from Servers — the low-cardinality side, filtered on an
    /// unindexed <c>Game</c> — and probe the sessions per server instead (see
    /// deploy/NODE_TUNING.md §2).
    /// </para>
    /// <para>
    /// A win is the session's own round, finished, with both ticket counts recorded and
    /// unequal, won by the session's team label; a loss is the mirror. Ties and unfinished
    /// rounds are neither. Timestamps are stored as TEXT, which julianday() reads directly.
    /// </para>
    /// </summary>
    internal const string RowsSql = """
        SELECT lower(trim(s.GameId)) AS GameId,
               ps.MapName AS MapName,
               trim(ps.CurrentTeamLabel) AS TeamLabel,
               COUNT(*) AS Rounds,
               SUM(ps.TotalKills) AS Kills,
               SUM(ps.TotalDeaths) AS Deaths,
               SUM(ps.TotalScore) AS Score,
               SUM(max(0, (julianday(ps.LastSeenTime) - julianday(ps.StartTime)) * 1440)) AS Minutes,
               SUM(CASE WHEN r.IsActive = 0
                         AND r.Tickets1 IS NOT NULL AND r.Tickets2 IS NOT NULL
                         AND r.Tickets1 <> r.Tickets2
                         AND lower(trim(CASE WHEN r.Tickets1 > r.Tickets2 THEN r.Team1Label ELSE r.Team2Label END))
                             = lower(trim(ps.CurrentTeamLabel))
                        THEN 1 ELSE 0 END) AS Wins,
               SUM(CASE WHEN r.IsActive = 0
                         AND r.Tickets1 IS NOT NULL AND r.Tickets2 IS NOT NULL
                         AND r.Tickets1 <> r.Tickets2
                         AND lower(trim(CASE WHEN r.Tickets1 > r.Tickets2 THEN r.Team2Label ELSE r.Team1Label END))
                             = lower(trim(ps.CurrentTeamLabel))
                        THEN 1 ELSE 0 END) AS Losses,
               MIN(ps.StartTime) AS OldestStart
        FROM (SELECT ServerGuid, MapName, CurrentTeamLabel, TotalKills, TotalDeaths, TotalScore,
                     StartTime, LastSeenTime, RoundId
              FROM PlayerSessions
              WHERE PlayerName = $playerName
                AND IsDeleted = 0
                AND ServerGuid IN (SELECT Guid FROM Servers WHERE Game = 'bf1942')
              ORDER BY LastSeenTime DESC
              LIMIT $window) ps
        CROSS JOIN Servers s
        LEFT JOIN Rounds r ON r.RoundId = ps.RoundId
        WHERE s.Guid = ps.ServerGuid
        GROUP BY lower(trim(s.GameId)), ps.MapName, trim(ps.CurrentTeamLabel)
        """;

    /// <summary>Whether the player has a BF1942 session older than the window, walked on the same index.</summary>
    internal const string BeyondWindowSql = """
        SELECT EXISTS (
            SELECT 1 FROM PlayerSessions
            WHERE PlayerName = $playerName
              AND IsDeleted = 0
              AND ServerGuid IN (SELECT Guid FROM Servers WHERE Game = 'bf1942')
            ORDER BY LastSeenTime DESC
            LIMIT 1 OFFSET $window)
        """;

    public Task<bool> PlayerExistsAsync(string playerName, CancellationToken cancellationToken = default) =>
        dbContext.Players.AsNoTracking().AnyAsync(player => player.Name == playerName, cancellationToken);

    public Task<ServiceRecordRows> GetRowsAsync(string playerName, CancellationToken cancellationToken = default) =>
        GetRowsAsync(playerName, SessionWindow, cancellationToken);

    internal async Task<ServiceRecordRows> GetRowsAsync(string playerName, int window,
        CancellationToken cancellationToken)
    {
        // Raw ADO.NET is invisible to the EF instrumentation, so the query gets its own span.
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("ServiceRecord.GetRows");
        activity?.SetTag("query.name", "ServiceRecordRows");
        activity?.SetTag("query.filters", $"player:{playerName}");
        var stopwatch = Stopwatch.StartNew();

        // Opened through EF rather than on the raw connection so the connection interceptor
        // still applies its busy_timeout; EF only closes what it opened.
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var rows = new List<ServiceRecordRow>();
            await using (var command = Command(playerName, window))
            {
                command.CommandText = RowsSql;
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    rows.Add(new ServiceRecordRow(
                        GameId: await reader.IsDBNullAsync(0, cancellationToken) ? "" : reader.GetString(0),
                        MapName: await reader.IsDBNullAsync(1, cancellationToken) ? "" : reader.GetString(1),
                        TeamLabel: await reader.IsDBNullAsync(2, cancellationToken) ? "" : reader.GetString(2),
                        Rounds: (int)reader.GetInt64(3),
                        Kills: await ReadIntAsync(reader, 4, cancellationToken),
                        Deaths: await ReadIntAsync(reader, 5, cancellationToken),
                        Score: await ReadIntAsync(reader, 6, cancellationToken),
                        // NULL only when every session in the group has an unreadable timestamp.
                        Minutes: await reader.IsDBNullAsync(7, cancellationToken) ? 0 : reader.GetDouble(7),
                        Wins: await ReadIntAsync(reader, 8, cancellationToken),
                        Losses: await ReadIntAsync(reader, 9, cancellationToken),
                        OldestStart: await reader.IsDBNullAsync(10, cancellationToken) ? null : ParseTimestamp(reader.GetString(10))));
                }
            }

            // Only a full window can have left anything out; ask the index once whether it did.
            var capped = false;
            if (rows.Sum(row => row.Rounds) >= window)
            {
                await using var command = Command(playerName, window);
                command.CommandText = BeyondWindowSql;
                capped = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture) == 1;
            }

            activity?.SetTag("result.count", rows.Count);
            activity?.SetTag("result.capped", capped);
            activity?.SetTag("duration_ms", stopwatch.ElapsedMilliseconds);
            return new ServiceRecordRows(rows, capped);
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    /// <summary>A command on the context's connection with the two parameters both queries bind.</summary>
    private System.Data.Common.DbCommand Command(string playerName, int window)
    {
        var command = dbContext.Database.GetDbConnection().CreateCommand();
        var player = command.CreateParameter();
        player.ParameterName = "$playerName";
        player.Value = playerName;
        command.Parameters.Add(player);
        var limit = command.CreateParameter();
        limit.ParameterName = "$window";
        limit.Value = window;
        command.Parameters.Add(limit);
        return command;
    }

    /// <summary>EF stores a DateTime as "yyyy-MM-dd HH:mm:ss.FFFFFFF", in UTC.</summary>
    private static DateTime? ParseTimestamp(string value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : null;

    private static async Task<int> ReadIntAsync(System.Data.Common.DbDataReader reader, int ordinal,
        CancellationToken cancellationToken) =>
        await reader.IsDBNullAsync(ordinal, cancellationToken) ? 0 : (int)reader.GetInt64(ordinal);
}
