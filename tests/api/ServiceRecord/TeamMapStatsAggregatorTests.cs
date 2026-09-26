using api.PlayerTracking;
using api.ServiceRecord;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;
using NSubstitute;

namespace api.tests.ServiceRecord;

public sealed class TeamMapStatsAggregatorTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly IClock clock = Substitute.For<IClock>();
    private readonly TeamMapStatsAggregator aggregator;

    public TeamMapStatsAggregatorTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        dbContext = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options);
        dbContext.Database.EnsureCreated();
        aggregator = new TeamMapStatsAggregator(dbContext, clock, NullLogger<TeamMapStatsAggregator>.Instance);

        dbContext.Players.AddRange(new Player { Name = "Able" }, new Player { Name = "Baker" }, new Player { Name = "Charlie" });
        dbContext.Servers.Add(new GameServer { Guid = "vanilla", Name = "Vanilla", Game = "bf1942", GameId = "bf1942" });
        dbContext.SaveChanges();
    }

    private static DateTime Utc(int year, int month, int day, int hour = 20, int minute = 0) =>
        new(year, month, day, hour, minute, 0, DateTimeKind.Utc);

    private void Now(DateTime utc) => clock.GetCurrentInstant().Returns(Instant.FromDateTimeUtc(utc));

    private PlayerSession Session(string player, DateTime start, double minutes, string label = "Axis",
        string map = "wake", string? roundId = null, int kills = 0)
    {
        var session = new PlayerSession
        {
            PlayerName = player,
            ServerGuid = "vanilla",
            MapName = map,
            GameType = "conquest",
            StartTime = start,
            LastSeenTime = start.AddMinutes(minutes),
            RoundId = roundId,
            CurrentTeamLabel = label,
            TotalKills = kills,
        };
        dbContext.PlayerSessions.Add(session);
        dbContext.SaveChanges();
        return session;
    }

    private void Round(string id, DateTime start, int? tickets1, int? tickets2, bool isActive = false)
    {
        dbContext.Rounds.Add(new Round
        {
            RoundId = id,
            ServerGuid = "vanilla",
            ServerName = "Vanilla",
            MapName = "wake",
            GameType = "conquest",
            StartTime = start,
            EndTime = isActive ? null : start.AddMinutes(30),
            IsActive = isActive,
            Tickets1 = tickets1,
            Tickets2 = tickets2,
            Team1Label = "Axis",
            Team2Label = "Allied",
        });
        dbContext.SaveChanges();
    }

    /// <summary>What the tracker does when the round's server is next seen on another map.</summary>
    private async Task CloseRoundAsync(string id, DateTime at)
    {
        var round = dbContext.Rounds.Single(r => r.RoundId == id);
        round.IsActive = false;
        round.EndTime = at;
        dbContext.Servers.Single(server => server.Guid == round.ServerGuid).LastSeenTime = at;
        await dbContext.SaveChangesAsync();
    }

    private List<api.Data.Entities.PlayerTeamMapStats> Rows(string? player = null) =>
    [
        .. dbContext.PlayerTeamMapStats.AsNoTracking()
            .Where(row => player == null || row.PlayerName == player)
            .OrderBy(row => row.PlayerName).ThenBy(row => row.Year).ThenBy(row => row.Month).ThenBy(row => row.TeamLabel),
    ];

    private Task<TeamMapStatsState?> StateAsync() => TeamMapStatsState.LoadAsync(dbContext);

    [Fact]
    public async Task FirstRefreshBuildsThisMonthThenBackfillsThreeMonthsACycle()
    {
        for (var month = 4; month <= 9; month++)
            Session("Able", Utc(2026, month, 10), 30);
        Now(Utc(2026, 9, 20));

        await aggregator.RefreshAsync();

        // September in full, then August, July and June.
        Assert.Equal([6, 7, 8, 9], Rows().Select(row => row.Month));
        var state = await StateAsync();
        Assert.NotNull(state);
        Assert.Equal(new AggregateMonth(2026, 6), state.OldestMonth);
        Assert.False(state.Complete);

        Now(Utc(2026, 9, 20, 21));
        await aggregator.RefreshAsync();

        Assert.Equal([4, 5, 6, 7, 8, 9], Rows().Select(row => row.Month));
        state = await StateAsync();
        Assert.Equal(new AggregateMonth(2026, 4), state!.OldestMonth);
        Assert.True(state.Complete);
    }

    [Fact]
    public async Task BucketsASessionByTheMonthItWasLastSeen()
    {
        Session("Able", Utc(2026, 8, 31, 23, 30), 60);
        Now(Utc(2026, 9, 2));

        await aggregator.RefreshAsync();

        var row = Assert.Single(Rows());
        Assert.Equal((2026, 9), (row.Year, row.Month));
        Assert.Equal(60, row.TotalPlayTimeMinutes, precision: 3);
        Assert.Equal(Instant.FromDateTimeUtc(Utc(2026, 8, 31, 23, 30)), row.FirstSessionStart);
    }

    [Fact]
    public async Task RefreshRewritesOnlyThePlayersSeenSinceTheLastOne()
    {
        Session("Able", Utc(2026, 9, 1), 30);
        Session("Charlie", Utc(2026, 9, 2), 30);
        Now(Utc(2026, 9, 10));
        await aggregator.RefreshAsync();

        // Charlie has not played since; a row nobody would rewrite keeps whatever it holds.
        await dbContext.Database.ExecuteSqlRawAsync("UPDATE PlayerTeamMapStats SET Sessions = 99 WHERE PlayerName = 'Charlie'");
        Session("Able", Utc(2026, 9, 10, 20, 10), 30, kills: 7);
        Now(Utc(2026, 9, 10, 21));

        await aggregator.RefreshAsync();

        var able = Assert.Single(Rows("Able"));
        Assert.Equal(2, able.Sessions);
        Assert.Equal(7, able.TotalKills);
        Assert.Equal(99, Assert.Single(Rows("Charlie")).Sessions);
    }

    [Fact]
    public async Task TheFirstRefreshOfAMonthFinishesTheMonthBefore()
    {
        Session("Able", Utc(2026, 8, 31, 22), 20);
        Now(Utc(2026, 8, 31, 22, 30));
        await aggregator.RefreshAsync();

        // Played after that refresh, still in August, and again in September.
        Session("Able", Utc(2026, 8, 31, 23, 20), 30);
        Session("Able", Utc(2026, 9, 1, 0, 10), 20);
        Now(Utc(2026, 9, 1, 0, 45));
        await aggregator.RefreshAsync();

        Assert.Equal([(8, 2), (9, 1)], Rows("Able").Select(row => (row.Month, row.Sessions)));
    }

    [Fact]
    public async Task ARoundThatEndsAfterThePlayerLeftStillCountsNextRefresh()
    {
        Round("wake-1", Utc(2026, 9, 10, 19, 50), tickets1: 10, tickets2: 5, isActive: true);
        Session("Able", Utc(2026, 9, 10, 20), 30, roundId: "wake-1");
        Now(Utc(2026, 9, 10, 20, 40));
        await aggregator.RefreshAsync();
        Assert.Equal(0, Assert.Single(Rows()).Wins);

        await CloseRoundAsync("wake-1", Utc(2026, 9, 10, 20, 50));
        Now(Utc(2026, 9, 10, 21, 40));
        await aggregator.RefreshAsync();

        var row = Assert.Single(Rows());
        Assert.Equal(1, row.Wins);
        Assert.Equal(0, row.Losses);
    }

    [Fact]
    public async Task ARoundClosedDaysAfterThePlayerLeftCountsWhenItCloses()
    {
        // The server went dark mid-round; the round stays open until it is next seen.
        Round("wake-1", Utc(2026, 9, 10, 19, 50), tickets1: 10, tickets2: 5, isActive: true);
        Session("Able", Utc(2026, 9, 10, 20), 30, roundId: "wake-1");
        Now(Utc(2026, 9, 10, 20, 40));
        await aggregator.RefreshAsync();
        Now(Utc(2026, 9, 12, 9, 40));
        await aggregator.RefreshAsync();

        await CloseRoundAsync("wake-1", Utc(2026, 9, 12, 10));
        Now(Utc(2026, 9, 12, 10, 40));
        await aggregator.RefreshAsync();

        Assert.Equal(1, Assert.Single(Rows()).Wins);
    }

    [Fact]
    public async Task ARoundClosedNextMonthRewritesTheMonthItsSessionIsIn()
    {
        Round("wake-1", Utc(2026, 8, 31, 22), tickets1: 3, tickets2: 8, isActive: true);
        Session("Able", Utc(2026, 8, 31, 22, 5), 30, roundId: "wake-1");
        Now(Utc(2026, 8, 31, 23));
        await aggregator.RefreshAsync();
        Now(Utc(2026, 9, 1, 12));
        await aggregator.RefreshAsync();

        await CloseRoundAsync("wake-1", Utc(2026, 9, 2, 12));
        Now(Utc(2026, 9, 2, 12, 30));
        await aggregator.RefreshAsync();

        var row = Assert.Single(Rows());
        Assert.Equal((8, 1), (row.Month, row.Losses));
    }

    [Fact]
    public async Task RecomputePlayersRebuildsEveryMonthOfThoseNamedOnly()
    {
        Session("Able", Utc(2026, 7, 5), 30);
        var deleted = Session("Able", Utc(2026, 8, 5), 30);
        Session("Baker", Utc(2026, 8, 6), 30);
        Now(Utc(2026, 8, 20));
        await aggregator.RefreshAsync();
        await dbContext.Database.ExecuteSqlRawAsync("UPDATE PlayerTeamMapStats SET Sessions = 99 WHERE PlayerName = 'Baker'");

        deleted.IsDeleted = true;
        await dbContext.SaveChangesAsync();
        await aggregator.RecomputePlayersAsync(["Able"]);

        Assert.Equal([(7, 1)], Rows("Able").Select(row => (row.Month, row.Sessions)));
        Assert.Equal(99, Assert.Single(Rows("Baker")).Sessions);
    }

    [Fact]
    public async Task CompletesAtOnceWithNoSessionsAtAll()
    {
        Now(Utc(2026, 9, 20));

        await aggregator.RefreshAsync();

        Assert.Empty(Rows());
        Assert.True((await StateAsync())!.Complete);
    }

    /// <summary>
    /// Production's planner statistics for the tables these queries read (sampled with
    /// analysis_limit=400, deploy/NODE_TUNING.md). An empty database plans from heuristics;
    /// these are what make the planner reach for a skip-scan of the name indexes.
    /// </summary>
    private async Task UseProductionStatisticsAsync()
    {
        await dbContext.Database.ExecuteSqlRawAsync("ANALYZE");
        await dbContext.Database.ExecuteSqlRawAsync("DELETE FROM sqlite_stat1");
        await dbContext.Database.ExecuteSqlRawAsync("""
            INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES
            ('PlayerSessions', 'IX_PlayerSessions_IsActive_LastSeenTime', '2583668 241 4'),
            ('PlayerSessions', 'IX_PlayerSessions_IsActive_SyncedToNeo4jAt_LastSeenTime', '2583668 241 241 4'),
            ('PlayerSessions', 'IX_PlayerSessions_LastSeenTime_WhereNotDeleted', '2579934 4'),
            ('PlayerSessions', 'IX_PlayerSessions_PlayerName_IsActive', '2583668 58 58'),
            ('PlayerSessions', 'IX_PlayerSessions_PlayerName_LastSeenTime', '2583668 58 1'),
            ('PlayerSessions', 'IX_PlayerSessions_PlayerName_ServerGuid_IsActive', '2583668 58 12 12'),
            ('PlayerSessions', 'IX_PlayerSessions_PlayerName_ServerGuid_SessionId', '2583668 58 12 1'),
            ('PlayerSessions', 'IX_PlayerSessions_RoundId', '2583668 7'),
            ('PlayerSessions', 'IX_PlayerSessions_RoundId_PlayerName', '2583668 7 1'),
            ('PlayerSessions', 'IX_PlayerSessions_ServerGuid_LastSeenTime', '2583668 134 1'),
            ('PlayerSessions', 'IX_PlayerSessions_ServerGuid_StartTime_MapName', '2583668 134 1 1'),
            ('Rounds', 'IX_Rounds_IsActive', '1345060 295'),
            ('Rounds', 'IX_Rounds_IsActive_SyncedToNeo4jAt_StartTime', '1345060 295 295 2'),
            ('Rounds', 'IX_Rounds_MapName', '1345060 24'),
            ('Rounds', 'IX_Rounds_ServerGuid', '190 1'),
            ('Rounds', 'IX_Rounds_ServerGuid_EndTime', '1345060 48 1'),
            ('Rounds', 'IX_Rounds_ServerGuid_IsActive', '1345060 48 48'),
            ('Rounds', 'IX_Rounds_ServerGuid_StartTime', '1345060 48 1'),
            ('Rounds', 'sqlite_autoindex_Rounds_1', '1345060 1'),
            ('Servers', 'sqlite_autoindex_Servers_1', '784 1')
            """);
        // Makes this connection's planner read the rows just written.
        await dbContext.Database.ExecuteSqlRawAsync("ANALYZE sqlite_schema");
    }

    private async Task<List<string>> PlanAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = connection.CreateCommand();
#pragma warning disable CA2100 // Every statement explained here is one of the aggregator's constants.
        command.CommandText = "EXPLAIN QUERY PLAN " + sql;
#pragma warning restore CA2100
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name, value);

        var steps = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            steps.Add(reader.GetString(3));
        return steps;
    }

    [Fact]
    public async Task TheMonthScanReadsOneRangeOfTheLastSeenIndex()
    {
        // The reason this aggregate is cheap: a month is a range of the partial index, not
        // the whole-table sweep the start-time aggregates make.
        await UseProductionStatisticsAsync();

        var steps = await PlanAsync(TeamMapStatsAggregator.MonthScanSql,
            ("$start", "2026-08-01 00:00:00"), ("$end", "2026-09-01 00:00:00"));

        Assert.Contains(steps, step => step.StartsWith("SEARCH ps USING INDEX IX_PlayerSessions_LastSeenTime_WhereNotDeleted", StringComparison.Ordinal));
        Assert.DoesNotContain(steps, step => step.StartsWith("SCAN ps", StringComparison.Ordinal));
    }

    [Fact]
    public async Task PlayersSeenSinceReadsTheLastSeenIndexNotTheNameIndex()
    {
        await UseProductionStatisticsAsync();

        var steps = await PlanAsync(TeamMapStatsAggregator.PlayersSeenSinceSql, ("$since", "2026-09-26 11:00:00"));

        Assert.Equal("SEARCH PlayerSessions USING INDEX IX_PlayerSessions_LastSeenTime_WhereNotDeleted (LastSeenTime>?)", steps[0]);
    }

    [Fact]
    public async Task RoundsFinishedSinceWalkFromTheServersSeenSince()
    {
        await UseProductionStatisticsAsync();

        var steps = await PlanAsync(TeamMapStatsAggregator.PlayersInRoundsFinishedSinceSql, ("$since", "2026-09-26 11:00:00"));

        Assert.Equal("SCAN s", steps[0]);
        Assert.StartsWith("SEARCH r USING INDEX IX_Rounds_ServerGuid_EndTime (ServerGuid=? AND EndTime>?)", steps[1], StringComparison.Ordinal);
        Assert.StartsWith("SEARCH ps USING INDEX IX_PlayerSessions_RoundId", steps[2], StringComparison.Ordinal);
    }

    [Fact]
    public async Task RecomputeReadsEachPlayersOwnSessions()
    {
        await UseProductionStatisticsAsync();

        var steps = await PlanAsync(TeamMapStatsAggregator.PlayersScanSql.Replace("{0}", "$names", StringComparison.Ordinal),
            ("$names", "[\"Able\",\"Baker\"]"));

        Assert.Contains(steps, step => step.StartsWith("SEARCH ps USING INDEX IX_PlayerSessions_PlayerName", StringComparison.Ordinal));
        Assert.DoesNotContain(steps, step => step.StartsWith("SCAN ps", StringComparison.Ordinal));
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
