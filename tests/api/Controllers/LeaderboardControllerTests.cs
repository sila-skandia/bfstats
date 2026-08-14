using api.Data.Entities;
using api.PlayerStats;
using api.PlayerStats.Models;
using api.PlayerTracking;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NSubstitute;
using Xunit;

namespace api.tests.Controllers;

public class LeaderboardControllerTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly SqliteLeaderboardService _leaderboardService;
    private readonly ILogger<LeaderboardController> _logger;
    private readonly LeaderboardController _controller;

    public LeaderboardControllerTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();
        _leaderboardService = new SqliteLeaderboardService(_dbContext);
        _logger = Substitute.For<ILogger<LeaderboardController>>();
        _controller = new LeaderboardController(_leaderboardService, _logger);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task GetLeaderboard_ReturnsOkWithAggregatedPlayersAndServersAndMaps()
    {
        // Seed server
        _dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-1",
            Name = "=DOG= Dogtags 24/7",
            Country = "DE",
            Game = "bf1942"
        });

        // Seed player map stats
        var now = DateTime.UtcNow;
        var (year, month) = (now.Year, now.Month);

        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "Rommel_44",
                ServerGuid = "srv-1",
                MapName = "bocage",
                Year = year,
                Month = month,
                TotalKills = 150,
                TotalDeaths = 50,
                TotalScore = 2000,
                TotalRounds = 10,
                TotalPlayTimeMinutes = 120
            },
            new PlayerMapStats
            {
                PlayerName = "Patton",
                ServerGuid = "srv-1",
                MapName = "omaha beach",
                Year = year,
                Month = month,
                TotalKills = 80,
                TotalDeaths = 100,
                TotalScore = 1200,
                TotalRounds = 8,
                TotalPlayTimeMinutes = 90
            }
        );

        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(days: 30, minRounds: 1);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Equal(2, response.TotalPlayers);
        Assert.Equal(2, response.Players.Count);
        Assert.Single(response.Servers);
        Assert.Equal("srv-1", response.Servers[0].Guid);
        Assert.Equal(2, response.Maps.Count);

        var rommel = response.Players.First(p => p.Name == "Rommel_44");
        Assert.Equal(150, rommel.Kills);
        Assert.Equal(50, rommel.Deaths);
        Assert.Equal(3.0, rommel.Kd);
        Assert.Equal(2000, rommel.Score);
        Assert.Equal(1.25, rommel.Kpm); // 150 / 120
        Assert.Equal(10, rommel.Rounds);
        Assert.Equal("=DOG= Dogtags 24/7", rommel.FavServer);
        Assert.Equal("Bocage", rommel.FavMap);
    }

    [Fact]
    public async Task GetLeaderboard_WithMapFilter_ReturnsFilteredResults()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "Rommel_44",
                ServerGuid = "srv-1",
                MapName = "bocage",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 100,
                TotalDeaths = 20,
                TotalScore = 1500,
                TotalRounds = 5,
                TotalPlayTimeMinutes = 60
            },
            new PlayerMapStats
            {
                PlayerName = "Rommel_44",
                ServerGuid = "srv-1",
                MapName = "wake",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 50,
                TotalDeaths = 10,
                TotalScore = 800,
                TotalRounds = 3,
                TotalPlayTimeMinutes = 30
            }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(days: 30, minRounds: 1, map: "wake");

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Single(response.Players);
        Assert.Equal("Wake", response.Players[0].FavMap);
    }

    [Fact]
    public async Task GetLeaderboard_WithPagingAndSorting_ReturnsCorrectPageAndRanks()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats { PlayerName = "PlayerA", ServerGuid = "srv-1", MapName = "bocage", Year = now.Year, Month = now.Month, TotalScore = 500, TotalRounds = 5, TotalPlayTimeMinutes = 50 },
            new PlayerMapStats { PlayerName = "PlayerB", ServerGuid = "srv-1", MapName = "bocage", Year = now.Year, Month = now.Month, TotalScore = 1500, TotalRounds = 5, TotalPlayTimeMinutes = 50 },
            new PlayerMapStats { PlayerName = "PlayerC", ServerGuid = "srv-1", MapName = "bocage", Year = now.Year, Month = now.Month, TotalScore = 2500, TotalRounds = 5, TotalPlayTimeMinutes = 50 }
        );
        await _dbContext.SaveChangesAsync();

        // Page 1, PageSize 2, Sort by Score desc -> PlayerC (rank 1), PlayerB (rank 2)
        var resultPage1 = await _controller.GetLeaderboard(page: 1, pageSize: 2, sortBy: "score", sortDir: "desc");
        var okResult1 = Assert.IsType<OkObjectResult>(resultPage1.Result);
        var res1 = Assert.IsType<GlobalLeaderboardResponse>(okResult1.Value);

        Assert.Equal(3, res1.TotalPlayers);
        Assert.Equal(2, res1.TotalPages);
        Assert.Equal(2, res1.Players.Count);
        Assert.Equal("PlayerC", res1.Players[0].Name);
        Assert.Equal(1, res1.Players[0].Rank);
        Assert.Equal("PlayerB", res1.Players[1].Name);
        Assert.Equal(2, res1.Players[1].Rank);

        // Page 2, PageSize 2 -> PlayerA (rank 3)
        var resultPage2 = await _controller.GetLeaderboard(page: 2, pageSize: 2, sortBy: "score", sortDir: "desc");
        var okResult2 = Assert.IsType<OkObjectResult>(resultPage2.Result);
        var res2 = Assert.IsType<GlobalLeaderboardResponse>(okResult2.Value);

        Assert.Single(res2.Players);
        Assert.Equal("PlayerA", res2.Players[0].Name);
        Assert.Equal(3, res2.Players[0].Rank);
    }

    [Fact]
    public async Task GetLeaderboard_WithSearchQuery_ReturnsMatchingPlayersOnly()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats { PlayerName = "[DOG]Rommel", ServerGuid = "srv-1", MapName = "bocage", Year = now.Year, Month = now.Month, TotalScore = 1000, TotalRounds = 5, TotalPlayTimeMinutes = 50 },
            new PlayerMapStats { PlayerName = "Patton_USA", ServerGuid = "srv-1", MapName = "bocage", Year = now.Year, Month = now.Month, TotalScore = 1000, TotalRounds = 5, TotalPlayTimeMinutes = 50 }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(q: "rommel");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Single(response.Players);
        Assert.Equal("[DOG]Rommel", response.Players[0].Name);
        Assert.Equal("[DOG]", response.Players[0].Tag);
    }

    [Fact]
    public async Task GetLeaderboard_WithNegativeDays_ReturnsBadRequest()
    {
        var result = await _controller.GetLeaderboard(days: -1);
        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetLeaderboard_WithExclude_OmitsStatsFromExcludedServers()
    {
        var now = DateTime.UtcNow;
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-live", Name = "Dogtags 24/7", Game = "bf1942" },
            new GameServer { Guid = "srv-bots", Name = "Bot Arena", Game = "bf1942" }
        );
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "Rommel",
                ServerGuid = "srv-live",
                MapName = "bocage",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 100,
                TotalDeaths = 20,
                TotalScore = 2000,
                TotalRounds = 8,
                TotalPlayTimeMinutes = 80
            },
            new PlayerMapStats
            {
                PlayerName = "Rommel",
                ServerGuid = "srv-bots",
                MapName = "wake",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 500,
                TotalDeaths = 10,
                TotalScore = 8000,
                TotalRounds = 20,
                TotalPlayTimeMinutes = 40
            },
            new PlayerMapStats
            {
                PlayerName = "BotFarmer",
                ServerGuid = "srv-bots",
                MapName = "wake",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 900,
                TotalDeaths = 5,
                TotalScore = 12000,
                TotalRounds = 30,
                TotalPlayTimeMinutes = 30
            }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(exclude: "Bot Arena,srv-live");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Empty(response.Players);

        var liveOnly = await _controller.GetLeaderboard(exclude: "Bot Arena");
        var liveOk = Assert.IsType<OkObjectResult>(liveOnly.Result);
        var liveResponse = Assert.IsType<GlobalLeaderboardResponse>(liveOk.Value);

        Assert.Single(liveResponse.Players);
        Assert.Equal("Rommel", liveResponse.Players[0].Name);
        Assert.Equal(100, liveResponse.Players[0].Kills);
        Assert.Equal(2000, liveResponse.Players[0].Score);
        Assert.Equal("Dogtags 24/7", liveResponse.Players[0].FavServer);
    }

    [Fact]
    public async Task GetLeaderboard_PopulatedOnly_KeepsHighOccupancyCluster()
    {
        var now = DateTime.UtcNow;
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-live", Name = "Dogtags 24/7", Game = "bf1942" },
            new GameServer { Guid = "srv-bots", Name = "Bot Arena", Game = "bf1942" }
        );

        var hour = NodaTime.Instant.FromDateTimeUtc(DateTime.SpecifyKind(now.AddHours(-3), DateTimeKind.Utc));
        _dbContext.ServerOnlineCounts.AddRange(
            new api.Data.Entities.ServerOnlineCount
            {
                ServerGuid = "srv-live",
                HourTimestamp = hour,
                Game = "bf1942",
                AvgPlayers = 16.4,
                PeakPlayers = 22,
                SampleCount = 120
            },
            new api.Data.Entities.ServerOnlineCount
            {
                ServerGuid = "srv-bots",
                HourTimestamp = hour,
                Game = "bf1942",
                AvgPlayers = 1.2,
                PeakPlayers = 3,
                SampleCount = 120
            }
        );

        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "Rommel",
                ServerGuid = "srv-live",
                MapName = "bocage",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 100,
                TotalDeaths = 40,
                TotalScore = 1500,
                TotalRounds = 6,
                TotalPlayTimeMinutes = 60
            },
            new PlayerMapStats
            {
                PlayerName = "BotFarmer",
                ServerGuid = "srv-bots",
                MapName = "wake",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 800,
                TotalDeaths = 10,
                TotalScore = 9000,
                TotalRounds = 40,
                TotalPlayTimeMinutes = 50
            }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(populatedOnly: true);
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Single(response.Players);
        Assert.Equal("Rommel", response.Players[0].Name);
        Assert.Equal(2, response.Servers.Count);

        var live = response.Servers.First(s => s.Guid == "srv-live");
        var bots = response.Servers.First(s => s.Guid == "srv-bots");
        Assert.True(live.IsPopulated);
        Assert.False(bots.IsPopulated);
        Assert.Equal(16.4, live.AvgPlayers);
        Assert.Equal(1.2, bots.AvgPlayers);
    }

    [Fact]
    public async Task GetLeaderboard_UnscopedAllTime_CapsLookbackTo365Days()
    {
        var result = await _controller.GetLeaderboard(days: 0);
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);
        Assert.Equal(365, response.Days);
    }

    [Fact]
    public async Task GetLeaderboard_AllTimeWithServerFilter_KeepsUnboundedLookback()
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-1",
            Name = "Dogtags 24/7",
            Game = "bf1942"
        });
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(days: 0, server: "Dogtags 24/7");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);
        Assert.Equal(0, response.Days);
    }

    [Fact]
    public async Task GetLeaderboard_OversizedPageSize_IsClamped()
    {
        var result = await _controller.GetLeaderboard(pageSize: 500);
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);
        Assert.Equal(100, response.PageSize);
    }
}
