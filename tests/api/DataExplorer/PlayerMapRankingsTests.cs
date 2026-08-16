using api.Data.Entities;
using api.DataExplorer;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.DataExplorer;

/// <summary>
/// Guards the scope of the ranking query in <see cref="DataExplorerService.GetPlayerMapRankingsAsync"/>.
///
/// The ranking CTE used to build its ServerGuid IN list from every server for the game —
/// 690 in production — to answer a question about the handful of servers the player has
/// actually played on. It is now scoped to the player's own servers.
///
/// That narrowing is only safe because rank is partitioned by (MapName, ServerGuid): a
/// partition the player is absent from cannot contribute a row to the final result. The
/// tests here pin both halves of that argument — the servers the player is absent from
/// must not matter, and the *other players* on the servers they are present on must
/// still count, which is what a careless narrowing would break.
/// </summary>
public sealed class PlayerMapRankingsTests : IDisposable
{
    private const string Game = "bf1942";
    private const string PlayerServerA = "server-a";
    private const string PlayerServerB = "server-b";
    private const string UnrelatedServer = "server-c";
    private const string Map = "berlin";
    private const string Target = "Target";

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly DataExplorerService service;

    public PlayerMapRankingsTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        service = new DataExplorerService(dbContext, NullLogger<DataExplorerService>.Instance);
    }

    [Fact]
    public async Task RanksThePlayerAgainstEveryoneOnTheSameServer()
    {
        SeedServers(PlayerServerA);

        // Target is third on server A by score.
        AddStats(Target, PlayerServerA, score: 100);
        AddStats("Better", PlayerServerA, score: 300);
        AddStats("AlsoBetter", PlayerServerA, score: 200);
        AddStats("Worse", PlayerServerA, score: 50);
        await dbContext.SaveChangesAsync();

        var result = await service.GetPlayerMapRankingsAsync(Target, Game);

        var serverStats = Assert.Single(Assert.Single(result!.MapGroups).ServerStats);
        Assert.Equal(3, serverStats.Rank);
    }

    [Fact]
    public async Task IgnoresServersThePlayerHasNeverPlayedOn()
    {
        SeedServers(PlayerServerA, UnrelatedServer);

        AddStats(Target, PlayerServerA, score: 100);
        AddStats("Worse", PlayerServerA, score: 50);

        // Same map, a server Target has never touched, and scores that would dominate
        // the leaderboard if the two servers were ever pooled into one partition.
        AddStats("Stranger", UnrelatedServer, score: 9_999);
        AddStats("OtherStranger", UnrelatedServer, score: 8_888);
        await dbContext.SaveChangesAsync();

        var result = await service.GetPlayerMapRankingsAsync(Target, Game);

        var mapGroup = Assert.Single(result!.MapGroups);
        var serverStats = Assert.Single(mapGroup.ServerStats);
        Assert.Equal(PlayerServerA, serverStats.ServerGuid);
        Assert.Equal(1, serverStats.Rank);
    }

    [Fact]
    public async Task RanksEachOfThePlayersServersIndependently()
    {
        SeedServers(PlayerServerA, PlayerServerB, UnrelatedServer);

        // First on A, second on B.
        AddStats(Target, PlayerServerA, score: 500);
        AddStats("Rival", PlayerServerA, score: 100);

        AddStats(Target, PlayerServerB, score: 100);
        AddStats("Rival", PlayerServerB, score: 500);

        AddStats("Stranger", UnrelatedServer, score: 9_999);
        await dbContext.SaveChangesAsync();

        var result = await service.GetPlayerMapRankingsAsync(Target, Game);

        var mapGroup = Assert.Single(result!.MapGroups);
        Assert.Equal(2, mapGroup.ServerStats.Count);
        Assert.Equal(1, mapGroup.ServerStats.Single(s => s.ServerGuid == PlayerServerA).Rank);
        Assert.Equal(2, mapGroup.ServerStats.Single(s => s.ServerGuid == PlayerServerB).Rank);

        // BestRank reads across the player's servers, so it should follow server A.
        Assert.Equal(1, mapGroup.BestRank);
    }

    [Fact]
    public async Task ReturnsNullWhenThePlayerHasNoStatsForTheGame()
    {
        SeedServers(PlayerServerA);
        AddStats("SomeoneElse", PlayerServerA, score: 100);
        await dbContext.SaveChangesAsync();

        Assert.Null(await service.GetPlayerMapRankingsAsync(Target, Game));
    }

    private void SeedServers(params string[] guids)
    {
        foreach (var guid in guids)
        {
            dbContext.Servers.Add(new GameServer { Guid = guid, Name = $"Name of {guid}", Game = Game });
        }
    }

    private void AddStats(string playerName, string serverGuid, int score)
    {
        // The query filters on (Year, Month) against a cutoff derived from `days`, so
        // stats have to be stamped in the current period to be visible at all.
        var now = DateTime.UtcNow;

        dbContext.Set<PlayerMapStats>().Add(new PlayerMapStats
        {
            PlayerName = playerName,
            MapName = Map,
            ServerGuid = serverGuid,
            Year = now.Year,
            Month = now.Month,
            TotalRounds = 1,
            TotalKills = 10,
            TotalDeaths = 5,
            TotalScore = score,
            TotalPlayTimeMinutes = 60,
            UpdatedAt = Instant.FromDateTimeUtc(DateTime.SpecifyKind(now, DateTimeKind.Utc))
        });
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
