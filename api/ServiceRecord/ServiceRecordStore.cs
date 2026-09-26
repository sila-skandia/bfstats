using System.Diagnostics;
using System.Globalization;
using api.PlayerTracking;
using api.ServiceRecord.Models;
using api.Telemetry;
using Microsoft.EntityFrameworkCore;

namespace api.ServiceRecord;

/// <summary>
/// What a service record is summed from: the player's whole career from PlayerTeamMapStats
/// once its backfill is complete, and until then one grouped query over their most recent
/// sessions. Either way, a few hundred rows.
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
    internal const string RowsSql = $"""
        SELECT lower(trim(s.GameId)) AS GameId,
               ps.MapName AS MapName,
               trim(ps.CurrentTeamLabel) AS TeamLabel,
               COUNT(*) AS Rounds,
               SUM(ps.TotalKills) AS Kills,
               SUM(ps.TotalDeaths) AS Deaths,
               SUM(ps.TotalScore) AS Score,
               {ServiceRecordSql.Minutes} AS Minutes,
               {ServiceRecordSql.Wins} AS Wins,
               {ServiceRecordSql.Losses} AS Losses,
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

    /// <summary>
    /// The same rows from the monthly aggregate: a whole career, read off the player's own
    /// range of the primary key, a few dozen pages however long they have played.
    /// </summary>
    internal const string AggregateRowsSql = """
        SELECT lower(trim(s.GameId)) AS GameId,
               a.MapName AS MapName,
               a.TeamLabel AS TeamLabel,
               SUM(a.Sessions) AS Rounds,
               SUM(a.TotalKills) AS Kills,
               SUM(a.TotalDeaths) AS Deaths,
               SUM(a.TotalScore) AS Score,
               SUM(a.TotalPlayTimeMinutes) AS Minutes,
               SUM(a.Wins) AS Wins,
               SUM(a.Losses) AS Losses,
               MIN(a.FirstSessionStart) AS OldestStart
        FROM PlayerTeamMapStats a
        CROSS JOIN Servers s
        WHERE a.PlayerName = $playerName
          AND s.Guid = a.ServerGuid
          AND s.Game = 'bf1942'
        GROUP BY lower(trim(s.GameId)), a.MapName, a.TeamLabel
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

    public async Task<ServiceRecordRows> GetRowsAsync(string playerName, CancellationToken cancellationToken = default)
    {
        // The aggregate holds only the newest months until its backfill reaches the first
        // session; a partial career would be worse than a labelled window.
        var state = await TeamMapStatsState.LoadAsync(dbContext, cancellationToken);
        return state?.Complete == true
            ? await GetAggregateRowsAsync(playerName, cancellationToken)
            : await GetRowsAsync(playerName, SessionWindow, cancellationToken);
    }

    internal async Task<ServiceRecordRows> GetAggregateRowsAsync(string playerName, CancellationToken cancellationToken)
    {
        using var activity = ActivitySources.SqliteAnalytics.StartActivity("ServiceRecord.GetAggregateRows");
        activity?.SetTag("query.name", "ServiceRecordAggregateRows");
        activity?.SetTag("query.filters", $"player:{playerName}");

        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = Command(playerName, SessionWindow);
            command.CommandText = AggregateRowsSql;
            var rows = await ReadRowsAsync(command, cancellationToken);
            activity?.SetTag("result.count", rows.Count);
            return new ServiceRecordRows(rows, Capped: false);
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

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
            List<ServiceRecordRow> rows;
            await using (var command = Command(playerName, window))
            {
                command.CommandText = RowsSql;
                rows = await ReadRowsAsync(command, cancellationToken);
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

    private static async Task<List<ServiceRecordRow>> ReadRowsAsync(System.Data.Common.DbCommand command,
        CancellationToken cancellationToken)
    {
        var rows = new List<ServiceRecordRow>();
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

        return rows;
    }

    /// <summary>A command on the context's connection with the two parameters the queries bind.</summary>
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

    /// <summary>
    /// A session's "yyyy-MM-dd HH:mm:ss.FFFFFFF" (EF's DateTime text) or the aggregate's ISO
    /// instant, both UTC.
    /// </summary>
    private static DateTime? ParseTimestamp(string value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : null;

    private static async Task<int> ReadIntAsync(System.Data.Common.DbDataReader reader, int ordinal,
        CancellationToken cancellationToken) =>
        await reader.IsDBNullAsync(ordinal, cancellationToken) ? 0 : (int)reader.GetInt64(ordinal);
}
