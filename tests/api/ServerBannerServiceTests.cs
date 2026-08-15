using api.Bflist;
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

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }
}
