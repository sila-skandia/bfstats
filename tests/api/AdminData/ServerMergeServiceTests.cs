using api.AdminData;
using api.Data.Entities;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodaTime;
using NSubstitute;

namespace api.tests.AdminData;

public class ServerMergeServiceTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IClock _clock;
    private readonly ILogger<ServerMergeService> _logger;
    private readonly ServerMergeService _service;

    public ServerMergeServiceTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();

        _scopeFactory = Substitute.For<IServiceScopeFactory>();
        _clock = Substitute.For<IClock>();
        _clock.GetCurrentInstant().Returns(Instant.FromUtc(2024, 1, 1, 0, 0));
        _logger = Substitute.For<ILogger<ServerMergeService>>();

        _service = new ServerMergeService(_dbContext, _scopeFactory, _clock, _logger);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Close();
    }

    [Fact]
    public async Task MergeServers_Succeeds_WhenMultipleDuplicatesHaveSameHourTimestamp()
    {
        // Arrange
        var primary = new GameServer { Guid = "primary", Name = "Primary", Ip = "1.1.1.1", Port = 1, Game = "bf1942" };
        var dupe1 = new GameServer { Guid = "dupe1", Name = "Dupe 1", Ip = "1.1.1.1", Port = 1, Game = "bf1942" };
        var dupe2 = new GameServer { Guid = "dupe2", Name = "Dupe 2", Ip = "1.1.1.1", Port = 1, Game = "bf1942" };
        _dbContext.Servers.AddRange(primary, dupe1, dupe2);

        var timestamp = Instant.FromUtc(2024, 1, 1, 10, 0);
        
        // dupe1 has data for 10:00: 10 avg, 15 peak, 120 samples
        _dbContext.ServerOnlineCounts.Add(new ServerOnlineCount 
        { 
            ServerGuid = "dupe1", 
            HourTimestamp = timestamp, 
            Game = "bf1942", 
            AvgPlayers = 10, 
            PeakPlayers = 15, 
            SampleCount = 120 
        });

        // dupe2 ALSO has data for 10:00: 20 avg, 25 peak, 120 samples
        _dbContext.ServerOnlineCounts.Add(new ServerOnlineCount 
        { 
            ServerGuid = "dupe2", 
            HourTimestamp = timestamp, 
            Game = "bf1942", 
            AvgPlayers = 20, 
            PeakPlayers = 25, 
            SampleCount = 120 
        });

        // Combined should be:
        // Avg: (10*120 + 20*120) / (120+120) = 3600 / 240 = 15
        // Peak: Max(15, 25) = 25
        // Samples: 120 + 120 = 240
        
        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.MergeServersAsync("primary", new[] { "dupe1", "dupe2" }, "admin@test.com", true);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("primary", result.PrimaryGuid);

        var primaryCount = await _dbContext.ServerOnlineCounts
            .AsNoTracking()
            .FirstOrDefaultAsync(soc => soc.ServerGuid == "primary" && soc.HourTimestamp == timestamp);
        
        Assert.NotNull(primaryCount);
        Assert.Equal(15.0, primaryCount.AvgPlayers);
        Assert.Equal(25, primaryCount.PeakPlayers);
        Assert.Equal(240, primaryCount.SampleCount);

        // Verify duplicates are gone
        var dupeCounts = await _dbContext.ServerOnlineCounts
            .AsNoTracking()
            .Where(soc => soc.ServerGuid == "dupe1" || soc.ServerGuid == "dupe2")
            .ToListAsync();
        Assert.Empty(dupeCounts);
    }

    [Fact]
    public async Task MergeServers_Succeeds_WhenPrimaryAndDuplicatesHaveOverlappingData()
    {
        // Arrange
        var primary = new GameServer { Guid = "primary", Name = "Primary", Ip = "1.1.1.1", Port = 1, Game = "bf1942" };
        var dupe = new GameServer { Guid = "dupe", Name = "Dupe", Ip = "1.1.1.1", Port = 1, Game = "bf1942" };
        _dbContext.Servers.AddRange(primary, dupe);

        var timestamp = Instant.FromUtc(2024, 1, 1, 10, 0);
        
        // primary has data: 30 avg, 40 peak, 100 samples
        _dbContext.ServerOnlineCounts.Add(new ServerOnlineCount 
        { 
            ServerGuid = "primary", 
            HourTimestamp = timestamp, 
            Game = "bf1942", 
            AvgPlayers = 30, 
            PeakPlayers = 40, 
            SampleCount = 100 
        });

        // dupe has data: 10 avg, 20 peak, 100 samples
        _dbContext.ServerOnlineCounts.Add(new ServerOnlineCount 
        { 
            ServerGuid = "dupe", 
            HourTimestamp = timestamp, 
            Game = "bf1942", 
            AvgPlayers = 10, 
            PeakPlayers = 20, 
            SampleCount = 100 
        });

        // Combined should be:
        // Avg: (30*100 + 10*100) / (100+100) = 4000 / 200 = 20
        // Peak: Max(40, 20) = 40
        // Samples: 100 + 100 = 200
        
        await _dbContext.SaveChangesAsync();

        // Act
        await _service.MergeServersAsync("primary", new[] { "dupe" }, "admin@test.com", true);

        // Assert
        var primaryCount = await _dbContext.ServerOnlineCounts
            .AsNoTracking()
            .FirstOrDefaultAsync(soc => soc.ServerGuid == "primary" && soc.HourTimestamp == timestamp);
        
        Assert.NotNull(primaryCount);
        Assert.Equal(20.0, primaryCount.AvgPlayers);
        Assert.Equal(40, primaryCount.PeakPlayers);
        Assert.Equal(200, primaryCount.SampleCount);
    }

    [Fact]
    public async Task FindDuplicateCandidates_ReturnsEmpty_WhenIdentitiesAreUnique()
    {
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "a", Name = "Alpha", Ip = "1.1.1.1", Port = 14567, Game = "bf1942" },
            new GameServer { Guid = "b", Name = "Bravo", Ip = "1.1.1.1", Port = 14567, Game = "bf1942" });
        await _dbContext.SaveChangesAsync();

        var result = await _service.FindDuplicateCandidatesAsync("bf1942");

        Assert.Empty(result);
    }

    [Fact]
    public async Task FindDuplicateCandidates_GroupsOnlyDuplicateIdentities_AndIgnoresUnrelatedSessions()
    {
        _dbContext.Servers.AddRange(
            new GameServer
            {
                Guid = "primary",
                Name = "Night Host",
                Ip = "10.0.0.5",
                Port = 14567,
                Game = "bf1942",
                IsOnline = true,
                LastSeenTime = new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc)
            },
            new GameServer
            {
                Guid = "dupe",
                Name = "Night Host",
                Ip = "10.0.0.5",
                Port = 14567,
                Game = "bf1942",
                IsOnline = false,
                LastSeenTime = new DateTime(2026, 9, 5, 3, 0, 0, DateTimeKind.Utc)
            },
            new GameServer
            {
                Guid = "unique",
                Name = "Unique",
                Ip = "8.8.8.8",
                Port = 14567,
                Game = "bf1942",
                LastSeenTime = new DateTime(2026, 9, 6, 7, 0, 0, DateTimeKind.Utc)
            });

        _dbContext.Players.AddRange(
            new Player { Name = "alice" },
            new Player { Name = "bob" },
            new Player { Name = "carol" },
            new Player { Name = "deleted" });

        _dbContext.PlayerSessions.AddRange(
            new PlayerSession
            {
                PlayerName = "alice",
                ServerGuid = "primary",
                StartTime = new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
                LastSeenTime = new DateTime(2026, 9, 1, 1, 0, 0, DateTimeKind.Utc),
                MapName = "kursk"
            },
            new PlayerSession
            {
                PlayerName = "bob",
                ServerGuid = "dupe",
                StartTime = new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc),
                LastSeenTime = new DateTime(2026, 8, 1, 0, 30, 0, DateTimeKind.Utc),
                MapName = "kursk"
            },
            new PlayerSession
            {
                PlayerName = "carol",
                ServerGuid = "unique",
                StartTime = new DateTime(2026, 7, 1, 0, 0, 0, DateTimeKind.Utc),
                LastSeenTime = new DateTime(2026, 7, 1, 3, 0, 0, DateTimeKind.Utc),
                MapName = "kursk"
            },
            new PlayerSession
            {
                PlayerName = "deleted",
                ServerGuid = "primary",
                StartTime = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
                LastSeenTime = new DateTime(2026, 6, 1, 4, 0, 0, DateTimeKind.Utc),
                MapName = "kursk",
                IsDeleted = true
            });

        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats
            {
                PlayerName = "alice",
                ServerGuid = "primary",
                Year = 2026,
                Week = 36,
                TotalPlayTimeMinutes = 120,
                UpdatedAt = Instant.FromUtc(2026, 9, 6, 0, 0)
            },
            new PlayerServerStats
            {
                PlayerName = "bob",
                ServerGuid = "dupe",
                Year = 2026,
                Week = 30,
                TotalPlayTimeMinutes = 15,
                UpdatedAt = Instant.FromUtc(2026, 8, 1, 0, 0)
            },
            new PlayerServerStats
            {
                PlayerName = "carol",
                ServerGuid = "unique",
                Year = 2026,
                Week = 20,
                TotalPlayTimeMinutes = 9999,
                UpdatedAt = Instant.FromUtc(2026, 7, 1, 0, 0)
            });

        await _dbContext.SaveChangesAsync();

        var result = await _service.FindDuplicateCandidatesAsync("bf1942");

        var candidate = Assert.Single(result);
        Assert.Equal("Night Host", candidate.Name);
        Assert.Equal(2, candidate.Guids.Count);
        Assert.Equal(2, candidate.TotalSessions);
        Assert.Equal(135, candidate.TotalPlaytimeMinutes);
        Assert.Equal("primary", candidate.Guids[0].ServerGuid);
        Assert.Equal(120, candidate.Guids[0].PlaytimeMinutes);
        Assert.Equal(1, candidate.Guids[0].SessionCount);
        Assert.Equal("dupe", candidate.Guids[1].ServerGuid);
        Assert.DoesNotContain(result, c => c.Name == "Unique");
    }

    [Fact]
    public async Task FindDuplicateCandidates_FiltersByGame()
    {
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "bf1", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "bf1942" },
            new GameServer { Guid = "bf2", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "bf1942" },
            new GameServer { Guid = "fh1", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "fh2" },
            new GameServer { Guid = "fh2", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "fh2" });
        await _dbContext.SaveChangesAsync();

        var result = await _service.FindDuplicateCandidatesAsync("bf1942");

        var candidate = Assert.Single(result);
        Assert.Equal("bf1942", candidate.Game);
        Assert.Equal(2, candidate.Guids.Count);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task FindDuplicateCandidates_WhenGameIsBlank_ReturnsEveryGame(string? game)
    {
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "bf1", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "bf1942" },
            new GameServer { Guid = "bf2", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "bf1942" },
            new GameServer { Guid = "fh1", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "fh2" },
            new GameServer { Guid = "fh2", Name = "Same", Ip = "1.1.1.1", Port = 1, Game = "fh2" });
        await _dbContext.SaveChangesAsync();

        var result = await _service.FindDuplicateCandidatesAsync(game);

        Assert.Equal(2, result.Count);
        Assert.Contains(result, c => c.Game == "bf1942");
        Assert.Contains(result, c => c.Game == "fh2");
    }

    [Fact]
    public async Task FindDuplicateCandidates_DuplicateIdentityWithNoSessions_ReturnsZeroTotals()
    {
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "a", Name = "Empty", Ip = "9.9.9.9", Port = 14567, Game = "bf1942" },
            new GameServer { Guid = "b", Name = "Empty", Ip = "9.9.9.9", Port = 14567, Game = "bf1942" });
        await _dbContext.SaveChangesAsync();

        var result = await _service.FindDuplicateCandidatesAsync("bf1942");

        var candidate = Assert.Single(result);
        Assert.Equal(0, candidate.TotalSessions);
        Assert.Equal(0, candidate.TotalPlaytimeMinutes);
        Assert.All(candidate.Guids, g =>
        {
            Assert.Equal(0, g.SessionCount);
            Assert.Equal(0, g.PlaytimeMinutes);
            Assert.Null(g.FirstSession);
            Assert.Null(g.LastSession);
        });
    }

}
