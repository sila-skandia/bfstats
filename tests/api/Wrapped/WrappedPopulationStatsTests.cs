using api.Data.Entities;
using api.PlayerTracking;
using api.Wrapped;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace api.tests.Wrapped;

/// <summary>
/// Covers the shared population snapshot that Wrapped ranks and percentiles are read from.
/// Getting these cohorts or comparisons wrong would silently shift every player's numbers, so
/// they're pinned here rather than only exercised end-to-end.
/// </summary>
public class WrappedPopulationStatsTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;

    public WrappedPopulationStatsTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Close();
    }

    [Fact]
    public void CountGreater_TreatsTiesAsNotBeaten_SoRanksAreCompetitionRanks()
    {
        int[] scores = [10, 20, 20, 30];

        Assert.Equal(0, WrappedPopulationStats.CountGreater(scores, 30));
        Assert.Equal(1, WrappedPopulationStats.CountGreater(scores, 20));
        Assert.Equal(3, WrappedPopulationStats.CountGreater(scores, 10));
        Assert.Equal(4, WrappedPopulationStats.CountGreater(scores, 0));
    }

    [Fact]
    public void CountLess_ExcludesTies()
    {
        int[] scores = [10, 20, 20, 30];

        Assert.Equal(0, WrappedPopulationStats.CountLess(scores, 10));
        Assert.Equal(1, WrappedPopulationStats.CountLess(scores, 20));
        Assert.Equal(3, WrappedPopulationStats.CountLess(scores, 30));
        Assert.Equal(4, WrappedPopulationStats.CountLess(scores, 31));
    }

    [Fact]
    public void Percentile_IsZeroForAnEmptyCohort()
    {
        Assert.Equal(0.0, WrappedPopulationStats.Percentile(Array.Empty<int>(), 5, 0));
    }

    [Fact]
    public async Task Build_AppliesTheRoundsAndKillsCohortFilters()
    {
        // Eligible for the rounds/kills/playtime cohort (>= 5 rounds) and for K/D (>= 20 kills).
        AddMonthly("Veteran", rounds: 40, kills: 200, deaths: 50, playTime: 600);
        // Eligible for the first cohort only - too few kills for K/D.
        AddMonthly("Casual", rounds: 10, kills: 5, deaths: 5, playTime: 60);
        // Below the rounds floor, so out of every cohort.
        AddMonthly("Tourist", rounds: 2, kills: 40, deaths: 1, playTime: 20);
        await _dbContext.SaveChangesAsync();

        var stats = await WrappedPopulationStatsBuilder.BuildAsync(_dbContext, 2026);

        // Ranks are drawn from every player, cohorts only from qualifying ones.
        Assert.Equal(3, stats.GlobalKillsAsc.Length);
        Assert.Equal(2, stats.EligiblePlayerCount);
        Assert.Equal(1, stats.KdEligiblePlayerCount);
        Assert.Equal([10, 40], stats.EligibleRoundsAsc);
        Assert.Equal([4.0], stats.EligibleKdAsc); // 200 / 50
    }

    [Fact]
    public async Task Build_SumsAcrossMonthsBeforeRanking()
    {
        AddMonthly("Split", month: 1, rounds: 3, kills: 10, deaths: 4, playTime: 30);
        AddMonthly("Split", month: 2, rounds: 4, kills: 15, deaths: 6, playTime: 40);
        await _dbContext.SaveChangesAsync();

        var stats = await WrappedPopulationStatsBuilder.BuildAsync(_dbContext, 2026);

        // 3 + 4 rounds clears the >= 5 floor even though neither month does alone.
        Assert.Equal([7], stats.EligibleRoundsAsc);
        Assert.Equal([25], stats.GlobalKillsAsc);
    }

    [Fact]
    public async Task Build_IgnoresOtherYears()
    {
        AddMonthly("ThisYear", rounds: 10, kills: 30, deaths: 10, playTime: 100);
        AddMonthly("LastYear", year: 2025, rounds: 99, kills: 999, deaths: 10, playTime: 900);
        await _dbContext.SaveChangesAsync();

        var stats = await WrappedPopulationStatsBuilder.BuildAsync(_dbContext, 2026);

        Assert.Equal([30], stats.GlobalKillsAsc);
    }

    [Fact]
    public async Task Build_TalliesRoundPlacementsGloballyAndPerServer()
    {
        AddAchievement("Ace", "round_placement", "round_placement_1", serverGuid: "server-a");
        AddAchievement("Ace", "round_placement", "round_placement_2", serverGuid: "server-a");
        AddAchievement("Ace", "round_placement", "round_placement_3", serverGuid: "server-b");
        AddAchievement("Rookie", "round_placement", "round_placement_1", serverGuid: "server-a");
        // Out of year, and so out of every tally.
        AddAchievement("Ace", "round_placement", "round_placement_1", serverGuid: "server-a", year: 2025);
        await _dbContext.SaveChangesAsync();

        var stats = await WrappedPopulationStatsBuilder.BuildAsync(_dbContext, 2026);

        Assert.Equal(3, stats.PlayerPlacementTotals["Ace"]);
        Assert.Equal(1, stats.PlayerPlacementTotals["Rookie"]);
        Assert.Equal(2, stats.PlayerPlacementsByServer[WrappedPopulationStats.ServerPlayerKey("server-a", "Ace")]);
        Assert.Equal([1, 3], stats.GlobalPlacementCountsAsc);
        Assert.Equal([1, 2], stats.ServerPlacementCountsAsc["server-a"]);
    }

    [Fact]
    public async Task Build_PrefersTheActualStreakFromMetadataOverTheAchievementTier()
    {
        // The id only records the tier crossed; the real streak lives in the metadata.
        AddAchievement("Sniper", "kill_streak", "kill_streak_25", metadata: "{\"actual_streak\": 31}");
        AddAchievement("Gunner", "kill_streak", "kill_streak_10");
        AddAchievement("Broken", "kill_streak", "kill_streak_5", metadata: "not json");
        await _dbContext.SaveChangesAsync();

        var stats = await WrappedPopulationStatsBuilder.BuildAsync(_dbContext, 2026);

        // Malformed metadata falls back to the tier value rather than throwing.
        Assert.Equal([5, 10, 31], stats.GlobalStreakValuesAsc);
    }

    [Fact]
    public async Task Build_KeepsServerRankingScoresPerServer()
    {
        // ServerPlayerRankings has FKs to both Servers and Players.
        _dbContext.Servers.Add(new GameServer { Guid = "server-a", Name = "Server A", GameId = "bf1942" });
        _dbContext.Servers.Add(new GameServer { Guid = "server-b", Name = "Server B", GameId = "bf1942" });
        _dbContext.Players.Add(new Player { Name = "Ace", FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });
        _dbContext.Players.Add(new Player { Name = "Rookie", FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });

        AddRanking("server-a", "Ace", 500);
        AddRanking("server-a", "Ace", 300); // second month, summed
        AddRanking("server-a", "Rookie", 100);
        AddRanking("server-b", "Ace", 50);
        await _dbContext.SaveChangesAsync();

        var stats = await WrappedPopulationStatsBuilder.BuildAsync(_dbContext, 2026);

        Assert.Equal([100, 800], stats.RankingScoresAsc["server-a"]);
        Assert.Equal([50], stats.RankingScoresAsc["server-b"]);
    }

    private void AddMonthly(string playerName, int rounds, int kills, int deaths, double playTime, int month = 6, int year = 2026)
    {
        _dbContext.PlayerStatsMonthly.Add(new PlayerStatsMonthly
        {
            PlayerName = playerName,
            Year = year,
            Month = month,
            TotalRounds = rounds,
            TotalKills = kills,
            TotalDeaths = deaths,
            TotalScore = kills * 10,
            TotalPlayTimeMinutes = playTime
        });
    }

    private void AddAchievement(
        string playerName,
        string achievementType,
        string achievementId,
        string serverGuid = "server-a",
        string? metadata = null,
        int year = 2026)
    {
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementType = achievementType,
            AchievementId = achievementId,
            AchievementName = achievementId,
            Tier = "bronze",
            Value = 1,
            AchievedAt = Instant.FromUtc(year, 6, 1, 12, 0),
            ProcessedAt = Instant.FromUtc(year, 6, 1, 12, 0),
            ServerGuid = serverGuid,
            MapName = "El Alamein",
            RoundId = $"round-{Guid.NewGuid():N}",
            Metadata = metadata,
            Game = "bf1942"
        });
    }

    private void AddRanking(string serverGuid, string playerName, int totalScore)
    {
        _dbContext.ServerPlayerRankings.Add(new ServerPlayerRanking
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            Year = 2026,
            Month = _dbContext.ServerPlayerRankings.Local.Count(r => r.ServerGuid == serverGuid && r.PlayerName == playerName) + 1,
            Rank = 1,
            TotalScore = totalScore
        });
    }
}
