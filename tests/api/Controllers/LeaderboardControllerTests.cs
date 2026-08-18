using api.Data.Entities;
using api.PlayerStats;
using api.PlayerStats.Models;
using api.PlayerTracking;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NSubstitute;

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
        SqliteLeaderboardService.ClearOccupancyCache();
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
        SqliteLeaderboardService.ClearOccupancyCache();
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

        var mapsResult = await _controller.GetMaps();
        var mapsOk = Assert.IsType<OkObjectResult>(mapsResult.Result);
        var mapsList = Assert.IsType<List<string>>(mapsOk.Value);
        Assert.Equal(2, mapsList.Count);

        var rommel = response.Players.First(p => p.Name == "Rommel_44");
        Assert.Equal(150, rommel.Kills);
        Assert.Equal(50, rommel.Deaths);
        Assert.Equal(3.0, rommel.Kd);
        Assert.Equal(2000, rommel.Score);
        Assert.Equal(1.25, rommel.Kpm); // 150 / 120
        Assert.Equal(10, rommel.Rounds);
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
        Assert.Equal("Rommel_44", response.Players[0].Name);
    }

    [Fact]
    public async Task GetLeaderboard_WithMultipleIncludeMaps_AggregatesOnlyThoseMaps()
    {
        var now = DateTime.UtcNow;
        _dbContext.Servers.Add(new GameServer { Guid = "srv-1", Name = "Dogtags 24/7", Game = "bf1942" });
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "Rommel",
                ServerGuid = "srv-1",
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
                PlayerName = "Patton",
                ServerGuid = "srv-1",
                MapName = "omaha",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 80,
                TotalDeaths = 40,
                TotalScore = 1500,
                TotalRounds = 6,
                TotalPlayTimeMinutes = 60
            },
            new PlayerMapStats
            {
                PlayerName = "Zhukov",
                ServerGuid = "srv-1",
                MapName = "wake",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 40,
                TotalDeaths = 40,
                TotalScore = 800,
                TotalRounds = 4,
                TotalPlayTimeMinutes = 40
            }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(map: "bocage,wake");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Equal(2, response.Players.Count);
        Assert.Contains(response.Players, p => p.Name == "Rommel");
        Assert.Contains(response.Players, p => p.Name == "Zhukov");
        Assert.DoesNotContain(response.Players, p => p.Name == "Patton");
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

    [Theory]
    [InlineData("favServer")]
    [InlineData("favMap")]
    public async Task GetLeaderboard_WithFavouriteSorting_ReturnsRankedPlayers(string sortBy)
    {
        var now = DateTime.UtcNow;
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-1", Name = "Server One", Game = "bf1942" },
            new GameServer { Guid = "srv-2", Name = "Server Two", Game = "bf1942" });
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "PlayerA",
                ServerGuid = "srv-1",
                MapName = "bocage",
                Year = now.Year,
                Month = now.Month,
                TotalScore = 500,
                TotalRounds = 5,
                TotalPlayTimeMinutes = 50
            },
            new PlayerMapStats
            {
                PlayerName = "PlayerB",
                ServerGuid = "srv-2",
                MapName = "wake",
                Year = now.Year,
                Month = now.Month,
                TotalScore = 1000,
                TotalRounds = 8,
                TotalPlayTimeMinutes = 80
            });
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(sortBy: sortBy);

        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);
        Assert.Equal(2, response.TotalPlayers);
        Assert.Equal(2, response.Players.Count);
        Assert.Equal([1, 2], response.Players.Select(player => player.Rank));
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
    }

    [Fact]
    public async Task GetLeaderboard_WithMultipleIncludeServers_AggregatesOnlyThoseServers()
    {
        var now = DateTime.UtcNow;
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-a", Name = "Dogtags 24/7", Game = "bf1942" },
            new GameServer { Guid = "srv-b", Name = "Merciless Gamers", Game = "bf1942" },
            new GameServer { Guid = "srv-c", Name = "Bot Arena", Game = "bf1942" }
        );
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "Rommel",
                ServerGuid = "srv-a",
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
                PlayerName = "Patton",
                ServerGuid = "srv-b",
                MapName = "omaha",
                Year = now.Year,
                Month = now.Month,
                TotalKills = 80,
                TotalDeaths = 40,
                TotalScore = 1500,
                TotalRounds = 6,
                TotalPlayTimeMinutes = 60
            },
            new PlayerMapStats
            {
                PlayerName = "BotFarmer",
                ServerGuid = "srv-c",
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

        var result = await _controller.GetLeaderboard(server: "Dogtags 24/7,Merciless Gamers");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Equal(2, response.Players.Count);
        Assert.Contains(response.Players, p => p.Name == "Rommel");
        Assert.Contains(response.Players, p => p.Name == "Patton");
        Assert.DoesNotContain(response.Players, p => p.Name == "BotFarmer");
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

    [Fact]
    public async Task GetMaps_WithQuery_FiltersMaps()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats { PlayerName = "P1", ServerGuid = "s1", MapName = "Wake Island", Year = now.Year, Month = now.Month, TotalKills = 10, TotalDeaths = 5, TotalScore = 100, TotalRounds = 1, TotalPlayTimeMinutes = 10 },
            new PlayerMapStats { PlayerName = "P2", ServerGuid = "s1", MapName = "Bocage", Year = now.Year, Month = now.Month, TotalKills = 10, TotalDeaths = 5, TotalScore = 100, TotalRounds = 1, TotalPlayTimeMinutes = 10 },
            new PlayerMapStats { PlayerName = "P3", ServerGuid = "s1", MapName = "Omaha Beach", Year = now.Year, Month = now.Month, TotalKills = 10, TotalDeaths = 5, TotalScore = 100, TotalRounds = 1, TotalPlayTimeMinutes = 10 }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetMaps(q: "island");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var maps = Assert.IsType<List<string>>(okResult.Value);

        Assert.Single(maps);
        Assert.Equal("Wake Island", maps[0]);
    }

    [Fact]
    public async Task GetLeaderboard_SortByKpm_SortsCorrectly()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerStatsMonthly.AddRange(
            new PlayerStatsMonthly { PlayerName = "FastKiller", Year = now.Year, Month = now.Month, TotalKills = 100, TotalDeaths = 10, TotalScore = 500, TotalRounds = 5, TotalPlayTimeMinutes = 10 },  // KPM = 10.0
            new PlayerStatsMonthly { PlayerName = "SlowKiller", Year = now.Year, Month = now.Month, TotalKills = 20, TotalDeaths = 10, TotalScore = 1000, TotalRounds = 5, TotalPlayTimeMinutes = 40 }   // KPM = 0.5
        );
        await _dbContext.SaveChangesAsync();

        var descResult = await _controller.GetLeaderboard(sortBy: "kpm", sortDir: "desc");
        var descOk = Assert.IsType<OkObjectResult>(descResult.Result);
        var descResp = Assert.IsType<GlobalLeaderboardResponse>(descOk.Value);

        Assert.Equal(2, descResp.Players.Count);
        Assert.Equal("FastKiller", descResp.Players[0].Name);
        Assert.Equal(10.0, descResp.Players[0].Kpm);
        Assert.Equal("SlowKiller", descResp.Players[1].Name);
        Assert.Equal(0.5, descResp.Players[1].Kpm);

        var ascResult = await _controller.GetLeaderboard(sortBy: "kpm", sortDir: "asc");
        var ascOk = Assert.IsType<OkObjectResult>(ascResult.Result);
        var ascResp = Assert.IsType<GlobalLeaderboardResponse>(ascOk.Value);

        Assert.Equal(2, ascResp.Players.Count);
        Assert.Equal("SlowKiller", ascResp.Players[0].Name);
        Assert.Equal("FastKiller", descResp.Players[0].Name);
    }

    [Fact]
    public async Task GetLeaderboard_PopulatesFavoriteServer()
    {
        var now = DateTime.UtcNow;
        _dbContext.Servers.Add(new GameServer { Guid = "s1", Name = "Dogtags 24/7", Country = "DE", Game = "bf1942" });
        _dbContext.PlayerStatsMonthly.Add(
            new PlayerStatsMonthly { PlayerName = "Hero", Year = now.Year, Month = now.Month, TotalKills = 50, TotalDeaths = 10, TotalScore = 500, TotalRounds = 5, TotalPlayTimeMinutes = 50 }
        );
        _dbContext.PlayerServerStats.Add(
            new PlayerServerStats { PlayerName = "Hero", ServerGuid = "s1", Year = now.Year, Week = 30, TotalKills = 50, TotalDeaths = 10, TotalScore = 500, TotalRounds = 5, TotalPlayTimeMinutes = 50 }
        );
        _dbContext.PlayerMapStats.Add(
            new PlayerMapStats { PlayerName = "Hero", ServerGuid = "s1", MapName = "bocage", Year = now.Year, Month = now.Month, TotalKills = 50, TotalDeaths = 10, TotalScore = 500, TotalRounds = 5, TotalPlayTimeMinutes = 50 }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard();
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var resp = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Single(resp.Players);
        Assert.Equal("Hero", resp.Players[0].Name);
        Assert.Equal("Dogtags 24/7", resp.Players[0].FavServer);
        Assert.Equal("s1", resp.Players[0].FavServerGuid);
        Assert.Equal("DE", resp.Players[0].FavServerCountry);
    }

    [Fact]
    public async Task GetLeaderboard_GroupByPlayerServer_PopulatesPerServerBreakdown()
    {
        var now = DateTime.UtcNow;
        var (isoYear, isoWeek) = (System.Globalization.ISOWeek.GetYear(now), System.Globalization.ISOWeek.GetWeekOfYear(now));

        _dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-simple", Name = "*NEW* SIMPLE | RtR+SW", Country = "FR", Game = "bf1942" },
            new GameServer { Guid = "srv-7kav", Name = "=7Kav= Panzerkrieg", Country = "DE", Game = "bf1942" },
            new GameServer { Guid = "srv-moon", Name = "MoonGamers.com | Est. 2004", Country = "US", Game = "bf1942" }
        );

        _dbContext.PlayerStatsMonthly.Add(
            new PlayerStatsMonthly { PlayerName = "Falcon", Year = now.Year, Month = now.Month, TotalKills = 28280, TotalDeaths = 6000, TotalScore = 39132, TotalRounds = 728, TotalPlayTimeMinutes = 13260 }
        );

        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats { PlayerName = "Falcon", ServerGuid = "srv-simple", Year = isoYear, Week = isoWeek, TotalKills = 21400, TotalDeaths = 3980, TotalScore = 25390, TotalRounds = 472, TotalPlayTimeMinutes = 8460 },
            new PlayerServerStats { PlayerName = "Falcon", ServerGuid = "srv-7kav", Year = isoYear, Week = isoWeek, TotalKills = 6880, TotalDeaths = 2020, TotalScore = 13742, TotalRounds = 256, TotalPlayTimeMinutes = 4800 },
            new PlayerServerStats { PlayerName = "Falcon", ServerGuid = "srv-moon", Year = isoYear, Week = isoWeek, TotalKills = 100, TotalDeaths = 50, TotalScore = 200, TotalRounds = 10, TotalPlayTimeMinutes = 120 }
        );

        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(groupBy: "playerServer");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var resp = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Equal("playerServer", resp.GroupBy);
        Assert.Single(resp.Players);

        var falcon = resp.Players[0];
        Assert.Equal("Falcon", falcon.Name);
        Assert.NotNull(falcon.Servers);
        Assert.Equal(3, falcon.Servers.Count);

        // Highest score server first
        var simpleSrv = falcon.Servers[0];
        Assert.Equal("srv-simple", simpleSrv.Guid);
        Assert.Equal("*NEW* SIMPLE | RtR+SW", simpleSrv.Name);
        Assert.Equal("SIMPLE | RtR+SW", simpleSrv.ShortName);
        Assert.Equal("FR", simpleSrv.Country);
        Assert.Equal("🇫🇷", simpleSrv.Flag);
        Assert.Equal(21400, simpleSrv.Kills);
        Assert.Equal(3980, simpleSrv.Deaths);
        Assert.Equal(25390, simpleSrv.Score);
        Assert.Equal(472, simpleSrv.Rounds);
        Assert.Equal(8460, simpleSrv.PlayMin);
        Assert.Equal(Math.Round(21400.0 / 3980, 2), simpleSrv.Kd);
        Assert.Equal(Math.Round(21400.0 / 8460, 2), simpleSrv.Kpm);

        var kavSrv = falcon.Servers[1];
        Assert.Equal("srv-7kav", kavSrv.Guid);
        Assert.Equal("=7Kav= Panzerkrieg", kavSrv.Name);
        Assert.Equal("=7Kav= Panzerkrieg", kavSrv.ShortName);
        Assert.Equal("DE", kavSrv.Country);
        Assert.Equal("🇩🇪", kavSrv.Flag);
        Assert.Equal(6880, kavSrv.Kills);
        Assert.Equal(2020, kavSrv.Deaths);
        Assert.Equal(13742, kavSrv.Score);
        Assert.Equal(256, kavSrv.Rounds);
        Assert.Equal(4800, kavSrv.PlayMin);

        var moonSrv = falcon.Servers[2];
        Assert.Equal("srv-moon", moonSrv.Guid);
        Assert.Equal("MoonGamers.com | Est. 2004", moonSrv.Name);
        Assert.Equal("MoonGamers.com | Est. 2004", moonSrv.ShortName);
        Assert.Equal("US", moonSrv.Country);
        Assert.Equal("🇺🇸", moonSrv.Flag);
    }

    [Fact]
    public async Task GetLeaderboard_WithPlayerFilter_ReturnsOnlySpecifiedPlayers()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerStatsMonthly.AddRange(
            new PlayerStatsMonthly { PlayerName = "Falcon", Year = now.Year, Month = now.Month, TotalKills = 100, TotalDeaths = 50, TotalScore = 300, TotalRounds = 5, TotalPlayTimeMinutes = 60 },
            new PlayerStatsMonthly { PlayerName = "Sky Miner", Year = now.Year, Month = now.Month, TotalKills = 80, TotalDeaths = 40, TotalScore = 200, TotalRounds = 4, TotalPlayTimeMinutes = 50 },
            new PlayerStatsMonthly { PlayerName = "Spoegwolf", Year = now.Year, Month = now.Month, TotalKills = 60, TotalDeaths = 30, TotalScore = 150, TotalRounds = 3, TotalPlayTimeMinutes = 40 }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetLeaderboard(player: "Falcon,Spoegwolf");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var resp = Assert.IsType<GlobalLeaderboardResponse>(okResult.Value);

        Assert.Equal("Falcon,Spoegwolf", resp.Player);
        Assert.Equal(2, resp.TotalPlayers);
        Assert.Equal(2, resp.Players.Count);
        Assert.Contains(resp.Players, p => p.Name == "Falcon");
        Assert.Contains(resp.Players, p => p.Name == "Spoegwolf");
        Assert.DoesNotContain(resp.Players, p => p.Name == "Sky Miner");
    }

    [Fact]
    public async Task GetPlayers_ReturnsMatchingPlayers()
    {
        var now = DateTime.UtcNow;
        _dbContext.PlayerStatsMonthly.AddRange(
            new PlayerStatsMonthly { PlayerName = "Falcon", Year = now.Year, Month = now.Month, TotalKills = 100, TotalDeaths = 50, TotalScore = 300, TotalRounds = 5, TotalPlayTimeMinutes = 60 },
            new PlayerStatsMonthly { PlayerName = "Sky Miner", Year = now.Year, Month = now.Month, TotalKills = 80, TotalDeaths = 40, TotalScore = 200, TotalRounds = 4, TotalPlayTimeMinutes = 50 }
        );
        await _dbContext.SaveChangesAsync();

        var result = await _controller.GetPlayers(q: "fal");
        var okResult = Assert.IsType<OkObjectResult>(result.Result);
        var list = Assert.IsType<List<string>>(okResult.Value);

        Assert.Single(list);
        Assert.Equal("Falcon", list[0]);
    }
}
