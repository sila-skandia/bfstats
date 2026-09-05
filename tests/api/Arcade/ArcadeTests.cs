using api.Arcade;
using api.Arcade.Models;
using api.Data.Entities;
using api.PlayerTracking;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using NSubstitute;

namespace api.tests.Arcade;

public class ArcadeTests : IDisposable
{
    private readonly SqliteConnection _connection;
    private readonly PlayerTrackerDbContext _dbContext;
    private readonly IMemoryCache _memoryCache;
    private readonly ILogger<ArcadeService> _serviceLogger;
    private readonly ILogger<ArcadeController> _controllerLogger;
    private readonly ArcadeService _service;
    private readonly ArcadeController _controller;

    public ArcadeTests()
    {
        _connection = new SqliteConnection("Filename=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<PlayerTrackerDbContext>()
            .UseSqlite(_connection)
            .Options;

        _dbContext = new PlayerTrackerDbContext(options);
        _dbContext.Database.EnsureCreated();

        _memoryCache = new MemoryCache(new MemoryCacheOptions());
        _serviceLogger = Substitute.For<ILogger<ArcadeService>>();
        _controllerLogger = Substitute.For<ILogger<ArcadeController>>();

        _service = new ArcadeService(_dbContext, _memoryCache, _serviceLogger);
        _controller = new ArcadeController(_service, _controllerLogger);

        SeedSampleData();
    }

    private void SeedSampleData()
    {
        _dbContext.Servers.AddRange(
            new GameServer { Guid = "srv-1", Name = "Simple 24/7 Wake", Country = "US", Game = "bf1942", IsOnline = true, CurrentNumPlayers = 8 },
            new GameServer { Guid = "srv-2", Name = "Berlin Rotation", Country = "DE", Game = "bf1942", IsOnline = true, CurrentNumPlayers = 4 },
            new GameServer { Guid = "srv-3", Name = "Nordic Front", Country = "SE", Game = "bf1942", IsOnline = true, CurrentNumPlayers = 0 }
        );

        _dbContext.PlayerStatsMonthly.AddRange(
            new PlayerStatsMonthly
            {
                PlayerName = "ApexSoldier",
                Year = 2026,
                Month = 9,
                TotalKills = 15000,
                TotalDeaths = 7500,
                TotalScore = 25000,
                TotalPlayTimeMinutes = 18000
            },
            new PlayerStatsMonthly
            {
                PlayerName = "EagleEye",
                Year = 2026,
                Month = 9,
                TotalKills = 8000,
                TotalDeaths = 5000,
                TotalScore = 14000,
                TotalPlayTimeMinutes = 9000
            },
            new PlayerStatsMonthly
            {
                PlayerName = "PanzerGeneral",
                Year = 2026,
                Month = 9,
                TotalKills = 22000,
                TotalDeaths = 9000,
                TotalScore = 38000,
                TotalPlayTimeMinutes = 24000
            },
            new PlayerStatsMonthly
            {
                PlayerName = "Valkyrie",
                Year = 2026,
                Month = 9,
                TotalKills = 5000,
                TotalDeaths = 4000,
                TotalScore = 9000,
                TotalPlayTimeMinutes = 6000
            },
            new PlayerStatsMonthly
            {
                PlayerName = "ApexSoldier",
                Year = 2024,
                Month = 10,
                TotalKills = 4200,
                TotalDeaths = 2100,
                TotalScore = 7800,
                TotalPlayTimeMinutes = 3600
            },
            new PlayerStatsMonthly
            {
                PlayerName = "EagleEye",
                Year = 2024,
                Month = 10,
                TotalKills = 6100,
                TotalDeaths = 3000,
                TotalScore = 10200,
                TotalPlayTimeMinutes = 4800
            },
            new PlayerStatsMonthly
            {
                PlayerName = "PanzerGeneral",
                Year = 2024,
                Month = 10,
                TotalKills = 3900,
                TotalDeaths = 2500,
                TotalScore = 6500,
                TotalPlayTimeMinutes = 3000
            },
            new PlayerStatsMonthly
            {
                PlayerName = "Valkyrie",
                Year = 2024,
                Month = 10,
                TotalKills = 2800,
                TotalDeaths = 2200,
                TotalScore = 5100,
                TotalPlayTimeMinutes = 2400
            }
        );

        _dbContext.PlayerServerStats.AddRange(
            new PlayerServerStats
            {
                PlayerName = "ApexSoldier",
                ServerGuid = "srv-1",
                Year = 2026,
                Week = 35,
                TotalKills = 14000,
                TotalDeaths = 7000,
                TotalScore = 24000,
                TotalPlayTimeMinutes = 17000,
                TotalRounds = 120
            },
            new PlayerServerStats
            {
                PlayerName = "EagleEye",
                ServerGuid = "srv-1",
                Year = 2026,
                Week = 35,
                TotalKills = 7500,
                TotalDeaths = 4500,
                TotalScore = 13500,
                TotalPlayTimeMinutes = 8500,
                TotalRounds = 80
            },
            new PlayerServerStats
            {
                PlayerName = "PanzerGeneral",
                ServerGuid = "srv-1",
                Year = 2026,
                Week = 35,
                TotalKills = 19000,
                TotalDeaths = 8000,
                TotalScore = 32000,
                TotalPlayTimeMinutes = 20000,
                TotalRounds = 160
            },
            new PlayerServerStats
            {
                PlayerName = "Valkyrie",
                ServerGuid = "srv-1",
                Year = 2026,
                Week = 35,
                TotalKills = 4500,
                TotalDeaths = 3800,
                TotalScore = 8500,
                TotalPlayTimeMinutes = 5500,
                TotalRounds = 50
            }
        );

        _dbContext.PlayerMapStats.AddRange(
            new PlayerMapStats
            {
                PlayerName = "ApexSoldier",
                MapName = "Wake Island",
                ServerGuid = "srv-1",
                Year = 2026,
                Month = 9,
                TotalRounds = 50,
                TotalKills = 15000,
                TotalDeaths = 8000,
                TotalScore = 25000,
                TotalPlayTimeMinutes = 12000
            },
            new PlayerMapStats
            {
                PlayerName = "EagleEye",
                MapName = "Wake Island",
                ServerGuid = "srv-1",
                Year = 2026,
                Month = 9,
                TotalRounds = 40,
                TotalKills = 9000,
                TotalDeaths = 4000,
                TotalScore = 16000,
                TotalPlayTimeMinutes = 8000
            },
            new PlayerMapStats
            {
                PlayerName = "PanzerGeneral",
                MapName = "Wake Island",
                ServerGuid = "srv-1",
                Year = 2026,
                Month = 9,
                TotalRounds = 60,
                TotalKills = 12000,
                TotalDeaths = 10000,
                TotalScore = 21000,
                TotalPlayTimeMinutes = 10000
            },
            new PlayerMapStats
            {
                PlayerName = "Valkyrie",
                MapName = "Wake Island",
                ServerGuid = "srv-1",
                Year = 2026,
                Month = 9,
                TotalRounds = 30,
                TotalKills = 4000,
                TotalDeaths = 3500,
                TotalScore = 7000,
                TotalPlayTimeMinutes = 4500
            },
            new PlayerMapStats
            {
                PlayerName = "ApexSoldier",
                MapName = "Stalingrad",
                ServerGuid = "srv-2",
                Year = 2026,
                Month = 9,
                TotalRounds = 20,
                TotalKills = 5000,
                TotalDeaths = 4000,
                TotalScore = 9000,
                TotalPlayTimeMinutes = 5000
            },
            new PlayerMapStats
            {
                PlayerName = "EagleEye",
                MapName = "Stalingrad",
                ServerGuid = "srv-2",
                Year = 2026,
                Month = 9,
                TotalRounds = 25,
                TotalKills = 7000,
                TotalDeaths = 2800,
                TotalScore = 12000,
                TotalPlayTimeMinutes = 5500
            },
            new PlayerMapStats
            {
                PlayerName = "PanzerGeneral",
                MapName = "Stalingrad",
                ServerGuid = "srv-2",
                Year = 2026,
                Month = 9,
                TotalRounds = 45,
                TotalKills = 18000,
                TotalDeaths = 12000,
                TotalScore = 32000,
                TotalPlayTimeMinutes = 14000
            },
            new PlayerMapStats
            {
                PlayerName = "Valkyrie",
                MapName = "Stalingrad",
                ServerGuid = "srv-2",
                Year = 2026,
                Month = 9,
                TotalRounds = 18,
                TotalKills = 3500,
                TotalDeaths = 3000,
                TotalScore = 6000,
                TotalPlayTimeMinutes = 3200
            },
            new PlayerMapStats
            {
                PlayerName = "PanzerGeneral",
                MapName = "Bocage",
                ServerGuid = "srv-2",
                Year = 2026,
                Month = 9,
                TotalRounds = 80,
                TotalKills = 22000,
                TotalDeaths = 11000,
                TotalScore = 38000,
                TotalPlayTimeMinutes = 16000
            }
        );

        _dbContext.ServerMapStats.AddRange(
            new ServerMapStats
            {
                ServerGuid = "srv-1",
                MapName = "Wake Island",
                Year = 2026,
                Month = 9,
                TotalRounds = 500,
                TotalPlayTimeMinutes = 12500,
                AvgConcurrentPlayers = 24.5,
                PeakConcurrentPlayers = 32,
                Team1Victories = 280,
                Team2Victories = 220,
                Team1Label = "US Marines",
                Team2Label = "Imperial Navy"
            },
            new ServerMapStats
            {
                ServerGuid = "srv-1",
                MapName = "Midway",
                Year = 2026,
                Month = 9,
                TotalRounds = 300,
                TotalPlayTimeMinutes = 9000,
                AvgConcurrentPlayers = 22.0,
                PeakConcurrentPlayers = 32,
                Team1Victories = 160,
                Team2Victories = 140,
                Team1Label = "US Navy",
                Team2Label = "Imperial Navy"
            },
            new ServerMapStats
            {
                ServerGuid = "srv-1",
                MapName = "Iwo Jima",
                Year = 2026,
                Month = 9,
                TotalRounds = 250,
                TotalPlayTimeMinutes = 8000,
                AvgConcurrentPlayers = 20.0,
                PeakConcurrentPlayers = 30,
                Team1Victories = 130,
                Team2Victories = 120,
                Team1Label = "US Marines",
                Team2Label = "Imperial Navy"
            },
            new ServerMapStats
            {
                ServerGuid = "srv-1",
                MapName = "Guadalcanal",
                Year = 2026,
                Month = 9,
                TotalRounds = 200,
                TotalPlayTimeMinutes = 7000,
                AvgConcurrentPlayers = 18.0,
                PeakConcurrentPlayers = 28,
                Team1Victories = 110,
                Team2Victories = 90,
                Team1Label = "US Marines",
                Team2Label = "Imperial Navy"
            }
        );

        _dbContext.PlayerBestScores.AddRange(
            new PlayerBestScore
            {
                PlayerName = "ApexSoldier",
                ServerGuid = "srv-1",
                Period = "all_time",
                Rank = 1,
                FinalScore = 185,
                FinalKills = 142,
                FinalDeaths = 18,
                MapName = "Wake Island",
                RoundId = "rnd-123"
            },
            new PlayerBestScore
            {
                PlayerName = "EagleEye",
                ServerGuid = "srv-1",
                Period = "all_time",
                Rank = 1,
                FinalScore = 160,
                FinalKills = 120,
                FinalDeaths = 22,
                MapName = "Wake Island",
                RoundId = "rnd-124"
            },
            new PlayerBestScore
            {
                PlayerName = "PanzerGeneral",
                ServerGuid = "srv-1",
                Period = "all_time",
                Rank = 1,
                FinalScore = 172,
                FinalKills = 130,
                FinalDeaths = 25,
                MapName = "Wake Island",
                RoundId = "rnd-125"
            },
            new PlayerBestScore
            {
                PlayerName = "Valkyrie",
                ServerGuid = "srv-1",
                Period = "all_time",
                Rank = 1,
                FinalScore = 140,
                FinalKills = 95,
                FinalDeaths = 30,
                MapName = "Wake Island",
                RoundId = "rnd-126"
            },
            new PlayerBestScore
            {
                PlayerName = "ApexSoldier",
                ServerGuid = "srv-2",
                Period = "all_time",
                Rank = 2,
                FinalScore = 148,
                FinalKills = 100,
                FinalDeaths = 24,
                MapName = "Stalingrad",
                RoundId = "rnd-202"
            },
            new PlayerBestScore
            {
                PlayerName = "EagleEye",
                ServerGuid = "srv-2",
                Period = "all_time",
                Rank = 2,
                FinalScore = 155,
                FinalKills = 110,
                FinalDeaths = 28,
                MapName = "Stalingrad",
                RoundId = "rnd-201"
            },
            new PlayerBestScore
            {
                PlayerName = "PanzerGeneral",
                ServerGuid = "srv-2",
                Period = "all_time",
                Rank = 2,
                FinalScore = 210,
                FinalKills = 155,
                FinalDeaths = 20,
                MapName = "Stalingrad",
                RoundId = "rnd-200"
            },
            new PlayerBestScore
            {
                PlayerName = "Valkyrie",
                ServerGuid = "srv-2",
                Period = "all_time",
                Rank = 2,
                FinalScore = 132,
                FinalKills = 88,
                FinalDeaths = 35,
                MapName = "Stalingrad",
                RoundId = "rnd-203"
            }
        );

        _dbContext.MapGlobalAverages.AddRange(
            new MapGlobalAverage { MapName = "Wake Island", AvgKillRate = 3.5, AvgScoreRate = 5.2 },
            new MapGlobalAverage { MapName = "Omaha Beach", AvgKillRate = 4.1, AvgScoreRate = 6.0 },
            new MapGlobalAverage { MapName = "El Alamein", AvgKillRate = 2.8, AvgScoreRate = 4.1 },
            new MapGlobalAverage { MapName = "Stalingrad", AvgKillRate = 3.9, AvgScoreRate = 5.5 }
        );

        _dbContext.SaveChanges();
    }

    public void Dispose()
    {
        _dbContext.Dispose();
        _connection.Dispose();
        _memoryCache.Dispose();
    }

    [Fact]
    public async Task GetArcadeServers_ReturnsServersWithCandidateCounts()
    {
        var servers = await _service.GetArcadeServersAsync();

        Assert.NotEmpty(servers);
        var srv1 = servers.FirstOrDefault(s => s.Guid == "srv-1");
        Assert.NotNull(srv1);
        Assert.Equal("Simple 24/7 Wake", srv1.Name);
        Assert.Equal(8, srv1.CurrentPlayers);
        Assert.True(srv1.TotalCandidates >= 4);
    }

    [Fact]
    public async Task GetNextHigherLowerQuestion_ServerScoped_ReturnsServerContext()
    {
        var question = await _service.GetNextHigherLowerQuestionAsync("srv-1");

        Assert.NotNull(question);
        Assert.NotEmpty(question.MetricLabel);
        Assert.NotEmpty(question.Prompt);
        Assert.NotEmpty(question.PlayerA.Name);
        Assert.NotEmpty(question.PlayerB.Name);
        Assert.NotEqual(question.PlayerA.Name, question.PlayerB.Name);
        if (question.MapName != null)
        {
            Assert.Equal("Wake Island", question.MapName);
            Assert.Contains("Wake Island", question.MetricLabel, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("Wake Island", question.Prompt, StringComparison.OrdinalIgnoreCase);
        }
        else
        {
            Assert.Contains("Simple 24/7 Wake", question.MetricLabel);
        }
    }

    [Fact]
    public async Task GetNextHigherLowerQuestion_Global_ReturnsValidPairWithBothMasked()
    {
        var question = await _service.GetNextHigherLowerQuestionAsync();

        Assert.NotNull(question);
        Assert.NotEmpty(question.Metric);
        Assert.NotEmpty(question.MetricLabel);
        Assert.NotEmpty(question.Prompt);
        Assert.NotEmpty(question.PlayerA.Name);
        Assert.Null(question.PlayerA.Value);
        Assert.NotEmpty(question.PlayerB.Name);
        Assert.Null(question.PlayerB.Value);
        Assert.NotEmpty(question.RoundToken);
        Assert.NotEqual(question.PlayerA.Name, question.PlayerB.Name);
    }

    [Fact]
    public async Task GetNextHigherLowerQuestion_PrefersSharedMapMatchups()
    {
        var mapQuestions = 0;
        var signatures = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < 16; i++)
        {
            var question = await _service.GetNextHigherLowerQuestionAsync();
            signatures.Add($"{question.Metric}:{question.MapName}");
            if (string.IsNullOrWhiteSpace(question.MapName))
            {
                continue;
            }

            mapQuestions++;
            Assert.Contains(question.MapName, new[] { "Wake Island", "Stalingrad" });
            Assert.Contains(question.MapName, question.MetricLabel, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(question.MapName, question.Prompt, StringComparison.OrdinalIgnoreCase);
            Assert.Null(question.PlayerA.Value);
            Assert.Null(question.PlayerB.Value);
        }

        Assert.True(mapQuestions >= 12, $"Expected mostly map-scoped matchups, got {mapQuestions}/16");
        Assert.True(signatures.Count >= 2, "Matchups should vary metric or map instead of repeating one career stat");
    }

    [Fact]
    public async Task RevealHigherLower_MapMatchup_MentionsSharedMap()
    {
        HigherLowerQuestionDto? mapped = null;
        for (var i = 0; i < 12 && mapped == null; i++)
        {
            var question = await _service.GetNextHigherLowerQuestionAsync();
            if (!string.IsNullOrWhiteSpace(question.MapName))
            {
                mapped = question;
            }
        }

        Assert.NotNull(mapped);
        var reveal = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(mapped.RoundToken, "higher"));
        Assert.Contains(mapped.MapName!, reveal.Message, StringComparison.OrdinalIgnoreCase);
        Assert.NotNull(reveal.NextQuestion);
        Assert.NotEmpty(reveal.NextQuestion!.Prompt);
    }

    [Fact]
    public async Task RevealHigherLower_CorrectGuess_ReturnsSuccessAndNextQuestion()
    {
        var question = await _service.GetNextHigherLowerQuestionAsync();

        var revealHigh = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(question.RoundToken, "higher"));
        var revealLow = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(question.RoundToken, "lower"));

        Assert.NotNull(revealHigh);
        Assert.NotNull(revealLow);
        Assert.NotNull(revealHigh.FormattedPlayerAValue);
        Assert.NotNull(revealLow.FormattedPlayerAValue);

        var actualBHigher = revealHigh.PlayerBValue >= revealHigh.PlayerAValue;
        Assert.Equal(actualBHigher, revealHigh.IsCorrect);
        Assert.Equal(!actualBHigher || Math.Abs(revealHigh.PlayerBValue - revealHigh.PlayerAValue) < 0.0001, revealLow.IsCorrect);

        var winner = actualBHigher ? revealHigh : revealLow;
        Assert.True(winner.IsCorrect);
        Assert.NotNull(winner.NextQuestion);
    }

    [Fact]
    public async Task RevealHigherLower_GuessByPlayerAOrPlayerB_EvaluatesCorrectly()
    {
        var question = await _service.GetNextHigherLowerQuestionAsync();

        var revealA = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(question.RoundToken, "playerA"));
        var revealB = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(question.RoundToken, "playerB"));

        Assert.NotNull(revealA);
        Assert.NotNull(revealB);
        Assert.NotEmpty(revealA.FormattedPlayerAValue!);
        Assert.NotEmpty(revealA.FormattedPlayerBValue);

        var actualAHigher = revealA.PlayerAValue >= revealA.PlayerBValue;
        Assert.Equal(actualAHigher, revealA.IsCorrect);
        var actualBHigher = revealB.PlayerBValue >= revealB.PlayerAValue;
        Assert.Equal(actualBHigher, revealB.IsCorrect);
    }

    [Fact]
    public async Task RevealHigherLower_GuessByPlayerName_EvaluatesCorrectly()
    {
        var question = await _service.GetNextHigherLowerQuestionAsync();

        var revealNameA = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(question.RoundToken, question.PlayerA.Name));
        Assert.NotNull(revealNameA);
        var actualAHigher = revealNameA.PlayerAValue >= revealNameA.PlayerBValue;
        Assert.Equal(actualAHigher, revealNameA.IsCorrect);
    }

    [Fact]
    public async Task RevealHigherLower_NextQuestion_DoesNotAnchorRightPlayerToLeft()
    {
        var matchedCarriedCount = 0;
        for (var i = 0; i < 20; i++)
        {
            var q = await _service.GetNextHigherLowerQuestionAsync();
            var rev = await _service.RevealHigherLowerAsync(new HigherLowerRevealRequest(q.RoundToken, "playerA"));
            if (rev.NextQuestion != null && string.Equals(rev.NextQuestion.PlayerA.Name, q.PlayerB.Name, StringComparison.OrdinalIgnoreCase))
            {
                matchedCarriedCount++;
            }
        }

        Assert.True(matchedCarriedCount < 10, $"Expected freshly randomized candidates, but PlayerB was carried to PlayerA {matchedCarriedCount}/20 times");
    }

    [Fact]
    public async Task RevealHigherLower_TamperedToken_ThrowsArgumentException()
    {
        var request = new HigherLowerRevealRequest("corrupted_invalid_token", "higher");

        await Assert.ThrowsAsync<ArgumentException>(() => _service.RevealHigherLowerAsync(request));
    }

    [Fact]
    public async Task GetDailyMysteryDossier_ReturnsDeterministicDossier()
    {
        var dossier1 = await _service.GetDailyMysteryDossierAsync();
        var dossier2 = await _service.GetDailyMysteryDossierAsync();

        Assert.NotNull(dossier1);
        Assert.NotNull(dossier2);
        Assert.Equal(dossier1.DossierToken, dossier2.DossierToken);
        Assert.Equal(dossier1.KillsBracket, dossier2.KillsBracket);
        Assert.Equal("daily", dossier1.Mode);
        Assert.Equal(dossier1.CandidateOptions, dossier2.CandidateOptions);
    }

    [Fact]
    public async Task GetDailyMysteryDossier_IncludesCandidateOptionsRoster()
    {
        var dossier = await _service.GetDailyMysteryDossierAsync();

        Assert.NotNull(dossier);
        Assert.InRange(dossier.CandidateOptions.Count, 4, 5);
        Assert.Equal(dossier.CandidateOptions.Count, dossier.CandidateOptions.Distinct(StringComparer.OrdinalIgnoreCase).Count());

        var guessWrong = dossier.CandidateOptions[0];
        // Verify guessing works against the roster; if first option is correct, try another
        var result = await _service.GuessMysterySoldierAsync(
            new MysteryGuessRequest(dossier.DossierToken, guessWrong));

        Assert.Contains(result.GuessedPlayerName, dossier.CandidateOptions, StringComparer.OrdinalIgnoreCase);
        Assert.NotNull(result.Kills);
        Assert.NotNull(result.Kills.Value);

        if (!result.IsCorrect)
        {
            Assert.Null(result.TargetPlayerName);
            var remaining = dossier.CandidateOptions
                .Where(n => !string.Equals(n, guessWrong, StringComparison.OrdinalIgnoreCase))
                .ToList();
            Assert.NotEmpty(remaining);

            // Eventually one of the remaining options must be the target
            var found = false;
            foreach (var suspect in remaining)
            {
                var attempt = await _service.GuessMysterySoldierAsync(
                    new MysteryGuessRequest(dossier.DossierToken, suspect));
                if (attempt.IsCorrect)
                {
                    found = true;
                    Assert.Equal(suspect, attempt.TargetPlayerName);
                    Assert.Contains(attempt.TargetPlayerName!, dossier.CandidateOptions, StringComparer.OrdinalIgnoreCase);
                    break;
                }
            }
            Assert.True(found, "Target player must be present in CandidateOptions.");
        }
        else
        {
            Assert.Equal(guessWrong, result.TargetPlayerName);
        }
    }

    [Fact]
    public async Task GetRandomMysteryDossier_IncludesCandidateOptions()
    {
        var dossier = await _service.GetRandomMysteryDossierAsync();

        Assert.NotNull(dossier);
        Assert.Equal("random", dossier.Mode);
        Assert.InRange(dossier.CandidateOptions.Count, 4, 5);
        Assert.All(dossier.CandidateOptions, name => Assert.False(string.IsNullOrWhiteSpace(name)));
    }

    [Fact]
    public async Task GetDailyMysteryDossier_ServerScoped_IsScopedToRegulars()
    {
        var dossier = await _service.GetDailyMysteryDossierAsync("srv-1");

        Assert.NotNull(dossier);
        Assert.Equal("Simple 24/7 Wake", dossier.FavoriteServer);
        Assert.InRange(dossier.CandidateOptions.Count, 4, 5);
    }

    [Fact]
    public async Task GetDailyMysteryDossier_IncludesDynamicAttributes()
    {
        var dossier = await _service.GetDailyMysteryDossierAsync();

        Assert.NotNull(dossier);
        Assert.NotNull(dossier.Attributes);
        Assert.NotEmpty(dossier.Attributes);
        Assert.InRange(dossier.Attributes.Count, 4, 6);
        Assert.All(dossier.Attributes, a =>
        {
            Assert.False(string.IsNullOrWhiteSpace(a.Key));
            Assert.False(string.IsNullOrWhiteSpace(a.Label));
            Assert.False(string.IsNullOrWhiteSpace(a.Value));
        });
    }

    [Fact]
    public async Task GetRandomMysteryDossier_ExcludesSpecifiedPlayer()
    {
        // Sample repeatedly with exclusion to verify excluded player is never picked as target
        var targetToExclude = "Sgt_Rock";
        for (var i = 0; i < 15; i++)
        {
            var dossier = await _service.GetRandomMysteryDossierAsync(null, null, targetToExclude);
            var result = await _service.GuessMysterySoldierAsync(new MysteryGuessRequest(dossier.DossierToken, targetToExclude));
            // If excluded, guessing targetToExclude should never be correct
            Assert.False(result.IsCorrect);
        }
    }

    [Fact]
    public async Task GuessMysterySoldier_ReturnsDynamicAttributeMatches()
    {
        var dossier = await _service.GetDailyMysteryDossierAsync();
        Assert.NotNull(dossier.Attributes);

        var guess = dossier.CandidateOptions[0];
        var result = await _service.GuessMysterySoldierAsync(new MysteryGuessRequest(dossier.DossierToken, guess));

        Assert.NotNull(result.Attributes);
        Assert.Equal(dossier.Attributes.Count, result.Attributes.Count);
        Assert.Equal(dossier.Attributes.Select(a => a.Key), result.Attributes.Select(a => a.Key));
        Assert.All(result.Attributes, a =>
        {
            Assert.False(string.IsNullOrWhiteSpace(a.Key));
            Assert.False(string.IsNullOrWhiteSpace(a.Label));
            Assert.False(string.IsNullOrWhiteSpace(a.Value));
        });
    }

    [Fact]
    public async Task ConcedeMysterySoldier_RevealsTargetIdentity()
    {
        var dossier = await _service.GetDailyMysteryDossierAsync();
        Assert.NotNull(dossier.DossierToken);

        var concedeResult = await _service.ConcedeMysterySoldierAsync(new MysteryConcedeRequest(dossier.DossierToken));

        Assert.NotNull(concedeResult);
        Assert.False(string.IsNullOrWhiteSpace(concedeResult.TargetPlayerName));
        Assert.Contains(concedeResult.TargetPlayerName, dossier.CandidateOptions, StringComparer.OrdinalIgnoreCase);

        // Submitting this revealed target name as a guess should return IsCorrect == true
        var guessResult = await _service.GuessMysterySoldierAsync(new MysteryGuessRequest(dossier.DossierToken, concedeResult.TargetPlayerName));
        Assert.True(guessResult.IsCorrect);
    }

    [Fact]
    public async Task GenerateTriviaQuiz_ServerScoped_CreatesServerQuestions()
    {
        var quiz = await _service.GenerateTriviaQuizAsync("srv-1");

        Assert.NotNull(quiz);
        Assert.Equal(5, quiz.Questions.Count);

        // One of the questions asks about Simple 24/7 Wake's most played map or legend
        Assert.Contains(quiz.Questions, q => q.Question.Contains("Simple 24/7 Wake"));
        Assert.All(quiz.Questions, q => Assert.DoesNotContain("V - 1", q.Question, StringComparison.OrdinalIgnoreCase));
        Assert.All(quiz.Questions, q => Assert.DoesNotContain("commo-rose", q.Question, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task GenerateTriviaQuiz_RoundSpecificQuestion_ProvidesTargetRoundId()
    {
        var quiz = await _service.GenerateTriviaQuizAsync("srv-1");

        Assert.NotNull(quiz);
        var roundQuestion = quiz.Questions.FirstOrDefault(q => !string.IsNullOrEmpty(q.TargetRoundId));
        Assert.NotNull(roundQuestion);
        Assert.Equal("rnd-123", roundQuestion.TargetRoundId);

        var verifyResult = await _service.VerifyTriviaQuestionAsync(new TriviaVerifyQuestionRequest(
            quiz.QuizToken,
            roundQuestion.Id,
            "ApexSoldier"
        ));
        Assert.Equal("rnd-123", verifyResult.TargetRoundId);
    }

    [Fact]
    public async Task GenerateTriviaQuiz_IncludesMapOrPeriodScopedPlayerQuestions()
    {
        var quiz = await _service.GenerateTriviaQuizAsync();

        Assert.NotNull(quiz);
        Assert.Equal(5, quiz.Questions.Count);

        var scoped = quiz.Questions.Where(q =>
            q.Id.StartsWith("map_player_", StringComparison.Ordinal)
            || q.Id.StartsWith("player_map_", StringComparison.Ordinal)
            || q.Id.StartsWith("period_", StringComparison.Ordinal)
            || q.Id.StartsWith("map_best_", StringComparison.Ordinal)
            || q.Question.Contains("On ", StringComparison.Ordinal)
            || q.Question.Contains("On which map", StringComparison.Ordinal)
            || q.Question.Contains("In ", StringComparison.Ordinal)
            || q.Question.Contains("During ", StringComparison.Ordinal)).ToList();

        Assert.NotEmpty(scoped);

        // Prefer scoped player questions over easy all-time crowns when data exists
        Assert.DoesNotContain(quiz.Questions, q => q.Id is "top_kills" or "top_score" or "top_playtime");

        var mapOrPeriodWording = quiz.Questions.Any(q =>
            q.Question.Contains("On Wake Island", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("On Stalingrad", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("October 2024", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("September 2026", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("During ", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("highest single-round score", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("On which map", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("Kill/Death", StringComparison.OrdinalIgnoreCase)
            || q.Question.Contains("kill rate", StringComparison.OrdinalIgnoreCase));

        Assert.True(mapOrPeriodWording, "Expected at least one map- or period-scoped trivia question.");
    }

    [Fact]
    public async Task GenerateTriviaQuiz_UsesOnlyDatabaseBackedQuestions()
    {
        var quiz = await _service.GenerateTriviaQuizAsync();

        Assert.NotNull(quiz);
        Assert.Equal(5, quiz.Questions.Count);

        var forbiddenFragments = new[]
        {
            "V - 1",
            "commo-rose",
            "Enemy boat spotted",
            "landmines and the vehicle repair wrench",
            "ticket bleed",
            "B-17 Flying Fortress",
            "horseshoe-shaped atoll"
        };

        foreach (var question in quiz.Questions)
        {
            Assert.False(question.Id.StartsWith("classic_", StringComparison.Ordinal));
            Assert.Equal(4, question.Options.Count);
            foreach (var fragment in forbiddenFragments)
            {
                Assert.DoesNotContain(fragment, question.Question, StringComparison.OrdinalIgnoreCase);
                Assert.All(question.Options, opt => Assert.DoesNotContain(fragment, opt, StringComparison.OrdinalIgnoreCase));
            }
        }

        // Every option set must resolve against seeded DB entities (players, maps, or servers)
        var knownPlayers = new HashSet<string>(["ApexSoldier", "EagleEye", "PanzerGeneral", "Valkyrie"], StringComparer.Ordinal);
        var knownMaps = new HashSet<string>(["Wake Island", "Omaha Beach", "El Alamein", "Stalingrad", "Midway", "Iwo Jima", "Guadalcanal", "Bocage"], StringComparer.Ordinal);
        var knownServers = new HashSet<string>(["Simple 24/7 Wake", "Berlin Rotation", "Nordic Front"], StringComparer.Ordinal);

        Assert.All(quiz.Questions, q =>
        {
            var allKnown = q.Options.All(o => knownPlayers.Contains(o) || knownMaps.Contains(o) || knownServers.Contains(o));
            Assert.True(allKnown, $"Question '{q.Id}' has options not present in seeded DB data: {string.Join(", ", q.Options)}");
        });
    }

    [Fact]
    public async Task GenerateAndVerifyTriviaQuiz_EvaluatesCorrectly()
    {
        var quiz = await _service.GenerateTriviaQuizAsync();

        Assert.NotNull(quiz);
        Assert.Equal(5, quiz.Questions.Count);
        Assert.NotEmpty(quiz.QuizToken);

        foreach (var q in quiz.Questions)
        {
            Assert.NotEmpty(q.Question);
            Assert.NotEmpty(q.Category);
            Assert.Equal(4, q.Options.Count);
        }

        var emptyAnswers = new Dictionary<string, string>();
        var result = await _service.VerifyTriviaQuizAsync(new TriviaVerifyRequest(quiz.QuizToken, emptyAnswers));

        Assert.NotNull(result);
        Assert.Equal(5, result.TotalQuestions);
        Assert.Equal(0, result.CorrectCount);
        Assert.Equal(0, result.ScorePercentage);
        Assert.NotEmpty(result.RankTitle);
        Assert.NotEmpty(result.SummaryMessage);
        Assert.Equal(5, result.QuestionResults.Count);
    }

    [Fact]
    public async Task SearchPlayers_FiltersCorrectly()
    {
        var results = await _service.SearchPlayersAsync("Apex");

        Assert.Single(results);
        Assert.Equal("ApexSoldier", results[0].Name);
    }

    [Fact]
    public async Task ArcadeController_EndpointsReturnOk()
    {
        var srvAction = await _controller.GetArcadeServers();
        var srvResult = Assert.IsType<OkObjectResult>(srvAction.Result);
        Assert.IsAssignableFrom<IReadOnlyList<ArcadeServerDto>>(srvResult.Value);

        var qAction = await _controller.GetNextHigherLower(serverGuid: "srv-1");
        var qResult = Assert.IsType<OkObjectResult>(qAction.Result);
        var q = Assert.IsType<HigherLowerQuestionDto>(qResult.Value);

        var revealAction = await _controller.RevealHigherLower(new HigherLowerRevealRequest(q.RoundToken, "higher"));
        var revealResult = Assert.IsType<OkObjectResult>(revealAction.Result);
        Assert.IsType<HigherLowerRevealResultDto>(revealResult.Value);

        var mysteryAction = await _controller.GetDailyMystery(serverGuid: "srv-1");
        var mysteryResult = Assert.IsType<OkObjectResult>(mysteryAction.Result);
        Assert.IsType<MysteryDossierDto>(mysteryResult.Value);

        var triviaAction = await _controller.GenerateTriviaQuiz(serverGuid: "srv-1");
        var triviaResult = Assert.IsType<OkObjectResult>(triviaAction.Result);
        var quizDto = Assert.IsType<TriviaQuizDto>(triviaResult.Value);

        var verifySingleAction = await _controller.VerifyTriviaQuestion(new TriviaVerifyQuestionRequest(
            quizDto.QuizToken,
            quizDto.Questions[0].Id,
            quizDto.Questions[0].Options[0]
        ));
        var verifySingleResult = Assert.IsType<OkObjectResult>(verifySingleAction.Result);
        Assert.IsType<TriviaQuestionVerificationDto>(verifySingleResult.Value);
    }

    [Fact]
    public async Task VerifyTriviaQuestion_SingleQuestion_EvaluatesCorrectly()
    {
        var quiz = await _service.GenerateTriviaQuizAsync();
        Assert.NotEmpty(quiz.Questions);

        var q = quiz.Questions[0];
        var guess = q.Options[0];

        var result = await _service.VerifyTriviaQuestionAsync(new TriviaVerifyQuestionRequest(quiz.QuizToken, q.Id, guess));

        Assert.NotNull(result);
        Assert.Equal(q.Id, result.QuestionId);
        Assert.Equal(guess, result.SelectedAnswer);
        Assert.NotEmpty(result.CorrectAnswer);
        Assert.NotEmpty(result.Explanation);
        Assert.Contains(result.CorrectAnswer, q.Options);
    }

    [Fact]
    public async Task GenerateTriviaQuiz_MultipleGenerations_ProvidesVariety()
    {
        var allQuestionIds = new HashSet<string>();

        for (var i = 0; i < 5; i++)
        {
            var quiz = await _service.GenerateTriviaQuizAsync();
            foreach (var q in quiz.Questions)
            {
                allQuestionIds.Add(q.Id);
            }
        }

        // Multiple distinct generations draw varied questions from the pool rather than a fixed 5
        Assert.True(allQuestionIds.Count > 5, $"Expected more than 5 distinct question IDs across 5 runs, got {allQuestionIds.Count}");
    }

    [Fact]
    public async Task GenerateTriviaQuiz_ServerScoped_MultipleGenerations_ProvidesVariety()
    {
        var allQuestionIds = new HashSet<string>();
        var firstQuestionIds = new HashSet<string>();

        for (var i = 0; i < 5; i++)
        {
            var quiz = await _service.GenerateTriviaQuizAsync("srv-1");
            Assert.NotNull(quiz);
            Assert.Equal(5, quiz.Questions.Count);

            firstQuestionIds.Add(quiz.Questions[0].Id);
            foreach (var q in quiz.Questions)
            {
                allQuestionIds.Add(q.Id);
            }
        }

        // Multiple distinct generations draw varied questions from the server pool rather than a fixed 5
        Assert.True(allQuestionIds.Count > 5, $"Expected more than 5 distinct question IDs across 5 server runs, got {allQuestionIds.Count}");
        // Q1 must not always be the exact same question
        Assert.True(firstQuestionIds.Count > 1, $"Expected Q1 to vary across server runs, got only {firstQuestionIds.Count} distinct ID(s): {string.Join(", ", firstQuestionIds)}");
    }

    [Fact]
    public void TriviaQuestionComposer_BuildsPlayerBestMapAndMapKdQuestions()
    {
        var facts = new List<PlayerMapFact>
        {
            new("ApexSoldier", "Wake Island", 15000, 8000, 25000, 12000, 50),
            new("ApexSoldier", "Stalingrad", 5000, 4000, 9000, 5000, 20),
            new("EagleEye", "Wake Island", 9000, 4000, 16000, 8000, 40),
            new("EagleEye", "Stalingrad", 7000, 2800, 12000, 5500, 25),
            new("PanzerGeneral", "Wake Island", 12000, 10000, 21000, 10000, 60),
            new("PanzerGeneral", "Stalingrad", 18000, 12000, 32000, 14000, 45),
            new("PanzerGeneral", "Bocage", 22000, 11000, 38000, 16000, 80),
            new("Valkyrie", "Wake Island", 4000, 3500, 7000, 4500, 30),
            new("Valkyrie", "Stalingrad", 3500, 3000, 6000, 3200, 18)
        };
        var maps = new[] { "Wake Island", "Stalingrad", "Bocage", "Midway" };

        var questions = TriviaQuestionComposer.Compose(facts, maps);

        var apexKillsMap = questions.Single(q => q.Id == "player_map_kills_apexsoldier");
        Assert.Equal("Wake Island", apexKillsMap.CorrectAnswer);
        Assert.Contains("On which map has ApexSoldier recorded the most kills?", apexKillsMap.Question);
        Assert.Equal(4, apexKillsMap.Options.Count);

        var apexKillRate = questions.Single(q => q.Id == "player_map_killrate_apexsoldier");
        Assert.Equal("Wake Island", apexKillRate.CorrectAnswer);

        var wakeKd = questions.Single(q => q.Id == "map_player_kd_wake_island");
        Assert.Equal("EagleEye", wakeKd.CorrectAnswer);
        Assert.Contains("Kill/Death", wakeKd.Question);

        var wakeKillRate = questions.Single(q => q.Id == "map_player_killrate_wake_island");
        Assert.Equal("ApexSoldier", wakeKillRate.CorrectAnswer);

        Assert.Contains(questions, q => q.Id.StartsWith("player_map_", StringComparison.Ordinal));
        Assert.Contains(questions, q => q.Id.StartsWith("map_player_", StringComparison.Ordinal));
        Assert.True(questions.Count > 8, $"Expected a combinatorial pool, got {questions.Count}");
    }

    [Fact]
    public async Task GenerateTriviaQuiz_ServerScoped_FactionBalance_HasOnlyTwoOptionsFromStats()
    {
        TriviaQuizDto? quizWithBalance = null;
        TriviaQuestionDto? balanceQuestion = null;

        for (var i = 0; i < 20; i++)
        {
            var quiz = await _service.GenerateTriviaQuizAsync("srv-1");
            balanceQuestion = quiz.Questions.FirstOrDefault(x => x.Id.StartsWith("srv_team_balance_"));
            if (balanceQuestion != null)
            {
                quizWithBalance = quiz;
                break;
            }
        }

        Assert.NotNull(balanceQuestion);
        Assert.NotNull(quizWithBalance);

        // Exactly 2 options representing the competing sides on that map
        Assert.Equal(2, balanceQuestion.Options.Count);
        Assert.Contains("Imperial Navy", balanceQuestion.Options);
        Assert.True(balanceQuestion.Options.Contains("US Marines") || balanceQuestion.Options.Contains("US Navy"));

        // No hallucinated distractors
        Assert.DoesNotContain("Allies", balanceQuestion.Options);
        Assert.DoesNotContain("Axis", balanceQuestion.Options);

        var verifyResult = await _service.VerifyTriviaQuestionAsync(new TriviaVerifyQuestionRequest(
            quizWithBalance.QuizToken,
            balanceQuestion.Id,
            balanceQuestion.Options[0]
        ));
        Assert.NotNull(verifyResult);
        Assert.Contains(verifyResult.CorrectAnswer, balanceQuestion.Options);
    }

    [Fact]
    public async Task GenerateTriviaQuiz_ServerScoped_FactionBalance_ResolvesThreeFactionsToTwoHighest()
    {
        _dbContext.Servers.Add(new GameServer
        {
            Guid = "srv-multi-faction",
            Name = "Multi Faction Server",
            Country = "US",
            Game = "bf1942",
            IsOnline = true
        });

        _dbContext.ServerMapStats.AddRange(
            new ServerMapStats
            {
                ServerGuid = "srv-multi-faction",
                MapName = "Bocage",
                Year = 2026,
                Month = 8,
                TotalRounds = 120,
                TotalPlayTimeMinutes = 3000,
                Team1Victories = 60,
                Team2Victories = 50,
                Team1Label = "Axis",
                Team2Label = "Allied"
            },
            new ServerMapStats
            {
                ServerGuid = "srv-multi-faction",
                MapName = "Bocage",
                Year = 2026,
                Month = 9,
                TotalRounds = 100,
                TotalPlayTimeMinutes = 2500,
                Team1Victories = 40,
                Team2Victories = 30,
                Team1Label = "Axis",
                Team2Label = "Allied"
            },
            new ServerMapStats
            {
                ServerGuid = "srv-multi-faction",
                MapName = "Bocage",
                Year = 2026,
                Month = 7,
                TotalRounds = 10,
                TotalPlayTimeMinutes = 200,
                Team1Victories = 5,
                Team2Victories = 2,
                Team1Label = "RogueFaction",
                Team2Label = "Allied"
            }
        );
        await _dbContext.SaveChangesAsync();

        var quiz = await _service.GenerateTriviaQuizAsync("srv-multi-faction");
        Assert.NotNull(quiz);

        var balanceQuestion = quiz.Questions.FirstOrDefault(q => q.Id == "srv_team_balance_bocage");
        Assert.NotNull(balanceQuestion);

        // Only the 2 highest factions are presented; RogueFaction is excluded
        Assert.Equal(2, balanceQuestion.Options.Count);
        Assert.Contains("Axis", balanceQuestion.Options);
        Assert.Contains("Allied", balanceQuestion.Options);
        Assert.DoesNotContain("RogueFaction", balanceQuestion.Options);

        var verify = await _service.VerifyTriviaQuestionAsync(new TriviaVerifyQuestionRequest(
            quiz.QuizToken,
            balanceQuestion.Id,
            "Axis"
        ));
        Assert.True(verify.IsCorrect);
        Assert.Equal("Axis", verify.CorrectAnswer);
        Assert.Contains("100 wins versus Allied's 82 wins", verify.Explanation);
    }

    [Fact]
    public void RelationshipTrivia_BuildsUniqueWingmanLongestAndRecentQuestions()
    {
        var questions = ArcadeRelationshipTrivia.FromCoPlayers("ApexSoldier",
        [
            Rel("EagleEye", 80, new DateTime(2022, 1, 1), new DateTime(2026, 6, 1)),
            Rel("OrbitBuddy", 40, new DateTime(2023, 5, 1), new DateTime(2026, 8, 1)),
            Rel("Valkyrie", 20, new DateTime(2024, 2, 1), new DateTime(2026, 4, 1)),
            Rel("ExtraFour", 10, new DateTime(2025, 3, 1), new DateTime(2026, 9, 1))
        ]);

        Assert.Equal(3, questions.Count);
        Assert.Contains(questions, q => q.Id == "rel_wingman_apexsoldier" && q.CorrectAnswer == "EagleEye");
        Assert.Contains(questions, q => q.Id == "rel_longest_apexsoldier" && q.CorrectAnswer == "EagleEye");
        Assert.Contains(questions, q => q.Id == "rel_recent_apexsoldier" && q.CorrectAnswer == "ExtraFour");
        Assert.All(questions, q => Assert.Equal(4, q.Options.Count));
    }

    [Fact]
    public void RelationshipTrivia_SkipsTiedLeaders()
    {
        var questions = ArcadeRelationshipTrivia.FromCoPlayers("ApexSoldier",
        [
            Rel("EagleEye", 40, new DateTime(2022, 1, 1), new DateTime(2026, 6, 1)),
            Rel("OrbitBuddy", 40, new DateTime(2022, 1, 1), new DateTime(2026, 6, 1)),
            Rel("Valkyrie", 20, new DateTime(2024, 2, 1), new DateTime(2026, 4, 1)),
            Rel("ExtraFour", 10, new DateTime(2025, 3, 1), new DateTime(2026, 4, 1))
        ]);

        Assert.DoesNotContain(questions, q => q.Id.StartsWith("rel_wingman_", StringComparison.Ordinal));
        Assert.DoesNotContain(questions, q => q.Id.StartsWith("rel_longest_", StringComparison.Ordinal));
        Assert.DoesNotContain(questions, q => q.Id.StartsWith("rel_recent_", StringComparison.Ordinal));
    }

    [Fact]
    public async Task OrbitPlayer_BiasesMysteryRosterAndAddsRelationshipTrivia()
    {
        _dbContext.PlayerStatsMonthly.AddRange(
            new PlayerStatsMonthly
            {
                PlayerName = "OrbitBuddy",
                Year = 2026,
                Month = 9,
                TotalKills = 12,
                TotalDeaths = 10,
                TotalScore = 20,
                TotalPlayTimeMinutes = 40
            },
            new PlayerStatsMonthly
            {
                PlayerName = "ExtraFour",
                Year = 2026,
                Month = 9,
                TotalKills = 8,
                TotalDeaths = 8,
                TotalScore = 15,
                TotalPlayTimeMinutes = 30
            });
        await _dbContext.SaveChangesAsync();

        var relationships = Substitute.For<api.PlayerRelationships.IPlayerRelationshipService>();
        relationships.GetMostFrequentCoPlayersAsync("ApexSoldier", 100, Arg.Any<CancellationToken>())
            .Returns(Task.FromResult(new List<api.PlayerRelationships.Models.PlayerRelationship>
            {
                Rel("EagleEye", 80, new DateTime(2022, 1, 1), new DateTime(2026, 6, 1)),
                Rel("OrbitBuddy", 40, new DateTime(2023, 5, 1), new DateTime(2026, 8, 1)),
                Rel("Valkyrie", 20, new DateTime(2024, 2, 1), new DateTime(2026, 4, 1)),
                Rel("ExtraFour", 10, new DateTime(2025, 3, 1), new DateTime(2026, 9, 1))
            }));

        var serviceProvider = Substitute.For<IServiceProvider>();
        serviceProvider.GetService(typeof(api.PlayerRelationships.IPlayerRelationshipService)).Returns(relationships);
        var orbitService = new ArcadeService(_dbContext, _memoryCache, _serviceLogger, serviceProvider);

        var dossier = await orbitService.GetRandomMysteryDossierAsync(orbitPlayer: "ApexSoldier");
        Assert.Contains("OrbitBuddy", dossier.CandidateOptions, StringComparer.OrdinalIgnoreCase);

        var quiz = await orbitService.GenerateTriviaQuizAsync(orbitPlayer: "ApexSoldier");
        Assert.Contains(quiz.Questions, q => q.Id.StartsWith("rel_", StringComparison.Ordinal));
    }

    private static api.PlayerRelationships.Models.PlayerRelationship Rel(
        string other,
        int sessions,
        DateTime first,
        DateTime last)
        => new()
        {
            Player1Name = "ApexSoldier",
            Player2Name = other,
            SessionCount = sessions,
            FirstPlayedTogether = first,
            LastPlayedTogether = last
        };
}
