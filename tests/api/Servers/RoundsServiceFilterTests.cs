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
    public async Task GetRounds_DuplicateExactServerName_UsesLiveServerGuidOnly()
    {
        SeedServer("stale-guid", "*NEW* SiMPLE | BF1942", isOnline: false,
            lastSeenTime: new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), currentNumPlayers: 0);
        SeedServer("live-guid", "*NEW* SiMPLE | BF1942", isOnline: true,
            lastSeenTime: new DateTime(2026, 9, 10, 20, 0, 0, DateTimeKind.Utc), currentNumPlayers: 58);
        SeedRound("r-stale", "stale-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 10, 19, 0, 0, DateTimeKind.Utc));
        SeedRound("r-live", "live-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 10, 18, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { ServerName = "*NEW* SiMPLE | BF1942" });

        Assert.Equal(1, result.TotalItems);
        var round = Assert.Single(result.Items);
        Assert.Equal("r-live", round.RoundId);
        Assert.Equal("live-guid", round.ServerGuid);
    }

    [Fact]
    public async Task GetRounds_DuplicateExactServerName_BothOffline_UsesMostRecentlySeen()
    {
        SeedServer("older-guid", "*NEW* SiMPLE | BF1942", isOnline: false,
            lastSeenTime: new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc));
        SeedServer("newer-guid", "*NEW* SiMPLE | BF1942", isOnline: false,
            lastSeenTime: new DateTime(2026, 9, 10, 12, 0, 0, DateTimeKind.Utc));
        SeedRound("r-older", "older-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 10, 11, 0, 0, DateTimeKind.Utc));
        SeedRound("r-newer", "newer-guid", "*NEW* SiMPLE | BF1942", new DateTime(2026, 9, 10, 10, 0, 0, DateTimeKind.Utc));
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { ServerName = "*NEW* SiMPLE | BF1942" });

        Assert.Equal(1, result.TotalItems);
        Assert.Equal("r-newer", Assert.Single(result.Items).RoundId);
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

    [Fact]
    public async Task GetRounds_GlobalMinParticipants_ExcludesEmptyRoundsAndPagesByStartTime()
    {
        SeedServer("a-guid", "Alpha");
        SeedServer("b-guid", "Bravo");
        SeedRound("r-empty-new", "a-guid", "Alpha", new DateTime(2026, 10, 9, 23, 0, 0, DateTimeKind.Utc), participantCount: 0);
        SeedRound("r-live", "b-guid", "Bravo", new DateTime(2026, 10, 9, 22, 0, 0, DateTimeKind.Utc), participantCount: 12);
        SeedRound("r-empty-old", "a-guid", "Alpha", new DateTime(2026, 10, 9, 21, 0, 0, DateTimeKind.Utc), participantCount: 0);
        SeedRound("r-older", "a-guid", "Alpha", new DateTime(2026, 10, 9, 20, 0, 0, DateTimeKind.Utc), participantCount: 4);
        await _dbContext.SaveChangesAsync();

        var result = await _service.GetRounds(
            1, 25, "startTime", "desc",
            new RoundFilters { MinParticipants = 1 });

        Assert.Equal(2, result.TotalItems);
        Assert.Equal(new[] { "r-live", "r-older" }, result.Items.Select(r => r.RoundId).ToArray());
    }

    [Fact]
    public async Task GetRounds_GlobalMinParticipants_CountUsesParticipantCountIndex()
    {
        await UseListingStatisticsAsync();

        var steps = await PlanAsync(
            """SELECT COUNT(*) FROM "Rounds" AS "r" WHERE "r"."ParticipantCount" >= $min""",
            ("$min", 1));

        Assert.Contains(
            steps,
            step => step.Contains("IX_Rounds_ParticipantCount", StringComparison.Ordinal));
        Assert.DoesNotContain(steps, step => step.StartsWith("SCAN r", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GetRounds_DefaultSort_PageUsesStartTimeIndex()
    {
        await UseListingStatisticsAsync();

        var steps = await PlanAsync(
            """
            SELECT "r"."RoundId"
            FROM "Rounds" AS "r"
            WHERE "r"."ParticipantCount" >= $min
            ORDER BY "r"."StartTime" DESC
            LIMIT $take
            """,
            ("$min", 1), ("$take", 25));

        Assert.Contains(
            steps,
            step => step.Contains("IX_Rounds_StartTime", StringComparison.Ordinal));
        Assert.DoesNotContain(steps, step => step.Contains("USE TEMP B-TREE FOR ORDER BY", StringComparison.Ordinal));
    }

    private void SeedServer(
        string guid,
        string name,
        bool isOnline = true,
        DateTime? lastSeenTime = null,
        int currentNumPlayers = 0)
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = guid,
            Name = name,
            Game = "bf1942",
            GameId = "bf1942",
            Ip = "1.2.3.4",
            Port = 14567,
            IsOnline = isOnline,
            LastSeenTime = lastSeenTime ?? new DateTime(2026, 9, 1, 0, 0, 0, DateTimeKind.Utc),
            CurrentNumPlayers = currentNumPlayers
        });
    }

    private void SeedRound(
        string roundId,
        string serverGuid,
        string serverName,
        DateTime startTime,
        string mapName = "Wake",
        int participantCount = 16)
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
            ParticipantCount = participantCount,
            IsActive = false
        });
    }

    private async Task UseListingStatisticsAsync()
    {
        await _dbContext.Database.ExecuteSqlRawAsync("ANALYZE");
        await _dbContext.Database.ExecuteSqlRawAsync("DELETE FROM sqlite_stat1");
        await _dbContext.Database.ExecuteSqlRawAsync("""
            INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES
            ('Rounds', 'IX_Rounds_IsActive', '1345060 295'),
            ('Rounds', 'IX_Rounds_IsActive_SyncedToNeo4jAt_StartTime', '1345060 295 295 2'),
            ('Rounds', 'IX_Rounds_MapName', '1345060 24'),
            ('Rounds', 'IX_Rounds_ParticipantCount', '1345060 12'),
            ('Rounds', 'IX_Rounds_ServerGuid', '190 1'),
            ('Rounds', 'IX_Rounds_ServerGuid_EndTime', '1345060 48 1'),
            ('Rounds', 'IX_Rounds_ServerGuid_IsActive', '1345060 48 48'),
            ('Rounds', 'IX_Rounds_ServerGuid_StartTime', '1345060 48 1'),
            ('Rounds', 'IX_Rounds_StartTime', '1345060 1'),
            ('Rounds', 'sqlite_autoindex_Rounds_1', '1345060 1')
            """);
        await _dbContext.Database.ExecuteSqlRawAsync("ANALYZE sqlite_schema");
    }

    private async Task<List<string>> PlanAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var command = _connection.CreateCommand();
#pragma warning disable CA2100
        command.CommandText = "EXPLAIN QUERY PLAN " + sql;
#pragma warning restore CA2100
        foreach (var (name, value) in parameters)
            command.Parameters.AddWithValue(name, value);

        var steps = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
            steps.Add(reader.GetString(3));
        return steps;
    }
}
