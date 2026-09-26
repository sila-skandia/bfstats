using System.Globalization;
using System.Text.Json;
using api.PlayerTracking;
using api.ServiceRecord.Models;
using api.Telemetry;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using NodaTime;
using NodaTime.Text;

namespace api.ServiceRecord;

/// <summary>
/// Maintains PlayerTeamMapStats, the per-team monthly aggregate the service record reads a
/// whole career from. Runs inside the hourly aggregate cycle and under its lock.
/// <para>
/// <b>A month is reached by range.</b> Rows are bucketed by the month a session was last
/// seen in, so a month's sessions are one range of
/// <c>IX_PlayerSessions_LastSeenTime_WhereNotDeleted</c>: on the 25 GB production copy a
/// full month (140-195k sessions) reads in about a second, where the start-time sweeps of
/// the other aggregates cannot use an index at all.
/// </para>
/// <para>
/// <b>An hour only rewrites who played.</b> A session only changes while it is being played,
/// and its win or loss when its round finishes, so each refresh rewrites the rows of the
/// players seen since the last one and of everyone in a round that has finished since,
/// rather than the whole month: a few thousand rows an hour where the month is ~100k, which
/// matters with the WAL already on watch (deploy/PRODUCTION_ISSUES.md).
/// </para>
/// <para>
/// <b>History is backfilled a few months a cycle,</b> newest first, and the state in
/// <c>app_data</c> records how far it has got. Until it reaches the first session the
/// service record keeps to its live window.
/// </para>
/// Every write follows the WriteLockNote in AggregateCalculationService.cs: the scan runs
/// outside the transaction, which holds the write lock only for the delete and insert.
/// </summary>
public class TeamMapStatsAggregator(
    PlayerTrackerDbContext dbContext,
    IClock clock,
    ILogger<TeamMapStatsAggregator> logger) : ITeamMapStatsAggregator
{
    /// <summary>Months of history the backfill rebuilds per hourly cycle.</summary>
    internal const int BackfillMonthsPerCycle = 3;

    /// <summary>
    /// How far behind the watermark a refresh looks again. The tracker stamps sessions and
    /// rounds before it commits them, and retries a cycle when the database is busy, so a
    /// write can land just behind a scan that has already read past its timestamp.
    /// </summary>
    internal static readonly Duration RefreshOverlap = Duration.FromMinutes(30);

    // A month nobody reads yet (the first run, the backfill) is committed in pieces this
    // size, so the tracker's own writes never wait behind a whole month.
    private const int RowsPerTransaction = 2000;

    private const string InsertSql = """
        INSERT INTO PlayerTeamMapStats
        (PlayerName, Year, Month, ServerGuid, MapName, TeamLabel, Sessions, TotalKills, TotalDeaths,
         TotalScore, TotalPlayTimeMinutes, Wins, Losses, FirstSessionStart, UpdatedAt)
        VALUES ($PlayerName, $Year, $Month, $ServerGuid, $MapName, $TeamLabel, $Sessions, $TotalKills, $TotalDeaths,
         $TotalScore, $TotalPlayTimeMinutes, $Wins, $Losses, $FirstSessionStart, $UpdatedAt)
        """;

    // Players rebuilt per transaction by RecomputePlayersAsync.
    private const int PlayerBatchSize = 400;

    private const string ScanSelect = $"""
        SELECT ps.PlayerName AS PlayerName,
               CAST(strftime('%Y', ps.LastSeenTime) AS INTEGER) AS Year,
               CAST(strftime('%m', ps.LastSeenTime) AS INTEGER) AS Month,
               ps.ServerGuid AS ServerGuid,
               ps.MapName AS MapName,
               trim(ps.CurrentTeamLabel) AS TeamLabel,
               COUNT(*) AS Sessions,
               SUM(ps.TotalKills) AS TotalKills,
               SUM(ps.TotalDeaths) AS TotalDeaths,
               SUM(ps.TotalScore) AS TotalScore,
               {ServiceRecordSql.Minutes} AS TotalPlayTimeMinutes,
               {ServiceRecordSql.Wins} AS Wins,
               {ServiceRecordSql.Losses} AS Losses,
               MIN(ps.StartTime) AS FirstSessionStart
        FROM PlayerSessions ps
        LEFT JOIN Rounds r ON r.RoundId = ps.RoundId
        """;

    private const string ScanGroupBy =
        "GROUP BY ps.PlayerName, Year, Month, ps.ServerGuid, ps.MapName, trim(ps.CurrentTeamLabel)";

    /// <summary>
    /// One month's sessions. <c>ps.IsDeleted = 0</c> must stay spelled exactly like this: it is
    /// what lets SQLite use the partial index, whose own condition it is.
    /// </summary>
    internal const string MonthScanSql = ScanSelect + """

        WHERE ps.IsDeleted = 0
          AND ps.LastSeenTime >= $start AND ps.LastSeenTime < $end
        """ + "\n" + ScanGroupBy;

    // Name lists travel as one JSON array parameter, so no statement is ever built from
    // anything but constants.
    internal const string PlayersScanSql = ScanSelect + """

        WHERE ps.IsDeleted = 0
          AND ps.PlayerName IN (SELECT value FROM json_each({0}))
        """ + "\n" + ScanGroupBy;

    /// <summary>
    /// Everyone seen since <c>$since</c>. Pinned to the partial index: on production's
    /// statistics the planner would rather skip-scan IX_PlayerSessions_PlayerName_LastSeenTime
    /// for names already in order, which took 1.3 s against 1 ms for the range on a local copy.
    /// </summary>
    internal const string PlayersSeenSinceSql = """
        SELECT DISTINCT PlayerName AS Value
        FROM PlayerSessions INDEXED BY IX_PlayerSessions_LastSeenTime_WhereNotDeleted
        WHERE IsDeleted = 0 AND LastSeenTime >= $since
        """;

    /// <summary>
    /// Everyone in a round finished since <c>$since</c>, with the month of that session. A
    /// round only closes when its server is next seen on another map: after some of its
    /// players have left, or a day later when the server went dark mid-round (0.37% of the
    /// decided sessions in August 2026 closed more than 2 hours after the player's last
    /// observation). Walked from the servers seen since, the only ones that can have closed
    /// a round, down IX_Rounds_ServerGuid_EndTime; the CROSS JOINs fix that order.
    /// </summary>
    internal const string PlayersInRoundsFinishedSinceSql = """
        SELECT DISTINCT ps.PlayerName AS PlayerName,
               CAST(strftime('%Y', ps.LastSeenTime) AS INTEGER) AS Year,
               CAST(strftime('%m', ps.LastSeenTime) AS INTEGER) AS Month
        FROM Servers s
        CROSS JOIN Rounds r
        CROSS JOIN PlayerSessions ps
        WHERE s.LastSeenTime >= $since
          AND r.ServerGuid = s.Guid AND r.EndTime >= $since
          AND ps.RoundId = r.RoundId AND ps.IsDeleted = 0
        """;

    private const string DeletePlayersSql =
        "DELETE FROM PlayerTeamMapStats WHERE PlayerName IN (SELECT value FROM json_each({0}))";

    private const string DeletePlayersMonthSql =
        "DELETE FROM PlayerTeamMapStats WHERE Year = {0} AND Month = {1} AND PlayerName IN (SELECT value FROM json_each({2}))";

    public async Task<int> RefreshAsync(CancellationToken cancellationToken = default)
    {
        using var activity = ActivitySources.AggregateCalculation.StartActivity("AggregateCalculation.PlayerTeamMapStats");
        var written = 0;
        var state = await TeamMapStatsState.LoadAsync(dbContext, cancellationToken);
        // Taken before reading anything, so a session updated mid-scan falls in the next window.
        var scanStart = clock.GetCurrentInstant();

        if (state is null)
        {
            // First run: this month in full. The backfill takes it back from here.
            var month = AggregateMonth.Of(scanStart);
            written += await RewriteMonthAsync(month, players: null, cancellationToken);
            state = new TeamMapStatsState(scanStart, month, Complete: false);
            activity?.SetTag("team_stats.first_run", true);
        }
        else
        {
            var pending = await PlayersToRewriteAsync(state.RefreshedThrough - RefreshOverlap, scanStart,
                cancellationToken);
            activity?.SetTag("team_stats.months", pending.Count);
            activity?.SetTag("team_stats.players", pending.Values.Sum(players => players.Count));

            foreach (var (month, players) in pending)
            {
                // A month the backfill has not reached is rebuilt whole when it gets there.
                if (month < state.OldestMonth)
                    continue;
                written += await RewriteMonthAsync(month, players, cancellationToken);
            }

            state = state with { RefreshedThrough = scanStart };
        }

        await state.SaveAsync(dbContext, clock.GetCurrentInstant(), cancellationToken);

        if (!state.Complete)
            written += await BackfillAsync(state, cancellationToken);

        activity?.SetTag("team_stats.rows_written", written);
        return written;
    }

    public async Task<int> RecomputePlayersAsync(IReadOnlyCollection<string> playerNames,
        CancellationToken cancellationToken = default)
    {
        var written = 0;
        foreach (var batch in playerNames.Distinct(StringComparer.Ordinal).Chunk(PlayerBatchSize))
        {
            var names = JsonSerializer.Serialize(batch);
            var rows = await dbContext.Database
                .SqlQueryRaw<TeamMapStatsScanRow>(PlayersScanSql, names)
                .ToListAsync(cancellationToken);

            await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
            await dbContext.Database.ExecuteSqlRawAsync(DeletePlayersSql, [names], cancellationToken);
            written += await InsertAsync(rows, transaction, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }

        return written;
    }

    /// <summary>Rebuilds up to <see cref="BackfillMonthsPerCycle"/> older months, saving after each.</summary>
    private async Task<int> BackfillAsync(TeamMapStatsState state, CancellationToken cancellationToken)
    {
        var written = 0;
        var earliest = await EarliestMonthAsync(cancellationToken);

        for (var i = 0; i < BackfillMonthsPerCycle; i++)
        {
            var next = state.OldestMonth.Previous();
            if (earliest is null || next < earliest.Value)
                break;

            written += await RewriteMonthAsync(next, players: null, cancellationToken);
            state = state with { OldestMonth = next };
            await state.SaveAsync(dbContext, clock.GetCurrentInstant(), cancellationToken);
        }

        if (earliest is null || state.OldestMonth.Previous() < earliest.Value)
        {
            state = state with { Complete = true };
            await state.SaveAsync(dbContext, clock.GetCurrentInstant(), cancellationToken);
            logger.LogInformation("PlayerTeamMapStats backfill complete back to {Month}", state.OldestMonth);
        }

        return written;
    }

    /// <summary>
    /// Rebuilds a month: every row of it, or only the rows of <paramref name="players"/>.
    /// The month is scanned whole either way; a range of the index is cheaper than one
    /// random read per session of the players asked for.
    /// </summary>
    private async Task<int> RewriteMonthAsync(AggregateMonth month, IReadOnlySet<string>? players,
        CancellationToken cancellationToken)
    {
        var (start, end) = month.Bounds();
        var rows = await dbContext.Database
            .SqlQueryRaw<TeamMapStatsScanRow>(MonthScanSql,
                new SqliteParameter("$start", start), new SqliteParameter("$end", end))
            .ToListAsync(cancellationToken);
        if (players is null)
        {
            // Nothing reads this month until the backfill completes, so it need not appear
            // atomically: small transactions keep the write lock short.
            await dbContext.Database.ExecuteSqlRawAsync(
                "DELETE FROM PlayerTeamMapStats WHERE Year = {0} AND Month = {1}",
                [month.Year, month.Month], cancellationToken);
            foreach (var chunk in rows.Chunk(RowsPerTransaction))
            {
                await using var piece = await dbContext.Database.BeginTransactionAsync(cancellationToken);
                await InsertAsync(chunk, piece, cancellationToken);
                await piece.CommitAsync(cancellationToken);
            }

            return rows.Count;
        }

        // A live month: the players' old rows and their new ones change in one step.
        rows = [.. rows.Where(row => players.Contains(row.PlayerName))];
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        await dbContext.Database.ExecuteSqlRawAsync(DeletePlayersMonthSql,
            [month.Year, month.Month, JsonSerializer.Serialize(players)], cancellationToken);
        var written = await InsertAsync(rows, transaction, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return written;
    }

    /// <summary>
    /// The players whose rows need rewriting, by month, oldest first: everyone seen since
    /// <paramref name="since"/> in every month from then to now (usually one; two in the first
    /// hours of a month, which is what finishes the month before), and everyone in a round
    /// finished since then in the month of that session, however old.
    /// </summary>
    private async Task<SortedDictionary<AggregateMonth, HashSet<string>>> PlayersToRewriteAsync(Instant since,
        Instant now, CancellationToken cancellationToken)
    {
        var pending = new SortedDictionary<AggregateMonth, HashSet<string>>();
        void Add(AggregateMonth month, IEnumerable<string> players)
        {
            if (!pending.TryGetValue(month, out var set))
                pending[month] = set = new HashSet<string>(StringComparer.Ordinal);
            set.UnionWith(players);
        }

        var seen = await dbContext.Database
            .SqlQueryRaw<string>(PlayersSeenSinceSql, new SqliteParameter("$since", Timestamp(since)))
            .ToListAsync(cancellationToken);
        if (seen.Count > 0)
        {
            for (var month = AggregateMonth.Of(since); month <= AggregateMonth.Of(now); month = month.Next())
                Add(month, seen);
        }

        var finished = await dbContext.Database
            .SqlQueryRaw<TeamMapStatsPlayerMonth>(PlayersInRoundsFinishedSinceSql,
                new SqliteParameter("$since", Timestamp(since)))
            .ToListAsync(cancellationToken);
        foreach (var session in finished)
            Add(new AggregateMonth(session.Year, session.Month), [session.PlayerName]);

        return pending;
    }

    /// <summary>The month of the earliest session: the first entry of the LastSeenTime index.</summary>
    private async Task<AggregateMonth?> EarliestMonthAsync(CancellationToken cancellationToken)
    {
        var earliest = await dbContext.Database
            .SqlQueryRaw<DateTime?>("SELECT MIN(LastSeenTime) AS Value FROM PlayerSessions WHERE IsDeleted = 0")
            .FirstOrDefaultAsync(cancellationToken);
        return earliest is null ? null : AggregateMonth.Of(earliest.Value);
    }

    /// <summary>
    /// One prepared statement run per row inside the caller's transaction: SQLite's fast path,
    /// where a multi-row VALUES list through EF spends its time building parameters.
    /// </summary>
    private async Task<int> InsertAsync(IReadOnlyCollection<TeamMapStatsScanRow> rows,
        IDbContextTransaction transaction, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
            return 0;

        var connection = dbContext.Database.GetDbConnection();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction.GetDbTransaction();
        command.CommandText = InsertSql;
        string[] names =
        [
            "$PlayerName", "$Year", "$Month", "$ServerGuid", "$MapName", "$TeamLabel", "$Sessions", "$TotalKills",
            "$TotalDeaths", "$TotalScore", "$TotalPlayTimeMinutes", "$Wins", "$Losses", "$FirstSessionStart", "$UpdatedAt",
        ];
        var parameters = names.Select(name =>
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            command.Parameters.Add(parameter);
            return parameter;
        }).ToArray();
        await command.PrepareAsync(cancellationToken);

        var now = InstantPattern.ExtendedIso.Format(clock.GetCurrentInstant());
        foreach (var row in rows)
        {
            object[] values =
            [
                row.PlayerName, row.Year, row.Month, row.ServerGuid, row.MapName, row.TeamLabel ?? "",
                row.Sessions, row.TotalKills, row.TotalDeaths, row.TotalScore, row.TotalPlayTimeMinutes,
                row.Wins, row.Losses,
                InstantPattern.ExtendedIso.Format(Instant.FromDateTimeUtc(DateTime.SpecifyKind(row.FirstSessionStart, DateTimeKind.Utc))),
                now,
            ];
            for (var i = 0; i < values.Length; i++)
                parameters[i].Value = values[i];
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        return rows.Count;
    }

    /// <summary>An instant in the text PlayerSessions stores its timestamps as.</summary>
    private static string Timestamp(Instant instant) =>
        instant.ToDateTimeUtc().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
}
