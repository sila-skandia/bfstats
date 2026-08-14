using api.Data.Entities;
using api.PlayerTracking;
using api.Wrapped;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using NodaTime;
using NSubstitute;
using System.Diagnostics;
using System.Text;

namespace api.tests.Wrapped;

public class WrappedServiceTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly ILogger<WrappedService> _logger;
    private readonly WrappedService _service;
    private readonly IConfiguration _configuration;
    private readonly IServiceProvider _serviceProvider;

    /// <summary>
    /// A second service over the same database. The per-player memos live on the service
    /// instance, so this is how a test observes a freshly computed result rather than a memo hit.
    /// </summary>
    private WrappedService NewService() => new(_dbContext, _configuration, _serviceProvider, _logger);

    public WrappedServiceTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        
        // Enable foreign key constraints in in-memory Sqlite
        using (var command = _connection.CreateCommand())
        {
            command.CommandText = "PRAGMA foreign_keys = ON;";
            command.ExecuteNonQuery();
        }
        
        _dbContext.Database.EnsureCreated();

        var inMemorySettings = new Dictionary<string, string?>
        {
            {"ServerWrapped:AllowedGuids:0", "test-server-guid"},
            {"ServerWrapped:AllowedGuids:1", "cached-server-guid"}
        };

        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(inMemorySettings)
            .Build();

        var relationshipService = Substitute.For<api.PlayerRelationships.IPlayerRelationshipService>();
        var serviceProvider = Substitute.For<IServiceProvider>();
        serviceProvider.GetService(typeof(api.PlayerRelationships.IPlayerRelationshipService)).Returns(relationshipService);
        _logger = Substitute.For<ILogger<WrappedService>>();
        _configuration = configuration;
        _serviceProvider = serviceProvider;
        _service = new WrappedService(_dbContext, configuration, serviceProvider, _logger);
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Close();
    }

    [Fact]
    public async Task GetServerWrappedAsync_CalculatesAndCaches_OnCacheMiss()
    {
        // Register CodePages encoding provider
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var cp1252 = Encoding.GetEncoding(1252);
        var cp1251 = Encoding.GetEncoding(1251);

        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer
        {
            Guid = serverGuid,
            Name = "Test Server Est. 2004",
            Ip = "127.0.0.1",
            Port = 14567,
            GameId = "bf1942",
            Timezone = "UTC"
        };
        _dbContext.Servers.Add(server);

        // Synthesize an encoded name matching PlayerNameDecoder's CP1252/CP1251 expectations
        var rawBytes = new byte[] { 208, 209, 210 }; // "РСТ" in CP1251
        var playerName = cp1252.GetString(rawBytes);

        var player = new Player
        {
            Name = playerName,
            FirstSeen = new DateTime(2025, 1, 1),
            LastSeen = new DateTime(2026, 12, 31)
        };
        _dbContext.Players.Add(player);

        // Add a round in 2026
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "round-1",
            ServerGuid = serverGuid,
            ServerName = "Test Server Est. 2004",
            MapName = "El Alamein",
            GameType = "Conquest",
            StartTime = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc),
            EndTime = new DateTime(2026, 6, 1, 12, 30, 0, DateTimeKind.Utc),
            ParticipantCount = 64,
            Tickets1 = 10,
            Tickets2 = 0,
            IsDeleted = false
        });

        // Add a player session in 2026
        _dbContext.PlayerSessions.Add(new PlayerSession
        {
            SessionId = 1,
            ServerGuid = serverGuid,
            PlayerName = playerName,
            StartTime = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc),
            LastSeenTime = new DateTime(2026, 6, 1, 12, 30, 0, DateTimeKind.Utc),
            IsDeleted = false
        });

        // Add some player server stats for 2026
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            Year = 2026,
            Week = 23,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(serverGuid, result.ServerGuid);
        Assert.Equal("Test Server Est. 2004", result.ServerName);
        Assert.Equal(1, result.YearInNumbers.RoundsFought);
        Assert.Equal(1, result.YearInNumbers.UniqueSoldiers);
        Assert.Equal(2.5, result.YearInNumbers.HoursInCombat); // 150 mins / 60

        // Verify player name is decoded correctly
        var expectedName = cp1251.GetString(rawBytes);
        Assert.Equal(expectedName, result.Honours.VolumeBoards.TopScore.PlayerName);

        // Verify cache record is created in database
        var cached = await _dbContext.ServerWrappedCaches.FirstOrDefaultAsync(c => c.ServerGuid == serverGuid && c.Year == 2026);
        Assert.NotNull(cached);
        Assert.Contains("test-server-guid", cached.JsonData);
    }

    [Fact]
    public async Task GetServerWrappedAsync_FiltersOutCtfAndTieRounds()
    {
        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" };
        _dbContext.Servers.Add(server);

        // Add 3 rounds in 2026:
        // Round 1: Conquest, margin = 2 (valid)
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "r-conquest-valid", ServerGuid = serverGuid, MapName = "Map A", GameType = "Conquest",
            StartTime = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc), Tickets1 = 10, Tickets2 = 8, ParticipantCount = 64
        });
        // Round 2: CTF, margin = 1 (invalid)
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "r-ctf-invalid", ServerGuid = serverGuid, MapName = "Map B", GameType = "CTF",
            StartTime = new DateTime(2026, 6, 1, 13, 0, 0, DateTimeKind.Utc), Tickets1 = 5, Tickets2 = 4, ParticipantCount = 64
        });
        // Round 3: Conquest, margin = 0 (invalid tie)
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "r-tie-invalid", ServerGuid = serverGuid, MapName = "Map C", GameType = "Conquest",
            StartTime = new DateTime(2026, 6, 1, 14, 0, 0, DateTimeKind.Utc), Tickets1 = 10, Tickets2 = 10, ParticipantCount = 64
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        // Should only have 1 closest battle (Round 1)
        Assert.Single(result.ClosestBattles);
        Assert.Equal("Map A", result.ClosestBattles[0].MapName);
        Assert.Equal(2, result.ClosestBattles[0].TicketsMargin);
    }

    [Fact]
    public async Task GetServerWrappedAsync_PopulatesPrestigiousMilestone()
    {
        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" };
        _dbContext.Servers.Add(server);

        // Add two milestone achievements achieved in 2026:
        // 1. total_kills_100 (Centurion, lower prestige)
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            ServerGuid = serverGuid, PlayerName = "SgtPepper", AchievementId = "total_kills_100",
            AchievementType = "milestone", AchievedAt = Instant.FromUtc(2026, 5, 1, 12, 0)
        });
        // 2. total_kills_50000 (God of War, higher prestige)
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            ServerGuid = serverGuid, PlayerName = "SgtPepper", AchievementId = "total_kills_50000",
            AchievementType = "milestone", AchievedAt = Instant.FromUtc(2026, 6, 1, 12, 0)
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.Decorations.MilestonesCrossed);
        Assert.NotNull(result.Decorations.PrestigiousMilestone);
        Assert.Equal("total_kills_50000", result.Decorations.PrestigiousMilestone.AchievementId);
        Assert.Equal("SgtPepper", result.Decorations.PrestigiousMilestone.PlayerName);
        Assert.Equal("God of War (50,000 Kills)", result.Decorations.PrestigiousMilestone.AchievementName);
    }

    [Fact]
    public async Task GetServerWrappedAsync_ReturnsCachedData_OnCacheHit()
    {
        // Arrange
        var serverGuid = "cached-server-guid";
        var cacheJson = "{\"serverGuid\":\"cached-server-guid\",\"serverName\":\"Cached Server\",\"year\":2026,\"yearInNumbers\":{\"roundsFought\":42}}";
        
        _dbContext.ServerWrappedCaches.Add(new ServerWrappedCache
        {
            ServerGuid = serverGuid,
            Year = 2026,
            JsonData = cacheJson,
            CalculatedAt = Instant.FromUtc(2026, 7, 9, 0, 0)
        });
        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetServerWrappedAsync(serverGuid, 2026);
        
        // Assert
        Assert.NotNull(result);
        Assert.Equal(serverGuid, result.ServerGuid);
        Assert.Equal("Cached Server", result.ServerName);
        Assert.Equal(42, result.YearInNumbers.RoundsFought);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_CalculatesAndCaches_OnCacheMiss_Global()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
        var cp1252 = Encoding.GetEncoding(1252);
        var cp1251 = Encoding.GetEncoding(1251);

        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer
        {
            Guid = serverGuid,
            Name = "Test Server",
            Ip = "127.0.0.1",
            Port = 14567,
            GameId = "bf1942",
            Timezone = "UTC"
        };
        _dbContext.Servers.Add(server);

        var rawBytes = new byte[] { 208, 209, 210 };
        var playerName = cp1252.GetString(rawBytes);

        var player = new Player
        {
            Name = playerName,
            FirstSeen = new DateTime(2025, 1, 1),
            LastSeen = new DateTime(2026, 12, 31)
        };
        _dbContext.Players.Add(player);

        // Seed stats
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            Year = 2026,
            Week = 23,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        // Add monthly stats for trend
        _dbContext.PlayerStatsMonthly.Add(new PlayerStatsMonthly
        {
            PlayerName = playerName,
            Year = 2026,
            Month = 6,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        _dbContext.PlayerMapStats.Add(new PlayerMapStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            MapName = "El Alamein",
            TotalRounds = 10,
            TotalPlayTimeMinutes = 300,
            Year = 2026,
            Month = 6
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(playerName, "global", 2026);

        // Assert
        Assert.NotNull(result);
        var expectedName = cp1251.GetString(rawBytes);
        Assert.Equal(expectedName, result.PlayerName);
        Assert.Equal("global", result.ServerGuid);
        Assert.Equal(5, result.YearInNumbers.RoundsPlayed);
        Assert.Equal(120, result.YearInNumbers.TotalKills);
        Assert.Equal(4.0, result.YearInNumbers.KdRatio); // 120 / 30

        // Verify cache record is created
        var cached = await _dbContext.PlayerWrappedCaches.FirstOrDefaultAsync(c => c.PlayerName == playerName && c.ServerGuid == "global" && c.Year == 2026);
        Assert.NotNull(cached);
        Assert.Contains("global", cached.JsonData);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_ReturnsCachedData_OnCacheHit()
    {
        // Arrange
        var playerName = "TestPlayer";
        var serverGuid = "global";
        var cacheJson = "{\"playerName\":\"TestPlayer\",\"serverGuid\":\"global\",\"year\":2026,\"yearInNumbers\":{\"roundsPlayed\":99},\"trend\":{\"monthlyKDs\":[],\"monthlyKillRates\":[],\"topMaps\":[]},\"favouriteMap\":{\"mapName\":\"\",\"rounds\":0,\"winRate\":0,\"topMaps5\":[],\"homeServerName\":\"\",\"homeServerLocation\":\"\"},\"medals\":{\"killStreaks25\":0,\"podiumFinishes\":0,\"eliteWarriorBadgeName\":\"\",\"eliteWarriorTier\":\"\",\"bestStreak\":0,\"lifetimeMilestoneText\":\"\"},\"bestMoment\":{\"streak\":0,\"mapName\":\"\",\"date\":\"2026-07-09T00:00:00Z\",\"estimatedDurationMinutes\":0,\"serverStreakRank\":0},\"squad\":[]}";
        
        _dbContext.PlayerWrappedCaches.Add(new PlayerWrappedCache
        {
            PlayerName = playerName,
            ServerGuid = serverGuid,
            Year = 2026,
            JsonData = cacheJson,
            CalculatedAt = Instant.FromUtc(2026, 7, 9, 0, 0)
        });
        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(playerName, serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("TestPlayer", result.PlayerName);
        Assert.Equal(99, result.YearInNumbers.RoundsPlayed);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_ConsolidatesTeamVictoryAchievementsAndDeterminesHighestTier()
    {
        // Arrange
        var playerName = "GroupedTestPlayer";
        var serverGuid = "test-server-guid";
        
        var server = new GameServer
        {
            Guid = serverGuid,
            Name = "Test Server",
            Ip = "127.0.0.1",
            Port = 14567,
            GameId = "bf1942",
            Timezone = "UTC"
        };
        _dbContext.Servers.Add(server);

        var player = new Player
        {
            Name = playerName,
            FirstSeen = new DateTime(2025, 1, 1),
            LastSeen = new DateTime(2026, 12, 31)
        };
        _dbContext.Players.Add(player);

        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid,
            PlayerName = playerName,
            Year = 2026,
            Week = 23,
            TotalRounds = 5,
            TotalKills = 120,
            TotalDeaths = 30,
            TotalPlayTimeMinutes = 150
        });

        // Add 3 team victories with different tiers
        var startInstant = Instant.FromUtc(2026, 6, 1, 12, 0, 0);
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementId = "team_victory",
            AchievementName = "Team Victory",
            AchievementType = "team_victory",
            Tier = "bronze",
            AchievedAt = startInstant,
            ServerGuid = serverGuid,
            Game = "bf1942"
        });
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementId = "team_victory",
            AchievementName = "Team Victory",
            AchievementType = "team_victory",
            Tier = "gold",
            AchievedAt = startInstant + Duration.FromDays(1),
            ServerGuid = serverGuid,
            Game = "bf1942"
        });
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementId = "team_victory_switched",
            AchievementName = "Team Victory (Team Switched)",
            AchievementType = "team_victory_switched",
            Tier = "silver",
            AchievedAt = startInstant + Duration.FromDays(2),
            ServerGuid = serverGuid,
            Game = "bf1942"
        });

        // Add a different achievement
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementId = "kill_streak_5",
            AchievementName = "First Blood",
            AchievementType = "kill_streak",
            Tier = "bronze",
            AchievedAt = startInstant + Duration.FromDays(3),
            ServerGuid = serverGuid,
            Game = "bf1942"
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(playerName, serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.NotNull(result.Medals.AchievementsBreakdown);
        

        // Should have exactly 2 unique types of achievements: team_victory and kill_streak_5
        Assert.Equal(2, result.Medals.AchievementsBreakdown.Count);

        var teamVictoryGroup = result.Medals.AchievementsBreakdown.Find(a => a.AchievementId == "team_victory");
        Assert.NotNull(teamVictoryGroup);
        Assert.Equal(3, teamVictoryGroup.Count); // 1 bronze + 1 gold + 1 silver switched
        Assert.Equal("gold", teamVictoryGroup.Tier); // gold is highest weight

        var killStreakGroup = result.Medals.AchievementsBreakdown.Find(a => a.AchievementId == "kill_streak_5");
        Assert.NotNull(killStreakGroup);
        Assert.Equal(1, killStreakGroup.Count);
        Assert.Equal("bronze", killStreakGroup.Tier);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_RanksAndPercentilesComeFromTheWholePopulation()
    {
        // Three players with a clear ordering, so every rank and percentile has one right answer.
        // These used to be a whole-table GROUP BY apiece and now come from the shared snapshot -
        // this pins the values so that swap can't quietly move anyone's numbers.
        AddMonthlyStats("Alpha", rounds: 20, kills: 100, deaths: 50, playTime: 600);   // kd 2.0
        AddMonthlyStats("Bravo", rounds: 10, kills: 50, deaths: 20, playTime: 300);    // kd 2.5
        AddMonthlyStats("Charlie", rounds: 6, kills: 10, deaths: 5, playTime: 100);    // under the K/D cohort's 20-kill floor

        // The player's own totals are read from PlayerServerStats, the population from monthly.
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = "test-server-guid", PlayerName = "Bravo", Year = 2026, Week = 23,
            TotalRounds = 10, TotalKills = 50, TotalDeaths = 20, TotalScore = 500, TotalPlayTimeMinutes = 300
        });

        // Round placements: Alpha 3, Bravo 2, Charlie 1.
        AddPlacements("Alpha", 3);
        AddPlacements("Bravo", 2);
        AddPlacements("Charlie", 1);

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync("Bravo", "global", 2026);

        // Assert
        Assert.NotNull(result);
        var numbers = result.YearInNumbers;

        // Only Alpha beats Bravo on score, kills and placements.
        Assert.Equal(2, numbers.ServerRank);
        Assert.Equal(2, numbers.KillsRank);
        Assert.Equal(2, numbers.PlacementsRank);

        // Cohort for these three is all 3 players (each cleared the 5-round floor); Bravo beats
        // Charlie only.
        Assert.Equal(33.33, numbers.RoundsPercentile);
        Assert.Equal(33.33, numbers.KillsPercentile);
        Assert.Equal(33.33, numbers.PlayTimePercentile);

        // K/D has its own cohort: Charlie's 10 kills miss the 20-kill floor, leaving Alpha and
        // Bravo, and Bravo's 2.5 beats Alpha's 2.0.
        Assert.Equal(50.0, numbers.KdPercentile);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_RanksBestStreakAgainstEveryOtherPlayersStreaks()
    {
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = "test-server-guid", PlayerName = "Sniper", Year = 2026, Week = 23,
            TotalRounds = 10, TotalKills = 60, TotalDeaths = 20, TotalScore = 600, TotalPlayTimeMinutes = 300
        });

        // Sniper's own streak is 30 (from metadata, not the kill_streak_25 tier it crossed).
        AddStreak("Sniper", "kill_streak_25", actualStreak: 30);
        // Two players beat it, one doesn't.
        AddStreak("Legend", "kill_streak_50", actualStreak: 55);
        AddStreak("Veteran", "kill_streak_30", actualStreak: 31);
        AddStreak("Rookie", "kill_streak_10", actualStreak: 12);

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync("Sniper", "global", 2026);

        // Assert
        Assert.NotNull(result);
        var streakMoment = Assert.Single(result.BestMoments, m => m.Type == "streak");
        Assert.Equal(30, streakMoment.Value);
        Assert.Equal(3, streakMoment.ServerStreakRank); // beaten by Legend and Veteran
    }

    private void AddMonthlyStats(string playerName, int rounds, int kills, int deaths, double playTime)
    {
        _dbContext.PlayerStatsMonthly.Add(new PlayerStatsMonthly
        {
            PlayerName = playerName,
            Year = 2026,
            Month = 6,
            TotalRounds = rounds,
            TotalKills = kills,
            TotalDeaths = deaths,
            TotalScore = kills * 10,
            TotalPlayTimeMinutes = playTime
        });
    }

    private void AddPlacements(string playerName, int count)
    {
        for (int i = 0; i < count; i++)
        {
            _dbContext.PlayerAchievements.Add(new PlayerAchievement
            {
                PlayerName = playerName,
                AchievementType = "round_placement",
                AchievementId = $"round_placement_{i + 1}",
                AchievementName = "Round Placement",
                Tier = "bronze",
                Value = 1,
                AchievedAt = Instant.FromUtc(2026, 6, 1, 12, i),
                ProcessedAt = Instant.FromUtc(2026, 6, 1, 12, i),
                ServerGuid = "test-server-guid",
                MapName = "El Alamein",
                RoundId = $"placement-{playerName}-{i}",
                Game = "bf1942"
            });
        }
    }

    private void AddStreak(string playerName, string achievementId, int actualStreak)
    {
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = playerName,
            AchievementType = "kill_streak",
            AchievementId = achievementId,
            AchievementName = "Kill Streak",
            Tier = "gold",
            Value = actualStreak,
            AchievedAt = Instant.FromUtc(2026, 6, 1, 12, 0),
            ProcessedAt = Instant.FromUtc(2026, 6, 1, 12, 0),
            ServerGuid = "test-server-guid",
            MapName = "El Alamein",
            RoundId = $"streak-{playerName}",
            Metadata = $"{{\"actual_streak\": {actualStreak}}}",
            Game = "bf1942"
        });
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_ServerAndGlobalPasses_AgreeOnTheServerAgnosticSections()
    {
        // Server Rankings and Relations never filter by serverGuid, so both passes for one
        // player must produce identical output — that equality is what makes the memo safe.
        var serverGuid = "test-server-guid";
        _dbContext.Servers.Add(new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" });
        _dbContext.Players.Add(new Player { Name = "Twin", FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid, PlayerName = "Twin", Year = 2026, Week = 23,
            TotalRounds = 12, TotalKills = 60, TotalDeaths = 20, TotalScore = 600, TotalPlayTimeMinutes = 300
        });
        _dbContext.ServerPlayerRankings.Add(new ServerPlayerRanking
        {
            ServerGuid = serverGuid, PlayerName = "Twin", Year = 2026, Month = 6, Rank = 1, TotalScore = 600
        });
        await _dbContext.SaveChangesAsync();

        // Deliberately two separate service instances, so neither result can come from the
        // other's memo. Comparing memoised output to itself would be circular and could never
        // fail; this compares two independent computations.
        var serverResult = await NewService().GetPlayerWrappedAsync("Twin", serverGuid, 2026, bypassCache: true);
        var globalResult = await NewService().GetPlayerWrappedAsync("Twin", "global", 2026, bypassCache: true);

        Assert.NotNull(serverResult);
        Assert.NotNull(globalResult);
        Assert.Equal(serverResult.ServerRankings.Count, globalResult.ServerRankings.Count);
        Assert.Equal(serverResult.Relations, globalResult.Relations);
        for (int i = 0; i < serverResult.ServerRankings.Count; i++)
        {
            Assert.Equal(serverResult.ServerRankings[i], globalResult.ServerRankings[i]);
        }
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_DoesNotLeakOneMemoisedPlayersRankingsToAnother()
    {
        // The memo is a single slot keyed by player+year. If the key check were wrong, the
        // second player would silently inherit the first player's rankings.
        var serverGuid = "test-server-guid";
        _dbContext.Servers.Add(new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" });
        _dbContext.Players.AddRange(
            new Player { Name = "First", FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) },
            new Player { Name = "Second", FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });

        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats { ServerGuid = serverGuid, PlayerName = "First", Year = 2026, Week = 23, TotalRounds = 10, TotalKills = 90, TotalDeaths = 20, TotalScore = 900, TotalPlayTimeMinutes = 300 },
            new PlayerServerStats { ServerGuid = serverGuid, PlayerName = "Second", Year = 2026, Week = 23, TotalRounds = 10, TotalKills = 10, TotalDeaths = 20, TotalScore = 100, TotalPlayTimeMinutes = 300 });

        _dbContext.ServerPlayerRankings.AddRange(
            new ServerPlayerRanking { ServerGuid = serverGuid, PlayerName = "First", Year = 2026, Month = 6, Rank = 1, TotalScore = 900 },
            new ServerPlayerRanking { ServerGuid = serverGuid, PlayerName = "Second", Year = 2026, Month = 6, Rank = 2, TotalScore = 100 });
        await _dbContext.SaveChangesAsync();

        var first = await _service.GetPlayerWrappedAsync("First", "global", 2026);
        var second = await _service.GetPlayerWrappedAsync("Second", "global", 2026);

        Assert.NotNull(first);
        Assert.NotNull(second);
        var firstRanking = Assert.Single(first.ServerRankings);
        var secondRanking = Assert.Single(second.ServerRankings);
        Assert.Equal(900, firstRanking.TotalScore);
        Assert.Equal(100, secondRanking.TotalScore);
        Assert.Equal(1, firstRanking.Rank);
        Assert.Equal(2, secondRanking.Rank);
    }

    [Fact]
    public async Task CrunchAllPlayersWrappedAsync_TopPlayerCount_TakesTheBusiestPlayersAndTheirMostPlayedServer()
    {
        var busyServer = "test-server-guid";
        var quietServer = "cached-server-guid";
        _dbContext.Servers.AddRange(
            new GameServer { Guid = busyServer, Name = "Busy", GameId = "bf1942", Timezone = "UTC" },
            new GameServer { Guid = quietServer, Name = "Quiet", GameId = "bf1942", Timezone = "UTC" });

        // Playtime ranking comes from PlayerStatsMonthly: Heavy > Middle > Light.
        AddMonthlyStats("Heavy", rounds: 50, kills: 500, deaths: 100, playTime: 3000);
        AddMonthlyStats("Middle", rounds: 30, kills: 300, deaths: 100, playTime: 2000);
        AddMonthlyStats("Light", rounds: 10, kills: 50, deaths: 40, playTime: 100);

        // Heavy plays mostly on busyServer; Middle mostly on quietServer. The crunch should pick
        // each player's own most-played server, not a globally configured one.
        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats { ServerGuid = busyServer, PlayerName = "Heavy", Year = 2026, Week = 23, TotalRounds = 40, TotalKills = 400, TotalDeaths = 80, TotalScore = 4000, TotalPlayTimeMinutes = 2500 },
            new PlayerServerStats { ServerGuid = quietServer, PlayerName = "Heavy", Year = 2026, Week = 23, TotalRounds = 10, TotalKills = 100, TotalDeaths = 20, TotalScore = 1000, TotalPlayTimeMinutes = 500 },
            new PlayerServerStats { ServerGuid = quietServer, PlayerName = "Middle", Year = 2026, Week = 23, TotalRounds = 25, TotalKills = 250, TotalDeaths = 80, TotalScore = 2500, TotalPlayTimeMinutes = 1800 },
            new PlayerServerStats { ServerGuid = busyServer, PlayerName = "Middle", Year = 2026, Week = 23, TotalRounds = 5, TotalKills = 50, TotalDeaths = 20, TotalScore = 500, TotalPlayTimeMinutes = 200 },
            new PlayerServerStats { ServerGuid = busyServer, PlayerName = "Light", Year = 2026, Week = 23, TotalRounds = 10, TotalKills = 50, TotalDeaths = 40, TotalScore = 500, TotalPlayTimeMinutes = 100 });
        await _dbContext.SaveChangesAsync();

        // Act — top 2 only, so Light must be excluded.
        await _service.CrunchAllPlayersWrappedAsync(2026, CancellationToken.None, topPlayerCount: 2);

        var cached = await _dbContext.PlayerWrappedCaches.AsNoTracking().ToListAsync();

        Assert.DoesNotContain(cached, c => c.PlayerName == "Light");
        Assert.Contains(cached, c => c.PlayerName == "Heavy" && c.ServerGuid == "global");
        Assert.Contains(cached, c => c.PlayerName == "Middle" && c.ServerGuid == "global");
        // Global only — the per-server variant is no longer computed, so nothing should be
        // cached against a server guid at all.
        Assert.All(cached, c => Assert.Equal("global", c.ServerGuid));
    }

    [Fact]
    public async Task CrunchAllPlayersWrappedAsync_WithoutTopPlayerCount_StillUsesTheConfiguredAllowlist()
    {
        // The default path must be unchanged — topPlayerCount is additive, not a replacement.
        _dbContext.Servers.Add(new GameServer { Guid = "test-server-guid", Name = "Busy", GameId = "bf1942", Timezone = "UTC" });
        AddMonthlyStats("Unlisted", rounds: 50, kills: 500, deaths: 100, playTime: 9000);
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = "test-server-guid", PlayerName = "Unlisted", Year = 2026, Week = 23,
            TotalRounds = 50, TotalKills = 500, TotalDeaths = 100, TotalScore = 5000, TotalPlayTimeMinutes = 9000
        });
        await _dbContext.SaveChangesAsync();

        await _service.CrunchAllPlayersWrappedAsync(2026, CancellationToken.None);

        // No PlayerWrapped:AllowedPlayerNames is configured in these tests, so the fallback
        // allowlist applies and the busiest player is deliberately not crunched.
        var cached = await _dbContext.PlayerWrappedCaches.AsNoTracking().ToListAsync();
        Assert.DoesNotContain(cached, c => c.PlayerName == "Unlisted");
    }

    [Fact]
    public async Task GetProfileWrappedAsync_ReturnsNull_WhenUserHasNoAliases()
    {
        // Arrange
        _dbContext.Users.Add(new User { Id = 1, Email = "nobody@example.com" });
        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetProfileWrappedAsync(1, 2026);

        // Assert
        Assert.Null(result);
    }

    [Fact]
    public async Task GetProfileWrappedAsync_MergesStatsAcrossAliases_AndExcludesEmptyAlias()
    {
        // Arrange
        _dbContext.Users.Add(new User { Id = 2, Email = "player@example.com" });
        _dbContext.UserPlayerNames.AddRange(
            new UserPlayerName { UserId = 2, PlayerName = "AliasOne", CreatedAt = DateTime.UtcNow },
            new UserPlayerName { UserId = 2, PlayerName = "AliasTwo", CreatedAt = DateTime.UtcNow },
            new UserPlayerName { UserId = 2, PlayerName = "AliasWithNoActivity", CreatedAt = DateTime.UtcNow }
        );

        // AliasOne: high volume, modest K/D
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = "test-server-guid", PlayerName = "AliasOne", Year = 2026, Week = 23,
            TotalRounds = 10, TotalKills = 100, TotalDeaths = 50, TotalPlayTimeMinutes = 300
        });

        // AliasTwo: low volume, elite K/D and kill rate
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = "test-server-guid", PlayerName = "AliasTwo", Year = 2026, Week = 23,
            TotalRounds = 2, TotalKills = 40, TotalDeaths = 5, TotalPlayTimeMinutes = 60
        });

        // Each alias's own favourite map, so the merge can pick the best map K/D across aliases.
        _dbContext.PlayerMapStats.Add(new PlayerMapStats
        {
            ServerGuid = api.Data.Entities.PlayerMapStats.GlobalServerGuid, PlayerName = "AliasOne", MapName = "Iwo Jima",
            Year = 2026, Month = 6, TotalRounds = 10, TotalKills = 100, TotalDeaths = 50, TotalPlayTimeMinutes = 300
        });
        _dbContext.PlayerMapStats.Add(new PlayerMapStats
        {
            ServerGuid = api.Data.Entities.PlayerMapStats.GlobalServerGuid, PlayerName = "AliasTwo", MapName = "Battle of Britain",
            Year = 2026, Month = 6, TotalRounds = 2, TotalKills = 40, TotalDeaths = 5, TotalPlayTimeMinutes = 60
        });

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetProfileWrappedAsync(2, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.UserId);

        // Totals are exact sums across the two active aliases; the empty alias contributes nothing.
        Assert.Equal(12, result.YearInNumbers.RoundsPlayed);
        Assert.Equal(140, result.YearInNumbers.TotalKills);
        Assert.Equal(55, result.YearInNumbers.TotalDeaths);
        Assert.Equal(2.55, result.YearInNumbers.KdRatio); // 140 / 55

        // Only the two active aliases should appear in the credits list.
        Assert.Equal(2, result.AliasCredits.Count);
        Assert.DoesNotContain(result.AliasCredits, c => c.PlayerName == "AliasWithNoActivity");

        // AliasTwo has both the best K/D (8.0) and the best kill rate (20 kills/round).
        Assert.Equal("AliasTwo", result.BestAliases.BestKdAliasName);
        Assert.Equal(8.0, result.BestAliases.BestKdValue);
        Assert.Equal("AliasTwo", result.BestAliases.BestKillRateAliasName);
        Assert.Equal(20.0, result.BestAliases.BestKillRateValue);

        // AliasTwo's map (Battle of Britain, 8.0 K/D) beats AliasOne's map (Iwo Jima, 2.0 K/D).
        Assert.Equal("Battle of Britain", result.BestAliases.BestMapKdMapName);
        Assert.Equal(8.0, result.BestAliases.BestMapKdValue);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_DerivesLuckyCharmAndArchNemesis_FromBatchedRelationsQueries()
    {
        // Regression test for the Relations section, which was rewritten from N+1
        // per-round queries to batched bulk queries. Exercises both the "teammate on
        // wins" and "opponent on losses" paths, including a player who switches teams
        // between rounds, to make sure the in-memory (RoundId, Team) matching that
        // replaced the per-round SQL filter still lines up correctly.
        var serverGuid = "test-server-guid";
        var server = new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" };
        _dbContext.Servers.Add(server);

        const string hero = "Hero";
        const string buddy = "Buddy";
        const string villain = "Villain";

        foreach (var name in new[] { hero, buddy, villain })
        {
            _dbContext.Players.Add(new Player { Name = name, FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });
        }

        // Give the player enough recorded activity for the Relations block to run at all.
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid, PlayerName = hero, Year = 2026, Week = 23,
            TotalRounds = 5, TotalKills = 50, TotalDeaths = 25, TotalPlayTimeMinutes = 150
        });

        var start = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc);

        // Hero wins rounds 1-3 on team 1. Buddy is his teammate (team 1) in rounds 1-2 only.
        for (int i = 1; i <= 3; i++)
        {
            var roundId = $"win-round-{i}";
            _dbContext.Rounds.Add(new Round
            {
                RoundId = roundId, ServerGuid = serverGuid, ServerName = "Test Server", MapName = "Map",
                GameType = "Conquest", StartTime = start.AddHours(i), EndTime = start.AddHours(i).AddMinutes(20),
                ParticipantCount = 2, IsDeleted = false
            });
            _dbContext.PlayerSessions.Add(new PlayerSession
            {
                SessionId = i, PlayerName = hero, ServerGuid = serverGuid, RoundId = roundId,
                CurrentTeam = 1, StartTime = start.AddHours(i), LastSeenTime = start.AddHours(i).AddMinutes(20), IsDeleted = false
            });
            _dbContext.PlayerAchievements.Add(new PlayerAchievement
            {
                PlayerName = hero, ServerGuid = serverGuid, RoundId = roundId, AchievementId = "team_victory",
                AchievementName = "Team Victory", AchievementType = "team_victory", Tier = "bronze",
                AchievedAt = Instant.FromDateTimeUtc(start.AddHours(i)), Game = "bf1942"
            });

            if (i <= 2)
            {
                _dbContext.PlayerSessions.Add(new PlayerSession
                {
                    SessionId = 100 + i, PlayerName = buddy, ServerGuid = serverGuid, RoundId = roundId,
                    CurrentTeam = 1, StartTime = start.AddHours(i), LastSeenTime = start.AddHours(i).AddMinutes(20), IsDeleted = false
                });
            }
        }

        // Hero loses rounds 4-5 on team 2 (a team switch relative to the wins above).
        // Villain is on the winning team (team 1) both times.
        for (int i = 4; i <= 5; i++)
        {
            var roundId = $"loss-round-{i}";
            _dbContext.Rounds.Add(new Round
            {
                RoundId = roundId, ServerGuid = serverGuid, ServerName = "Test Server", MapName = "Map",
                GameType = "Conquest", StartTime = start.AddHours(i), EndTime = start.AddHours(i).AddMinutes(20),
                ParticipantCount = 2, IsDeleted = false
            });
            _dbContext.PlayerSessions.Add(new PlayerSession
            {
                SessionId = i, PlayerName = hero, ServerGuid = serverGuid, RoundId = roundId,
                CurrentTeam = 2, StartTime = start.AddHours(i), LastSeenTime = start.AddHours(i).AddMinutes(20), IsDeleted = false
            });
            _dbContext.PlayerSessions.Add(new PlayerSession
            {
                SessionId = 200 + i, PlayerName = villain, ServerGuid = serverGuid, RoundId = roundId,
                CurrentTeam = 1, StartTime = start.AddHours(i), LastSeenTime = start.AddHours(i).AddMinutes(20), IsDeleted = false
            });
            _dbContext.PlayerAchievements.Add(new PlayerAchievement
            {
                PlayerName = villain, ServerGuid = serverGuid, RoundId = roundId, AchievementId = "team_victory",
                AchievementName = "Team Victory", AchievementType = "team_victory", Tier = "bronze",
                AchievedAt = Instant.FromDateTimeUtc(start.AddHours(i)), Game = "bf1942"
            });
        }

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(hero, serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(buddy, result.Relations.LuckyCharmName);
        Assert.Equal(2, result.Relations.LuckyCharmWins);
        Assert.Equal(villain, result.Relations.ArchNemesisName);
        Assert.Equal(2, result.Relations.ArchNemesisLosses);
        Assert.Null(result.Relations.TwoFaceName);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_Relations_EmitsNestedBuildExecuteReadSpans()
    {
        // Guards the tracing *structure* itself: Build/Execute/Read must be real child
        // Activities under each batch span (not just tags on the batch span), otherwise a
        // slow batch shows up in traces as one opaque line with nothing underneath it to
        // say whether the time went into query building, the DB call, or row processing.
        var serverGuid = "test-server-guid";
        _dbContext.Servers.Add(new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" });

        const string hero = "Hero";
        const string villain = "Villain";
        foreach (var name in new[] { hero, villain })
        {
            _dbContext.Players.Add(new Player { Name = name, FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });
        }

        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid, PlayerName = hero, Year = 2026, Week = 23,
            TotalRounds = 1, TotalKills = 5, TotalDeaths = 5, TotalPlayTimeMinutes = 20
        });

        var start = new DateTime(2026, 6, 1, 12, 0, 0, DateTimeKind.Utc);
        _dbContext.Rounds.Add(new Round
        {
            RoundId = "loss-round-1", ServerGuid = serverGuid, ServerName = "Test Server", MapName = "Map",
            GameType = "Conquest", StartTime = start, EndTime = start.AddMinutes(20), ParticipantCount = 2, IsDeleted = false
        });
        // Hero loses this round (team 2); Villain is on the winning team (team 1).
        _dbContext.PlayerSessions.Add(new PlayerSession
        {
            SessionId = 1, PlayerName = hero, ServerGuid = serverGuid, RoundId = "loss-round-1",
            CurrentTeam = 2, StartTime = start, LastSeenTime = start.AddMinutes(20), IsDeleted = false
        });
        _dbContext.PlayerSessions.Add(new PlayerSession
        {
            SessionId = 2, PlayerName = villain, ServerGuid = serverGuid, RoundId = "loss-round-1",
            CurrentTeam = 1, StartTime = start, LastSeenTime = start.AddMinutes(20), IsDeleted = false
        });
        _dbContext.PlayerAchievements.Add(new PlayerAchievement
        {
            PlayerName = villain, ServerGuid = serverGuid, RoundId = "loss-round-1", AchievementId = "team_victory",
            AchievementName = "Team Victory", AchievementType = "team_victory", Tier = "bronze",
            AchievedAt = Instant.FromDateTimeUtc(start), Game = "bf1942"
        });

        await _dbContext.SaveChangesAsync();

        var activities = new List<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "BfStats.Wrapped",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllData,
            ActivityStopped = activity => activities.Add(activity)
        };
        ActivitySource.AddActivityListener(listener);

        // Act
        await _service.GetPlayerWrappedAsync(hero, serverGuid, 2026);

        // Assert: the batch span exists, and Build/Execute/Read are its direct children.
        var nemesisBatch = Assert.Single(activities, a => a.OperationName == "Wrapped.CalculatePlayerWrapped.Relations.NemesisLossesBatch");
        var build = Assert.Single(activities, a => a.OperationName == "Wrapped.CalculatePlayerWrapped.Relations.NemesisLossesBatch.Build");
        var execute = Assert.Single(activities, a => a.OperationName == "Wrapped.CalculatePlayerWrapped.Relations.NemesisLossesBatch.Execute");
        var read = Assert.Single(activities, a => a.OperationName == "Wrapped.CalculatePlayerWrapped.Relations.NemesisLossesBatch.Read");

        Assert.Equal(nemesisBatch.Id, build.ParentId);
        Assert.Equal(nemesisBatch.Id, execute.ParentId);
        Assert.Equal(nemesisBatch.Id, read.ParentId);
    }

    [Fact]
    public async Task CrunchAllProfilesWrappedAsync_CachesEveryRegisteredAlias()
    {
        // Arrange
        _dbContext.Users.Add(new User { Id = 3, Email = "cruncher@example.com" });
        _dbContext.UserPlayerNames.Add(new UserPlayerName { UserId = 3, PlayerName = "CrunchAlias", CreatedAt = DateTime.UtcNow });
        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = "test-server-guid", PlayerName = "CrunchAlias", Year = 2026, Week = 23,
            TotalRounds = 3, TotalKills = 30, TotalDeaths = 10, TotalPlayTimeMinutes = 90
        });
        await _dbContext.SaveChangesAsync();

        // Act
        await _service.CrunchAllProfilesWrappedAsync(2026, CancellationToken.None);

        // Assert
        var cached = await _dbContext.PlayerWrappedCaches
            .FirstOrDefaultAsync(c => c.PlayerName == "CrunchAlias" && c.ServerGuid == "global" && c.Year == 2026);
        Assert.NotNull(cached);
    }

    [Fact]
    public async Task GetPlayerWrappedAsync_CalculatesPlayerDishonours_OnCacheMiss()
    {
        // Arrange
        var serverGuid = "test-server-guid";
        var server = new GameServer { Guid = serverGuid, Name = "Test Server", GameId = "bf1942", Timezone = "UTC" };
        _dbContext.Servers.Add(server);

        var playerName = "UnhappySoldier";
        _dbContext.Players.Add(new Player { Name = playerName, FirstSeen = new DateTime(2025, 1, 1), LastSeen = new DateTime(2026, 12, 31) });

        _dbContext.PlayerServerStats.Add(new PlayerServerStats
        {
            ServerGuid = serverGuid, PlayerName = playerName, Year = 2026, Week = 23,
            TotalRounds = 9, TotalKills = 16, TotalDeaths = 17, TotalPlayTimeMinutes = 100
        });

        // Seed Map stats: Map A, Map B, Map C
        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats { ServerGuid = serverGuid, PlayerName = playerName, MapName = "Map A", Year = 2026, Month = 6, TotalRounds = 5, TotalKills = 5, TotalDeaths = 10, TotalScore = 100 },
            new PlayerMapStats { ServerGuid = serverGuid, PlayerName = playerName, MapName = "Map B", Year = 2026, Month = 6, TotalRounds = 3, TotalKills = 10, TotalDeaths = 2, TotalScore = 300 },
            new PlayerMapStats { ServerGuid = serverGuid, PlayerName = playerName, MapName = "Map C", Year = 2026, Month = 6, TotalRounds = 1, TotalKills = 1, TotalDeaths = 5, TotalScore = 10 }
        );

        // Add 2 victories achievements for Map B
        var startInstant = Instant.FromUtc(2026, 6, 1, 12, 0, 0);
        _dbContext.PlayerAchievements.AddRange(
            new PlayerAchievement { ServerGuid = serverGuid, PlayerName = playerName, MapName = "Map B", AchievementId = "team_victory", AchievementType = "team_victory", Tier = "bronze", AchievedAt = startInstant },
            new PlayerAchievement { ServerGuid = serverGuid, PlayerName = playerName, MapName = "Map B", AchievementId = "team_victory", AchievementType = "team_victory", Tier = "bronze", AchievedAt = startInstant + Duration.FromHours(1) }
        );

        await _dbContext.SaveChangesAsync();

        // Act
        var result = await _service.GetPlayerWrappedAsync(playerName, serverGuid, 2026);

        // Assert
        Assert.NotNull(result);
        Assert.NotNull(result.Dishonours);
        
        // Least Favorite Map by KD should be Map A (KD = 0.5 vs Map B = 5.0, Map C excluded because rounds < average rounds of 3.0)
        Assert.NotNull(result.Dishonours.LeastFavoriteMapByKd);
        Assert.Equal("Map A", result.Dishonours.LeastFavoriteMapByKd.MapName);
        Assert.Equal(0.5, result.Dishonours.LeastFavoriteMapByKd.Value);
        Assert.Equal(0.94, result.Dishonours.LeastFavoriteMapByKd.PlayerAvg);
        Assert.Equal(5.0, result.Dishonours.LeastFavoriteMapByKd.PlayerBest);
        Assert.Equal(-0.44, result.Dishonours.LeastFavoriteMapByKd.Delta);

        // Lowest Kill Rate should be Map A (1.0 vs Map B = 3.3)
        Assert.NotNull(result.Dishonours.LowestKillRateMap);
        Assert.Equal("Map A", result.Dishonours.LowestKillRateMap.MapName);
        Assert.Equal(1.0, result.Dishonours.LowestKillRateMap.Value);
        Assert.Equal(1.8, result.Dishonours.LowestKillRateMap.PlayerAvg);
        Assert.Equal(3.3, result.Dishonours.LowestKillRateMap.PlayerBest);
        Assert.Equal(-0.8, result.Dishonours.LowestKillRateMap.Delta);

        // Lowest Score Rate should be Map A (20.0 vs Map B = 100.0)
        Assert.NotNull(result.Dishonours.LowestScoreRateMap);
        Assert.Equal("Map A", result.Dishonours.LowestScoreRateMap.MapName);
        Assert.Equal(20.0, result.Dishonours.LowestScoreRateMap.Value);
        Assert.Equal(45.6, result.Dishonours.LowestScoreRateMap.PlayerAvg);
        Assert.Equal(100.0, result.Dishonours.LowestScoreRateMap.PlayerBest);
        Assert.Equal(-25.6, result.Dishonours.LowestScoreRateMap.Delta);

        // Max Deaths should be Map A (DeathRate = 2.0 vs Map B = 0.67)
        Assert.NotNull(result.Dishonours.MaxDeathsMap);
        Assert.Equal("Map A", result.Dishonours.MaxDeathsMap.MapName);
        Assert.Equal(2.0, result.Dishonours.MaxDeathsMap.Value);
        Assert.Equal(1.9, result.Dishonours.MaxDeathsMap.PlayerAvg);
        Assert.Equal(0.7, result.Dishonours.MaxDeathsMap.PlayerBest);
        Assert.Equal(0.1, result.Dishonours.MaxDeathsMap.Delta);

        // Most Losses should be Map A (LossRate = 1.0 vs Map B = 0.33)
        Assert.NotNull(result.Dishonours.MostLossesMap);
        Assert.Equal("Map A", result.Dishonours.MostLossesMap.MapName);
        Assert.Equal(1.0, result.Dishonours.MostLossesMap.Value);
        Assert.Equal(0.78, result.Dishonours.MostLossesMap.PlayerAvg);
        Assert.Equal(0.33, result.Dishonours.MostLossesMap.PlayerBest);
        Assert.Equal(0.22, result.Dishonours.MostLossesMap.Delta);
    }
}
