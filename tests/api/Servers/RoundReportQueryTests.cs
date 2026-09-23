using api.Gamification.Services;
using api.PlayerTracking;
using api.Servers;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace api.tests.Servers;

public sealed class RoundReportQueryTests : IDisposable
{
    private static readonly DateTime RoundStart = new(2025, 9, 3, 18, 0, 0, DateTimeKind.Utc);

    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly RoundsService _service;
    private readonly SqliteGamificationService _gamification;

    public RoundReportQueryTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();
        _service = new RoundsService(_dbContext, NullLogger<RoundsService>.Instance);
        _gamification = new SqliteGamificationService(_dbContext, NullLogger<SqliteGamificationService>.Instance);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public void CapSnapshotEnd_UsesRoundEnd_WhenUnderTheCap()
    {
        var end = RoundStart.AddMinutes(45);

        Assert.Equal(end, RoundsService.CapSnapshotEnd(RoundStart, end));
    }

    [Fact]
    public void CapSnapshotEnd_ClampsRunawayEndTimes()
    {
        var end = RoundStart.AddDays(280);
        var expected = RoundStart.AddMinutes(RoundsService.MaxSnapshotMinutes);

        Assert.Equal(expected, RoundsService.CapSnapshotEnd(RoundStart, end));
    }

    [Fact]
    public async Task GetRoundReport_ReturnsNull_WhenRoundIsMissing()
    {
        var report = await _service.GetRoundReport("missing", _gamification);

        Assert.Null(report);
    }

    [Fact]
    public async Task GetRoundReport_IncludesOnlyObservationsInsideTheSnapshotWindow()
    {
        SeedServer();
        SeedRound(endTime: RoundStart.AddMinutes(40), participantCount: 1);
        SeedPlayer("alice");
        var session = SeedSession("alice", RoundStart, RoundStart.AddMinutes(40));
        SeedObservation(session, RoundStart.AddMinutes(1), score: 10);
        SeedObservation(session, RoundStart.AddMinutes(20), score: 25);
        await _dbContext.SaveChangesAsync();

        var report = await _service.GetRoundReport("zombie", _gamification);

        Assert.NotNull(report);
        Assert.Equal("Wake Island", report.Round.MapName);
        Assert.Equal("bf1942", report.Round.GameId);
        Assert.Equal(1, report.Round.TotalParticipants);
        Assert.Contains(report.LeaderboardSnapshots, s => s.Entries.Any(e => e.PlayerName == "alice" && e.Score == 25));
    }

    [Fact]
    public async Task GetRoundReport_IgnoresLeftoverSessionsFromAStaleActiveOrphan()
    {
        // Same shape as dc6659fb35e806ac8a9a: the round was closed to Start+60min,
        // but months of later sessions still carry that RoundId.
        SeedServer();
        SeedRound(endTime: RoundStart.AddMinutes(60), participantCount: 1);
        SeedPlayer("alice");
        SeedPlayer("latecomer");

        var original = SeedSession("alice", RoundStart, RoundStart.AddMinutes(50));
        SeedObservation(original, RoundStart.AddMinutes(5), score: 12);

        var leftover = SeedSession("latecomer", RoundStart.AddDays(200), RoundStart.AddDays(200).AddMinutes(30));
        SeedObservation(leftover, RoundStart.AddDays(200).AddMinutes(2), score: 999);
        await _dbContext.SaveChangesAsync();

        var report = await _service.GetRoundReport("zombie", _gamification);

        Assert.NotNull(report);
        Assert.All(report.LeaderboardSnapshots, snapshot =>
            Assert.DoesNotContain(snapshot.Entries, e => e.PlayerName == "latecomer"));
        Assert.Contains(report.LeaderboardSnapshots, s => s.Entries.Any(e => e.PlayerName == "alice"));
    }

    [Fact]
    public async Task GetRoundReport_DropsObservationsPastTheTimelineCap()
    {
        SeedServer();
        SeedRound(endTime: RoundStart.AddDays(10), participantCount: 1);
        SeedPlayer("alice");
        var session = SeedSession("alice", RoundStart, RoundStart.AddDays(10));
        SeedObservation(session, RoundStart.AddMinutes(3), score: 8);
        SeedObservation(session, RoundStart.AddMinutes(RoundsService.MaxSnapshotMinutes + 15), score: 80);
        await _dbContext.SaveChangesAsync();

        var report = await _service.GetRoundReport("zombie", _gamification);

        Assert.NotNull(report);
        Assert.DoesNotContain(
            report.LeaderboardSnapshots.SelectMany(s => s.Entries),
            e => e.Score == 80);
        Assert.Contains(
            report.LeaderboardSnapshots.SelectMany(s => s.Entries),
            e => e.PlayerName == "alice" && e.Score == 8);
    }

    private void SeedServer()
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = "simple-guid",
            Name = "*NEW* SiMPLE | Tanks a lot!",
            Game = "bf1942",
            GameId = "bf1942",
            Ip = "1.2.3.4",
            Port = 14567
        });
    }

    private void SeedRound(DateTime endTime, int? participantCount)
    {
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "zombie",
            ServerGuid = "simple-guid",
            ServerName = "*NEW* SiMPLE | Tanks a lot!",
            MapName = "Wake Island",
            GameType = "conquest",
            StartTime = RoundStart,
            EndTime = endTime,
            DurationMinutes = (int)(endTime - RoundStart).TotalMinutes,
            ParticipantCount = participantCount,
            IsActive = false
        });
    }

    private void SeedPlayer(string name)
    {
        _dbContext.Players.Add(new Player { Name = name });
    }

    private PlayerSession SeedSession(string playerName, DateTime start, DateTime lastSeen)
    {
        var session = new PlayerSession
        {
            PlayerName = playerName,
            ServerGuid = "simple-guid",
            RoundId = "zombie",
            StartTime = start,
            LastSeenTime = lastSeen,
            MapName = "Wake Island",
            GameType = "conquest",
            IsActive = false
        };
        _dbContext.PlayerSessions.Add(session);
        return session;
    }

    private void SeedObservation(PlayerSession session, DateTime timestamp, int score)
    {
        session.Observations.Add(new PlayerObservation
        {
            Timestamp = timestamp,
            Score = score,
            Kills = score / 2,
            Deaths = 0,
            Ping = 20,
            Team = 1,
            TeamLabel = "Axis"
        });
    }
}
