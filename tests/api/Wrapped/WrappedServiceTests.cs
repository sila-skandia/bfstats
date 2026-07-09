using api.Data.Entities;
using api.PlayerTracking;
using api.Wrapped;
using api.Wrapped.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using NodaTime;
using NSubstitute;
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace api.tests.Wrapped;

public class WrappedServiceTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly ILogger<WrappedService> _logger;
    private readonly WrappedService _service;

    public WrappedServiceTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        
        // Enable foreign key constraints in in-memory Sqlite
        using (var command = _connection.CreateCommand())
        {
            command.CommandText = "PRAGMA foreign_keys = ON;";
            command.ExecuteNonQuery();
        }
        
        _dbContext.Database.EnsureCreated();

        var inMemorySettings = new Dictionary<string, string?>
        {
            {"ServerWrapped:AllowedGuids:0", "test-server-guid"},
            {"ServerWrapped:AllowedGuids:1", "cached-server-guid"}
        };

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var relationshipService = Substitute.For<api.PlayerRelationships.IPlayerRelationshipService>();
        var serviceProvider = Substitute.For<IServiceProvider>();
        serviceProvider.GetService(typeof(api.PlayerRelationships.IPlayerRelationshipService)).Returns(relationshipService);
        _logger = Substitute.For<ILogger<WrappedService>>();
        _service = new WrappedService(_dbContext, configuration, serviceProvider, _logger);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Close();
    }

    [Fact]
    public async Task GetServerWrappedAsync_CalculatesAndCaches_OnCacheMiss()
    {
        // Register CodePages encoding provider
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var cp1252 = Encoding.GetEncoding(1252);
        var cp1251 = Encoding.GetEncoding(1251);

        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer
        {
            Guid = serverGuid,
            Name = "Test Server Est. 2004",
            Ip = "127.0.0.1",
            Port = 14567,
            GameId = "bf1942",
            Timezone = "UTC"
        };
        _dbContext.Servers.Add(server);

        // Synthesize an encoded name matching PlayerNameDecoder's CP1252/CP1251 expectations
        var rawBytes = new byte[] { 208, 209, 210 }; // "РСТ" in CP1251
        var playerName = cp1252.GetString(rawBytes);

        var player = new Player
        {
            Name = playerName,
            FirstSeen = new DateTime(2025, 1, 1),
            LastSeen = new DateTime(2026, 12, 31)
        };
        _dbContext.Players.Add(player);

        // Add a round in 2026
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "round-1",
            ServerGuid = serverGuid,
            ServerName = "Test Server Est. 2004",
            MapName = "El Alamein",
            GameType = "Conquest",
            StartTime = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc),
            EndTime = new DateTime(2026, 6, 1, 12, 30, 0, DateTimeKind.Utc),
            ParticipantCount = 64,
            Tickets1 = 10,
            Tickets2 = 0,
            IsDeleted = false
        });

        // Add a player session in 2026
        _dbContext.PlayerSessions.Add(new PlayerSession
        {
            SessionId = 1,
            ServerGuid = serverGuid,
            PlayerName = playerName,
            StartTime = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc),
            LastSeenTime = new DateTime(2026, 6, 1, 12, 30, 0, DateTimeKind.Utc),
            IsDeleted = false
        });

        // Add some player server stats for 2026
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            Year = 2026,
            Week = 23,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(serverGuid, result.ServerGuid);
        Assert.Equal("Test Server Est. 2004", result.ServerName);
        Assert.Equal(1, result.YearInNumbers.RoundsFought);
        Assert.Equal(1, result.YearInNumbers.UniqueSoldiers);
        Assert.Equal(2.5, result.YearInNumbers.HoursInCombat); // 150 mins / 60

        // Verify player name is decoded correctly
        var expectedName = cp1251.GetString(rawBytes);
        Assert.Equal(expectedName, result.Honours.VolumeBoards.TopScore.PlayerName);

        // Verify cache record is created in database
        var cached = await _dbContext.ServerWrappedCaches.FirstOrDefaultAsync(c => c.ServerGuid == serverGuid && c.Year == 2026);
        Assert.NotNull(cached);
        Assert.Contains("test-server-guid", cached.JsonData);
    }

    [Fact]
    public async Task GetServerWrappedAsync_FiltersOutCtfAndTieRounds()
    {
        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" };
        _dbContext.Servers.Add(server);

        // Add 3 rounds in 2026:
        // Round 1: Conquest, margin = 2 (valid)
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "r-conquest-valid", ServerGuid = serverGuid, MapName = "Map A", GameType = "Conquest",
            StartTime = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc), Tickets1 = 10, Tickets2 = 8, ParticipantCount = 64
        });
        // Round 2: CTF, margin = 1 (invalid)
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "r-ctf-invalid", ServerGuid = serverGuid, MapName = "Map B", GameType = "CTF",
            StartTime = new DateTime(2026, 6, 1, 13, 0, 0, DateTimeKind.Utc), Tickets1 = 5, Tickets2 = 4, ParticipantCount = 64
        });
        // Round 3: Conquest, margin = 0 (invalid tie)
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "r-tie-invalid", ServerGuid = serverGuid, MapName = "Map C", GameType = "Conquest",
            StartTime = new DateTime(2026, 6, 1, 14, 0, 0, DateTimeKind.Utc), Tickets1 = 10, Tickets2 = 10, ParticipantCount = 64
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        // Should only have 1 closest battle (Round 1)
        Assert.Single(result.ClosestBattles);
        Assert.Equal("Map A", result.ClosestBattles[0].MapName);
        Assert.Equal(2, result.ClosestBattles[0].TicketsMargin);
    }

    [Fact]
    public async Task GetServerWrappedAsync_PopulatesPrestigiousMilestone()
    {
        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" };
        _dbContext.Servers.Add(server);

        // Add two milestone achievements achieved in 2026:
        // 1. total_kills_100 (Centurion, lower prestige)
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            ServerGuid = serverGuid, PlayerName = "SgtPepper", AchievementId = "total_kills_100",
            AchievementType = "milestone", AchievedAt = Instant.FromUtc(2026, 5, 1, 12, 0)
        });
        // 2. total_kills_50000 (God of War, higher prestige)
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            ServerGuid = serverGuid, PlayerName = "SgtPepper", AchievementId = "total_kills_50000",
            AchievementType = "milestone", AchievedAt = Instant.FromUtc(2026, 6, 1, 12, 0)
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.Decorations.MilestonesCrossed);
        Assert.NotNull(result.Decorations.PrestigiousMilestone);
        Assert.Equal("total_kills_50000", result.Decorations.PrestigiousMilestone.AchievementId);
        Assert.Equal("SgtPepper", result.Decorations.PrestigiousMilestone.PlayerName);
        Assert.Equal("God of War (50,000 Kills)", result.Decorations.PrestigiousMilestone.AchievementName);
    }

    [Fact]
    public async Task GetServerWrappedAsync_ReturnsCachedData_OnCacheHit()
    {
        // Arrange
        var serverGuid = "cached-server-guid";
        var cacheJson = "{\"serverGuid\":\"cached-server-guid\",\"serverName\":\"Cached Server\",\"year\":2026,\"yearInNumbers\":{\"roundsFought\":42}}";
        
        _dbContext.ServerWrappedCaches.Add(new ServerWrappedCache
        {
            ServerGuid = serverGuid,
            Year = 2026,
            JsonData = cacheJson,
            CalculatedAt = Instant.FromUtc(2026, 7, 9, 0, 0)
        });
        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);
        
        // Assert
        Assert.NotNull(result);
        Assert.Equal(serverGuid, result.ServerGuid);
        Assert.Equal("Cached Server", result.ServerName);
        Assert.Equal(42, result.YearInNumbers.RoundsFought);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_CalculatesAndCaches_OnCacheMiss_Global()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var cp1252 = Encoding.GetEncoding(1252);
        var cp1251 = Encoding.GetEncoding(1251);

        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer
        {
            Guid = serverGuid,
            Name = "Test Server",
            Ip = "127.0.0.1",
            Port = 14567,
            GameId = "bf1942",
            Timezone = "UTC"
        };
        _dbContext.Servers.Add(server);

        var rawBytes = new byte[] { 208, 209, 210 };
        var playerName = cp1252.GetString(rawBytes);

        var player = new Player
        {
            Name = playerName,
            FirstSeen = new DateTime(2025, 1, 1),
            LastSeen = new DateTime(2026, 12, 31)
        };
        _dbContext.Players.Add(player);

        // Seed stats
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            Year = 2026,
            Week = 23,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        // Add monthly stats for trend
        _dbContext.PlayerStatsMonthly.Add(new PlayerStatsMonthly
        {
            PlayerName = playerName,
            Year = 2026,
            Month = 6,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        _dbContext.PlayerMapStats.Add(new PlayerMapStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            MapName = "El Alamein",
            TotalRounds = 10,
            TotalPlayTimeMinutes = 300,
            Year = 2026,
            Month = 6
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(playerName, "global", 2026);

        // Assert
        Assert.NotNull(result);
        var expectedName = cp1251.GetString(rawBytes);
        Assert.Equal(expectedName, result.PlayerName);
        Assert.Equal("global", result.ServerGuid);
        Assert.Equal(5, result.YearInNumbers.RoundsPlayed);
        Assert.Equal(120, result.YearInNumbers.TotalKills);
        Assert.Equal(4.0, result.YearInNumbers.KdRatio); // 120 / 30

        // Verify cache record is created
        var cached = await _dbContext.PlayerWrappedCaches.FirstOrDefaultAsync(c => c.PlayerName == playerName && c.ServerGuid == "global" && c.Year == 2026);
        Assert.NotNull(cached);
        Assert.Contains("global", cached.JsonData);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_ReturnsCachedData_OnCacheHit()
    {
        // Arrange
        var playerName = "TestPlayer";
        var serverGuid = "global";
        var cacheJson = "{\"playerName\":\"TestPlayer\",\"serverGuid\":\"global\",\"year\":2026,\"yearInNumbers\":{\"roundsPlayed\":99},\"trend\":{\"monthlyKDs\":[],\"monthlyKillRates\":[],\"topMaps\":[]},\"favouriteMap\":{\"mapName\":\"\",\"rounds\":0,\"winRate\":0,\"topMaps5\":[],\"homeServerName\":\"\",\"homeServerLocation\":\"\"},\"medals\":{\"killStreaks25\":0,\"podiumFinishes\":0,\"eliteWarriorBadgeName\":\"\",\"eliteWarriorTier\":\"\",\"bestStreak\":0,\"lifetimeMilestoneText\":\"\"},\"bestMoment\":{\"streak\":0,\"mapName\":\"\",\"date\":\"2026-07-09T00:00:00Z\",\"estimatedDurationMinutes\":0,\"serverStreakRank\":0},\"squad\":[]}";
        
        _dbContext.PlayerWrappedCaches.Add(new PlayerWrappedCache
        {
            PlayerName = playerName,
            ServerGuid = serverGuid,
            Year = 2026,
            JsonData = cacheJson,
            CalculatedAt = Instant.FromUtc(2026, 7, 9, 0, 0)
        });
        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(playerName, serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("TestPlayer", result.PlayerName);
        Assert.Equal(99, result.YearInNumbers.RoundsPlayed);
    }
}
