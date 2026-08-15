using api.Caching;
using api.GameTrends;
using api.PlayerStats;
using api.PlayerTracking;
using api.Servers;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests;

public sealed class ServerStatsServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly ICacheService cacheService;
    private readonly ICacheKeyService cacheKeyService;
    private readonly ISqliteGameTrendsService sqliteGameTrendsService;
    private readonly ISqliteLeaderboardService sqliteLeaderboardService;
    private readonly ServerStatsService service;

    public ServerStatsServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        cacheService = Substitute.For<ICacheService>();
        cacheKeyService = Substitute.For<ICacheKeyService>();
        sqliteGameTrendsService = Substitute.For<ISqliteGameTrendsService>();
        sqliteLeaderboardService = Substitute.For<ISqliteLeaderboardService>();

        service = new ServerStatsService(
            dbContext,
            NullLogger<ServerStatsService>.Instance,
            cacheService,
            cacheKeyService,
            sqliteGameTrendsService,
            sqliteLeaderboardService);
    }

    [Fact]
    public async Task SearchServersAsync_ReturnsEmpty_WhenQueryIsEmptyOrWhitespace()
    {
        var result = await service.SearchServersAsync("   ");
        Assert.Empty(result.Items);
        Assert.Equal(0, result.TotalItems);
    }

    [Fact]
    public async Task SearchServersAsync_PrioritizesPrefixMatchesAndPlayerCounts()
    {
        dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-1", Name = "Apex BF1942 Server", Game = "bf1942", CurrentNumPlayers = 10, Ip = "1.2.3.4", Port = 14567, Country = "DE" },
            new GameServer { Guid = "srv-2", Name = "Apex Full Server", Game = "bf1942", CurrentNumPlayers = 32, Ip = "1.2.3.5", Port = 14567, Country = "US" },
            new GameServer { Guid = "srv-3", Name = "Another Apex Server", Game = "bf1942", CurrentNumPlayers = 5, Ip = "1.2.3.6", Port = 14567, Country = "SE" },
            new GameServer { Guid = "srv-4", Name = "Different Server", Game = "bf1942", CurrentNumPlayers = 0, Ip = "1.2.3.7", Port = 14567, Country = "UK" },
            new GameServer { Guid = "srv-5", Name = "Apex BFVietnam Server", Game = "bfvietnam", CurrentNumPlayers = 10, Ip = "1.2.3.8", Port = 14567, Country = "DE" }
        );

        await dbContext.SaveChangesAsync();

        var result = await service.SearchServersAsync("Apex", "bf1942", 1, 5);

        // Filtered by bf1942, prefix matched first ordered by CurrentNumPlayers desc
        var items = result.Items.ToList();
        Assert.Equal(3, items.Count);
        Assert.Equal(3, result.TotalItems);
        Assert.Equal(1, result.TotalPages);
        Assert.Equal(1, result.CurrentPage);
        Assert.Equal("Apex Full Server", items[0].ServerName);
        Assert.Equal("Apex BF1942 Server", items[1].ServerName);
        Assert.Equal("Another Apex Server", items[2].ServerName); // Substring match
    }

    [Fact]
    public async Task SearchServersAsync_PaginatesCorrectly_AcrossMultiplePagesWithAccurateTotals()
    {
        dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-1", Name = "Apex BF1942 Alpha", Game = "bf1942", CurrentNumPlayers = 10 },
            new GameServer { Guid = "srv-2", Name = "Apex BF1942 Beta", Game = "bf1942", CurrentNumPlayers = 20 },
            new GameServer { Guid = "srv-3", Name = "Apex BF1942 Gamma", Game = "bf1942", CurrentNumPlayers = 5 },
            new GameServer { Guid = "srv-4", Name = "Community Apex Delta", Game = "bf1942", CurrentNumPlayers = 15 }
        );
        await dbContext.SaveChangesAsync();

        // Page 1 (pageSize = 2)
        var page1 = await service.SearchServersAsync("Apex", "bf1942", page: 1, pageSize: 2);
        var page1Items = page1.Items.ToList();

        Assert.Equal(4, page1.TotalItems);
        Assert.Equal(2, page1.TotalPages);
        Assert.Equal(1, page1.CurrentPage);
        Assert.Equal(2, page1Items.Count);
        Assert.Equal("Apex BF1942 Beta", page1Items[0].ServerName);  // Prefix, 20 players
        Assert.Equal("Apex BF1942 Alpha", page1Items[1].ServerName); // Prefix, 10 players

        // Page 2 (pageSize = 2)
        var page2 = await service.SearchServersAsync("Apex", "bf1942", page: 2, pageSize: 2);
        var page2Items = page2.Items.ToList();

        Assert.Equal(4, page2.TotalItems);
        Assert.Equal(2, page2.TotalPages);
        Assert.Equal(2, page2.CurrentPage);
        Assert.Equal(2, page2Items.Count);
        Assert.Equal("Apex BF1942 Gamma", page2Items[0].ServerName);   // Prefix, 5 players
        Assert.Equal("Community Apex Delta", page2Items[1].ServerName); // Substring, 15 players

        // Ensure distinct items across pages
        var combinedGuids = page1Items.Concat(page2Items).Select(s => s.ServerGuid).Distinct().ToList();
        Assert.Equal(4, combinedGuids.Count);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
