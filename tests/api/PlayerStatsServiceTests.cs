using api.Players;
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

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
