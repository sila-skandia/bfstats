using api.PlayerTracking;
using api.ServiceRecord;
using api.ServiceRecord.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace api.tests.ServiceRecord;

public sealed class ServiceRecordStoreTests : IDisposable
{
    private static readonly DateTime Start = new(2026, 8, 25, 20, 0, 0, DateTimeKind.Utc);

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly ServiceRecordStore store;
    private int nextSession;

    public ServiceRecordStoreTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();
        dbContext = new PlayerTrackerDbContext(new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options);
        dbContext.Database.EnsureCreated();
        store = new ServiceRecordStore(dbContext);

        dbContext.Players.AddRange(new Player { Name = "BetMan" }, new Player { Name = "Other" });
        dbContext.Servers.AddRange(
            // bflist reports gameIds in any case, sometimes padded.
            new GameServer { Guid = "vanilla", Name = "Vanilla", Game = "bf1942", GameId = " BF1942 " },
            new GameServer { Guid = "sw", Name = "Secret Weapons", Game = "bf1942", GameId = "XPack2" },
            new GameServer { Guid = "fh2", Name = "Forgotten Hope 2", Game = "fh2", GameId = "fh2" });
        dbContext.Rounds.AddRange(
            NewRound("axis-won", tickets1: 50, tickets2: 0),
            NewRound("allied-won", tickets1: 0, tickets2: 30),
            NewRound("tied", tickets1: 10, tickets2: 10),
            NewRound("live", tickets1: 99, tickets2: 1, isActive: true),
            NewRound("no-tickets", tickets1: null, tickets2: 5));
        dbContext.SaveChanges();
    }

    private static Round NewRound(string id, int? tickets1, int? tickets2, bool isActive = false) => new()
    {
        RoundId = id,
        ServerGuid = "vanilla",
        ServerName = "Vanilla",
        MapName = "wake",
        GameType = "conquest",
        StartTime = Start,
        EndTime = isActive ? null : Start.AddMinutes(30),
        IsActive = isActive,
        Tickets1 = tickets1,
        Tickets2 = tickets2,
        Team1Label = "Axis",
        Team2Label = "Allied",
    };

    private void Session(string label, double minutes, string? roundId = null, string server = "vanilla",
        string map = "wake", string player = "BetMan", int kills = 0, int deaths = 0, int score = 0,
        bool deleted = false)
    {
        var start = Start.AddHours(nextSession++);
        dbContext.PlayerSessions.Add(new PlayerSession
        {
            PlayerName = player,
            ServerGuid = server,
            MapName = map,
            GameType = "conquest",
            StartTime = start,
            LastSeenTime = start.AddMinutes(minutes),
            RoundId = roundId,
            CurrentTeamLabel = label,
            TotalKills = kills,
            TotalDeaths = deaths,
            TotalScore = score,
            IsDeleted = deleted,
        });
    }

    private async Task<List<ServiceRecordRow>> RowsAsync()
    {
        await dbContext.SaveChangesAsync();
        return [.. (await store.GetRowsAsync("BetMan")).Rows.OrderBy(row => row.GameId).ThenBy(row => row.TeamLabel, StringComparer.Ordinal)];
    }

    [Fact]
    public async Task GetRowsAsync_SumsSessionsPerModMapAndTeamLabel()
    {
        Session("Axis", 10, kills: 5, deaths: 2, score: 20);
        Session("Axis ", 20, kills: 1, deaths: 3, score: 4);
        Session("Allied", 15, server: "sw", kills: 7, deaths: 1, score: 30);

        var rows = await RowsAsync();

        Assert.Collection(rows,
            vanilla =>
            {
                // gameId trimmed and lowercased; the padded label folded into "Axis".
                Assert.Equal("bf1942", vanilla.GameId);
                Assert.Equal("wake", vanilla.MapName);
                Assert.Equal("Axis", vanilla.TeamLabel);
                Assert.Equal(2, vanilla.Rounds);
                Assert.Equal(6, vanilla.Kills);
                Assert.Equal(5, vanilla.Deaths);
                Assert.Equal(24, vanilla.Score);
                Assert.Equal(30, vanilla.Minutes, precision: 3);
            },
            secretWeapons =>
            {
                Assert.Equal("xpack2", secretWeapons.GameId);
                Assert.Equal("Allied", secretWeapons.TeamLabel);
                Assert.Equal(1, secretWeapons.Rounds);
                Assert.Equal(15, secretWeapons.Minutes, precision: 3);
            });
    }

    [Fact]
    public async Task GetRowsAsync_CountsWinsAndLossesFromTheSessionsOwnRound()
    {
        Session("Axis", 5, roundId: "axis-won");
        Session("Axis", 5, roundId: "allied-won");
        Session("Axis", 5, roundId: "tied");
        Session("Axis", 5, roundId: "live");
        Session("Axis", 5, roundId: "no-tickets");
        Session("Axis", 5);
        // Labels compare without regard to case.
        Session("allied", 5, roundId: "allied-won");

        var rows = await RowsAsync();

        var axis = rows.Single(row => row.TeamLabel == "Axis");
        Assert.Equal(6, axis.Rounds);
        // One win, one loss; the tie, the unfinished round, the round without tickets and
        // the session without a round are neither.
        Assert.Equal(1, axis.Wins);
        Assert.Equal(1, axis.Losses);

        var allied = rows.Single(row => row.TeamLabel == "allied");
        Assert.Equal(1, allied.Wins);
        Assert.Equal(0, allied.Losses);
    }

    [Fact]
    public async Task GetRowsAsync_LeavesOutDeletedSessionsOtherGamesAndOtherPlayers()
    {
        Session("Axis", 10);
        Session("Axis", 10, deleted: true);
        Session("Axis", 10, server: "fh2");
        Session("Axis", 10, player: "Other");

        var row = Assert.Single(await RowsAsync());

        Assert.Equal(1, row.Rounds);
        Assert.Equal(10, row.Minutes, precision: 3);
    }

    [Fact]
    public async Task GetRowsAsync_NeverCountsNegativeTime()
    {
        Session("1", -30);
        Session("1", 12);

        var row = Assert.Single(await RowsAsync());

        Assert.Equal("1", row.TeamLabel);
        Assert.Equal(2, row.Rounds);
        Assert.Equal(12, row.Minutes, precision: 3);
    }

    [Fact]
    public async Task GetRowsAsync_ReturnsNothingForAPlayerWithNoSessions()
    {
        var result = await store.GetRowsAsync("Other");

        Assert.Empty(result.Rows);
        Assert.False(result.Capped);
    }

    [Fact]
    public async Task PlayerExistsAsync_MatchesThePlayersRowExactly()
    {
        Assert.True(await store.PlayerExistsAsync("BetMan"));
        Assert.False(await store.PlayerExistsAsync("Nobody"));
    }

    [Fact]
    public async Task GetRowsAsync_CountsOnlyTheMostRecentSessionsInTheWindow()
    {
        for (var i = 0; i < 5; i++)
            Session(i % 2 == 0 ? "Axis" : "Allied", 10);
        await dbContext.SaveChangesAsync();

        var result = await store.GetRowsAsync("BetMan", 3, CancellationToken.None);

        Assert.True(result.Capped);
        Assert.Equal(3, result.Rows.Sum(row => row.Rounds));
        // Sessions start an hour apart; the window's oldest is the third from the end.
        Assert.Equal(Start.AddHours(2), result.Rows.Min(row => row.OldestStart));
    }

    [Fact]
    public async Task GetRowsAsync_IsNotCappedWhenTheWindowHoldsEverySession()
    {
        for (var i = 0; i < 3; i++)
            Session("Axis", 10);
        await dbContext.SaveChangesAsync();

        var result = await store.GetRowsAsync("BetMan", 3, CancellationToken.None);

        Assert.False(result.Capped);
        Assert.Equal(3, Assert.Single(result.Rows).Rounds);
    }

    [Fact]
    public async Task GetRowsAsync_OtherGamesAndDeletedSessionsDoNotUseUpTheWindow()
    {
        Session("Axis", 10);
        Session("Axis", 10);
        Session("Axis", 10, server: "fh2");
        Session("Axis", 10, deleted: true);
        await dbContext.SaveChangesAsync();

        var result = await store.GetRowsAsync("BetMan", 2, CancellationToken.None);

        Assert.False(result.Capped);
        Assert.Equal(2, Assert.Single(result.Rows).Rounds);
    }

    [Fact]
    public async Task RowsSql_WalksThePlayersSessionsNewestFirstOnAnIndex()
    {
        // A regression here means sorting or scanning every session instead of reading one
        // player's newest thousand off IX_PlayerSessions_PlayerName_LastSeenTime, or driving
        // the join from Servers and probing every server's sessions.
        await using var command = connection.CreateCommand();
        command.CommandText = "EXPLAIN QUERY PLAN " + ServiceRecordStore.RowsSql;
        command.Parameters.AddWithValue("$playerName", "BetMan");
        command.Parameters.AddWithValue("$window", ServiceRecordStore.SessionWindow);

        var steps = new List<string>();
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
                steps.Add(reader.GetString(3));
        }

        Assert.Contains(steps, step => step.StartsWith("SEARCH PlayerSessions USING INDEX IX_PlayerSessions_PlayerName_LastSeenTime (PlayerName=?)", StringComparison.Ordinal));
        Assert.DoesNotContain(steps, step => step.StartsWith("SCAN PlayerSessions", StringComparison.Ordinal));
        Assert.DoesNotContain(steps, step => step.Contains("TEMP B-TREE FOR ORDER BY", StringComparison.Ordinal));
        Assert.Contains(steps, step => step.StartsWith("SEARCH s USING", StringComparison.Ordinal) && step.Contains("(Guid=?)", StringComparison.Ordinal));
        Assert.Contains(steps, step => step.StartsWith("SEARCH r USING", StringComparison.Ordinal) && step.Contains("(RoundId=?)", StringComparison.Ordinal));
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
