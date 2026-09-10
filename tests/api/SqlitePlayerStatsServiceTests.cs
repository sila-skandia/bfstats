using api.Analytics.Models;
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

    [Theory]
    [InlineData("xpack1", "baytown", "xpack1")]
    [InlineData("bf1942", "baytown", "xpack1")]
    [InlineData("bf1942", "cassino", "xpack1")]
    [InlineData("bf1942", "eagles_nest", "xpack2")]
    [InlineData("bf1942", "dc_desertshield", "dc_final")]
    [InlineData("dc_final", "el_alamein", "dc_final")]
    [InlineData("fhsweurope", "wake", "fhsw")]
    [InlineData("bf1942", "wake", "bf1942")]
    public void CanonicalizeMod_ResolvesCorrectMod(string serverMod, string map, string expectedMod)
    {
        Assert.Equal(expectedMod, SqlitePlayerStatsService.CanonicalizeMod(serverMod, map));
    }

    [Fact]
    public async Task GetPlayerMapStatsAsync_StitchesModAndSplitsByMod()
    {
        dbContext.Servers.AddRange(
            new GameServer { Guid = "vanilla-srv", Name = "Vanilla Server", GameId = "bf1942" },
            new GameServer { Guid = "dc-srv", Name = "DC Server", GameId = "dc_final" }
        );

        var year = DateTime.UtcNow.Year;
        var month = DateTime.UtcNow.Month;
        var now = Instant.FromUtc(year, month, 1, 0, 0);

        dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "TestPilot",
                MapName = "el alamein",
                ServerGuid = "vanilla-srv",
                Year = year,
                Month = month,
                TotalKills = 25,
                TotalDeaths = 10,
                TotalScore = 200,
                TotalRounds = 3,
                TotalPlayTimeMinutes = 45,
                UpdatedAt = now
            },
            new PlayerMapStats
            {
                PlayerName = "TestPilot",
                MapName = "el alamein",
                ServerGuid = "dc-srv",
                Year = year,
                Month = month,
                TotalKills = 40,
                TotalDeaths = 15,
                TotalScore = 350,
                TotalRounds = 4,
                TotalPlayTimeMinutes = 60,
                UpdatedAt = now
            },
            new PlayerMapStats
            {
                PlayerName = "TestPilot",
                MapName = "baytown",
                ServerGuid = "vanilla-srv",
                Year = year,
                Month = month,
                TotalKills = 15,
                TotalDeaths = 5,
                TotalScore = 120,
                TotalRounds = 2,
                TotalPlayTimeMinutes = 30,
                UpdatedAt = now
            },
            new PlayerMapStats
            {
                PlayerName = "TestPilot",
                MapName = "dc desertshield",
                ServerGuid = "dc-srv",
                Year = year,
                Month = month,
                TotalKills = 50,
                TotalDeaths = 20,
                TotalScore = 400,
                TotalRounds = 5,
                TotalPlayTimeMinutes = 75,
                UpdatedAt = now
            }
        );
        await dbContext.SaveChangesAsync();

        var service = new SqlitePlayerStatsService(dbContext);
        var stats = await service.GetPlayerMapStatsAsync("TestPilot", TimePeriod.ThisYear);

        Assert.Equal(4, stats.Count);

        var dcDesert = stats.First(s => s.MapName == "dc desertshield");
        Assert.Equal("dc_final", dcDesert.GameId);
        Assert.Equal(50, dcDesert.TotalKills);

        var baytown = stats.First(s => s.MapName == "baytown");
        Assert.Equal("xpack1", baytown.GameId);
        Assert.Equal(15, baytown.TotalKills);

        var elAlameinDC = stats.First(s => s.MapName == "el alamein" && s.GameId == "dc_final");
        Assert.Equal(40, elAlameinDC.TotalKills);

        var elAlameinVanilla = stats.First(s => s.MapName == "el alamein" && s.GameId == "bf1942");
        Assert.Equal(25, elAlameinVanilla.TotalKills);
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
