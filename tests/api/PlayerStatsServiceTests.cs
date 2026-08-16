using api.Caching;
using api.Data.Entities;
using api.Players;
using api.Players.Models;
using api.PlayerStats;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests;

public sealed class PlayerStatsServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly ISqlitePlayerStatsService sqlitePlayerStatsService;
    private readonly PlayerStatsService service;

    public PlayerStatsServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        sqlitePlayerStatsService = Substitute.For<ISqlitePlayerStatsService>();
        service = new PlayerStatsService(dbContext, sqlitePlayerStatsService, NullLogger<PlayerStatsService>.Instance);
    }

    [Fact]
    public async Task SearchPlayersAsync_ReturnsEmpty_WhenQueryIsEmptyOrWhitespace()
    {
        var result = await service.SearchPlayersAsync("   ");
        Assert.Empty(result.Items);
        Assert.Equal(0, result.TotalItems);
    }

    [Fact]
    public async Task SearchPlayersAsync_PrioritizesPrefixMatchesAndPaginates()
    {
        var server = new GameServer
        {
            Guid = "srv-1",
            Name = "Apex BF1942 Server",
            GameId = "bf1942"
        };
        dbContext.Servers.Add(server);

        dbContext.Players.AddRange(
            new Player { Name = "Maverick", TotalPlayTimeMinutes = 500, AiBot = false, LastSeen = DateTime.UtcNow },
            new Player { Name = "Maximus", TotalPlayTimeMinutes = 1200, AiBot = false, LastSeen = DateTime.UtcNow },
            new Player { Name = "TopMax", TotalPlayTimeMinutes = 300, AiBot = false, LastSeen = DateTime.UtcNow },
            new Player { Name = "MaxBot", TotalPlayTimeMinutes = 900, AiBot = true, LastSeen = DateTime.UtcNow },
            new Player { Name = "OtherPlayer", TotalPlayTimeMinutes = 100, AiBot = false, LastSeen = DateTime.UtcNow }
        );

        // Add an active session for Maximus
        dbContext.PlayerSessions.Add(new PlayerSession
        {
            SessionId = 1,
            PlayerName = "Maximus",
            ServerGuid = "srv-1",
            IsActive = true,
            MapName = "El Alamein",
            StartTime = DateTime.UtcNow.AddMinutes(-30),
            LastSeenTime = DateTime.UtcNow,
            TotalKills = 15,
            TotalDeaths = 3
        });

        await dbContext.SaveChangesAsync();

        var result = await service.SearchPlayersAsync("Max", page: 1, pageSize: 5);

        // MaxBot (bot) must be excluded.
        // Prefix matches: Maximus (1200m), Maverick does not match Max prefix, TopMax is substring.
        Assert.Equal(2, result.Items.Count);
        Assert.Equal(2, result.TotalItems);
        Assert.Equal(1, result.TotalPages);
        Assert.Equal(1, result.Page);
        Assert.Equal("Maximus", result.Items[0].PlayerName);
        Assert.True(result.Items[0].IsActive);
        Assert.NotNull(result.Items[0].CurrentServer);
        Assert.Equal("Apex BF1942 Server", result.Items[0].CurrentServer!.ServerName);
        Assert.Equal("El Alamein", result.Items[0].CurrentServer!.MapName);

        // Substring match
        Assert.Equal("TopMax", result.Items[1].PlayerName);
        Assert.False(result.Items[1].IsActive);
    }

    [Fact]
    public async Task SearchPlayersAsync_PaginatesCorrectly_AcrossMultiplePagesWithAccurateTotals()
    {
        dbContext.Players.AddRange(
            new Player { Name = "MaxOne", TotalPlayTimeMinutes = 100 },
            new Player { Name = "MaxTwo", TotalPlayTimeMinutes = 200 },
            new Player { Name = "MaxThree", TotalPlayTimeMinutes = 50 },
            new Player { Name = "TheMaximus", TotalPlayTimeMinutes = 500 }
        );
        await dbContext.SaveChangesAsync();

        // Page 1 (pageSize = 2)
        var page1 = await service.SearchPlayersAsync("Max", page: 1, pageSize: 2);
        Assert.Equal(4, page1.TotalItems);
        Assert.Equal(2, page1.TotalPages);
        Assert.Equal(1, page1.Page);
        Assert.Equal(2, page1.Items.Count);
        Assert.Equal("MaxTwo", page1.Items[0].PlayerName); // Prefix, 200m
        Assert.Equal("MaxOne", page1.Items[1].PlayerName); // Prefix, 100m

        // Page 2 (pageSize = 2)
        var page2 = await service.SearchPlayersAsync("Max", page: 2, pageSize: 2);
        Assert.Equal(4, page2.TotalItems);
        Assert.Equal(2, page2.TotalPages);
        Assert.Equal(2, page2.Page);
        Assert.Equal(2, page2.Items.Count);
        Assert.Equal("MaxThree", page2.Items[0].PlayerName);   // Prefix, 50m
        Assert.Equal("TheMaximus", page2.Items[1].PlayerName); // Substring, 500m

        var allNames = page1.Items.Concat(page2.Items).Select(p => p.PlayerName).Distinct().ToList();
        Assert.Equal(4, allNames.Count);
    }

    [Fact]
    public async Task GetAllPlayersWithPaging_HydratesActiveStatusAndAggregatesAccurately()
    {
        var server = new GameServer
        {
            Guid = "srv-1",
            Name = "MoonGamers BF1942",
            GameId = "bf1942"
        };
        dbContext.Servers.Add(server);

        dbContext.Players.AddRange(
            new Player { Name = "The Muffin Man", TotalPlayTimeMinutes = 1500, AiBot = false, LastSeen = DateTime.UtcNow },
            new Player { Name = "AnotherPlayer", TotalPlayTimeMinutes = 200, AiBot = false, LastSeen = DateTime.UtcNow.AddDays(-1) }
        );

        dbContext.PlayerSessions.Add(new PlayerSession
        {
            SessionId = 10,
            PlayerName = "The Muffin Man",
            ServerGuid = "srv-1",
            IsActive = true,
            MapName = "Wake Island",
            StartTime = DateTime.UtcNow.AddMinutes(-20),
            LastSeenTime = DateTime.UtcNow,
            TotalKills = 25,
            TotalDeaths = 5
        });

        dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            PlayerName = "The Muffin Man",
            ServerGuid = "srv-1",
            Year = DateTime.UtcNow.Year,
            Week = System.Globalization.ISOWeek.GetWeekOfYear(DateTime.UtcNow),
            TotalKills = 100,
            TotalDeaths = 50,
            TotalRounds = 10,
            TotalScore = 500
        });

        await dbContext.SaveChangesAsync();

        var filters = new api.Players.Models.PlayerFilters
        {
            PlayerName = "Muffin"
        };

        var result = await service.GetAllPlayersWithPaging(
            page: 1,
            pageSize: 10,
            sortBy: "totalplaytimeminutes",
            sortOrder: "desc",
            filters: filters);

        Assert.Single(result.Items);
        Assert.Equal(1, result.TotalItems);
        var player = result.Items[0];
        Assert.Equal("The Muffin Man", player.PlayerName);
        Assert.True(player.IsActive);
        Assert.NotNull(player.CurrentServer);
        Assert.Equal("MoonGamers BF1942", player.CurrentServer!.ServerName);
        Assert.Equal("Wake Island", player.CurrentServer!.MapName);
        Assert.Equal(100, player.TotalKills);
        Assert.Equal(50, player.TotalDeaths);
        Assert.Equal(10, player.TotalRounds);
        Assert.Equal("MoonGamers BF1942", player.FavoriteServer);
    }

    [Fact]
    public async Task GetPlayerStatistics_CalculatesServerRankings_BatchedQuery()
    {
        var server1 = new GameServer { Guid = "srv-1", Name = "Server Alpha", GameId = "bf1942" };
        var server2 = new GameServer { Guid = "srv-2", Name = "Server Bravo", GameId = "bf1942" };
        dbContext.Servers.AddRange(server1, server2);

        dbContext.Players.AddRange(
            new Player { Name = "AcePlayer", TotalPlayTimeMinutes = 500, AiBot = false, LastSeen = DateTime.UtcNow },
            new Player { Name = "RivalPlayer", TotalPlayTimeMinutes = 400, AiBot = false, LastSeen = DateTime.UtcNow },
            new Player { Name = "ThirdPlayer", TotalPlayTimeMinutes = 300, AiBot = false, LastSeen = DateTime.UtcNow }
        );

        // Server 1 rankings: RivalPlayer (score 1000) > AcePlayer (score 800) > ThirdPlayer (score 200)
        dbContext.ServerPlayerRankings.AddRange(
            new ServerPlayerRanking { ServerGuid = "srv-1", PlayerName = "RivalPlayer", Year = 2026, Month = 8, TotalScore = 1000, Rank = 1 },
            new ServerPlayerRanking { ServerGuid = "srv-1", PlayerName = "AcePlayer", Year = 2026, Month = 8, TotalScore = 800, Rank = 2 },
            new ServerPlayerRanking { ServerGuid = "srv-1", PlayerName = "ThirdPlayer", Year = 2026, Month = 8, TotalScore = 200, Rank = 3 },
            // Server 2 rankings: AcePlayer (score 500) > RivalPlayer (score 300)
            new ServerPlayerRanking { ServerGuid = "srv-2", PlayerName = "AcePlayer", Year = 2026, Month = 8, TotalScore = 500, Rank = 1 },
            new ServerPlayerRanking { ServerGuid = "srv-2", PlayerName = "RivalPlayer", Year = 2026, Month = 8, TotalScore = 300, Rank = 2 }
        );

        await dbContext.SaveChangesAsync();

        var stats = await service.GetPlayerStatistics("AcePlayer");

        Assert.NotNull(stats);
        Assert.NotNull(stats.Insights);
        Assert.Equal(2, stats.Insights.ServerRankings.Count);

        // Best rank first (Server 2 rank 1, Server 1 rank 2)
        var rankSrv2 = stats.Insights.ServerRankings.FirstOrDefault(r => r.ServerGuid == "srv-2");
        Assert.NotNull(rankSrv2);
        Assert.Equal(1, rankSrv2!.Rank);
        Assert.Equal(500, rankSrv2.TotalScore);
        Assert.Equal(2, rankSrv2.TotalRankedPlayers);
        Assert.Equal("Server Bravo", rankSrv2.ServerName);

        var rankSrv1 = stats.Insights.ServerRankings.FirstOrDefault(r => r.ServerGuid == "srv-1");
        Assert.NotNull(rankSrv1);
        Assert.Equal(2, rankSrv1!.Rank);
        Assert.Equal(800, rankSrv1.TotalScore);
        Assert.Equal(3, rankSrv1.TotalRankedPlayers);
        Assert.Equal("Server Alpha", rankSrv1.ServerName);
    }

    [Fact]
    public async Task GetPlayerStatistics_UsesCache_WhenAvailable()
    {
        var cacheMock = Substitute.For<ICacheService>();
        var cachedStats = new PlayerTimeStatistics
        {
            TotalPlayTimeMinutes = 9999,
            TotalKills = 1234
        };

        cacheMock.GetAsync<PlayerTimeStatistics>("player_stats:cachedguy")
            .Returns(cachedStats);

        var cachedService = new PlayerStatsService(dbContext, sqlitePlayerStatsService, NullLogger<PlayerStatsService>.Instance, cacheMock);

        var result = await cachedService.GetPlayerStatistics("CachedGuy");

        Assert.Equal(9999, result.TotalPlayTimeMinutes);
        Assert.Equal(1234, result.TotalKills);
        // Did not query dbContext for player
        await cacheMock.DidNotReceive().SetAsync(Arg.Any<string>(), Arg.Any<PlayerTimeStatistics>(), Arg.Any<TimeSpan>());
    }

    [Fact]
    public async Task GetPlayerStatistics_SetsCache_OnCacheMiss()
    {
        var cacheMock = Substitute.For<ICacheService>();
        cacheMock.GetAsync<PlayerTimeStatistics>(Arg.Any<string>())
            .Returns((PlayerTimeStatistics?)null);

        dbContext.Players.Add(new Player { Name = "FreshPlayer", TotalPlayTimeMinutes = 100, AiBot = false, LastSeen = DateTime.UtcNow });
        await dbContext.SaveChangesAsync();

        var cachedService = new PlayerStatsService(dbContext, sqlitePlayerStatsService, NullLogger<PlayerStatsService>.Instance, cacheMock);

        var result = await cachedService.GetPlayerStatistics("FreshPlayer");

        Assert.NotNull(result);
        await cacheMock.Received(1).SetAsync("player_stats:freshplayer", Arg.Any<PlayerTimeStatistics>(), TimeSpan.FromMinutes(5));
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
