using api.AdminData;
using api.AdminData.Models;
using api.Caching;
using api.Data.Entities;
using api.ImageStorage;
using api.MapDossiers;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NodaTime;
using NSubstitute;

namespace api.tests.AdminData;

public class MapReportServiceTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IClock _clock;
    private readonly ICacheService _cacheService;
    private readonly ILogger<AdminDataService> _logger;
    private readonly IMapImageResolver _mapImageResolver;
    private readonly IMapDossierResolver _mapDossierResolver;
    private readonly AdminDataService _service;

    public MapReportServiceTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();

        _scopeFactory = Substitute.For<IServiceScopeFactory>();
        _clock = Substitute.For<IClock>();
        _clock.GetCurrentInstant().Returns(Instant.FromUtc(2026, 9, 10, 12, 0));
        _cacheService = Substitute.For<ICacheService>();
        _logger = Substitute.For<ILogger<AdminDataService>>();
        _mapImageResolver = Substitute.For<IMapImageResolver>();
        _mapDossierResolver = Substitute.For<IMapDossierResolver>();

        _service = new AdminDataService(
            _dbContext,
            _scopeFactory,
            _clock,
            _cacheService,
            _logger,
            _mapImageResolver,
            _mapDossierResolver
        );
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Close();
    }

    [Fact]
    public async Task GetMapReportAsync_IdentifiesMissingMaps_AndUninstalledMods()
    {
        // Arrange: 2 servers running different mods
        var s1 = new GameServer
        {
            Guid = "guid-vanilla",
            Name = "Vanilla Server",
            Ip = "1.2.3.4",
            Port = 14567,
            GameId = "bf1942",
            Game = "bf1942",
            IsOnline = true
        };
        var s2 = new GameServer
        {
            Guid = "guid-finn",
            Name = "FinnWars Public",
            Ip = "5.6.7.8",
            Port = 14567,
            GameId = "finnwars",
            Game = "bf1942",
            IsOnline = true
        };
        _dbContext.Servers.AddRange(s1, s2);

        var now = Instant.FromUtc(2026, 9, 10, 10, 0);
        _dbContext.ServerMapStats.AddRange(
            new ServerMapStats
            {
                ServerGuid = "guid-vanilla",
                MapName = "wake",
                Year = 2026,
                Month = 9,
                TotalRounds = 50,
                TotalPlayTimeMinutes = 1000,
                UpdatedAt = now
            },
            new ServerMapStats
            {
                ServerGuid = "guid-finn",
                MapName = "ayrapaa",
                Year = 2026,
                Month = 9,
                TotalRounds = 120,
                TotalPlayTimeMinutes = 2400,
                UpdatedAt = now
            }
        );
        await _dbContext.SaveChangesAsync();

        _mapImageResolver.GetKnownMods().Returns(["bf1942", "dc_final"]);
        _mapImageResolver.Resolve("bf1942", "wake", MapImageKind.Thumbnail).Returns("bf1942/wake.png");
        _mapImageResolver.Resolve("finnwars", "ayrapaa", MapImageKind.Thumbnail).Returns((string?)null);
        _mapImageResolver.Resolve("bf1942", "ayrapaa", MapImageKind.Thumbnail).Returns((string?)null);

        // Act: request missing only (default)
        var result = await _service.GetMapReportAsync(new MapReportRequest { Status = "missing" });

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.Summary.TotalMaps);
        Assert.Equal(1, result.Summary.MissingIconMaps);
        Assert.Equal(1, result.Summary.HasIconMaps);
        Assert.Equal(2, result.Summary.TotalMods);
        Assert.Equal(1, result.Summary.UninstalledMods); // finnwars is not in known mods

        Assert.Single(result.Items);
        var missing = result.Items[0];
        Assert.Equal("ayrapaa", missing.MapName);
        Assert.False(missing.HasThumbnail);
        Assert.Equal(120, missing.TotalRounds);
        Assert.Single(missing.Servers);
        Assert.Equal("FinnWars Public", missing.Servers[0].ServerName);
        Assert.Equal("finnwars", missing.Servers[0].GameId);

        var finnMod = result.Mods.FirstOrDefault(m => m.GameId == "finnwars");
        Assert.NotNull(finnMod);
        Assert.False(finnMod.IsInstalled);
        Assert.Equal(1, finnMod.MissingMaps);
        Assert.Equal(120, finnMod.TotalRounds);
    }

    [Fact]
    public async Task GetMapReportAsync_FiltersByMod_AndStatusAll()
    {
        // Arrange
        var s1 = new GameServer { Guid = "s1", Name = "S1", Ip = "1.1.1.1", Port = 1, GameId = "mod1", Game = "bf1942" };
        var s2 = new GameServer { Guid = "s2", Name = "S2", Ip = "2.2.2.2", Port = 2, GameId = "mod2", Game = "bf1942" };
        _dbContext.Servers.AddRange(s1, s2);

        var now = Instant.FromUtc(2026, 9, 10, 10, 0);
        _dbContext.ServerMapStats.AddRange(
            new ServerMapStats { ServerGuid = "s1", MapName = "map_a", Year = 2026, Month = 9, TotalRounds = 10, UpdatedAt = now },
            new ServerMapStats { ServerGuid = "s2", MapName = "map_b", Year = 2026, Month = 9, TotalRounds = 20, UpdatedAt = now }
        );
        await _dbContext.SaveChangesAsync();

        _mapImageResolver.GetKnownMods().Returns(["mod1"]);
        _mapImageResolver.Resolve(Arg.Any<string>(), Arg.Any<string>(), MapImageKind.Thumbnail).Returns((string?)null);

        // Act
        var result = await _service.GetMapReportAsync(new MapReportRequest { Mod = "mod2", Status = "all" });

        // Assert
        Assert.Single(result.Items);
        Assert.Equal("map_b", result.Items[0].MapName);
        Assert.Equal(20, result.Items[0].TotalRounds);
    }

    [Fact]
    public async Task GetMapReportAsync_IgnoresFh2AndBfvGames()
    {
        // Arrange: valid bf1942 server and legacy fh2/bfvietnam servers
        var sValid = new GameServer { Guid = "s-valid", Name = "Valid 1942", Ip = "1.1.1.1", Port = 1, Game = "bf1942", GameId = "bf1942" };
        var sFh2 = new GameServer { Guid = "s-fh2", Name = "FH2 Server", Ip = "2.2.2.2", Port = 2, Game = "fh2", GameId = "fh2" };
        var sBfv = new GameServer { Guid = "s-bfv", Name = "BFV Server", Ip = "3.3.3.3", Port = 3, Game = "bfvietnam", GameId = "bfvietnam" };
        var sBfv2 = new GameServer { Guid = "s-bfv2", Name = "BFV Server 2", Ip = "4.4.4.4", Port = 4, Game = "bf1942", GameId = "bfv" };
        _dbContext.Servers.AddRange(sValid, sFh2, sBfv, sBfv2);

        var now = Instant.FromUtc(2026, 9, 10, 10, 0);
        _dbContext.ServerMapStats.AddRange(
            new ServerMapStats { ServerGuid = "s-valid", MapName = "wake", Year = 2026, Month = 9, TotalRounds = 50, UpdatedAt = now },
            new ServerMapStats { ServerGuid = "s-fh2", MapName = "dalian_plant", Year = 2026, Month = 9, TotalRounds = 100, UpdatedAt = now },
            new ServerMapStats { ServerGuid = "s-bfv", MapName = "hue_1968", Year = 2026, Month = 9, TotalRounds = 80, UpdatedAt = now },
            new ServerMapStats { ServerGuid = "s-bfv2", MapName = "cambodian_incursion", Year = 2026, Month = 9, TotalRounds = 60, UpdatedAt = now }
        );
        await _dbContext.SaveChangesAsync();

        _mapImageResolver.GetKnownMods().Returns(["bf1942"]);
        _mapImageResolver.Resolve("bf1942", "wake", MapImageKind.Thumbnail).Returns("bf1942/wake.png");

        // Act
        var result = await _service.GetMapReportAsync(new MapReportRequest { Status = "all" });

        // Assert: only the valid bf1942 map is returned
        Assert.Single(result.Items);
        Assert.Equal("wake", result.Items[0].MapName);
        Assert.Equal(1, result.Summary.TotalMaps);

        // Mods list should not contain fh2, bfvietnam, or bfv
        Assert.DoesNotContain(result.Mods, m => m.GameId.Equals("fh2", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(result.Mods, m => m.GameId.Equals("bfvietnam", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(result.Mods, m => m.GameId.Equals("bfv", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GetMapReportAsync_WithGroupByMod_ReturnsModGroupsWithMaps()
    {
        // Arrange
        var sBg42 = new GameServer { Guid = "s-bg42", Name = "BG42 Server", Ip = "1.1.1.1", Port = 14567, Game = "bf1942", GameId = "battlegroup42" };
        var sVanilla = new GameServer { Guid = "s-vanilla", Name = "Vanilla Server", Ip = "2.2.2.2", Port = 14567, Game = "bf1942", GameId = "bf1942" };
        _dbContext.Servers.AddRange(sBg42, sVanilla);

        var now = Instant.FromUtc(2026, 9, 10, 10, 0);
        _dbContext.ServerMapStats.AddRange(
            new ServerMapStats { ServerGuid = "s-bg42", MapName = "bg42_kursk", Year = 2026, Month = 9, TotalRounds = 100, UpdatedAt = now },
            new ServerMapStats { ServerGuid = "s-bg42", MapName = "bg42_berlin", Year = 2026, Month = 9, TotalRounds = 50, UpdatedAt = now },
            new ServerMapStats { ServerGuid = "s-vanilla", MapName = "wake", Year = 2026, Month = 9, TotalRounds = 200, UpdatedAt = now }
        );
        await _dbContext.SaveChangesAsync();

        _mapImageResolver.GetKnownMods().Returns(["bf1942"]);
        _mapImageResolver.Resolve("bf1942", "wake", MapImageKind.Thumbnail).Returns("bf1942/wake.png");
        _mapImageResolver.Resolve(Arg.Any<string>(), "bg42_kursk", MapImageKind.Thumbnail).Returns((string?)null);
        _mapImageResolver.Resolve(Arg.Any<string>(), "bg42_berlin", MapImageKind.Thumbnail).Returns((string?)null);

        // Act: Group by mod with Status = "missing"
        var result = await _service.GetMapReportAsync(new MapReportRequest { GroupBy = "mod", Status = "missing" });

        // Assert
        Assert.NotNull(result.ModGroups);
        // bg42 is canonicalized from battlegroup42, and is uninstalled with 2 missing maps
        Assert.Single(result.ModGroups);
        var bg42Group = result.ModGroups[0];
        Assert.Equal("bg42", bg42Group.GameId);
        Assert.False(bg42Group.IsInstalled);
        Assert.Equal(2, bg42Group.TotalMaps);
        Assert.Equal(2, bg42Group.MissingMaps);
        Assert.Equal(150, bg42Group.TotalRounds);
        Assert.Equal(2, bg42Group.Maps.Count);
        Assert.Equal("bg42_kursk", bg42Group.Maps[0].MapName);
        Assert.Equal("bg42_berlin", bg42Group.Maps[1].MapName);
    }
}
