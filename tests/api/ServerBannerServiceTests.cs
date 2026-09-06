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
    public async Task ResolveStatsAsync_DoesNotReadRounds_UsesStoredMap()
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-3",
            Name = "SiMPLE",
            Game = "bf1942",
            Ip = "1.2.3.4",
            Port = 14567,
            MaxPlayers = 64,
            CurrentNumPlayers = 12,
            MapName = "Wake",
            CurrentMap = "Gazala",
            IsOnline = true
        });
        dbContext.Rounds.Add(new Round
        {
            RoundId = "round-stale",
            ServerGuid = "srv-3",
            ServerName = "SiMPLE",
            MapName = "Battleaxe",
            GameType = "gpm_cq",
            StartTime = DateTime.UtcNow.AddHours(-1),
            IsActive = true
        });
        await dbContext.SaveChangesAsync();

        var stats = await service.ResolveStatsAsync("SiMPLE", ServerBannerStyle.Reticle, showTickets: false, CancellationToken.None);

        Assert.NotNull(stats);
        Assert.Equal("Gazala", stats.Map);
        Assert.Null(stats.GameMode);
        await bfListApiService.DidNotReceiveWithAnyArgs().FetchSingleServerSummaryAsync(default!, default!);
    }

    [Fact]
    public async Task ResolveStatsAsync_UsesLiveMapModeAndTickets_IgnoresActiveRound()
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-4",
            Name = "Apex",
            Game = "bf1942",
            Ip = "9.9.9.9",
            Port = 14567,
            MaxPlayers = 64,
            CurrentNumPlayers = 22,
            MapName = "Wake",
            IsOnline = true
        });
        dbContext.Rounds.Add(new Round
        {
            RoundId = "round-other",
            ServerGuid = "srv-4",
            ServerName = "Apex",
            MapName = "Battleaxe",
            GameType = "gpm_ctf",
            StartTime = DateTime.UtcNow.AddMinutes(-20),
            IsActive = true
        });
        await dbContext.SaveChangesAsync();

        bfListApiService.FetchSingleServerSummaryAsync("bf1942", "9.9.9.9:14567")
            .Returns(new ServerSummary
            {
                MapName = "El Alamein",
                GameType = "gpm_cq",
                Tickets1 = 142,
                Tickets2 = 69
            });

        var stats = await service.ResolveStatsAsync("Apex", ServerBannerStyle.Reticle, showTickets: true, CancellationToken.None);

        Assert.NotNull(stats);
        Assert.Equal("El Alamein", stats.Map);
        Assert.Equal("gpm_cq", stats.GameMode);
        Assert.NotNull(stats.Tickets);
        Assert.Equal(142, stats.Tickets.Team1Tickets);
        Assert.Equal(69, stats.Tickets.Team2Tickets);
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
