using api.Data.Entities;
using api.DataExplorer;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.DataExplorer;

public sealed class MapPlayerRankingsTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _db;
    private readonly DataExplorerService _service;
    private readonly Instant _now = Instant.FromUtc(2026, 10, 1, 0, 0);
    private readonly int _year = DateTime.UtcNow.Year;
    private readonly int _month = DateTime.UtcNow.Month;

    public MapPlayerRankingsTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();
        _db = new PlayerTrackerDbContext(
            new DbContextOptionsBuilder<PlayerTrackerDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
        _service = new DataExplorerService(_db, NullLogger<DataExplorerService>.Instance);
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task UnfilteredRankings_DoNotDoubleCountGlobalRows()
    {
        SeedServer("srv-a", "bf1942");
        SeedServer("srv-b", "bf1942");
        SeedMap("alice", "srv-a", score: 100, rounds: 5);
        SeedMap("alice", "srv-b", score: 200, rounds: 4);
        SeedMap("alice", "", score: 300, rounds: 9);
        await _db.SaveChangesAsync();

        var result = await _service.GetMapPlayerRankingsAsync("market garden", days: 60, minRounds: 3);

        Assert.NotNull(result);
        var alice = Assert.Single(result.Rankings);
        Assert.Equal(300, alice.TotalScore);
        Assert.Equal(9, alice.TotalRounds);
        Assert.Equal(2, alice.UniqueServers);
        Assert.Equal(1, result.TotalCount);
    }

    [Fact]
    public async Task PaginatesWithoutChangingTotalCountOrRankOffset()
    {
        SeedServer("srv-a", "bf1942");
        SeedMap("alpha", "srv-a", score: 500, rounds: 10);
        SeedMap("bravo", "srv-a", score: 400, rounds: 10);
        SeedMap("charlie", "srv-a", score: 300, rounds: 10);
        SeedMap("delta", "srv-a", score: 200, rounds: 10);
        SeedMap("echo", "srv-a", score: 100, rounds: 10);
        await _db.SaveChangesAsync();

        var page1 = await _service.GetMapPlayerRankingsAsync(
            "market garden", page: 1, pageSize: 2, days: 60, minRounds: 3);
        var page2 = await _service.GetMapPlayerRankingsAsync(
            "market garden", page: 2, pageSize: 2, days: 60, minRounds: 3);

        Assert.NotNull(page1);
        Assert.NotNull(page2);
        Assert.Equal(5, page1.TotalCount);
        Assert.Equal(5, page2.TotalCount);
        Assert.Equal(["alpha", "bravo"], page1.Rankings.Select(r => r.PlayerName).ToArray());
        Assert.Equal([1, 2], page1.Rankings.Select(r => r.Rank).ToArray());
        Assert.Equal(["charlie", "delta"], page2.Rankings.Select(r => r.PlayerName).ToArray());
        Assert.Equal([3, 4], page2.Rankings.Select(r => r.Rank).ToArray());
    }

    [Fact]
    public async Task RespectsMinRoundsHavingFilter()
    {
        SeedServer("srv-a", "bf1942");
        SeedMap("regular", "srv-a", score: 50, rounds: 5);
        SeedMap("tourist", "srv-a", score: 999, rounds: 2);
        await _db.SaveChangesAsync();

        var result = await _service.GetMapPlayerRankingsAsync(
            "market garden", days: 60, minRounds: 3);

        Assert.NotNull(result);
        Assert.Equal(1, result.TotalCount);
        Assert.Equal("regular", Assert.Single(result.Rankings).PlayerName);
    }

    [Fact]
    public async Task IsolatesGameViaServerCatalog()
    {
        SeedServer("bf-srv", "bf1942");
        SeedServer("fh-srv", "fh2");
        SeedMap("alice", "bf-srv", score: 100, rounds: 5);
        SeedMap("bob", "fh-srv", score: 900, rounds: 20);
        await _db.SaveChangesAsync();

        var result = await _service.GetMapPlayerRankingsAsync(
            "market garden", game: "bf1942", days: 60, minRounds: 3);

        Assert.NotNull(result);
        Assert.Equal(1, result.TotalCount);
        Assert.Equal("alice", Assert.Single(result.Rankings).PlayerName);
    }

    [Fact]
    public async Task FiltersToOneServer()
    {
        SeedServer("srv-a", "bf1942");
        SeedServer("srv-b", "bf1942");
        SeedMap("alice", "srv-a", score: 100, rounds: 5);
        SeedMap("alice", "srv-b", score: 200, rounds: 5);
        await _db.SaveChangesAsync();

        var result = await _service.GetMapPlayerRankingsAsync(
            "market garden", serverGuid: "srv-a", days: 60, minRounds: 3);

        Assert.NotNull(result);
        var alice = Assert.Single(result.Rankings);
        Assert.Equal(100, alice.TotalScore);
        Assert.Equal(1, alice.UniqueServers);
    }

    [Fact]
    public async Task ReturnsNull_WhenGameHasNoServers()
    {
        var result = await _service.GetMapPlayerRankingsAsync("market garden", game: "bf1942");
        Assert.Null(result);
    }

    private void SeedServer(string guid, string game)
    {
        _db.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = guid,
            Game = game,
            GameId = game,
            IsOnline = true
        });
    }

    private void SeedMap(string player, string serverGuid, int score, int rounds)
    {
        _db.PlayerMapStats.Add(new PlayerMapStats
        {
            PlayerName = player,
            MapName = "market garden",
            ServerGuid = serverGuid,
            Year = _year,
            Month = _month,
            TotalScore = score,
            TotalKills = score / 2,
            TotalDeaths = 10,
            TotalRounds = rounds,
            TotalPlayTimeMinutes = rounds * 20,
            UpdatedAt = _now
        });
    }
}
