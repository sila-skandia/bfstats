using api.Data.Entities;
using api.GameTrends;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace api.tests.GameTrends;

public sealed class PlayerTrendTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly SqliteGameTrendsService _service;

    public PlayerTrendTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();
        _service = new SqliteGameTrendsService(_dbContext);
    }

    [Fact]
    public async Task NetworkTrend_SumsOnlyServersCurrentlyOnline()
    {
        var hour = Instant.FromDateTimeUtc(DateTime.UtcNow.AddHours(-2));
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "live-1", Name = "Live", Game = "bf1942", GameId = "bf1942", IsOnline = true },
            new GameServer { Guid = "dead-1", Name = "Dead", Game = "bf1942", GameId = "bf1942", IsOnline = false }
        );
        _dbContext.ServerOnlineCounts.AddRange(
            Count("live-1", hour, avg: 20, peak: 24),
            Count("dead-1", hour, avg: 40, peak: 50)
        );
        await _dbContext.SaveChangesAsync();

        var trend = await _service.GetNetworkPlayerTrendAsync("bf1942", 7);

        Assert.Equal("network", trend.Scope);
        Assert.Equal(1, trend.ServerCount);
        var point = Assert.Single(trend.Points);
        Assert.Equal(20, point.AvgPlayers);
        Assert.Equal(24, point.PeakPlayers);
    }

    [Fact]
    public async Task NetworkTrend_ReturnsEmpty_WhenNoLiveServers()
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = "dead-1",
            Name = "Dead",
            Game = "bf1942",
            GameId = "bf1942",
            IsOnline = false
        });
        _dbContext.ServerOnlineCounts.Add(Count("dead-1", Instant.FromDateTimeUtc(DateTime.UtcNow.AddHours(-1)), 12, 14));
        await _dbContext.SaveChangesAsync();

        var trend = await _service.GetNetworkPlayerTrendAsync("bf1942", 7);

        Assert.Empty(trend.Points);
        Assert.Equal(0, trend.ServerCount);
    }

    [Fact]
    public async Task ServerTrend_UsesPrimaryKeyRange_AndIgnoresOtherServers()
    {
        var hour = Instant.FromDateTimeUtc(DateTime.UtcNow.AddHours(-3));
        _dbContext.ServerOnlineCounts.AddRange(
            Count("alpha", hour, 8, 10),
            Count("beta", hour, 30, 32)
        );
        await _dbContext.SaveChangesAsync();

        var trend = await _service.GetServerPlayerTrendAsync("alpha", 7);

        Assert.Equal("server", trend.Scope);
        Assert.Equal("alpha", trend.ServerGuid);
        var point = Assert.Single(trend.Points);
        Assert.Equal(8, point.AvgPlayers);
        Assert.Equal(10, point.PeakPlayers);
    }

    [Fact]
    public async Task ServerTrend_DropsRowsOlderThanLookback()
    {
        var recent = Instant.FromDateTimeUtc(DateTime.UtcNow.AddHours(-2));
        var old = Instant.FromDateTimeUtc(DateTime.UtcNow.AddDays(-20));
        _dbContext.ServerOnlineCounts.AddRange(
            Count("alpha", recent, 5, 6),
            Count("alpha", old, 99, 99)
        );
        await _dbContext.SaveChangesAsync();

        var trend = await _service.GetServerPlayerTrendAsync("alpha", 7);

        var point = Assert.Single(trend.Points);
        Assert.Equal(5, point.AvgPlayers);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }

    private static ServerOnlineCount Count(string guid, Instant hour, double avg, int peak) => new()
    {
        ServerGuid = guid,
        HourTimestamp = hour,
        Game = "bf1942",
        AvgPlayers = avg,
        PeakPlayers = peak,
        SampleCount = 10
    };
}
