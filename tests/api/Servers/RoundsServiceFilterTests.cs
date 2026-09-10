using api.PlayerTracking;
using api.Servers;
using api.Servers.Models;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.Servers;

public sealed class RoundsServiceFilterTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly RoundsService _service;

    public RoundsServiceFilterTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();
        _service = new RoundsService(_dbContext, NullLogger<RoundsService>.Instance);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task GetRounds_FiltersByResolvedServerGuid_NotSubstringOnRoundsName()
    {
        SeedServer("moon-guid", "MoonGamers.com | Est. 2004");
        SeedServer("simple-guid", "*NEW* SiMPLE | BF1942");
        SeedRound("r-moon", "moon-guid", "MoonGamers.com | Est. 2004", new DateTime(2026, 9, 6, 9, 0, 0, DateTimeKind.Utc));
        SeedRound("r-simple", "simple-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc));
        SeedRound("r-stale-name", "simple-guid", "Moon", new DateTime(2026, 9, 6, 7, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { ServerName = "MoonGamers.com | Est. 2004" });

        Assert.Equal(1, result.TotalItems);
        var round = Assert.Single(result.Items);
        Assert.Equal("r-moon", round.RoundId);
    }

    [Fact]
    public async Task GetRounds_PartialServerName_MatchesCurrentServersThenGuids()
    {
        SeedServer("moon-guid", "MoonGamers.com | Est. 2004");
        SeedServer("other-guid", "Kyiv Server");
        SeedRound("r-moon", "moon-guid", "MoonGamers.com | Est. 2004", new DateTime(2026, 9, 6, 9, 0, 0, DateTimeKind.Utc));
        SeedRound("r-other", "other-guid", "Kyiv Server", new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { ServerName = "MoonGamers" });

        Assert.Equal(1, result.TotalItems);
        Assert.Equal("r-moon", result.Items[0].RoundId);
    }

    [Fact]
    public async Task GetRounds_UnknownServerName_ReturnsEmptyWithoutScanningRoundNames()
    {
        SeedServer("other-guid", "Kyiv Server");
        SeedRound("r-other", "other-guid", "Kyiv Server", new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc));
        SeedRound("r-orphan", "other-guid", "Some substring MoonGamers leftover", new DateTime(2026, 9, 6, 7, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { ServerName = "MoonGamers.com | Est. 2004" });

        Assert.Equal(0, result.TotalItems);
        Assert.Empty(result.Items);
    }

    [Fact]
    public async Task GetRounds_ServerGuid_TakesPrecedenceOverServerName()
    {
        SeedServer("moon-guid", "MoonGamers.com | Est. 2004");
        SeedServer("simple-guid", "*NEW* SiMPLE | BF1942");
        SeedRound("r-moon", "moon-guid", "MoonGamers.com | Est. 2004", new DateTime(2026, 9, 6, 9, 0, 0, DateTimeKind.Utc));
        SeedRound("r-simple", "simple-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters
            {
                ServerName = "MoonGamers.com | Est. 2004",
                ServerGuid = "simple-guid"
            });

        Assert.Equal(1, result.TotalItems);
        Assert.Equal("r-simple", result.Items[0].RoundId);
    }

    [Fact]
    public async Task GetRounds_ExactServerName_DoesNotIncludeSubstringOtherServers()
    {
        SeedServer("simple-guid", "*NEW* SiMPLE | BF1942");
        SeedServer("rtr-guid", "*NEW* SiMPLE | BF1942 RtR+SW");
        SeedRound("r-simple", "simple-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 6, 9, 0, 0, DateTimeKind.Utc));
        SeedRound("r-rtr", "rtr-guid", "*NEW* SiMPLE | BF1942 RtR+SW", new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { ServerName = "*NEW* SiMPLE | BF1942" });

        Assert.Equal(1, result.TotalItems);
        Assert.Equal("r-simple", Assert.Single(result.Items).RoundId);
    }

    [Fact]
    public async Task GetRounds_FiltersByExactMapName_NotSubstring()
    {
        SeedServer("simple-guid", "*NEW* SiMPLE | BF1942");
        SeedRound("r-britain", "simple-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 6, 9, 0, 0, DateTimeKind.Utc), "battle of britain");
        SeedRound("r-berlin", "simple-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 6, 8, 0, 0, DateTimeKind.Utc), "Battle of Berlin");
        SeedRound("r-wake", "simple-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 6, 7, 0, 0, DateTimeKind.Utc), "Wake Island");
        await _dbContext.SaveChangesAsync();

        var exact = await _service.GetRounds(
            1, 5, "startTime", "desc",
            new RoundFilters { ServerGuid = "simple-guid", MapName = "battle of britain" });

        Assert.Equal(1, exact.TotalItems);
        Assert.Equal("r-britain", Assert.Single(exact.Items).RoundId);

        var substring = await _service.GetRounds(
            1, 5, "startTime", "desc",
            new RoundFilters { ServerGuid = "simple-guid", MapName = "britain" });

        Assert.Equal(0, substring.TotalItems);
        Assert.Empty(substring.Items);
    }

    [Fact]
    public async Task GetRounds_PopulatesGameIdFromGameServer()
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = "fhsw-guid",
            Name = "FHSW European Server",
            Game = "bf1942",
            GameId = "fhsw",
            Ip = "1.2.3.4",
            Port = 14567
        });
        SeedRound("r-fhsw", "fhsw-guid", "FHSW European Server", new DateTime(2026, 9, 6, 12, 0, 0, DateTimeKind.Utc), "operation_coronet");
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 5, "startTime", "desc",
            new RoundFilters { ServerGuid = "fhsw-guid" });

        var round = Assert.Single(result.Items);
        Assert.Equal("r-fhsw", round.RoundId);
        Assert.Equal("fhsw", round.GameId);
        Assert.Equal("operation_coronet", round.MapName);
    }

    private void SeedServer(string guid, string name)
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = name,
            Game = "bf1942",
            GameId = "bf1942",
            Ip = "1.2.3.4",
            Port = 14567
        });
    }

    private void SeedRound(string roundId, string serverGuid, string serverName, DateTime startTime, string mapName = "Wake")
    {
        _dbContext.Rounds.Add(new Round
        {
            RoundId = roundId,
            ServerGuid = serverGuid,
            ServerName = serverName,
            MapName = mapName,
            GameType = "conquest",
            StartTime = startTime,
            EndTime = startTime.AddMinutes(20),
            DurationMinutes = 20,
            ParticipantCount = 16,
            IsActive = false
        });
    }
}
