using System.Globalization;
using api.Data.Entities;
using api.PlayerRelationships;
using api.PlayerRelationships.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NodaTime;

namespace api.tests.PlayerRelationships;

public sealed class ServerProximityServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly IRelationshipCacheService cache;
    private readonly ServerProximityService service;
    private readonly HashSet<string> seededPlayers = [];
    private readonly HashSet<string> seededServers = [];

    public ServerProximityServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        cache = Substitute.For<IRelationshipCacheService>();
        cache.GetAsync<ServerProximityResponse>(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((ServerProximityResponse?)null);

        service = new ServerProximityService(dbContext, cache, NullLogger<ServerProximityService>.Instance);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }

    private void EnsureParents(string player, string serverGuid)
    {
        if (seededPlayers.Add(player))
            dbContext.Players.Add(new Player { Name = player });

        if (seededServers.Add(serverGuid))
            dbContext.Servers.Add(new GameServer { Guid = serverGuid, Name = serverGuid });
    }

    private void AddSession(
        string player,
        string serverGuid,
        DateTime start,
        double? ping,
        bool deleted = false)
    {
        EnsureParents(player, serverGuid);
        dbContext.PlayerSessions.Add(new PlayerSession
        {
            PlayerName = player,
            ServerGuid = serverGuid,
            StartTime = start,
            LastSeenTime = start.AddMinutes(20),
            IsActive = false,
            IsDeleted = deleted,
            AveragePing = ping,
            MapName = "Wake"
        });
    }

    private void AddWeeklyStats(string player, string serverGuid, int rounds, int? year = null, int? week = null)
    {
        var now = DateTime.UtcNow;
        dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            PlayerName = player,
            ServerGuid = serverGuid,
            Year = year ?? ISOWeek.GetYear(now),
            Week = week ?? ISOWeek.GetWeekOfYear(now),
            TotalRounds = rounds,
            TotalKills = rounds * 4,
            TotalDeaths = rounds * 2,
            TotalScore = rounds * 10,
            TotalPlayTimeMinutes = rounds * 15,
            UpdatedAt = Instant.FromUtc(now.Year, now.Month, Math.Min(now.Day, 28), 0, 0)
        });
    }

    [Fact]
    public async Task GetAsync_RanksByWeeklyRounds_AndIgnoresOneOffSessions()
    {
        const string server = "simple";
        var monday = DateTime.UtcNow.AddHours(-18);

        AddWeeklyStats("Regular", server, rounds: 40);
        AddWeeklyStats("Visitor", server, rounds: 2);
        AddWeeklyStats("Regular", "other-server", rounds: 200);

        for (var i = 0; i < 8; i++)
            AddSession("Regular", server, monday.AddHours(i), ping: 40);

        for (var i = 0; i < 30; i++)
            AddSession("OneOff", server, monday.AddHours(i), ping: 20);

        AddSession("Visitor", server, monday, ping: 35);
        AddSession("Visitor", server, monday.AddHours(1), ping: 45);

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, minPing: 0, maxPing: 250, limit: 50);

        Assert.Equal(2, result.TotalRegulars);
        Assert.Equal(2, result.Players.Count);
        Assert.Equal("Regular", result.Players[0].PlayerName);
        Assert.Equal("Visitor", result.Players[1].PlayerName);
        Assert.DoesNotContain(result.Players, p => p.PlayerName == "OneOff");
        Assert.Equal(8, result.Players[0].SessionCount);
        Assert.Equal(40, result.Players[0].AvgPing, 1);
    }

    [Fact]
    public async Task GetAsync_FiltersByAveragePingWindow()
    {
        const string server = "simple";
        var start = DateTime.UtcNow.AddHours(-10);

        AddWeeklyStats("Close", server, 10);
        AddWeeklyStats("Far", server, 10);

        AddSession("Close", server, start, ping: 30);
        AddSession("Close", server, start.AddHours(1), ping: 40);
        AddSession("Far", server, start, ping: 180);
        AddSession("Far", server, start.AddHours(1), ping: 200);

        await dbContext.SaveChangesAsync();

        var closeOnly = await service.GetAsync(server, minPing: 0, maxPing: 80, limit: 50);
        Assert.Single(closeOnly.Players);
        Assert.Equal("Close", closeOnly.Players[0].PlayerName);
        Assert.Equal(1, closeOnly.TotalRegulars);

        var farOnly = await service.GetAsync(server, minPing: 150, maxPing: 250, limit: 50);
        Assert.Single(farOnly.Players);
        Assert.Equal("Far", farOnly.Players[0].PlayerName);
        Assert.Equal(1, farOnly.TotalRegulars);
    }

    [Fact]
    public async Task GetAsync_ComputesPeakHourFromNamedSessions()
    {
        const string server = "simple";
        var day = DateTime.UtcNow.Date.AddDays(-2);

        AddWeeklyStats("NightOwl", server, 5);
        AddSession("NightOwl", server, day.AddHours(3), ping: 50);
        AddSession("NightOwl", server, day.AddHours(3).AddDays(1), ping: 55);
        AddSession("NightOwl", server, day.AddHours(3).AddDays(2), ping: 45);
        AddSession("NightOwl", server, day.AddHours(18), ping: 50);

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, 0, 250, 10);
        Assert.Single(result.Players);
        Assert.Equal(3, result.Players[0].PeakHourUtc);
    }

    [Fact]
    public async Task GetAsync_SkipsDeletedAndNullPingSessions()
    {
        const string server = "simple";
        var start = DateTime.UtcNow.AddHours(-8);

        AddWeeklyStats("OnlyLive", server, 4);
        AddSession("OnlyLive", server, start, ping: 60);
        AddSession("OnlyLive", server, start.AddHours(1), ping: 80, deleted: true);
        AddSession("OnlyLive", server, start.AddHours(2), ping: null);

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, 0, 250, 10);
        Assert.Single(result.Players);
        Assert.Equal(1, result.Players[0].SessionCount);
        Assert.Equal(60, result.Players[0].AvgPing, 1);
    }

    [Fact]
    public async Task GetAsync_FallsBackToSessions_WhenWeeklyStatsAreEmpty()
    {
        const string server = "brand-new";
        var start = DateTime.UtcNow.AddHours(-6);

        AddSession("Pioneer", server, start, ping: 25);
        AddSession("Pioneer", server, start.AddHours(1), ping: 35);
        AddSession("Second", server, start, ping: 90);

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, 0, 250, 50);
        Assert.Equal(2, result.TotalRegulars);
        Assert.Equal("Pioneer", result.Players[0].PlayerName);
        Assert.Equal(2, result.Players[0].SessionCount);
    }

    [Fact]
    public async Task GetAsync_RespectsLimit()
    {
        const string server = "simple";
        var start = DateTime.UtcNow.AddHours(-9);

        for (var i = 0; i < 6; i++)
        {
            var name = $"P{i}";
            AddWeeklyStats(name, server, rounds: 20 - i);
            for (var s = 0; s < 6 - i; s++)
                AddSession(name, server, start.AddHours(i).AddMinutes(s), ping: 40);
        }

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, 0, 250, limit: 3);
        Assert.Equal(6, result.TotalRegulars);
        Assert.Equal(3, result.Players.Count);
        Assert.Equal(["P0", "P1", "P2"], result.Players.Select(p => p.PlayerName).ToList());
    }

    [Fact]
    public async Task GetAsync_IgnoresSessionsOlderThanLookback()
    {
        const string server = "simple";
        var recent = DateTime.UtcNow.AddDays(-2);
        var stale = DateTime.UtcNow.AddDays(-(ServerProximityService.SessionLookbackDays + 10));

        AddWeeklyStats("Regular", server, 20);
        AddSession("Regular", server, recent, ping: 40);
        AddSession("Regular", server, recent.AddHours(1), ping: 50);
        for (var i = 0; i < 20; i++)
            AddSession("Regular", server, stale.AddHours(i), ping: 200);

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, 0, 250, 10);
        Assert.Single(result.Players);
        Assert.Equal(2, result.Players[0].SessionCount);
        Assert.Equal(45, result.Players[0].AvgPing, 1);
    }

    [Fact]
    public async Task GetAsync_RanksByRecentWeeksOnly()
    {
        const string server = "simple";
        var recent = DateTime.UtcNow.AddHours(-4);
        var cutoff = DateTime.UtcNow.AddDays(-7 * (ServerProximityService.CandidateLookbackWeeks + 4));

        AddWeeklyStats("Current", server, 8);
        AddWeeklyStats("Retired", server, 400, year: ISOWeek.GetYear(cutoff), week: ISOWeek.GetWeekOfYear(cutoff));

        AddSession("Current", server, recent, ping: 30);
        AddSession("Current", server, recent.AddHours(1), ping: 40);
        AddSession("Retired", server, recent, ping: 20);
        AddSession("Retired", server, recent.AddHours(1), ping: 25);

        await dbContext.SaveChangesAsync();

        var result = await service.GetAsync(server, 0, 250, 10);
        Assert.Single(result.Players);
        Assert.Equal("Current", result.Players[0].PlayerName);
        Assert.DoesNotContain(result.Players, p => p.PlayerName == "Retired");
    }

    [Fact]
    public async Task GetAsync_ReturnsCachedResponse()
    {
        var cached = new ServerProximityResponse(
            [new ServerProximityEntry("Cached", 42, 3, 15, DateTime.UtcNow)],
            1);
        cache.GetAsync<ServerProximityResponse>(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(cached);

        var result = await service.GetAsync("any", 0, 250, 50);
        Assert.Same(cached, result);
        Assert.Empty(dbContext.ChangeTracker.Entries());
    }
}
