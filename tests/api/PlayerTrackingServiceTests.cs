using api.Bflist.Models;
using api.DiscordNotifications;
using api.PlayerTracking;
using api.Servers;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests;

public sealed class PlayerTrackingServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly PlayerTrackingService service;

    public PlayerTrackingServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        var configuration = new ConfigurationBuilder().AddInMemoryCollection().Build();
        var botDetection = new BotDetectionService(configuration);
        var discord = Substitute.For<IDiscordWebhookService>();

        service = new PlayerTrackingService(
            dbContext,
            botDetection,
            discord,
            eventPublisher: null,
            logger: NullLogger<PlayerTrackingService>.Instance);
    }

    [Fact]
    public async Task TrackPlayers_StoresHumanRosterCount()
    {
        await SeedServer("srv-roster");
        var snapshot = Server(
            guid: "srv-roster",
            numPlayers: 3,
            players:
            [
                new PlayerInfo { Name = "Alpha" },
                new PlayerInfo { Name = "Bravo" },
                new PlayerInfo { Name = "Charlie" }
            ]);

        await service.TrackPlayersFromServerInfo(snapshot, DateTime.UtcNow, "bf1942");

        var stored = await dbContext.Servers.SingleAsync(s => s.Guid == "srv-roster");
        Assert.Equal(3, stored.CurrentNumPlayers);
    }

    [Fact]
    public async Task TrackPlayers_UsesReportedNumPlayers_WhenRosterIsEmpty()
    {
        await SeedServer("srv-empty-roster");
        var snapshot = Server(
            guid: "srv-empty-roster",
            numPlayers: 12,
            players: []);

        await service.TrackPlayersFromServerInfo(snapshot, DateTime.UtcNow, "bf1942");

        var stored = await dbContext.Servers.SingleAsync(s => s.Guid == "srv-empty-roster");
        Assert.Equal(12, stored.CurrentNumPlayers);
    }

    [Fact]
    public async Task TrackPlayers_StoresZero_WhenServerIsEmpty()
    {
        await SeedServer("srv-empty");
        var snapshot = Server(
            guid: "srv-empty",
            numPlayers: 0,
            players: []);

        await service.TrackPlayersFromServerInfo(snapshot, DateTime.UtcNow, "bf1942");

        var stored = await dbContext.Servers.SingleAsync(s => s.Guid == "srv-empty");
        Assert.Equal(0, stored.CurrentNumPlayers);
    }

    [Fact]
    public async Task TrackPlayers_IgnoresBotsInRosterCount()
    {
        await SeedServer("srv-bots");
        var snapshot = Server(
            guid: "srv-bots",
            numPlayers: 4,
            players:
            [
                new PlayerInfo { Name = "Alpha" },
                new PlayerInfo { Name = "BFPlayer" },
                new PlayerInfo { Name = "Player_2" },
                new PlayerInfo { Name = "Bravo" }
            ]);

        await service.TrackPlayersFromServerInfo(snapshot, DateTime.UtcNow, "bf1942");

        var stored = await dbContext.Servers.SingleAsync(s => s.Guid == "srv-bots");
        Assert.Equal(2, stored.CurrentNumPlayers);
    }

    private async Task SeedServer(string guid)
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = guid,
            Ip = "1.2.3.4",
            Port = 14567,
            Game = "bf1942",
            GameId = "bf1942",
            GeoLookupDate = DateTime.UtcNow,
            CurrentNumPlayers = 0
        });
        await dbContext.SaveChangesAsync();
    }

    private static Bf1942ServerAdapter Server(string guid, int numPlayers, PlayerInfo[] players) =>
        new(new Bf1942ServerInfo
        {
            Guid = guid,
            Name = guid,
            Ip = "1.2.3.4",
            Port = 14567,
            GameId = "bf1942",
            MapName = "Wake",
            GameType = "conquest",
            MaxPlayers = 64,
            NumPlayers = numPlayers,
            Players = players
        });

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
