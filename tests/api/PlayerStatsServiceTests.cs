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
        Assert.Equal("Maximus", result.Items[0].PlayerName);
        Assert.True(result.Items[0].IsActive);
        Assert.NotNull(result.Items[0].CurrentServer);
        Assert.Equal("Apex BF1942 Server", result.Items[0].CurrentServer!.ServerName);
        Assert.Equal("El Alamein", result.Items[0].CurrentServer!.MapName);

        // Substring match
        Assert.Equal("TopMax", result.Items[1].PlayerName);
        Assert.False(result.Items[1].IsActive);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
