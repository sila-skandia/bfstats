using api.Data.Entities;
using api.Gamification.Services;
using api.PlayerTracking;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using NodaTime;

namespace api.tests.Gamification;

public sealed class SqliteGamificationPagingFilterTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly SqliteGamificationService _service;
    private readonly List<string> _sql = [];

    public SqliteGamificationPagingFilterTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .LogTo(
                _sql.Add,
                [DbLoggerCategory.Database.Command.Name],
                LogLevel.Information)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();
        _service = new SqliteGamificationService(_dbContext, NullLogger<SqliteGamificationService>.Instance);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
    }

    [Fact]
    public async Task GetAllAchievementsWithPaging_PlayerAndId_UsesEqualityNotSubstring()
    {
        Seed("Dima", "kill_streak_20", Instant.FromUtc(2026, 9, 10, 2, 0));
        Seed("Dima", "kill_streak_5", Instant.FromUtc(2026, 9, 9, 2, 0));
        Seed("DimaXX", "kill_streak_20", Instant.FromUtc(2026, 9, 8, 2, 0));
        await _dbContext.SaveChangesAsync();
        _sql.Clear();

        var (items, total) = await _service.GetAllAchievementsWithPagingAsync(
            1, 25, "AchievedAt", "desc",
            playerName: "Dima",
            achievementId: "kill_streak_20");

        Assert.Equal(1, total);
        var achievement = Assert.Single(items);
        Assert.Equal("Dima", achievement.PlayerName);
        Assert.Equal("kill_streak_20", achievement.AchievementId);
        Assert.DoesNotContain(_sql, s => s.Contains("instr(", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(_sql, s => s.Contains("\"PlayerName\" = ", StringComparison.Ordinal));
        Assert.Contains(_sql, s => s.Contains("\"AchievementId\" = ", StringComparison.Ordinal));
    }

    [Fact]
    public async Task GetAllAchievementsWithPaging_PlayerOnly_DoesNotMatchNameSubstring()
    {
        Seed("Dima", "kill_streak_20", Instant.FromUtc(2026, 9, 10, 2, 0));
        Seed("DimaXX", "kill_streak_10", Instant.FromUtc(2026, 9, 9, 2, 0));
        await _dbContext.SaveChangesAsync();
        _sql.Clear();

        var (items, total) = await _service.GetAllAchievementsWithPagingAsync(
            1, 25, "AchievedAt", "desc",
            playerName: "Dima");

        Assert.Equal(1, total);
        Assert.Equal("Dima", Assert.Single(items).PlayerName);
        Assert.DoesNotContain(_sql, s => s.Contains("instr(", StringComparison.OrdinalIgnoreCase));
    }

    private void Seed(string playerName, string achievementId, Instant achievedAt)
    {
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementId = achievementId,
            AchievementType = "kill_streak",
            AchievementName = achievementId,
            AchievedAt = achievedAt,
            ProcessedAt = achievedAt,
            Version = achievedAt,
            ServerGuid = "test-guid",
            MapName = "Wake",
            RoundId = $"r-{playerName}-{achievementId}"
        });
    }
}
