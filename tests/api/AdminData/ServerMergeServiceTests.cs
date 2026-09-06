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
    public async Task FindDuplicateCandidates_ReturnsOnlySharedIdentityGroups()
    {
        var lastSeen = new DateTime(2026, 9, 1, 12, 0, 0, DateTimeKind.Utc);
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "a1", Name = "SiMPLE", Ip = "1.1.1.1", Port = 14567, Game = "bf1942", IsOnline = true, LastSeenTime = lastSeen },
            new GameServer { Guid = "a2", Name = "SiMPLE", Ip = "1.1.1.1", Port = 14567, Game = "bf1942", IsOnline = false, LastSeenTime = lastSeen.AddDays(-1) },
            new GameServer { Guid = "unique", Name = "Other", Ip = "2.2.2.2", Port = 14567, Game = "bf1942", IsOnline = true, LastSeenTime = lastSeen },
            new GameServer { Guid = "fh", Name = "SiMPLE", Ip = "1.1.1.1", Port = 14567, Game = "fh2", IsOnline = true, LastSeenTime = lastSeen });

        _dbContext.Players.Add(new Player { Name = "Ace", LastSeen = lastSeen });
        _dbContext.PlayerSessions.AddRange(
            new PlayerSession
            {
                SessionId = 1,
                PlayerName = "Ace",
                ServerGuid = "a1",
                StartTime = lastSeen.AddHours(-2),
                LastSeenTime = lastSeen.AddHours(-1),
                IsDeleted = false
            },
            new PlayerSession
            {
                SessionId = 2,
                PlayerName = "Ace",
                ServerGuid = "a2",
                StartTime = lastSeen.AddDays(-3),
                LastSeenTime = lastSeen.AddDays(-2),
                IsDeleted = false
            },
            new PlayerSession
            {
                SessionId = 3,
                PlayerName = "Ace",
                ServerGuid = "a2",
                StartTime = lastSeen.AddDays(-4),
                LastSeenTime = lastSeen.AddDays(-3),
                IsDeleted = true
            },
            new PlayerSession
            {
                SessionId = 4,
                PlayerName = "Ace",
                ServerGuid = "unique",
                StartTime = lastSeen.AddHours(-5),
                LastSeenTime = lastSeen.AddHours(-4),
                IsDeleted = false
            });

        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats
            {
                PlayerName = "Ace",
                ServerGuid = "a1",
                Year = 2026,
                Week = 35,
                TotalPlayTimeMinutes = 90,
                UpdatedAt = Instant.FromUtc(2026, 9, 1, 0, 0)
            },
            new PlayerServerStats
            {
                PlayerName = "Ace",
                ServerGuid = "a1",
                Year = 2026,
                Week = 36,
                TotalPlayTimeMinutes = 30,
                UpdatedAt = Instant.FromUtc(2026, 9, 1, 0, 0)
            },
            new PlayerServerStats
            {
                PlayerName = "Ace",
                ServerGuid = "a2",
                Year = 2026,
                Week = 30,
                TotalPlayTimeMinutes = 15,
                UpdatedAt = Instant.FromUtc(2026, 8, 1, 0, 0)
            });

        await _dbContext.SaveChangesAsync();

        var allGames = await _service.FindDuplicateCandidatesAsync(null);
        var bf1942 = await _service.FindDuplicateCandidatesAsync("bf1942");
        var empty = await _service.FindDuplicateCandidatesAsync("bfvietnam");

        Assert.Single(allGames);
        Assert.Single(bf1942);
        Assert.Empty(empty);

        var candidate = Assert.Single(bf1942);
        Assert.Equal("bf1942", candidate.Game);
        Assert.Equal("1.1.1.1", candidate.Ip);
        Assert.Equal(14567, candidate.Port);
        Assert.Equal("SiMPLE", candidate.Name);
        Assert.Equal(2, candidate.Guids.Count);
        Assert.Equal(2, candidate.TotalSessions);
        Assert.Equal(135, candidate.TotalPlaytimeMinutes);
        Assert.Equal(lastSeen.AddDays(-3), candidate.FirstSeen);
        Assert.Equal(lastSeen.AddHours(-1), candidate.LastSeen);

        var primary = candidate.Guids[0];
        Assert.Equal("a1", primary.ServerGuid);
        Assert.Equal(1, primary.SessionCount);
        Assert.Equal(120, primary.PlaytimeMinutes);
        Assert.True(primary.IsOnline);

        var dupe = candidate.Guids[1];
        Assert.Equal("a2", dupe.ServerGuid);
        Assert.Equal(1, dupe.SessionCount);
        Assert.Equal(15, dupe.PlaytimeMinutes);
        Assert.False(dupe.IsOnline);
    }

}
