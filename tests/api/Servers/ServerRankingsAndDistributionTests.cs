using api.Caching;
using api.Data.Entities;
using api.Gamification.Models;
using api.PlayerStats;
using api.PlayerTracking;
using api.Servers;
using api.Servers.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using NSubstitute;
using NSubstitute.ExceptionExtensions;
using NodaTime;
using Xunit;

namespace api.tests.Servers;

public class ServerRankingsAndDistributionTests : IDisposable
{
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly SqliteLeaderboardService _leaderboardService;
    private readonly ICacheService _cacheService;
    private readonly ICacheKeyService _cacheKeyService;
    private readonly ILogger<ServersV2Controller> _logger;
    private readonly ServersV2Controller _controller;

    public ServerRankingsAndDistributionTests()
    {
        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _leaderboardService = new SqliteLeaderboardService(_dbContext);
        _cacheService = Substitute.For<ICacheService>();
        _cacheKeyService = new CacheKeyService();
        _logger = Substitute.For<ILogger<ServersV2Controller>>();
        _controller = new ServersV2Controller(
            _dbContext,
            _leaderboardService,
            _cacheService,
            _cacheKeyService,
            _logger);
    }

    public void Dispose()
    {
        _dbContext.Database.EnsureDeleted();
        _dbContext.Dispose();
    }

    private void SeedServerAndStats(string serverGuid, string serverName)
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = serverGuid,
            Name = serverName,
            Game = "bf1942",
            Ip = "127.0.0.1",
            Port = 14567
        });

        var now = DateTime.UtcNow;
        var year = System.Globalization.ISOWeek.GetYear(now);
        var week = System.Globalization.ISOWeek.GetWeekOfYear(now);

        // Seed 5 test players
        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats
            {
                PlayerName = "AcePilot",
                ServerGuid = serverGuid,
                Year = year,
                Week = week,
                TotalPlayTimeMinutes = 600,
                TotalKills = 300,
                TotalDeaths = 100,
                TotalScore = 5000,
                TotalRounds = 20,
                UpdatedAt = Instant.FromDateTimeUtc(now)
            },
            new PlayerServerStats
            {
                PlayerName = "SniperWolf",
                ServerGuid = serverGuid,
                Year = year,
                Week = week,
                TotalPlayTimeMinutes = 400,
                TotalKills = 250,
                TotalDeaths = 50,
                TotalScore = 4000,
                TotalRounds = 15,
                UpdatedAt = Instant.FromDateTimeUtc(now)
            },
            new PlayerServerStats
            {
                PlayerName = "TankCommander",
                ServerGuid = serverGuid,
                Year = year,
                Week = week,
                TotalPlayTimeMinutes = 500,
                TotalKills = 150,
                TotalDeaths = 100,
                TotalScore = 3000,
                TotalRounds = 12,
                UpdatedAt = Instant.FromDateTimeUtc(now)
            },
            new PlayerServerStats
            {
                PlayerName = "MedicBob",
                ServerGuid = serverGuid,
                Year = year,
                Week = week,
                TotalPlayTimeMinutes = 300,
                TotalKills = 50,
                TotalDeaths = 100,
                TotalScore = 2500,
                TotalRounds = 10,
                UpdatedAt = Instant.FromDateTimeUtc(now)
            },
            new PlayerServerStats
            {
                PlayerName = "RecruitJoe",
                ServerGuid = serverGuid,
                Year = year,
                Week = week,
                TotalPlayTimeMinutes = 60,
                TotalKills = 10,
                TotalDeaths = 20,
                TotalScore = 300,
                TotalRounds = 2,
                UpdatedAt = Instant.FromDateTimeUtc(now)
            }
        );

        // Seed some achievements for placement medals
        _dbContext.PlayerAchievements.AddRange(
            new PlayerAchievement
            {
                Id = 1L,
                PlayerName = "AcePilot",
                ServerGuid = serverGuid,
                AchievementType = AchievementTypes.Placement,
                Tier = "gold",
                AchievedAt = Instant.FromDateTimeUtc(now)
            },
            new PlayerAchievement
            {
                Id = 2L,
                PlayerName = "AcePilot",
                ServerGuid = serverGuid,
                AchievementType = AchievementTypes.Placement,
                Tier = "silver",
                AchievedAt = Instant.FromDateTimeUtc(now)
            },
            new PlayerAchievement
            {
                Id = 3L,
                PlayerName = "SniperWolf",
                ServerGuid = serverGuid,
                AchievementType = AchievementTypes.Placement,
                Tier = "gold",
                AchievedAt = Instant.FromDateTimeUtc(now)
            }
        );

        _dbContext.SaveChanges();
    }

    [Fact]
    public async Task GetServerPlayerRankingsAsync_ReturnsPagedRankings()
    {
        var serverGuid = "srv-rankings-1";
        var serverName = "BF1942 Server 1";
        SeedServerAndStats(serverGuid, serverName);

        var start = DateTime.UtcNow.AddDays(-30);
        var end = DateTime.UtcNow;

        var result = await _leaderboardService.GetServerPlayerRankingsAsync(
            serverGuid, serverName, 30, start, end, page: 1, pageSize: 2, sortBy: "active", minRounds: 1);

        Assert.NotNull(result);
        Assert.Equal(5, result.TotalCount);
        Assert.Equal(3, result.TotalPages);
        Assert.Equal(1, result.Page);
        Assert.Equal(2, result.PageSize);
        Assert.Equal(2, result.Rankings.Count);

        // Page 1: Top 2 by playtime -> AcePilot (600m, rank 1), TankCommander (500m, rank 2)
        Assert.Equal("AcePilot", result.Rankings[0].PlayerName);
        Assert.Equal(1, result.Rankings[0].Rank);
        Assert.Equal("TankCommander", result.Rankings[1].PlayerName);
        Assert.Equal(2, result.Rankings[1].Rank);

        // Page 2: Next 2 -> SniperWolf (400m, rank 3), MedicBob (300m, rank 4)
        var page2 = await _leaderboardService.GetServerPlayerRankingsAsync(
            serverGuid, serverName, 30, start, end, page: 2, pageSize: 2, sortBy: "active", minRounds: 1);

        Assert.Equal(2, page2.Rankings.Count);
        Assert.Equal("SniperWolf", page2.Rankings[0].PlayerName);
        Assert.Equal(3, page2.Rankings[0].Rank);
        Assert.Equal("MedicBob", page2.Rankings[1].PlayerName);
        Assert.Equal(4, page2.Rankings[1].Rank);
    }

    [Fact]
    public async Task GetServerPlayerRankingsAsync_SortsByKdAndScoreCorrectly()
    {
        var serverGuid = "srv-rankings-2";
        var serverName = "BF1942 Server 2";
        SeedServerAndStats(serverGuid, serverName);

        var start = DateTime.UtcNow.AddDays(-30);
        var end = DateTime.UtcNow;

        // Sort by K/D: SniperWolf (250/50 = 5.0), AcePilot (300/100 = 3.0), TankCommander (150/100 = 1.5)
        var kdResult = await _leaderboardService.GetServerPlayerRankingsAsync(
            serverGuid, serverName, 30, start, end, page: 1, pageSize: 10, sortBy: "kd", minRounds: 1);

        Assert.Equal("SniperWolf", kdResult.Rankings[0].PlayerName);
        Assert.Equal(5.0, kdResult.Rankings[0].KdRatio);
        Assert.Equal("AcePilot", kdResult.Rankings[1].PlayerName);
        Assert.Equal(3.0, kdResult.Rankings[1].KdRatio);

        // Sort by Score: AcePilot (5000), SniperWolf (4000), TankCommander (3000)
        var scoreResult = await _leaderboardService.GetServerPlayerRankingsAsync(
            serverGuid, serverName, 30, start, end, page: 1, pageSize: 10, sortBy: "score", minRounds: 1);

        Assert.Equal("AcePilot", scoreResult.Rankings[0].PlayerName);
        Assert.Equal(5000, scoreResult.Rankings[0].TotalScore);
        Assert.Equal("SniperWolf", scoreResult.Rankings[1].PlayerName);
        Assert.Equal(4000, scoreResult.Rankings[1].TotalScore);
    }

    [Fact]
    public async Task GetServerPlayerRankingsAsync_FiltersBySearchQueryAndMinRounds()
    {
        var serverGuid = "srv-rankings-3";
        var serverName = "BF1942 Server 3";
        SeedServerAndStats(serverGuid, serverName);

        var start = DateTime.UtcNow.AddDays(-30);
        var end = DateTime.UtcNow;

        // Search for "medic"
        var searchResult = await _leaderboardService.GetServerPlayerRankingsAsync(
            serverGuid, serverName, 30, start, end, page: 1, pageSize: 10, sortBy: "active", minRounds: 1, searchQuery: "medic");

        Assert.Single(searchResult.Rankings);
        Assert.Equal("MedicBob", searchResult.Rankings[0].PlayerName);

        // Filter by minRounds = 15 -> only AcePilot (20) and SniperWolf (15) qualify
        var minRoundsResult = await _leaderboardService.GetServerPlayerRankingsAsync(
            serverGuid, serverName, 30, start, end, page: 1, pageSize: 10, sortBy: "active", minRounds: 15);

        Assert.Equal(2, minRoundsResult.TotalCount);
        Assert.Equal(2, minRoundsResult.Rankings.Count);
    }

    [Fact]
    public async Task GetServerRankDistributionAsync_ComputesAveragesAndPercentiles()
    {
        var serverGuid = "srv-rankings-4";
        var serverName = "BF1942 Server 4";
        SeedServerAndStats(serverGuid, serverName);

        var start = DateTime.UtcNow.AddDays(-30);
        var end = DateTime.UtcNow;

        var dist = await _leaderboardService.GetServerRankDistributionAsync(
            serverGuid, serverName, 30, start, end, minRounds: 1);

        Assert.NotNull(dist);
        Assert.Equal(5, dist.TotalPlayers);

        // Verify K/D distribution
        Assert.NotNull(dist.KdDistribution);
        Assert.Equal("K/D ratio", dist.KdDistribution.MetricName);
        Assert.True(dist.KdDistribution.Average > 0);
        Assert.True(dist.KdDistribution.P95 > 0);
        Assert.True(dist.KdDistribution.Median > 0);
        Assert.Equal(8, dist.KdDistribution.Bands.Count);

        // Sum of band counts must equal total players (5)
        var totalBandedKd = dist.KdDistribution.Bands.Sum(b => b.Count);
        Assert.Equal(5, totalBandedKd);

        // Verify Score distribution
        Assert.NotNull(dist.ScoreDistribution);
        Assert.Equal("Score", dist.ScoreDistribution.MetricName);
        var totalBandedScore = dist.ScoreDistribution.Bands.Sum(b => b.Count);
        Assert.Equal(5, totalBandedScore);

        // Verify Kills, Playtime, KillRate
        Assert.NotNull(dist.KillsDistribution);
        Assert.NotNull(dist.PlayTimeDistribution);
        Assert.NotNull(dist.KillRateDistribution);
    }

    [Fact]
    public async Task Controller_GetServerPlayerRankings_ReturnsOkResult()
    {
        var serverGuid = "srv-ctrl-1";
        var serverName = "ControllerTestServer";
        SeedServerAndStats(serverGuid, serverName);

        var actionResult = await _controller.GetServerPlayerRankings(serverName, days: 30, page: 1, pageSize: 20);
        var okResult = Assert.IsType<OkObjectResult>(actionResult.Result);
        var response = Assert.IsType<ServerPlayerRankingsResponse>(okResult.Value);

        Assert.Equal(serverGuid, response.ServerGuid);
        Assert.Equal(5, response.TotalCount);
    }

    [Fact]
    public async Task Controller_GetServerRankDistribution_ReturnsOkResult()
    {
        var serverGuid = "srv-ctrl-2";
        var serverName = "DistTestServer";
        SeedServerAndStats(serverGuid, serverName);

        var actionResult = await _controller.GetServerRankDistribution(serverName, days: 30, minRounds: 1);
        var okResult = Assert.IsType<OkObjectResult>(actionResult.Result);
        var response = Assert.IsType<ServerRankDistributionResponse>(okResult.Value);

        Assert.Equal(serverGuid, response.ServerGuid);
        Assert.Equal(5, response.TotalPlayers);
    }
}
