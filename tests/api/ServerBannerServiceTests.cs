using api.Bflist;
using api.Bflist.Models;
using api.GameTrends;
using api.PlayerTracking;
using api.ServerBanners;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace api.tests;

public sealed class ServerBannerServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;
    private readonly IBfListApiService bfListApiService;
    private readonly ServerBannerService service;

    public ServerBannerServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();

        bfListApiService = Substitute.For<IBfListApiService>();
        var gameTrendsService = Substitute.For<ISqliteGameTrendsService>();

        service = new ServerBannerService(
            dbContext,
            bfListApiService,
            gameTrendsService,
            null!,
            NullLogger<ServerBannerService>.Instance);
    }

    [Fact]
    public async Task ResolveStatsAsync_ReadsCurrentNumPlayersFromStoredField()
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-1",
            Name = "Apex BF1942",
            Game = "bf1942",
            Ip = "1.2.3.4",
            Port = 14567,
            MaxPlayers = 64,
            CurrentNumPlayers = 14,
            MapName = "Wake",
            IsOnline = true
        });
        await dbContext.SaveChangesAsync();

        var stats = await service.ResolveStatsAsync("Apex BF1942", ServerBannerStyle.Reticle, showTickets: false, CancellationToken.None);

        Assert.NotNull(stats);
        Assert.Equal(14, stats.NumPlayers);
        await bfListApiService.DidNotReceiveWithAnyArgs().FetchSingleServerSummaryAsync(default!, default!);
    }

    [Fact]
    public async Task ResolveStatsAsync_ReturnsZero_WhenStoredFieldIsZero()
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-2",
            Name = "Empty Box",
            Game = "bf1942",
            Ip = "5.6.7.8",
            Port = 14567,
            MaxPlayers = 32,
            CurrentNumPlayers = 0,
            MapName = "Gazala",
            IsOnline = true
        });
        await dbContext.SaveChangesAsync();

        var stats = await service.ResolveStatsAsync("Empty Box", ServerBannerStyle.Console, showTickets: false, CancellationToken.None);

        Assert.NotNull(stats);
        Assert.Equal(0, stats.NumPlayers);
    }

    [Fact]
    public async Task ResolveStatsAsync_PrefersOnlineRow_WhenDuplicateNamesHaveStaleIp()
    {
        dbContext.Servers.AddRange(
            new GameServer
            {
                Guid = "chasaba-old",
                Name = "CHASABA Main BF1942 Server",
                Game = "bf1942",
                Ip = "153.223.78.15",
                Port = 14567,
                MaxPlayers = 64,
                CurrentNumPlayers = 0,
                MapName = "old map",
                IsOnline = false,
                LastSeenTime = DateTime.UtcNow.AddDays(-2)
            },
            new GameServer
            {
                Guid = "chasaba-live",
                Name = "CHASABA Main BF1942 Server",
                Game = "bf1942",
                Ip = "153.207.118.175",
                Port = 14567,
                MaxPlayers = 64,
                CurrentNumPlayers = 66,
                MapName = "flak tower-1945",
                IsOnline = true,
                LastSeenTime = DateTime.UtcNow
            });
        await dbContext.SaveChangesAsync();

        var stats = await service.ResolveStatsAsync(
            "CHASABA Main BF1942 Server",
            ServerBannerStyle.Reticle,
            showTickets: false,
            CancellationToken.None);

        Assert.NotNull(stats);
        Assert.Equal("153.207.118.175:14567", stats.IpPort);
        Assert.Equal(66, stats.NumPlayers);
        Assert.True(stats.IsOnline);
    }

    [Fact]
    public async Task ResolveStatsAsync_UsesLiveSnapshotForTickets_WithoutSingleServerCall()
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = "chasaba-old",
            Name = "CHASABA Main BF1942 Server",
            Game = "bf1942",
            Ip = "153.223.78.15",
            Port = 14567,
            MaxPlayers = 64,
            CurrentNumPlayers = 12,
            MapName = "old map",
            IsOnline = true
        });
        await dbContext.SaveChangesAsync();

        bfListApiService.TryGetCachedServerByNameAsync("bf1942", "CHASABA Main BF1942 Server")
            .Returns(new ServerSummary
            {
                Name = "CHASABA Main BF1942 Server",
                Ip = "153.207.118.175",
                Port = 14567,
                Tickets1 = 650,
                Tickets2 = 436,
                Teams =
                [
                    new TeamInfo { Index = 1, Label = "Axis", Tickets = 650 },
                    new TeamInfo { Index = 2, Label = "Allied", Tickets = 436 }
                ]
            });

        var stats = await service.ResolveStatsAsync(
            "CHASABA Main BF1942 Server",
            ServerBannerStyle.Reticle,
            showTickets: true,
            CancellationToken.None);

        Assert.NotNull(stats);
        Assert.Equal("153.207.118.175:14567", stats.IpPort);
        Assert.NotNull(stats.Tickets);
        Assert.Equal(650, stats.Tickets.Team1Tickets);
        Assert.Equal(436, stats.Tickets.Team2Tickets);
        Assert.Equal("AXIS", stats.Tickets.Team1Label);
        Assert.Equal("ALLIED", stats.Tickets.Team2Label);
        await bfListApiService.DidNotReceiveWithAnyArgs().FetchSingleServerSummaryAsync(default!, default!);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
