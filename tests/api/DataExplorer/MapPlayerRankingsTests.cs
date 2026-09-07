using api.Data.Entities;
using api.DataExplorer;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.DataExplorer;

/// <summary>
/// Guards the map-wide player leaderboard in
/// <see cref="DataExplorerService.GetMapPlayerRankingsAsync"/>.
///
/// That endpoint pages a PlayerMapStats GROUP BY PlayerName over a year/month
/// window, with a COUNT that uses the same HAVING SUM(TotalRounds) floor. The
/// production query was correct but not covering for those SUM columns, so it
/// is easy to "fix" a 9s page by dropping the COUNT or the round floor and
/// silently changing ranks. These tests pin ranking, the min-rounds filter,
/// month rolling, isolation by map+server, search, and pagination totals.
/// </summary>
public sealed class MapPlayerRankingsTests : IDisposable
{
    private const string Game = "bf1942";
    private const string ServerA = "server-a";
    private const string ServerB = "server-b";
    private const string MapGarden = "market garden";
    private const string MapWake = "wake island";

    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly DataExplorerService service;
    private readonly DateTime now;

    public MapPlayerRankingsTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        service = new DataExplorerService(dbContext, NullLogger<DataExplorerService>.Instance);
        now = DateTime.UtcNow;
    }

    [Fact]
    public async Task RanksPlayersByScoreOnTheRequestedServerMap()
    {
        SeedServer(ServerA);

        AddPlayerStats("Ace", ServerA, MapGarden, score: 300, kills: 10, rounds: 5);
        AddPlayerStats("Bravo", ServerA, MapGarden, score: 200, kills: 40, rounds: 5);
        AddPlayerStats("Charlie", ServerA, MapGarden, score: 100, kills: 20, rounds: 5);
        await dbContext.SaveChangesAsync();

        var result = await service.GetMapPlayerRankingsAsync(MapGarden, Game, serverGuid: ServerA);

        Assert.NotNull(result);
        Assert.Equal(3, result.TotalCount);
        Assert.Equal(["Ace", "Bravo", "Charlie"], result.Rankings.Select(e => e.PlayerName).ToList());
        Assert.Equal([1, 2, 3], result.Rankings.Select(e => e.Rank).ToList());
        Assert.Equal(300, result.Rankings[0].TotalScore);
        Assert.Equal(40, result.Rankings[1].TotalKills);
    }

    [Fact]
    public async Task ExcludesPlayersBelowMinRounds()
    {
        SeedServer(ServerA);

        AddPlayerStats("Qualified", ServerA, MapGarden, score: 50, kills: 10, rounds: 3);
        AddPlayerStats("TooFew", ServerA, MapGarden, score: 9_999, kills: 9_999, rounds: 2);
        await dbContext.SaveChangesAsync();

        var result = await service.GetMapPlayerRankingsAsync(MapGarden, Game, serverGuid: ServerA, minRounds: 3);

        Assert.NotNull(result);
        Assert.Equal(1, result.TotalCount);
        Assert.Equal("Qualified", Assert.Single(result.Rankings).PlayerName);
    }

    [Fact]
    public async Task SumsRoundsAcrossMonthsInsideTheWindow()
    {
        SeedServer(ServerA);

        var previous = now.AddMonths(-1);
        AddPlayerStats("Splitter", ServerA, MapGarden, score: 10, kills: 10, rounds: 2, year: previous.Year, month: previous.Month);
        AddPlayerStats("Splitter", ServerA, MapGarden, score: 15, kills: 5, rounds: 2, year: now.Year, month: now.Month);
        await dbContext.SaveChangesAsync();

        var result = await service.GetMapPlayerRankingsAsync(MapGarden, Game, serverGuid: ServerA, days: 60, minRounds: 3);

        var entry = Assert.Single(result!.Rankings);
        Assert.Equal("Splitter", entry.PlayerName);
        Assert.Equal(25, entry.TotalScore);
        Assert.Equal(15, entry.TotalKills);
        Assert.Equal(4, entry.TotalRounds);
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task IgnoresMonthsOutsideTheDaysWindow()
    {
        SeedServer(ServerA);

        var stale = now.AddDays(-90);
        AddPlayerStats("OldTimer", ServerA, MapGarden, score: 9_999, kills: 9_999, rounds: 20, year: stale.Year, month: stale.Month);
        AddPlayerStats("Current", ServerA, MapGarden, score: 10, kills: 10, rounds: 5);
        await dbContext.SaveChangesAsync();

        var result = await service.GetMapPlayerRankingsAsync(MapGarden, Game, serverGuid: ServerA, days: 60);

        Assert.Equal("Current", Assert.Single(result!.Rankings).PlayerName);
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task IsolatesByMapAndServer()
    {
        SeedServer(ServerA);
        SeedServer(ServerB);

        AddPlayerStats("OnGarden", ServerA, MapGarden, score: 100, kills: 10, rounds: 5);
        AddPlayerStats("OnWake", ServerA, MapWake, score: 9_999, kills: 9_999, rounds: 5);
        AddPlayerStats("OtherServer", ServerB, MapGarden, score: 9_999, kills: 9_999, rounds: 5);
        await dbContext.SaveChangesAsync();

        var result = await service.GetMapPlayerRankingsAsync(MapGarden, Game, serverGuid: ServerA);

        Assert.Equal("OnGarden", Assert.Single(result!.Rankings).PlayerName);
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task PaginatesWithoutChangingTotalCountOrRankOffset()
    {
        SeedServer(ServerA);

        AddPlayerStats("Ace", ServerA, MapGarden, score: 300, kills: 10, rounds: 5);
        AddPlayerStats("Bravo", ServerA, MapGarden, score: 200, kills: 10, rounds: 5);
        AddPlayerStats("Charlie", ServerA, MapGarden, score: 100, kills: 10, rounds: 5);
        await dbContext.SaveChangesAsync();

        var page2 = await service.GetMapPlayerRankingsAsync(
            MapGarden, Game, page: 2, pageSize: 2, serverGuid: ServerA);

        Assert.Equal(3, page2!.TotalCount);
        var only = Assert.Single(page2.Rankings);
        Assert.Equal("Charlie", only.PlayerName);
        Assert.Equal(3, only.Rank);
    }

    [Fact]
    public async Task PrefixSearchNarrowsBothPageAndTotal()
    {
        SeedServer(ServerA);

        AddPlayerStats("AlphaOne", ServerA, MapGarden, score: 300, kills: 10, rounds: 5);
        AddPlayerStats("AlphaTwo", ServerA, MapGarden, score: 200, kills: 10, rounds: 5);
        AddPlayerStats("Bravo", ServerA, MapGarden, score: 100, kills: 10, rounds: 5);
        await dbContext.SaveChangesAsync();

        var result = await service.GetMapPlayerRankingsAsync(
            MapGarden, Game, serverGuid: ServerA, searchQuery: "Alpha");

        Assert.Equal(2, result!.TotalCount);
        Assert.Equal(["AlphaOne", "AlphaTwo"], result.Rankings.Select(e => e.PlayerName).ToList());
    }

    private void SeedServer(string guid)
    {
        dbContext.Servers.Add(new GameServer { Guid = guid, Name = $"Name of {guid}", Game = Game });
    }

    private void AddPlayerStats(
        string playerName,
        string serverGuid,
        string mapName,
        int score,
        int kills,
        int rounds,
        int? year = null,
        int? month = null)
    {
        dbContext.Set<PlayerMapStats>().Add(new PlayerMapStats
        {
            PlayerName = playerName,
            MapName = mapName,
            ServerGuid = serverGuid,
            Year = year ?? now.Year,
            Month = month ?? now.Month,
            TotalRounds = rounds,
            TotalKills = kills,
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
