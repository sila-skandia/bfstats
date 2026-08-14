using api.Data.Entities;
using api.PlayerStats;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace api.tests;

public sealed class SqlitePlayerStatsServiceTests : IDisposable
{
    private readonly SqliteConnection connection;
    private readonly PlayerTrackerDbContext dbContext;

    public SqlitePlayerStatsServiceTests()
    {
        connection = new SqliteConnection("Filename=:memory:");
        connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(connection)
            .Options;

        dbContext = new PlayerTrackerDbContext(options);
        dbContext.Database.EnsureCreated();
    }

    [Fact]
    public async Task GetPlayerBestScoresAsync_ReturnsOlderAllTimeScores()
    {
        dbContext.Servers.Add(new GameServer
        {
            Guid = "server-1",
            Name = "Test Server"
        });

        dbContext.PlayerBestScores.AddRange(
            CreateBestScore("all_time", rank: 1, score: 100, Instant.FromUtc(2025, 1, 1, 0, 0)),
            CreateBestScore("all_time", rank: 2, score: 90, Instant.FromUtc(2025, 2, 1, 0, 0)),
            CreateBestScore("all_time", rank: 3, score: 80, Instant.FromUtc(2025, 3, 1, 0, 0)),
            CreateBestScore("this_week", rank: 1, score: 70, SystemClock.Instance.GetCurrentInstant()));
        await dbContext.SaveChangesAsync();

        var service = new SqlitePlayerStatsService(dbContext);

        var result = await service.GetPlayerBestScoresAsync("Player");

        Assert.Equal([100, 90, 80], result.AllTime.Select(score => score.Score));
        Assert.Equal([70], result.ThisWeek.Select(score => score.Score));
    }

    public void Dispose()
    {
        dbContext.Dispose();
        connection.Dispose();
    }

    private static PlayerBestScore CreateBestScore(string period, int rank, int score, Instant roundEndTime)
    {
        return new PlayerBestScore
        {
            PlayerName = "Player",
            Period = period,
            Rank = rank,
            FinalScore = score,
            FinalKills = score,
            FinalDeaths = 1,
            MapName = "test map",
            ServerGuid = "server-1",
            RoundEndTime = roundEndTime,
            RoundId = $"{period}-{rank}"
        };
    }
}
