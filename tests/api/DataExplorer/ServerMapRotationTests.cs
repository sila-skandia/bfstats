using api.Data.Entities;
using api.DataExplorer;
using api.Gamification.Models;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.DataExplorer;

public sealed class ServerMapRotationTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _db;
    private readonly DataExplorerService _service;
    private readonly Instant _now = Instant.FromUtc(2026, 10, 17, 2, 0);
    private int _achievementSeq;

    public ServerMapRotationTests()
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
    public async Task ReturnsNull_WhenServerMissing()
    {
        var result = await _service.GetServerMapRotationAsync("missing");
        Assert.Null(result);
    }

    [Fact]
    public async Task PicksGoldWinnerPerMap_IgnoringOtherTiersTypesAndServers()
    {
        SeedServer("moon");
        SeedMap("moon", "kursk", playMinutes: 200);
        SeedMap("moon", "wake", playMinutes: 100);

        SeedGold("alice", "moon", "kursk", 3);
        SeedGold("bob", "moon", "kursk", 2);
        SeedPlacement("carol", "moon", "kursk", "silver", 9);
        SeedAchievement("dave", "moon", "kursk", "kill_streak", "gold", 9);
        SeedGold("erin", "other-server", "kursk", 9);
        SeedGold("frank", "moon", "wake", 1);

        await _db.SaveChangesAsync();

        var result = await _service.GetServerMapRotationAsync("moon", page: 1, pageSize: 50);

        Assert.NotNull(result);
        Assert.Equal(2, result.TotalCount);
        Assert.Equal(["kursk", "wake"], result.Maps.Select(m => m.MapName).ToArray());

        var kursk = result.Maps[0];
        Assert.NotNull(kursk.TopPlayerByWins);
        Assert.Equal("alice", kursk.TopPlayerByWins.PlayerName);
        Assert.Equal(3, kursk.TopPlayerByWins.Wins);

        var wake = result.Maps[1];
        Assert.NotNull(wake.TopPlayerByWins);
        Assert.Equal("frank", wake.TopPlayerByWins.PlayerName);
        Assert.Equal(1, wake.TopPlayerByWins.Wins);
    }

    [Fact]
    public async Task BreaksWinTiesByPlayerName()
    {
        SeedServer("moon");
        SeedMap("moon", "kursk", playMinutes: 50);
        SeedGold("zeta", "moon", "kursk", 2);
        SeedGold("alpha", "moon", "kursk", 2);
        await _db.SaveChangesAsync();

        var result = await _service.GetServerMapRotationAsync("moon", pageSize: 10);

        Assert.NotNull(result);
        var winner = Assert.Single(result.Maps).TopPlayerByWins;
        Assert.NotNull(winner);
        Assert.Equal("alpha", winner.PlayerName);
        Assert.Equal(2, winner.Wins);
    }

    [Fact]
    public async Task ComputesWinnersOnlyForTheRequestedPage()
    {
        SeedServer("moon");
        SeedMap("moon", "kursk", playMinutes: 300);
        SeedMap("moon", "wake", playMinutes: 200);
        SeedMap("moon", "midway", playMinutes: 100);
        SeedGold("alice", "moon", "kursk", 1);
        SeedGold("bob", "moon", "wake", 1);
        SeedGold("carol", "moon", "midway", 1);
        await _db.SaveChangesAsync();

        var page1 = await _service.GetServerMapRotationAsync("moon", page: 1, pageSize: 1);
        var page2 = await _service.GetServerMapRotationAsync("moon", page: 2, pageSize: 1);

        Assert.NotNull(page1);
        Assert.NotNull(page2);
        Assert.Equal(3, page1.TotalCount);
        Assert.True(page1.HasMore);
        Assert.Equal("kursk", Assert.Single(page1.Maps).MapName);
        Assert.Equal("alice", page1.Maps[0].TopPlayerByWins?.PlayerName);
        Assert.Equal("wake", Assert.Single(page2.Maps).MapName);
        Assert.Equal("bob", page2.Maps[0].TopPlayerByWins?.PlayerName);
    }

    private void SeedServer(string guid)
    {
        _db.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = guid,
            Game = "bf1942",
            GameId = "bf1942",
            IsOnline = true
        });
    }

    private void SeedMap(string serverGuid, string mapName, int playMinutes)
    {
        var now = DateTime.UtcNow;
        _db.ServerMapStats.Add(new ServerMapStats
        {
            ServerGuid = serverGuid,
            MapName = mapName,
            Year = now.Year,
            Month = now.Month,
            TotalRounds = playMinutes / 20,
            TotalPlayTimeMinutes = playMinutes,
            AvgConcurrentPlayers = 20,
            Team1Victories = 2,
            Team2Victories = 1,
            Team1Label = "Axis",
            Team2Label = "Allies",
            UpdatedAt = _now
        });
    }

    private void SeedGold(string player, string serverGuid, string mapName, int wins) =>
        SeedPlacement(player, serverGuid, mapName, "gold", wins);

    private void SeedPlacement(string player, string serverGuid, string mapName, string tier, int wins)
    {
        SeedAchievement(player, serverGuid, mapName, AchievementTypes.Placement, tier, wins);
    }

    private void SeedAchievement(
        string player,
        string serverGuid,
        string mapName,
        string type,
        string tier,
        int wins)
    {
        for (var i = 0; i < wins; i++)
        {
            _achievementSeq++;
            _db.PlayerAchievements.Add(new PlayerAchievement
            {
                PlayerName = player,
                AchievementType = type,
                AchievementId = $"{type}_{_achievementSeq}",
                AchievementName = type,
                Tier = tier,
                Value = 1,
                AchievedAt = Instant.FromUtc(2026, 10, 1, 12, _achievementSeq % 60),
                ProcessedAt = _now,
                ServerGuid = serverGuid,
                MapName = mapName,
                RoundId = $"round-{_achievementSeq}",
                Game = "bf1942",
                Version = _now
            });
        }
    }
}
