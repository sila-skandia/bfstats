using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using api.Arcade.Models;
using api.Data.Entities;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace api.Arcade;

public class ArcadeService(
    PlayerTrackerDbContext dbContext,
    IMemoryCache memoryCache,
    ILogger<ArcadeService> logger) : IArcadeService
{
    private const string ServerListCacheKey = "Arcade:Servers";
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);
    private static readonly byte[] TokenSigningKey = RandomNumberGenerator.GetBytes(32);
    private static readonly string[] CareerMetrics = ["kills", "score", "playtime", "kd"];
    private static readonly string[] MapMetrics = ["kills", "score", "playtime", "kd", "rounds", "killrate"];
    private static readonly IReadOnlyDictionary<string, IReadOnlyList<PlayerMapSnapshot>> EmptyMapSnapshots =
        new Dictionary<string, IReadOnlyList<PlayerMapSnapshot>>(StringComparer.OrdinalIgnoreCase);

    private static readonly IReadOnlyDictionary<string, IReadOnlyList<PlayerMapSnapshot>> DefaultMapSnapshots =
        new Dictionary<string, IReadOnlyList<PlayerMapSnapshot>>(StringComparer.OrdinalIgnoreCase)
        {
            ["Sgt_Rock"] =
            [
                new("Wake Island", 6200, 3100, 9800, 140, 48, 2.00, 0.74),
                new("Omaha Beach", 4100, 2800, 7200, 95, 32, 1.46, 0.72)
            ],
            ["Panzer_Ace"] =
            [
                new("Bocage", 9100, 3600, 15200, 180, 62, 2.53, 0.84),
                new("Stalingrad", 5400, 2900, 9100, 110, 38, 1.86, 0.82)
            ],
            ["Red_Baron"] =
            [
                new("El Alamein", 4800, 2200, 8100, 88, 29, 2.18, 0.91),
                new("Stalingrad", 3900, 2100, 6700, 72, 24, 1.86, 0.90)
            ],
            ["Major_Kong"] =
            [
                new("Bocage", 3500, 2700, 6100, 78, 26, 1.30, 0.75),
                new("Market Garden", 2900, 2400, 5200, 64, 21, 1.21, 0.76)
            ],
            ["Desert_Fox"] =
            [
                new("Tobruk", 7200, 3100, 11800, 150, 44, 2.32, 0.80),
                new("Bocage", 4100, 2500, 7400, 86, 28, 1.64, 0.79)
            ],
            ["Viper_42"] =
            [
                new("Wake Island", 5100, 3400, 8600, 120, 41, 1.50, 0.71),
                new("Midway", 2600, 1900, 4500, 58, 18, 1.37, 0.75)
            ],
            ["Ghost_Sniper"] =
            [
                new("Stalingrad", 4700, 1800, 7900, 92, 30, 2.61, 0.85),
                new("Kharkov", 2200, 1500, 3900, 48, 16, 1.47, 0.76)
            ],
            ["Iron_Duke"] =
            [
                new("Wake Island", 4300, 3000, 7400, 105, 36, 1.43, 0.68),
                new("Battleaxe", 3900, 2600, 6800, 88, 27, 1.50, 0.74)
            ]
        };

    private static ArcadeRoster DefaultRoster => new(DefaultCandidates, DefaultMapSnapshots);

    private static readonly IReadOnlyList<ArcadeCandidate> DefaultCandidates =
    [
        new("Sgt_Rock", "US", 14500, 24800, 320, 1.85, "Omaha Beach", "Simple 24/7 Wake", "Sharpshooter"),
        new("Panzer_Ace", "DE", 18200, 31200, 410, 2.10, "Bocage", "BFClassic Rotation", "Tank Buster"),
        new("Red_Baron", "DE", 12100, 21900, 280, 1.95, "El Alamein", "Desert Rats BF", "Ace Pilot"),
        new("Major_Kong", "GB", 9800, 17500, 220, 1.45, "Market Garden", "UK Veterans Server", "Iron Man"),
        new("Desert_Fox", "DE", 16400, 28700, 390, 2.05, "Tobruk", "Desert Rats BF", "Tactician"),
        new("Viper_42", "US", 11300, 19400, 250, 1.68, "Wake Island", "Simple 24/7 Wake", "Combat Scout"),
        new("Ghost_Sniper", "SE", 8700, 15100, 190, 1.72, "Stalingrad", "Nordic Warriors", "Deadly Aim"),
        new("Iron_Duke", "CA", 13800, 23500, 310, 1.55, "Battleaxe", "Allied Command", "Frontline Legend")
    ];

    public async Task<IReadOnlyList<ArcadeServerDto>> GetArcadeServersAsync(CancellationToken cancellationToken = default)
    {
        if (memoryCache.TryGetValue(ServerListCacheKey, out IReadOnlyList<ArcadeServerDto>? cached) && cached != null)
        {
            return cached;
        }

        try
        {
            var servers = await dbContext.Servers
                .AsNoTracking()
                .Select(s => new
                {
                    s.Guid,
                    s.Name,
                    Country = s.Country ?? "US",
                    s.CurrentNumPlayers,
                    s.IsOnline
                })
                .ToListAsync(cancellationToken);

            var serverAggregates = await dbContext.PlayerServerStats
                .AsNoTracking()
                .GroupBy(pss => pss.ServerGuid)
                .Select(g => new
                {
                    ServerGuid = g.Key,
                    Count = g.Select(x => x.PlayerName).Distinct().Count(),
                    TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes)
                })
                .ToDictionaryAsync(x => x.ServerGuid, cancellationToken);

            var result = servers
                .Where(s => serverAggregates.ContainsKey(s.Guid) || s.CurrentNumPlayers > 0)
                .Select(s =>
                {
                    serverAggregates.TryGetValue(s.Guid, out var stats);
                    return new ArcadeServerDto(
                        s.Guid,
                        s.Name,
                        s.Country,
                        s.CurrentNumPlayers,
                        stats?.Count ?? 0,
                        stats != null ? Math.Round(stats.TotalPlayTimeMinutes / 60.0, 1) : 0
                    );
                })
                .OrderByDescending(s => s.TotalPlayTimeHours)
                .ThenByDescending(s => s.TotalCandidates)
                .Take(60)
                .ToList();

            memoryCache.Set(ServerListCacheKey, result, CacheDuration);
            return result;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to load arcade servers from database.");
            return [];
        }
    }

    public Task<HigherLowerQuestionDto> GetNextHigherLowerQuestionAsync(
        string? serverGuid = null,
        string? currentCandidateName = null,
        CancellationToken cancellationToken = default)
        => BuildNextHigherLowerAsync(serverGuid, currentCandidateName, null, null, cancellationToken);

    public async Task<HigherLowerRevealResultDto> RevealHigherLowerAsync(
        HigherLowerRevealRequest request,
        CancellationToken cancellationToken = default)
    {
        var payload = ValidateToken<HigherLowerTokenPayload>(request.RoundToken);
        if (payload == null)
        {
            throw new ArgumentException("Invalid or expired round token.");
        }

        var guess = request.Guess.Trim();
        bool isCorrect;

        var isGuessA = string.Equals(guess, "playera", StringComparison.OrdinalIgnoreCase)
            || string.Equals(guess, "a", StringComparison.OrdinalIgnoreCase)
            || NamesEqual(guess, payload.PlayerA);
        var isGuessB = string.Equals(guess, "playerb", StringComparison.OrdinalIgnoreCase)
            || string.Equals(guess, "b", StringComparison.OrdinalIgnoreCase)
            || NamesEqual(guess, payload.PlayerB);

        if (Math.Abs(payload.ValueB - payload.ValueA) < 0.0001)
        {
            isCorrect = true;
        }
        else if (string.Equals(guess, "higher", StringComparison.OrdinalIgnoreCase) || isGuessB)
        {
            isCorrect = payload.ValueB >= payload.ValueA;
        }
        else if (string.Equals(guess, "lower", StringComparison.OrdinalIgnoreCase) || isGuessA)
        {
            isCorrect = payload.ValueA >= payload.ValueB;
        }
        else
        {
            throw new ArgumentException("Guess must be 'playerA', 'playerB', 'higher', 'lower', or a player name.");
        }

        var formattedValA = FormatMetricValue(payload.Metric, payload.ValueA);
        var formattedValB = FormatMetricValue(payload.Metric, payload.ValueB);
        var valuePhraseA = FormatRevealValuePhrase(payload.Metric, formattedValA);
        var valuePhraseB = FormatRevealValuePhrase(payload.Metric, formattedValB);
        var scope = string.IsNullOrWhiteSpace(payload.MapName) ? "" : $" on {payload.MapName}";
        var prefix = isCorrect ? "Correct!" : "Not quite!";
        var message = $"{prefix} {payload.PlayerA} has {valuePhraseA} vs {payload.PlayerB}'s {valuePhraseB}{scope}.";

        var nextQuestion = await BuildNextHigherLowerAsync(
            payload.ServerGuid,
            null,
            payload.Metric,
            payload.MapName,
            cancellationToken);

        return new HigherLowerRevealResultDto(
            isCorrect,
            payload.ValueA,
            payload.ValueB,
            formattedValB,
            message,
            nextQuestion,
            formattedValA
        );
    }

    public async Task<MysteryDossierDto> GetDailyMysteryDossierAsync(
        string? serverGuid = null,
        CancellationToken cancellationToken = default)
    {
        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);
        if (candidates.Count == 0)
        {
            candidates = DefaultCandidates;
        }

        var todayKey = $"{DateTime.UtcNow:yyyy-MM-dd}_{serverGuid ?? "global"}";
        var hash = (uint)todayKey.GetHashCode();
        var index = (int)(hash % (uint)candidates.Count);
        var target = candidates[index];

        var tokenPayload = new MysteryTokenPayload(target.PlayerName, "daily", todayKey, serverGuid);
        var dossierToken = SignPayload(tokenPayload);

        return BuildDossierDto(target, dossierToken, "daily", candidates, (int)hash);
    }

    public async Task<MysteryDossierDto> GetRandomMysteryDossierAsync(
        string? serverGuid = null,
        CancellationToken cancellationToken = default)
    {
        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);
        if (candidates.Count == 0)
        {
            candidates = DefaultCandidates;
        }

        var target = candidates[RandomNumberGenerator.GetInt32(candidates.Count)];
        var tokenPayload = new MysteryTokenPayload(target.PlayerName, "random", Guid.NewGuid().ToString("N"), serverGuid);
        var dossierToken = SignPayload(tokenPayload);

        return BuildDossierDto(target, dossierToken, "random", candidates);
    }

    public async Task<MysteryGuessResultDto> GuessMysterySoldierAsync(
        MysteryGuessRequest request,
        CancellationToken cancellationToken = default)
    {
        var payload = ValidateToken<MysteryTokenPayload>(request.DossierToken);
        if (payload == null)
        {
            throw new ArgumentException("Invalid or expired dossier token.");
        }

        var candidates = await GetArcadeCandidatesAsync(payload.ServerGuid, cancellationToken);
        if (candidates.Count == 0)
        {
            candidates = DefaultCandidates;
        }

        var target = candidates.FirstOrDefault(c =>
            string.Equals(c.PlayerName, payload.TargetPlayerName, StringComparison.OrdinalIgnoreCase))
            ?? DefaultCandidates.FirstOrDefault(c =>
                string.Equals(c.PlayerName, payload.TargetPlayerName, StringComparison.OrdinalIgnoreCase))
            ?? candidates[0];

        var guessedName = request.GuessedPlayerName.Trim();
        var guessedCandidate = candidates.FirstOrDefault(c =>
            string.Equals(c.PlayerName, guessedName, StringComparison.OrdinalIgnoreCase));

        if (guessedCandidate == null)
        {
            guessedCandidate = new ArcadeCandidate(
                guessedName,
                "??",
                0,
                0,
                0,
                1.0,
                "Unknown",
                "Unknown",
                null
            );
        }

        var isCorrect = string.Equals(guessedCandidate.PlayerName, target.PlayerName, StringComparison.OrdinalIgnoreCase);

        var killsTolerance = Math.Max(250, (int)(target.TotalKills * 0.15));
        string killsIndicator;
        if (Math.Abs(guessedCandidate.TotalKills - target.TotalKills) <= killsTolerance)
        {
            killsIndicator = "match";
        }
        else if (target.TotalKills > guessedCandidate.TotalKills)
        {
            killsIndicator = "higher";
        }
        else
        {
            killsIndicator = "lower";
        }

        var mapMatch = string.Equals(guessedCandidate.FavoriteMap, target.FavoriteMap, StringComparison.OrdinalIgnoreCase);
        var serverMatch = string.Equals(guessedCandidate.FavoriteServer, target.FavoriteServer, StringComparison.OrdinalIgnoreCase);

        string playTimeIndicator;
        if (Math.Abs(guessedCandidate.PlayTimeHours - target.PlayTimeHours) <= Math.Max(10, target.PlayTimeHours * 0.2))
        {
            playTimeIndicator = "match";
        }
        else if (target.PlayTimeHours > guessedCandidate.PlayTimeHours)
        {
            playTimeIndicator = "higher";
        }
        else
        {
            playTimeIndicator = "lower";
        }

        string kdIndicator;
        if (Math.Abs(guessedCandidate.KdRatio - target.KdRatio) <= 0.15)
        {
            kdIndicator = "match";
        }
        else if (target.KdRatio > guessedCandidate.KdRatio)
        {
            kdIndicator = "higher";
        }
        else
        {
            kdIndicator = "lower";
        }

        return new MysteryGuessResultDto(
            guessedCandidate.PlayerName,
            isCorrect,
            new AttributeMatchDto($"{guessedCandidate.TotalKills:N0}", killsIndicator == "match", killsIndicator),
            new AttributeMatchDto($"{guessedCandidate.PlayTimeHours:F0} hrs", playTimeIndicator == "match", playTimeIndicator),
            new AttributeMatchDto($"{guessedCandidate.KdRatio:F2}", kdIndicator == "match", kdIndicator),
            new AttributeMatchDto(guessedCandidate.FavoriteMap, mapMatch),
            new AttributeMatchDto(guessedCandidate.FavoriteServer, serverMatch),
            isCorrect ? target.PlayerName : null,
            isCorrect ? $"Target confirmed! Classified identity: {target.PlayerName}." : null
        );
    }

    public async Task<TriviaQuizDto> GenerateTriviaQuizAsync(
        string? serverGuid = null,
        CancellationToken cancellationToken = default)
    {
        if (!string.IsNullOrWhiteSpace(serverGuid))
        {
            var serverQuiz = await GenerateServerSpecificTriviaQuizAsync(serverGuid, cancellationToken);
            if (serverQuiz != null)
            {
                return serverQuiz;
            }
        }

        return await GenerateGlobalTriviaQuizAsync(cancellationToken);
    }

    private async Task<TriviaQuizDto?> GenerateServerSpecificTriviaQuizAsync(
        string serverGuid,
        CancellationToken cancellationToken)
    {
        var server = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid, cancellationToken);
        if (server == null)
        {
            return null;
        }

        var serverPool = await GetServerTriviaPoolAsync(serverGuid, cancellationToken);
        if (serverPool.Count == 0)
        {
            return null;
        }

        List<TriviaQuestionInternal> selectedQuestions;
        if (serverPool.Count < 5)
        {
            var globalPool = await GetGlobalTriviaPoolAsync(cancellationToken);
            var combined = serverPool.Concat(globalPool.Where(g => !serverPool.Any(s => s.Id == g.Id))).ToList();
            selectedQuestions = SelectDiverseTriviaQuestions(combined, 5, server.Name);
        }
        else
        {
            selectedQuestions = SelectDiverseTriviaQuestions(serverPool, 5, server.Name);
        }

        var quizTokenPayload = new TriviaQuizTokenPayload(
            selectedQuestions.Select(q => new TriviaAnswerPayload(
                q.Id,
                q.Question,
                q.CorrectAnswer,
                q.Explanation,
                q.TargetPlayerName,
                q.TargetRoundId,
                q.TargetMapName,
                q.TargetServerName)).ToList()
        );
        var quizToken = SignPayload(quizTokenPayload);

        var dtoList = selectedQuestions.Select(q =>
        {
            var shuffledOptions = q.Options.ToList();
            Shuffle(shuffledOptions);
            return new TriviaQuestionDto(
                q.Id,
                q.Category,
                q.Question,
                shuffledOptions,
                null,
                q.TargetRoundId,
                q.TargetMapName,
                q.TargetServerName
            );
        }).ToList();

        return new TriviaQuizDto(quizToken, dtoList);
    }

    private async Task<TriviaQuizDto> GenerateGlobalTriviaQuizAsync(CancellationToken cancellationToken)
    {
        var masterPool = await GetGlobalTriviaPoolAsync(cancellationToken);
        if (masterPool.Count == 0)
        {
            throw new InvalidOperationException("Insufficient tracked statistics to generate a trivia quiz.");
        }

        var selectedQuestions = SelectDiverseTriviaQuestions(masterPool, 5);

        var quizTokenPayload = new TriviaQuizTokenPayload(
            selectedQuestions.Select(q => new TriviaAnswerPayload(
                q.Id,
                q.Question,
                q.CorrectAnswer,
                q.Explanation,
                q.TargetPlayerName,
                q.TargetRoundId,
                q.TargetMapName,
                q.TargetServerName)).ToList()
        );
        var quizToken = SignPayload(quizTokenPayload);

        var dtoList = selectedQuestions.Select(q =>
        {
            var shuffledOptions = q.Options.ToList();
            Shuffle(shuffledOptions);
            return new TriviaQuestionDto(
                q.Id,
                q.Category,
                q.Question,
                shuffledOptions,
                null,
                q.TargetRoundId,
                q.TargetMapName,
                q.TargetServerName
            );
        }).ToList();

        return new TriviaQuizDto(quizToken, dtoList);
    }

    private async Task<IReadOnlyList<TriviaQuestionInternal>> GetGlobalTriviaPoolAsync(CancellationToken cancellationToken)
    {
        const string cacheKey = "Arcade:Trivia:MasterPool";
        if (memoryCache.TryGetValue(cacheKey, out IReadOnlyList<TriviaQuestionInternal>? cached) && cached != null && cached.Count > 0)
        {
            return cached;
        }

        var pool = new List<TriviaQuestionInternal>();
        var candidates = (await LoadGlobalRosterFromDbAsync(cancellationToken)).Candidates;

        await AddCombinatorialMapTriviaQuestionsAsync(pool, null, cancellationToken);
        await AddMapScopedTriviaQuestionsAsync(pool, cancellationToken);
        await AddPeriodScopedTriviaQuestionsAsync(pool, cancellationToken);
        await AddMapBestScoreTriviaQuestionsAsync(pool, cancellationToken);
        await AddMapGlobalAndTheaterQuestionsAsync(pool, cancellationToken);
        await AddPlayerAchievementTriviaQuestionsAsync(pool, cancellationToken);
        await AddServerNetworkTriviaQuestionsAsync(pool, cancellationToken);
        AddCareerMilestoneTriviaQuestions(pool, candidates);

        var distinctPool = pool.DistinctBy(q => q.Id).ToList();

        memoryCache.Set(cacheKey, (IReadOnlyList<TriviaQuestionInternal>)distinctPool, TimeSpan.FromMinutes(20));

        return distinctPool;
    }

    private async Task<IReadOnlyList<TriviaQuestionInternal>> GetServerTriviaPoolAsync(
        string serverGuid,
        CancellationToken cancellationToken)
    {
        var cacheKey = $"Arcade:Trivia:ServerPool:{serverGuid}";
        if (memoryCache.TryGetValue(cacheKey, out IReadOnlyList<TriviaQuestionInternal>? cached) && cached != null && cached.Count > 0)
        {
            return cached;
        }

        var server = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid, cancellationToken);
        if (server == null)
        {
            return [];
        }

        var serverName = server.Name;
        var pool = new List<TriviaQuestionInternal>();

        await AddCombinatorialMapTriviaQuestionsAsync(pool, serverGuid, cancellationToken, serverName);
        await AddServerMapStatTriviaQuestionsAsync(pool, serverGuid, serverName, cancellationToken);
        await AddServerRoundRecordTriviaQuestionsAsync(pool, serverGuid, serverName, cancellationToken);
        await AddServerCareerLeaderTriviaQuestionsAsync(pool, serverGuid, serverName, cancellationToken);
        await AddServerPeriodicLeaderTriviaQuestionsAsync(pool, serverGuid, serverName, cancellationToken);
        await AddServerAchievementTriviaQuestionsAsync(pool, serverGuid, serverName, cancellationToken);
        await AddServerActivityPatternTriviaQuestionsAsync(pool, serverGuid, serverName, cancellationToken);

        var distinctPool = pool.DistinctBy(q => q.Id).ToList();

        if (distinctPool.Count > 0)
        {
            memoryCache.Set(cacheKey, (IReadOnlyList<TriviaQuestionInternal>)distinctPool, TimeSpan.FromMinutes(20));
        }

        return distinctPool;
    }

    private async Task AddServerMapStatTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string serverGuid,
        string serverName,
        CancellationToken cancellationToken)
    {
        var topMaps = await dbContext.ServerMapStats
            .AsNoTracking()
            .Where(sms => sms.ServerGuid == serverGuid)
            .GroupBy(sms => sms.MapName)
            .Select(g => new
            {
                MapName = g.Key,
                TotalRounds = g.Sum(x => x.TotalRounds),
                TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes),
                AvgDurationMinutes = g.Sum(x => x.TotalRounds) > 0 ? (double)g.Sum(x => x.TotalPlayTimeMinutes) / g.Sum(x => x.TotalRounds) : 0,
                PeakConcurrentPlayers = g.Max(x => x.PeakConcurrentPlayers),
                AvgConcurrentPlayers = g.Average(x => x.AvgConcurrentPlayers)
            })
            .OrderByDescending(x => x.TotalRounds)
            .Take(16)
            .ToListAsync(cancellationToken);

        if (topMaps.Count == 0) return;

        if (topMaps.Count >= 4)
        {
            // Most contested map on this server
            var mostPlayed = topMaps[0];
            var otherPlayed = topMaps.Skip(1).Take(3).Select(m => m.MapName).Distinct().ToList();
            if (otherPlayed.Count == 3)
            {
                var mapOptions = new List<string> { mostPlayed.MapName };
                mapOptions.AddRange(otherPlayed);
                Shuffle(mapOptions);
                pool.Add(new TriviaQuestionInternal(
                    "srv_most_played_map",
                    $"{serverName} History",
                    $"What is the most contested map in {serverName}'s recorded history?",
                    mapOptions,
                    mostPlayed.MapName,
                    $"{mostPlayed.MapName} leads with {mostPlayed.TotalRounds:N0} total rounds played on {serverName}!",
                    TargetMapName: mostPlayed.MapName,
                    TargetServerName: serverName
                ));
            }

            // Longest average round duration
            var longestMap = topMaps.OrderByDescending(m => m.AvgDurationMinutes).First();
            var durOptions = topMaps.Where(m => m.MapName != longestMap.MapName).Take(3).Select(m => m.MapName).Distinct().ToList();
            if (durOptions.Count == 3 && longestMap.AvgDurationMinutes > 0)
            {
                durOptions.Add(longestMap.MapName);
                Shuffle(durOptions);
                pool.Add(new TriviaQuestionInternal(
                    "srv_longest_map",
                    "Theater Endurance",
                    $"Which map typically features the longest average round duration on {serverName}?",
                    durOptions,
                    longestMap.MapName,
                    $"Rounds on {longestMap.MapName} average {longestMap.AvgDurationMinutes:F1} minutes of combat on {serverName}.",
                    TargetMapName: longestMap.MapName,
                    TargetServerName: serverName
                ));
            }

            // Fastest average round conclusion
            var fastestMap = topMaps.Where(m => m.AvgDurationMinutes > 0).OrderBy(m => m.AvgDurationMinutes).FirstOrDefault();
            if (fastestMap != null && fastestMap.MapName != longestMap.MapName)
            {
                var fastOptions = topMaps.Where(m => m.MapName != fastestMap.MapName).Take(3).Select(m => m.MapName).Distinct().ToList();
                if (fastOptions.Count == 3)
                {
                    fastOptions.Add(fastestMap.MapName);
                    Shuffle(fastOptions);
                    pool.Add(new TriviaQuestionInternal(
                        "srv_fastest_map",
                        "Blitz Engagements",
                        $"Which map concludes fastest on average on {serverName}?",
                        fastOptions,
                        fastestMap.MapName,
                        $"Rounds on {fastestMap.MapName} conclude quickest on {serverName}, averaging {fastestMap.AvgDurationMinutes:F1} minutes.",
                        TargetMapName: fastestMap.MapName,
                        TargetServerName: serverName
                    ));
                }
            }

            // Peak concurrent player turnout
            var peakMap = topMaps.OrderByDescending(m => m.PeakConcurrentPlayers).First();
            var secondPeak = topMaps.OrderByDescending(m => m.PeakConcurrentPlayers).Skip(1).FirstOrDefault();
            if (peakMap.PeakConcurrentPlayers > (secondPeak?.PeakConcurrentPlayers ?? 0) && peakMap.PeakConcurrentPlayers > 0)
            {
                var peakOptions = topMaps.Where(m => m.MapName != peakMap.MapName).Take(3).Select(m => m.MapName).Distinct().ToList();
                if (peakOptions.Count == 3)
                {
                    peakOptions.Add(peakMap.MapName);
                    Shuffle(peakOptions);
                    pool.Add(new TriviaQuestionInternal(
                        "srv_peak_players_map",
                        "Peak Combat",
                        $"Which theater has seen the highest peak concurrent player turnout on {serverName}?",
                        peakOptions,
                        peakMap.MapName,
                        $"{peakMap.MapName} reached a peak intensity of {peakMap.PeakConcurrentPlayers:N0} concurrent combatants on {serverName}!",
                        TargetMapName: peakMap.MapName,
                        TargetServerName: serverName
                    ));
                }
            }
        }

        // Faction balance across all contested maps
        var topMapNames = topMaps.Select(m => m.MapName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var mapStatRows = await dbContext.ServerMapStats
            .AsNoTracking()
            .Where(sms => sms.ServerGuid == serverGuid && topMapNames.Contains(sms.MapName))
            .ToListAsync(cancellationToken);

        var rowsByMap = mapStatRows
            .GroupBy(sms => sms.MapName, StringComparer.OrdinalIgnoreCase);

        foreach (var mapGroup in rowsByMap)
        {
            var mapName = mapGroup.Key;
            var factionWins = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var factionRounds = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            foreach (var row in mapGroup)
            {
                if (!string.IsNullOrWhiteSpace(row.Team1Label))
                {
                    var label = row.Team1Label.Trim();
                    factionWins[label] = factionWins.GetValueOrDefault(label) + row.Team1Victories;
                    factionRounds[label] = factionRounds.GetValueOrDefault(label) + row.TotalRounds;
                }

                if (!string.IsNullOrWhiteSpace(row.Team2Label))
                {
                    var label = row.Team2Label.Trim();
                    factionWins[label] = factionWins.GetValueOrDefault(label) + row.Team2Victories;
                    factionRounds[label] = factionRounds.GetValueOrDefault(label) + row.TotalRounds;
                }
            }

            if (factionWins.Count < 2) continue;

            // In BF1942, each map is contested by two sides.
            // If data anomalies/glitches produce 3 or more faction labels, pick the two highest by victories (tie-broken by rounds).
            var topFactions = factionWins
                .OrderByDescending(f => f.Value)
                .ThenByDescending(f => factionRounds.GetValueOrDefault(f.Key, 0))
                .Take(2)
                .ToList();

            var winner = topFactions[0].Key;
            var loser = topFactions[1].Key;
            var winCount = topFactions[0].Value;
            var loseCount = topFactions[1].Value;

            // Must have a clear winner (not tied), and winner must have at least one victory
            if (winCount <= loseCount || winCount == 0)
            {
                continue;
            }

            var teamOptions = new List<string> { winner, loser };
            Shuffle(teamOptions);

            var mapSlug = SanitizeTriviaId(mapName);
            pool.Add(new TriviaQuestionInternal(
                $"srv_team_balance_{mapSlug}",
                "Tactical Superiority",
                $"On {mapName} on {serverName}, which faction holds the higher all-time victory count?",
                teamOptions,
                winner,
                $"{winner} has dominated {mapName} with {winCount:N0} wins versus {loser}'s {loseCount:N0} wins on {serverName}!",
                TargetMapName: mapName,
                TargetServerName: serverName
            ));
        }
    }

    private async Task AddServerRoundRecordTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string serverGuid,
        string serverName,
        CancellationToken cancellationToken)
    {
        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);

        var bestScores = await dbContext.PlayerBestScores
            .AsNoTracking()
            .Where(pbs => pbs.ServerGuid == serverGuid && pbs.Period == "all_time")
            .OrderByDescending(pbs => pbs.FinalScore)
            .Take(16)
            .ToListAsync(cancellationToken);

        if (bestScores.Count > 0)
        {
            var topScore = bestScores[0];
            var scoreOptions = bestScores.Select(s => s.PlayerName).Distinct().Take(4).ToList();
            if (scoreOptions.Count < 4)
            {
                foreach (var c in candidates)
                {
                    if (scoreOptions.Count >= 4) break;
                    if (!scoreOptions.Contains(c.PlayerName, StringComparer.OrdinalIgnoreCase))
                    {
                        scoreOptions.Add(c.PlayerName);
                    }
                }
            }

            if (scoreOptions.Count == 4)
            {
                Shuffle(scoreOptions);
                pool.Add(new TriviaQuestionInternal(
                    "srv_best_round_score",
                    "Server Legend",
                    $"Who holds the record for highest single-round score ever achieved on {serverName}?",
                    scoreOptions,
                    topScore.PlayerName,
                    $"{topScore.PlayerName} scored an unbelievable {topScore.FinalScore:N0} points on {topScore.MapName} on {serverName}!",
                    TargetPlayerName: topScore.PlayerName,
                    TargetRoundId: topScore.RoundId,
                    TargetMapName: topScore.MapName,
                    TargetServerName: serverName
                ));
            }
        }

        var bestKills = await dbContext.PlayerBestScores
            .AsNoTracking()
            .Where(pbs => pbs.ServerGuid == serverGuid && pbs.Period == "all_time")
            .OrderByDescending(pbs => pbs.FinalKills)
            .Take(16)
            .ToListAsync(cancellationToken);

        if (bestKills.Count > 0 && bestKills[0].FinalKills > 0)
        {
            var topKill = bestKills[0];
            var killOptions = bestKills.Select(s => s.PlayerName).Distinct().Take(4).ToList();
            if (killOptions.Count < 4)
            {
                foreach (var c in candidates)
                {
                    if (killOptions.Count >= 4) break;
                    if (!killOptions.Contains(c.PlayerName, StringComparer.OrdinalIgnoreCase))
                    {
                        killOptions.Add(c.PlayerName);
                    }
                }
            }

            if (killOptions.Count == 4)
            {
                Shuffle(killOptions);
                pool.Add(new TriviaQuestionInternal(
                    "srv_best_round_kills",
                    "Single-Round Frags",
                    $"Who holds the record for most kills in a single round on {serverName}?",
                    killOptions,
                    topKill.PlayerName,
                    $"{topKill.PlayerName} eliminated {topKill.FinalKills:N0} enemies in a single round on {topKill.MapName} on {serverName}!",
                    TargetPlayerName: topKill.PlayerName,
                    TargetRoundId: topKill.RoundId,
                    TargetMapName: topKill.MapName,
                    TargetServerName: serverName
                ));
            }
        }

        var mapGroups = bestScores
            .GroupBy(pbs => pbs.MapName)
            .Where(g => g.Select(x => x.PlayerName).Distinct().Count() >= 4)
            .Take(8);

        foreach (var mg in mapGroups)
        {
            var mapRanked = mg.OrderByDescending(x => x.FinalScore).ToList();
            var top = mapRanked[0];
            var opts = mapRanked.Select(x => x.PlayerName).Distinct().Take(4).ToList();
            if (opts.Count == 4)
            {
                var mapSlug = SanitizeTriviaId(mg.Key);
                Shuffle(opts);
                pool.Add(new TriviaQuestionInternal(
                    $"srv_map_best_score_{mapSlug}",
                    "Map Round Records",
                    $"On {mg.Key} on {serverName}, who holds the record for highest single-round score?",
                    opts,
                    top.PlayerName,
                    $"{top.PlayerName} scored {top.FinalScore:N0} points in a single round on {mg.Key} on {serverName}.",
                    TargetPlayerName: top.PlayerName,
                    TargetRoundId: top.RoundId,
                    TargetMapName: mg.Key,
                    TargetServerName: serverName
                ));
            }
        }
    }

    private async Task AddServerCareerLeaderTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string serverGuid,
        string serverName,
        CancellationToken cancellationToken)
    {
        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);
        if (candidates.Count < 4) return;

        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "srv_career_kills",
            "Server Dominance",
            $"Which soldier has logged the most career kills on {serverName}?",
            c => c.TotalKills,
            c => $"{c.PlayerName} leads the server killboard with {c.TotalKills:N0} confirmed frags!",
            serverName: serverName);

        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "srv_career_score",
            "Server Veteran",
            $"Which regular combatant holds the all-time career scoring crown on {serverName}?",
            c => c.TotalScore,
            c => $"{c.PlayerName} reigns supreme with {c.TotalScore:N0} total points on {serverName}!",
            serverName: serverName);

        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "srv_career_playtime",
            "Server Endurance",
            $"Which regular has logged the most combat hours on {serverName}?",
            c => c.PlayTimeHours,
            c => $"{c.PlayerName} has logged {c.PlayTimeHours:N0} hours on {serverName}!",
            serverName: serverName);

        var qualifiedKd = candidates.Where(c => c.TotalKills >= 20).ToList();
        if (qualifiedKd.Count >= 4)
        {
            TryAddPlayerMetricQuestion(
                pool,
                qualifiedKd,
                "srv_career_kd",
                "Sharpshooter Intel",
                $"Which veteran boasts the most lethal career Kill/Death ratio on {serverName}?",
                c => c.KdRatio,
                c => $"{c.PlayerName} boasts a lethal {c.KdRatio:F2} K/D ratio on {serverName}!",
                serverName: serverName);
        }
    }

    private async Task AddServerPeriodicLeaderTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string serverGuid,
        string serverName,
        CancellationToken cancellationToken)
    {
        var yearlyData = await dbContext.PlayerServerStats
            .AsNoTracking()
            .Where(pss => pss.ServerGuid == serverGuid && pss.Year > 2000)
            .GroupBy(pss => new { pss.Year, pss.PlayerName })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.PlayerName,
                TotalKills = g.Sum(x => x.TotalKills),
                TotalScore = g.Sum(x => x.TotalScore),
                TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes),
                TotalRounds = g.Sum(x => x.TotalRounds)
            })
            .ToListAsync(cancellationToken);

        var years = yearlyData
            .GroupBy(d => d.Year)
            .Where(g => g.Count() >= 4)
            .OrderByDescending(g => g.Key)
            .Take(3);

        foreach (var yg in years)
        {
            var year = yg.Key;
            var players = yg.ToList();

            var topKills = players.OrderByDescending(p => p.TotalKills).ToList();
            if (topKills.Count >= 4 && topKills[0].TotalKills > topKills[1].TotalKills && topKills[0].TotalKills > 0)
            {
                var kOpts = topKills.Take(4).Select(p => p.PlayerName).ToList();
                Shuffle(kOpts);
                pool.Add(new TriviaQuestionInternal(
                    $"srv_year_kills_{year}",
                    "Annual Killboard",
                    $"In {year}, which soldier led {serverName} in confirmed kills?",
                    kOpts,
                    topKills[0].PlayerName,
                    $"{topKills[0].PlayerName} led {serverName} in {year} with {topKills[0].TotalKills:N0} kills.",
                    TargetPlayerName: topKills[0].PlayerName,
                    TargetServerName: serverName
                ));
            }

            var topScore = players.OrderByDescending(p => p.TotalScore).ToList();
            if (topScore.Count >= 4 && topScore[0].TotalScore > topScore[1].TotalScore && topScore[0].TotalScore > 0)
            {
                var sOpts = topScore.Take(4).Select(p => p.PlayerName).ToList();
                Shuffle(sOpts);
                pool.Add(new TriviaQuestionInternal(
                    $"srv_year_score_{year}",
                    "Annual Scoreboard",
                    $"In {year}, which combatant achieved the highest total score on {serverName}?",
                    sOpts,
                    topScore[0].PlayerName,
                    $"{topScore[0].PlayerName} topped {serverName}'s {year} scoreboard with {topScore[0].TotalScore:N0} points.",
                    TargetPlayerName: topScore[0].PlayerName,
                    TargetServerName: serverName
                ));
            }

            var topTime = players.OrderByDescending(p => p.TotalPlayTimeMinutes).ToList();
            if (topTime.Count >= 4 && topTime[0].TotalPlayTimeMinutes > topTime[1].TotalPlayTimeMinutes && topTime[0].TotalPlayTimeMinutes > 60)
            {
                var tOpts = topTime.Take(4).Select(p => p.PlayerName).ToList();
                Shuffle(tOpts);
                var hours = topTime[0].TotalPlayTimeMinutes / 60.0;
                pool.Add(new TriviaQuestionInternal(
                    $"srv_year_playtime_{year}",
                    "Annual Endurance",
                    $"During {year}, who logged the most combat hours on {serverName}?",
                    tOpts,
                    topTime[0].PlayerName,
                    $"{topTime[0].PlayerName} logged {hours:N0} combat hours on {serverName} during {year}.",
                    TargetPlayerName: topTime[0].PlayerName,
                    TargetServerName: serverName
                ));
            }
        }
    }

    private async Task AddServerAchievementTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string serverGuid,
        string serverName,
        CancellationToken cancellationToken)
    {
        var firstPlaceLeaders = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievementType == "round_placement" && pa.AchievementId == "round_placement_1")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(4)
            .ToListAsync(cancellationToken);

        if (firstPlaceLeaders.Count == 4 && firstPlaceLeaders[0].Count > firstPlaceLeaders[1].Count)
        {
            var top = firstPlaceLeaders[0];
            var opts = firstPlaceLeaders.Select(x => x.PlayerName).ToList();
            Shuffle(opts);
            pool.Add(new TriviaQuestionInternal(
                "srv_ach_most_first_places",
                "Combat MVP",
                $"Which soldier has achieved the most 1st-Place MVP finishes on {serverName}?",
                opts,
                top.PlayerName,
                $"{top.PlayerName} leads {serverName} with {top.Count:N0} first-place victories!",
                TargetPlayerName: top.PlayerName,
                TargetServerName: serverName
            ));
        }

        var podiumLeaders = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievementType == "round_placement")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(4)
            .ToListAsync(cancellationToken);

        if (podiumLeaders.Count == 4 && podiumLeaders[0].Count > podiumLeaders[1].Count)
        {
            var top = podiumLeaders[0];
            var opts = podiumLeaders.Select(x => x.PlayerName).ToList();
            Shuffle(opts);
            pool.Add(new TriviaQuestionInternal(
                "srv_ach_most_podiums",
                "Podium Veteran",
                $"Which combatant has achieved the highest number of podium finishes on {serverName}?",
                opts,
                top.PlayerName,
                $"{top.PlayerName} has secured a top-3 podium finish in {top.Count:N0} rounds on {serverName}.",
                TargetPlayerName: top.PlayerName,
                TargetServerName: serverName
            ));
        }

        var streakLeaders = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievementType == "kill_streak")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(4)
            .ToListAsync(cancellationToken);

        if (streakLeaders.Count == 4 && streakLeaders[0].Count > streakLeaders[1].Count)
        {
            var top = streakLeaders[0];
            var opts = streakLeaders.Select(x => x.PlayerName).ToList();
            Shuffle(opts);
            pool.Add(new TriviaQuestionInternal(
                "srv_ach_most_sprees",
                "Rampage Specialist",
                $"Which soldier has earned the most combat streak medals on {serverName}?",
                opts,
                top.PlayerName,
                $"{top.PlayerName} has unlocked {top.Count:N0} combat streak medals on {serverName}.",
                TargetPlayerName: top.PlayerName,
                TargetServerName: serverName
            ));
        }

        var longestStreaks = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.ServerGuid == serverGuid && pa.AchievementType == "kill_streak" && pa.RoundId != "")
            .OrderByDescending(pa => pa.Value)
            .Take(10)
            .ToListAsync(cancellationToken);

        if (longestStreaks.Count >= 4)
        {
            var topStreak = longestStreaks[0];
            var streakOpts = longestStreaks.Select(x => x.PlayerName).Distinct().Take(4).ToList();
            if (streakOpts.Count == 4 && topStreak.Value > 0)
            {
                Shuffle(streakOpts);
                pool.Add(new TriviaQuestionInternal(
                    "srv_ach_longest_streak_record",
                    "Killstreak Legend",
                    $"Who achieved the highest recorded killstreak in a single round on {serverName} without dying?",
                    streakOpts,
                    topStreak.PlayerName,
                    $"{topStreak.PlayerName} went on a {topStreak.Value}-kill rampage on {topStreak.MapName} on {serverName}!",
                    TargetPlayerName: topStreak.PlayerName,
                    TargetRoundId: topStreak.RoundId,
                    TargetMapName: topStreak.MapName,
                    TargetServerName: serverName
                ));
            }
        }
    }

    private async Task AddServerActivityPatternTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string serverGuid,
        string serverName,
        CancellationToken cancellationToken)
    {
        var dayPatterns = await dbContext.ServerHourlyPatterns
            .AsNoTracking()
            .Where(shp => shp.ServerGuid == serverGuid)
            .GroupBy(shp => shp.DayOfWeek)
            .Select(g => new { DayOfWeek = g.Key, AvgPlayers = g.Average(x => x.AvgPlayers) })
            .ToListAsync(cancellationToken);

        if (dayPatterns.Count >= 4)
        {
            var orderedDays = dayPatterns.OrderByDescending(x => x.AvgPlayers).ToList();
            if (orderedDays[0].AvgPlayers > orderedDays[1].AvgPlayers + 0.1 && orderedDays[0].AvgPlayers > 0)
            {
                var topDay = DayOfWeekName(orderedDays[0].DayOfWeek);
                var options = orderedDays.Take(4).Select(x => DayOfWeekName(x.DayOfWeek)).Distinct().ToList();
                if (options.Count == 4)
                {
                    Shuffle(options);
                    pool.Add(new TriviaQuestionInternal(
                        "srv_busiest_day",
                        "Server Schedule",
                        $"On {serverName}, which day of the week typically experiences the highest player turnout?",
                        options,
                        topDay,
                        $"{topDay} is {serverName}'s most active day of combat, averaging {orderedDays[0].AvgPlayers:F1} concurrent players.",
                        TargetServerName: serverName
                    ));
                }
            }
        }
    }

    private static string DayOfWeekName(int dow) => dow switch
    {
        0 => "Sunday",
        1 => "Monday",
        2 => "Tuesday",
        3 => "Wednesday",
        4 => "Thursday",
        5 => "Friday",
        6 => "Saturday",
        _ => "Weekend"
    };

    private static List<TriviaQuestionInternal> SelectDiverseTriviaQuestions(
        IReadOnlyList<TriviaQuestionInternal> pool,
        int count,
        string? mustIncludeSubstring = null)
    {
        if (pool.Count <= count)
        {
            var all = pool.ToList();
            Shuffle(all);
            return all;
        }

        var hasScoped = pool.Any(q => IsScopedTriviaQuestion(q.Id));

        var candidatePool = hasScoped
            ? pool.Where(q => q.Id is not ("top_kills" or "top_score" or "top_playtime" or "top_kd" or "top_rounds")).ToList()
            : pool.ToList();

        if (candidatePool.Count < count)
        {
            candidatePool = pool.ToList();
        }

        Shuffle(candidatePool);

        var selected = new List<TriviaQuestionInternal>();
        var usedCategories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!string.IsNullOrWhiteSpace(mustIncludeSubstring))
        {
            var serverNamedQuestions = candidatePool
                .Where(q => q.Question.Contains(mustIncludeSubstring, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (serverNamedQuestions.Count > 0)
            {
                var chosen = serverNamedQuestions[RandomNumberGenerator.GetInt32(serverNamedQuestions.Count)];
                selected.Add(chosen);
                usedCategories.Add(chosen.Category);
            }
        }

        if (selected.Count < count && candidatePool.Any(q => !string.IsNullOrEmpty(q.TargetRoundId)))
        {
            var roundCandidates = candidatePool
                .Where(q => !string.IsNullOrEmpty(q.TargetRoundId) && !selected.Any(s => s.Id == q.Id))
                .ToList();
            if (roundCandidates.Count > 0)
            {
                var chosenRound = roundCandidates[RandomNumberGenerator.GetInt32(roundCandidates.Count)];
                selected.Add(chosenRound);
                usedCategories.Add(chosenRound.Category);
            }
        }

        if (hasScoped && selected.Count < count)
        {
            var scopedCandidate = candidatePool.FirstOrDefault(q => IsScopedTriviaQuestion(q.Id) && !selected.Any(s => s.Id == q.Id));
            if (scopedCandidate != null)
            {
                selected.Add(scopedCandidate);
                usedCategories.Add(scopedCandidate.Category);
            }
        }

        foreach (var q in candidatePool)
        {
            if (selected.Count >= count) break;
            if (!selected.Any(s => s.Id == q.Id) && !usedCategories.Contains(q.Category))
            {
                selected.Add(q);
                usedCategories.Add(q.Category);
            }
        }

        if (selected.Count < count)
        {
            foreach (var q in candidatePool)
            {
                if (selected.Count >= count) break;
                if (!selected.Any(s => s.Id == q.Id))
                {
                    selected.Add(q);
                }
            }
        }

        Shuffle(selected);
        return selected;
    }

    private static bool IsScopedTriviaQuestion(string id) =>
        id.StartsWith("map_player_", StringComparison.Ordinal)
        || id.StartsWith("player_map_", StringComparison.Ordinal)
        || id.StartsWith("period_", StringComparison.Ordinal)
        || id.StartsWith("map_best_", StringComparison.Ordinal)
        || id.StartsWith("srv_year_", StringComparison.Ordinal)
        || id.StartsWith("srv_map_best_", StringComparison.Ordinal);

    private async Task AddCombinatorialMapTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string? serverGuid,
        CancellationToken cancellationToken,
        string? serverName = null)
    {
        var facts = await LoadPlayerMapFactsAsync(serverGuid, cancellationToken);
        if (facts.Count == 0)
        {
            return;
        }

        var distractorMaps = facts
            .Select(f => f.MapName)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (!string.IsNullOrWhiteSpace(serverGuid))
        {
            var serverMaps = await dbContext.ServerMapStats
                .AsNoTracking()
                .Where(sms => sms.ServerGuid == serverGuid)
                .Select(sms => sms.MapName)
                .Distinct()
                .ToListAsync(cancellationToken);
            distractorMaps = distractorMaps
                .Concat(serverMaps)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var composed = TriviaQuestionComposer.Compose(facts, distractorMaps);
        if (!string.IsNullOrWhiteSpace(serverName))
        {
            composed = composed.Select(q => q with { TargetServerName = serverName }).ToList();
        }

        pool.AddRange(composed);
    }

    private async Task<List<PlayerMapFact>> LoadPlayerMapFactsAsync(
        string? serverGuid,
        CancellationToken cancellationToken)
    {
        var query = dbContext.PlayerMapStats.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(serverGuid))
        {
            query = query.Where(m => m.ServerGuid == serverGuid);
        }

        var mapsWithPlayers = await query
            .GroupBy(m => m.MapName)
            .Select(g => new
            {
                MapName = g.Key,
                PlayerCount = g.Select(x => x.PlayerName).Distinct().Count(),
                TotalKills = g.Sum(x => x.TotalKills)
            })
            .Where(x => x.PlayerCount >= 2)
            .OrderByDescending(x => x.TotalKills)
            .Take(30)
            .ToListAsync(cancellationToken);

        var mapNames = mapsWithPlayers.Select(m => m.MapName).ToList();
        if (mapNames.Count == 0)
        {
            return [];
        }

        var mapFacts = await query
            .Where(m => mapNames.Contains(m.MapName))
            .GroupBy(m => new { m.PlayerName, m.MapName })
            .Select(g => new PlayerMapFact(
                g.Key.PlayerName,
                g.Key.MapName,
                g.Sum(x => x.TotalKills),
                g.Sum(x => x.TotalDeaths),
                g.Sum(x => x.TotalScore),
                g.Sum(x => x.TotalPlayTimeMinutes),
                g.Sum(x => x.TotalRounds)))
            .ToListAsync(cancellationToken);

        var topPlayers = mapFacts
            .GroupBy(f => f.PlayerName, StringComparer.OrdinalIgnoreCase)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalKills = g.Sum(x => x.TotalKills)
            })
            .OrderByDescending(x => x.TotalKills)
            .Take(40)
            .Select(x => x.PlayerName)
            .ToList();

        if (topPlayers.Count == 0)
        {
            return mapFacts;
        }

        var extraFacts = await query
            .Where(m => topPlayers.Contains(m.PlayerName) && !mapNames.Contains(m.MapName))
            .GroupBy(m => new { m.PlayerName, m.MapName })
            .Select(g => new PlayerMapFact(
                g.Key.PlayerName,
                g.Key.MapName,
                g.Sum(x => x.TotalKills),
                g.Sum(x => x.TotalDeaths),
                g.Sum(x => x.TotalScore),
                g.Sum(x => x.TotalPlayTimeMinutes),
                g.Sum(x => x.TotalRounds)))
            .ToListAsync(cancellationToken);

        return mapFacts.Concat(extraFacts).ToList();
    }

    private async Task AddMapScopedTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        CancellationToken cancellationToken)
    {
        var processedMaps = pool
            .Where(q => !string.IsNullOrWhiteSpace(q.TargetMapName))
            .Select(q => q.TargetMapName!)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // Query PlayerSessions for additional maps if PlayerMapStats was sparse
        if (processedMaps.Count < 10)
        {
            var sessionMaps = await dbContext.PlayerSessions
                .AsNoTracking()
                .Where(ps => ps.MapName.Length > 0 && !ps.IsDeleted)
                .GroupBy(ps => ps.MapName)
                .Select(g => new
                {
                    MapName = g.Key,
                    PlayerCount = g.Select(x => x.PlayerName).Distinct().Count(),
                    SessionCount = g.Count()
                })
                .Where(x => x.PlayerCount >= 4)
                .OrderByDescending(x => x.SessionCount)
                .Take(20)
                .ToListAsync(cancellationToken);

            foreach (var sm in sessionMaps)
            {
                if (processedMaps.Contains(sm.MapName)) continue;
                processedMaps.Add(sm.MapName);

                var sPlayers = await dbContext.PlayerSessions
                    .AsNoTracking()
                    .Where(ps => ps.MapName == sm.MapName && !ps.IsDeleted)
                    .GroupBy(ps => ps.PlayerName)
                    .Select(g => new
                    {
                        PlayerName = g.Key,
                        TotalKills = g.Sum(x => x.TotalKills),
                        TotalScore = g.Sum(x => x.TotalScore),
                        SessionCount = g.Count()
                    })
                    .ToListAsync(cancellationToken);

                if (sPlayers.Count < 4) continue;
                var mapSlug = SanitizeTriviaId(sm.MapName);

                var topKills = sPlayers.OrderByDescending(p => p.TotalKills).ToList();
                if (topKills[0].TotalKills > topKills[1].TotalKills)
                {
                    var kOpts = topKills.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                    if (kOpts.Count == 4)
                    {
                        pool.Add(new TriviaQuestionInternal(
                            $"map_player_kills_{mapSlug}",
                            "Map Dominance",
                            $"On {sm.MapName}, which combatant has recorded the most kills?",
                            kOpts,
                            topKills[0].PlayerName,
                            $"{topKills[0].PlayerName} leads {sm.MapName} with {topKills[0].TotalKills:N0} confirmed kills.",
                            TargetPlayerName: topKills[0].PlayerName,
                            TargetMapName: sm.MapName
                        ));
                    }
                }

                var topScore = sPlayers.OrderByDescending(p => p.TotalScore).ToList();
                if (topScore[0].TotalScore > topScore[1].TotalScore)
                {
                    var sOpts = topScore.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                    if (sOpts.Count == 4)
                    {
                        pool.Add(new TriviaQuestionInternal(
                            $"map_player_score_{mapSlug}",
                            "Map Scoreboard",
                            $"On {sm.MapName}, which combatant holds the highest recorded total score?",
                            sOpts,
                            topScore[0].PlayerName,
                            $"{topScore[0].PlayerName} leads {sm.MapName} with {topScore[0].TotalScore:N0} total score.",
                            TargetPlayerName: topScore[0].PlayerName,
                            TargetMapName: sm.MapName
                        ));
                    }
                }
            }
        }
    }

    private async Task AddPeriodScopedTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        CancellationToken cancellationToken)
    {
        var months = await dbContext.PlayerStatsMonthly
            .AsNoTracking()
            .GroupBy(p => new { p.Year, p.Month })
            .Select(g => new
            {
                g.Key.Year,
                g.Key.Month,
                PlayerCount = g.Select(x => x.PlayerName).Distinct().Count(),
                TotalKills = g.Sum(x => x.TotalKills)
            })
            .Where(x => x.PlayerCount >= 4)
            .OrderByDescending(x => x.Year)
            .ThenByDescending(x => x.Month)
            .Take(24)
            .ToListAsync(cancellationToken);

        foreach (var month in months)
        {
            var players = await dbContext.PlayerStatsMonthly
                .AsNoTracking()
                .Where(p => p.Year == month.Year && p.Month == month.Month)
                .Select(p => new
                {
                    p.PlayerName,
                    p.TotalKills,
                    p.TotalScore,
                    p.TotalPlayTimeMinutes,
                    p.TotalRounds,
                    p.KdRatio
                })
                .ToListAsync(cancellationToken);

            if (players.Count < 4) continue;

            var periodLabel = FormatMonthYear(month.Year, month.Month);
            var periodSlug = $"{month.Year}_{month.Month:D2}";

            // Kills
            var topKills = players.OrderByDescending(p => p.TotalKills).ToList();
            if (topKills[0].TotalKills > topKills[1].TotalKills)
            {
                var kOpts = topKills.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                if (kOpts.Count == 4)
                {
                    pool.Add(new TriviaQuestionInternal(
                        $"period_kills_{periodSlug}",
                        "Monthly Killboard",
                        $"In {periodLabel}, which soldier topped the monthly leaderboard with the most kills?",
                        kOpts,
                        topKills[0].PlayerName,
                        $"{topKills[0].PlayerName} led {periodLabel} with {topKills[0].TotalKills:N0} kills.",
                        TargetPlayerName: topKills[0].PlayerName
                    ));
                }
            }

            // Score
            var topScore = players.OrderByDescending(p => p.TotalScore).ToList();
            if (topScore[0].TotalScore > topScore[1].TotalScore)
            {
                var sOpts = topScore.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                if (sOpts.Count == 4)
                {
                    pool.Add(new TriviaQuestionInternal(
                        $"period_score_{periodSlug}",
                        "Monthly Scoreboard",
                        $"In {periodLabel}, which combatant achieved the highest total score?",
                        sOpts,
                        topScore[0].PlayerName,
                        $"{topScore[0].PlayerName} topped the {periodLabel} scoreboard with {topScore[0].TotalScore:N0} points.",
                        TargetPlayerName: topScore[0].PlayerName
                    ));
                }
            }

            // Playtime
            var topTime = players.OrderByDescending(p => p.TotalPlayTimeMinutes).ToList();
            if (topTime[0].TotalPlayTimeMinutes > topTime[1].TotalPlayTimeMinutes)
            {
                var tOpts = topTime.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                if (tOpts.Count == 4)
                {
                    var hours = topTime[0].TotalPlayTimeMinutes / 60.0;
                    pool.Add(new TriviaQuestionInternal(
                        $"period_playtime_{periodSlug}",
                        "Monthly Endurance",
                        $"During {periodLabel}, who logged the most combat hours?",
                        tOpts,
                        topTime[0].PlayerName,
                        $"{topTime[0].PlayerName} logged {hours:N0} hours during {periodLabel}.",
                        TargetPlayerName: topTime[0].PlayerName
                    ));
                }
            }

            // Rounds
            var topRounds = players.OrderByDescending(p => p.TotalRounds).ToList();
            if (topRounds[0].TotalRounds > topRounds[1].TotalRounds && topRounds[0].TotalRounds > 0)
            {
                var rOpts = topRounds.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                if (rOpts.Count == 4)
                {
                    pool.Add(new TriviaQuestionInternal(
                        $"period_rounds_{periodSlug}",
                        "Monthly Deployments",
                        $"In {periodLabel}, which soldier deployed into the most recorded rounds?",
                        rOpts,
                        topRounds[0].PlayerName,
                        $"{topRounds[0].PlayerName} deployed into {topRounds[0].TotalRounds:N0} rounds during {periodLabel}.",
                        TargetPlayerName: topRounds[0].PlayerName
                    ));
                }
            }

            // KD
            var topKd = players.Where(p => p.TotalKills >= 10).OrderByDescending(p => p.KdRatio).ToList();
            if (topKd.Count >= 4 && topKd[0].KdRatio > topKd[1].KdRatio)
            {
                var kdOpts = topKd.Take(4).Select(p => p.PlayerName).Distinct().ToList();
                if (kdOpts.Count == 4)
                {
                    pool.Add(new TriviaQuestionInternal(
                        $"period_kd_{periodSlug}",
                        "Monthly Sharpshooter",
                        $"In {periodLabel}, which soldier recorded the highest Kill/Death ratio?",
                        kdOpts,
                        topKd[0].PlayerName,
                        $"{topKd[0].PlayerName} recorded a {topKd[0].KdRatio:F2} K/D ratio during {periodLabel}.",
                        TargetPlayerName: topKd[0].PlayerName
                    ));
                }
            }
        }
    }

    private async Task AddMapBestScoreTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        CancellationToken cancellationToken)
    {
        var bestScores = await dbContext.PlayerBestScores
            .AsNoTracking()
            .Where(pbs => pbs.Period == "all_time")
            .OrderByDescending(pbs => pbs.FinalScore)
            .Take(8)
            .ToListAsync(cancellationToken);

        if (bestScores.Count >= 4)
        {
            var top = bestScores[0];
            var options = bestScores.Take(4).Select(s => s.PlayerName).Distinct().ToList();
            if (options.Count == 4)
            {
                pool.Add(new TriviaQuestionInternal(
                    "best_round_score",
                    "Single-Round Records",
                    "Who holds the highest single-round score recorded across all servers?",
                    options,
                    top.PlayerName,
                    $"{top.PlayerName} scored {top.FinalScore:N0} points on {top.MapName}.",
                    TargetPlayerName: top.PlayerName,
                    TargetRoundId: top.RoundId,
                    TargetMapName: top.MapName
                ));
            }
        }

        var bestKills = await dbContext.PlayerBestScores
            .AsNoTracking()
            .Where(pbs => pbs.Period == "all_time")
            .OrderByDescending(pbs => pbs.FinalKills)
            .Take(8)
            .ToListAsync(cancellationToken);

        if (bestKills.Count >= 4)
        {
            var top = bestKills[0];
            var options = bestKills.Take(4).Select(s => s.PlayerName).Distinct().ToList();
            if (options.Count == 4)
            {
                pool.Add(new TriviaQuestionInternal(
                    "best_round_kills",
                    "Single-Round Kills",
                    "Who holds the highest single-round kill count recorded across all servers?",
                    options,
                    top.PlayerName,
                    $"{top.PlayerName} recorded {top.FinalKills:N0} kills on {top.MapName}.",
                    TargetPlayerName: top.PlayerName,
                    TargetRoundId: top.RoundId,
                    TargetMapName: top.MapName
                ));
            }
        }

        var mapsWithScores = await dbContext.PlayerBestScores
            .AsNoTracking()
            .Where(pbs => pbs.Period == "all_time")
            .GroupBy(pbs => pbs.MapName)
            .Select(g => new
            {
                MapName = g.Key,
                PlayerCount = g.Select(x => x.PlayerName).Distinct().Count(),
                TopScore = g.Max(x => x.FinalScore)
            })
            .Where(x => x.PlayerCount >= 4)
            .OrderByDescending(x => x.TopScore)
            .Take(16)
            .ToListAsync(cancellationToken);

        foreach (var map in mapsWithScores)
        {
            var scores = await dbContext.PlayerBestScores
                .AsNoTracking()
                .Where(pbs => pbs.Period == "all_time" && pbs.MapName == map.MapName)
                .OrderByDescending(pbs => pbs.FinalScore)
                .Take(8)
                .ToListAsync(cancellationToken);

            var options = scores.Select(s => s.PlayerName).Distinct().Take(4).ToList();
            if (options.Count < 4) continue;

            var top = scores[0];
            var mapSlug = SanitizeTriviaId(map.MapName);

            pool.Add(new TriviaQuestionInternal(
                $"map_best_score_{mapSlug}",
                "Map Round Records",
                $"On {map.MapName}, who holds the record for highest single-round score?",
                options,
                top.PlayerName,
                $"{top.PlayerName} scored {top.FinalScore:N0} points in a single round on {map.MapName}.",
                TargetPlayerName: top.PlayerName,
                TargetRoundId: top.RoundId,
                TargetMapName: top.MapName
            ));

            var killRecords = await dbContext.PlayerBestScores
                .AsNoTracking()
                .Where(pbs => pbs.Period == "all_time" && pbs.MapName == map.MapName)
                .OrderByDescending(pbs => pbs.FinalKills)
                .Take(8)
                .ToListAsync(cancellationToken);

            var kOptions = killRecords.Select(s => s.PlayerName).Distinct().Take(4).ToList();
            if (kOptions.Count == 4 && killRecords[0].FinalKills > 0)
            {
                var topK = killRecords[0];
                pool.Add(new TriviaQuestionInternal(
                    $"map_best_kills_{mapSlug}",
                    "Map Round Kills",
                    $"On {map.MapName}, who holds the record for most kills in a single round?",
                    kOptions,
                    topK.PlayerName,
                    $"{topK.PlayerName} eliminated {topK.FinalKills:N0} enemies in a single round on {map.MapName}.",
                    TargetPlayerName: topK.PlayerName,
                    TargetRoundId: topK.RoundId,
                    TargetMapName: map.MapName
                ));
            }
        }
    }

    private async Task AddMapGlobalAndTheaterQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        CancellationToken cancellationToken)
    {
        var maps = await dbContext.MapGlobalAverages
            .AsNoTracking()
            .Where(m => m.ServerGuid == "")
            .OrderByDescending(m => m.AvgKillRate)
            .Take(16)
            .ToListAsync(cancellationToken);

        if (maps.Count < 4)
        {
            maps = await dbContext.MapGlobalAverages
                .AsNoTracking()
                .OrderByDescending(m => m.AvgKillRate)
                .Take(16)
                .ToListAsync(cancellationToken);
        }

        if (maps.Count >= 4)
        {
            var deadly = maps.OrderByDescending(m => m.AvgKillRate).First();
            var killRateOptions = maps.OrderByDescending(m => m.AvgKillRate).Take(4).Select(m => m.MapName).Distinct().ToList();
            if (killRateOptions.Count == 4)
            {
                pool.Add(new TriviaQuestionInternal(
                    "map_kill_rate",
                    "Map Tactics",
                    "Which map records the highest average kill rate (kills per minute) in tracked history?",
                    killRateOptions,
                    deadly.MapName,
                    $"{deadly.MapName} records an average kill rate of {deadly.AvgKillRate:F2} kills/min."
                ));
            }

            var scoring = maps.OrderByDescending(m => m.AvgScoreRate).First();
            var scoreRateOptions = maps.OrderByDescending(m => m.AvgScoreRate).Take(4).Select(m => m.MapName).Distinct().ToList();
            if (scoreRateOptions.Count == 4 && scoring.MapName != deadly.MapName)
            {
                pool.Add(new TriviaQuestionInternal(
                    "map_score_rate",
                    "Map Scoring",
                    "Which map records the highest average score rate (score per minute) in tracked history?",
                    scoreRateOptions,
                    scoring.MapName,
                    $"{scoring.MapName} records an average score rate of {scoring.AvgScoreRate:F2} score/min."
                ));
            }
        }

        var mapTotals = await dbContext.ServerMapStats
            .AsNoTracking()
            .GroupBy(sms => sms.MapName)
            .Select(g => new
            {
                MapName = g.Key,
                TotalRounds = g.Sum(x => x.TotalRounds),
                TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes),
                AvgDurationMinutes = g.Sum(x => x.TotalRounds) > 0 ? (double)g.Sum(x => x.TotalPlayTimeMinutes) / g.Sum(x => x.TotalRounds) : 0
            })
            .OrderByDescending(x => x.TotalRounds)
            .Take(16)
            .ToListAsync(cancellationToken);

        if (mapTotals.Count < 4)
        {
            mapTotals = await dbContext.Rounds
                .AsNoTracking()
                .Where(r => !r.IsDeleted && r.MapName.Length > 0)
                .GroupBy(r => r.MapName)
                .Select(g => new
                {
                    MapName = g.Key,
                    TotalRounds = g.Count(),
                    TotalPlayTimeMinutes = g.Sum(x => x.DurationMinutes) ?? 0,
                    AvgDurationMinutes = g.Count() > 0 ? (double)(g.Sum(x => x.DurationMinutes) ?? 0) / g.Count() : 0
                })
                .OrderByDescending(x => x.TotalRounds)
                .Take(16)
                .ToListAsync(cancellationToken);
        }

        if (mapTotals.Count >= 4)
        {
            var mostPlayed = mapTotals[0];
            var mostPlayedOptions = mapTotals.Take(4).Select(m => m.MapName).Distinct().ToList();
            if (mostPlayedOptions.Count == 4)
            {
                pool.Add(new TriviaQuestionInternal(
                    "map_most_rounds",
                    "Theater Contested",
                    "Which map has the most recorded rounds across all tracked servers?",
                    mostPlayedOptions,
                    mostPlayed.MapName,
                    $"{mostPlayed.MapName} leads with {mostPlayed.TotalRounds:N0} total recorded rounds."
                ));
            }

            var longest = mapTotals.OrderByDescending(m => m.AvgDurationMinutes).First();
            var durationOptions = mapTotals.OrderByDescending(m => m.AvgDurationMinutes).Take(4).Select(m => m.MapName).Distinct().ToList();
            if (durationOptions.Count == 4)
            {
                pool.Add(new TriviaQuestionInternal(
                    "map_longest_rounds",
                    "Theater Endurance",
                    "Which map has the longest average round duration across tracked servers?",
                    durationOptions,
                    longest.MapName,
                    $"Rounds on {longest.MapName} average {longest.AvgDurationMinutes:F1} minutes."
                ));
            }

            var fastest = mapTotals.Where(m => m.AvgDurationMinutes > 0).OrderBy(m => m.AvgDurationMinutes).FirstOrDefault();
            if (fastest != null && fastest.MapName != longest.MapName)
            {
                var fastOptions = mapTotals.Where(m => m.AvgDurationMinutes > 0).OrderBy(m => m.AvgDurationMinutes).Take(4).Select(m => m.MapName).Distinct().ToList();
                if (fastOptions.Count == 4)
                {
                    pool.Add(new TriviaQuestionInternal(
                        "map_fastest_rounds",
                        "Blitz Engagements",
                        "Which map records the fastest average round conclusion (shortest duration)?",
                        fastOptions,
                        fastest.MapName,
                        $"Rounds on {fastest.MapName} conclude fastest, averaging {fastest.AvgDurationMinutes:F1} minutes."
                    ));
                }
            }
        }
    }

    private async Task AddPlayerAchievementTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        CancellationToken cancellationToken)
    {
        var firstPlaceLeaders = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.AchievementType == "round_placement" && pa.AchievementId == "round_placement_1")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(4)
            .ToListAsync(cancellationToken);

        if (firstPlaceLeaders.Count == 4 && firstPlaceLeaders[0].Count > firstPlaceLeaders[1].Count)
        {
            var top = firstPlaceLeaders[0];
            var opts = firstPlaceLeaders.Select(x => x.PlayerName).ToList();
            pool.Add(new TriviaQuestionInternal(
                "ach_most_first_places",
                "Combat MVP",
                "Which soldier has achieved the most 1st-Place MVP finishes in recorded rounds?",
                opts,
                top.PlayerName,
                $"{top.PlayerName} leads the battlefield with {top.Count:N0} first-place victories!",
                TargetPlayerName: top.PlayerName
            ));
        }

        var podiumLeaders = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.AchievementType == "round_placement")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(4)
            .ToListAsync(cancellationToken);

        if (podiumLeaders.Count == 4 && podiumLeaders[0].Count > podiumLeaders[1].Count)
        {
            var top = podiumLeaders[0];
            var opts = podiumLeaders.Select(x => x.PlayerName).ToList();
            pool.Add(new TriviaQuestionInternal(
                "ach_most_podiums",
                "Podium Veteran",
                "Which combatant has achieved the highest number of podium (top 3) round finishes?",
                opts,
                top.PlayerName,
                $"{top.PlayerName} has secured a top-3 podium finish in {top.Count:N0} recorded rounds.",
                TargetPlayerName: top.PlayerName
            ));
        }

        var streakLeaders = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.AchievementType == "kill_streak")
            .GroupBy(pa => pa.PlayerName)
            .Select(g => new { PlayerName = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(4)
            .ToListAsync(cancellationToken);

        if (streakLeaders.Count == 4 && streakLeaders[0].Count > streakLeaders[1].Count)
        {
            var top = streakLeaders[0];
            var opts = streakLeaders.Select(x => x.PlayerName).ToList();
            pool.Add(new TriviaQuestionInternal(
                "ach_most_sprees",
                "Rampage Specialist",
                "Which soldier has earned the most combat streak medals (Killing Spree, Rampage, Godlike)?",
                opts,
                top.PlayerName,
                $"{top.PlayerName} has unlocked {top.Count:N0} combat streak medals.",
                TargetPlayerName: top.PlayerName
            ));
        }

        var longestStreaks = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(pa => pa.AchievementType == "kill_streak" && pa.RoundId != "")
            .OrderByDescending(pa => pa.Value)
            .Take(10)
            .ToListAsync(cancellationToken);

        if (longestStreaks.Count >= 4)
        {
            var topStreak = longestStreaks[0];
            var streakOpts = longestStreaks.Select(x => x.PlayerName).Distinct().Take(4).ToList();
            if (streakOpts.Count == 4 && topStreak.Value > 0)
            {
                pool.Add(new TriviaQuestionInternal(
                    "ach_longest_streak_record",
                    "Killstreak Legend",
                    "Who achieved the highest recorded killstreak in a single round without dying?",
                    streakOpts,
                    topStreak.PlayerName,
                    $"{topStreak.PlayerName} went on a {topStreak.Value}-kill rampage on {topStreak.MapName}!",
                    TargetPlayerName: topStreak.PlayerName,
                    TargetRoundId: topStreak.RoundId,
                    TargetMapName: topStreak.MapName
                ));
            }
        }
    }

    private async Task AddServerNetworkTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        CancellationToken cancellationToken)
    {
        var servers = await dbContext.Servers
            .AsNoTracking()
            .Where(s => s.Name != "")
            .ToListAsync(cancellationToken);

        if (servers.Count >= 4)
        {
            var onlineServers = servers.Where(s => s.IsOnline).ToList();
            if (onlineServers.Count >= 4)
            {
                var busiest = onlineServers.OrderByDescending(s => s.CurrentNumPlayers).First();
                var busyOpts = onlineServers.OrderByDescending(s => s.CurrentNumPlayers).Take(4).Select(s => s.Name).Distinct().ToList();
                if (busyOpts.Count == 4)
                {
                    pool.Add(new TriviaQuestionInternal(
                        "busiest_server",
                        "Server Occupancy",
                        "Which tracked server currently has the most players online?",
                        busyOpts,
                        busiest.Name,
                        $"{busiest.Name} currently reports {busiest.CurrentNumPlayers} players online.",
                        TargetServerName: busiest.Name
                    ));
                }
            }

            var maxCap = servers.OrderByDescending(s => s.MaxPlayers).First();
            var capOpts = servers.OrderByDescending(s => s.MaxPlayers).Take(4).Select(s => s.Name).Distinct().ToList();
            if (capOpts.Count == 4 && maxCap.MaxPlayers > 0)
            {
                pool.Add(new TriviaQuestionInternal(
                    "server_max_capacity",
                    "Server Capacity",
                    "Which tracked server boasts the largest maximum player capacity?",
                    capOpts,
                    maxCap.Name,
                    $"{maxCap.Name} supports up to {maxCap.MaxPlayers} simultaneous combatants.",
                    TargetServerName: maxCap.Name
                ));
            }
        }

        var combatantCounts = await dbContext.PlayerServerStats
            .AsNoTracking()
            .GroupBy(pss => pss.ServerGuid)
            .Select(g => new { ServerGuid = g.Key, Count = g.Select(x => x.PlayerName).Distinct().Count() })
            .OrderByDescending(x => x.Count)
            .Take(8)
            .ToListAsync(cancellationToken);

        if (combatantCounts.Count >= 4)
        {
            var sGuids = combatantCounts.Select(c => c.ServerGuid).ToList();
            var serverNames = await dbContext.Servers
                .AsNoTracking()
                .Where(s => sGuids.Contains(s.Guid))
                .ToDictionaryAsync(s => s.Guid, s => s.Name, cancellationToken);

            var named = combatantCounts
                .Where(c => serverNames.ContainsKey(c.ServerGuid))
                .Select(c => (Name: serverNames[c.ServerGuid], c.Count))
                .Take(4)
                .ToList();

            if (named.Count == 4)
            {
                var top = named[0];
                var options = named.Select(n => n.Name).ToList();
                pool.Add(new TriviaQuestionInternal(
                    "most_regulars",
                    "Server Regulars",
                    "Which server has the largest number of recorded regular combatants?",
                    options,
                    top.Name,
                    $"{top.Name} has {top.Count:N0} distinct players with recorded server stats.",
                    TargetServerName: top.Name
                ));
            }
        }
    }

    private static void AddCareerMilestoneTriviaQuestions(
        List<TriviaQuestionInternal> pool,
        IReadOnlyList<ArcadeCandidate> candidates)
    {
        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "top_kills",
            "Veteran Records",
            "Which combatant has logged the highest total kills on record?",
            c => c.TotalKills,
            c => $"{c.PlayerName} leads with {c.TotalKills:N0} total confirmed kills.");

        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "top_score",
            "Career Scoreboard",
            "Which combatant holds the highest career score on record?",
            c => c.TotalScore,
            c => $"{c.PlayerName} leads with {c.TotalScore:N0} career score.");

        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "top_playtime",
            "Field Endurance",
            "Which combatant has logged the most playtime among active veterans?",
            c => c.PlayTimeHours,
            c => $"{c.PlayerName} has {c.PlayTimeHours:N0} hours on record.");

        TryAddPlayerMetricQuestion(
            pool,
            candidates,
            "top_kd",
            "Sharpshooter Intel",
            "Which veteran boasts the most lethal career Kill/Death ratio?",
            c => c.KdRatio,
            c => $"{c.PlayerName} boasts a lethal {c.KdRatio:F2} K/D ratio.");
    }

    private static string FormatMonthYear(int year, int month)
    {
        if (month is < 1 or > 12)
        {
            return $"{year}-{month:D2}";
        }

        var date = new DateTime(year, month, 1);
        return date.ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
    }

    private static string SanitizeTriviaId(string value)
    {
        var chars = value
            .ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '_')
            .ToArray();
        var slug = new string(chars);
        while (slug.Contains("__", StringComparison.Ordinal))
        {
            slug = slug.Replace("__", "_", StringComparison.Ordinal);
        }
        return slug.Trim('_');
    }

    private static bool TryAddPlayerMetricQuestion(
        List<TriviaQuestionInternal> questions,
        IReadOnlyList<ArcadeCandidate> candidates,
        string id,
        string category,
        string question,
        Func<ArcadeCandidate, double> metricSelector,
        Func<ArcadeCandidate, string> explanationBuilder,
        string? mapName = null,
        string? serverName = null)
    {
        if (questions.Any(q => q.Id == id) || candidates.Count < 4)
        {
            return false;
        }

        var ranked = candidates.OrderByDescending(metricSelector).ToList();
        var top = ranked[0];
        var options = ranked.Take(4).Select(c => c.PlayerName).Distinct().ToList();
        if (options.Count < 4)
        {
            return false;
        }

        Shuffle(options);
        questions.Add(new TriviaQuestionInternal(
            id,
            category,
            question,
            options.Take(4).ToList(),
            top.PlayerName,
            explanationBuilder(top),
            TargetPlayerName: top.PlayerName,
            TargetMapName: mapName,
            TargetServerName: serverName
        ));
        return true;
    }

    public Task<TriviaQuestionVerificationDto> VerifyTriviaQuestionAsync(
        TriviaVerifyQuestionRequest request,
        CancellationToken cancellationToken = default)
    {
        var payload = ValidateToken<TriviaQuizTokenPayload>(request.QuizToken);
        if (payload == null)
        {
            throw new ArgumentException("Invalid or expired quiz token.");
        }

        var question = payload.Questions.FirstOrDefault(q => q.Id == request.QuestionId);
        if (question == null)
        {
            throw new ArgumentException($"Question with ID '{request.QuestionId}' was not found in this quiz session.");
        }

        var isCorrect = string.Equals(request.Answer.Trim(), question.CorrectAnswer.Trim(), StringComparison.OrdinalIgnoreCase);

        return Task.FromResult(new TriviaQuestionVerificationDto(
            question.Id,
            isCorrect,
            request.Answer,
            question.CorrectAnswer,
            question.Explanation,
            question.TargetPlayerName,
            question.TargetRoundId,
            question.TargetMapName,
            question.TargetServerName
        ));
    }

    public Task<TriviaQuizResultDto> VerifyTriviaQuizAsync(
        TriviaVerifyRequest request,
        CancellationToken cancellationToken = default)
    {
        var payload = ValidateToken<TriviaQuizTokenPayload>(request.QuizToken);
        if (payload == null)
        {
            throw new ArgumentException("Invalid or expired quiz token.");
        }

        var results = new List<TriviaQuestionResultDto>();
        var correctCount = 0;

        foreach (var q in payload.Questions)
        {
            request.Answers.TryGetValue(q.Id, out var selected);
            selected ??= "";

            var isCorrect = string.Equals(selected.Trim(), q.CorrectAnswer.Trim(), StringComparison.OrdinalIgnoreCase);
            if (isCorrect)
            {
                correctCount++;
            }

            results.Add(new TriviaQuestionResultDto(
                q.Id,
                q.Question,
                selected,
                q.CorrectAnswer,
                isCorrect,
                q.Explanation,
                q.TargetPlayerName,
                q.TargetRoundId,
                q.TargetMapName,
                q.TargetServerName
            ));
        }

        var total = payload.Questions.Count;
        var percentage = total > 0 ? (double)correctCount / total * 100.0 : 0.0;

        var (rankTitle, summary) = percentage switch
        {
            >= 100 => ("Supreme Commander (5/5)", "Flawless tactical intelligence! You know the battlefield inside out!"),
            >= 80 => ("Field Colonel (4/5)", "Superior battlefield awareness. An outstanding showing, Commander!"),
            >= 60 => ("Combat Major (3/5)", "Solid field performance. You have veteran frontline experience."),
            >= 40 => ("Frontline Sergeant (2/5)", "Decent reconnaissance, soldier. Hit the archives to hone your intel."),
            _ => ("Bootcamp Recruit", "Back to the briefing room! More target practice needed.")
        };

        return Task.FromResult(new TriviaQuizResultDto(
            total,
            correctCount,
            percentage,
            rankTitle,
            summary,
            results
        ));
    }

    public async Task<IReadOnlyList<ArcadePlayerSearchDto>> SearchPlayersAsync(
        string query,
        string? serverGuid = null,
        int limit = 10,
        CancellationToken cancellationToken = default)
    {
        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);
        if (candidates.Count == 0)
        {
            candidates = DefaultCandidates;
        }

        var q = query.Trim();
        if (string.IsNullOrWhiteSpace(q))
        {
            return candidates
                .Take(limit)
                .Select(c => new ArcadePlayerSearchDto(c.PlayerName, c.Country, c.PlayTimeHours, c.KdRatio))
                .ToList();
        }

        var matches = candidates
            .Where(c => c.PlayerName.Contains(q, StringComparison.OrdinalIgnoreCase))
            .Take(limit)
            .Select(c => new ArcadePlayerSearchDto(c.PlayerName, c.Country, c.PlayTimeHours, c.KdRatio))
            .ToList();

        return matches;
    }

    private async Task<IReadOnlyList<ArcadeCandidate>> GetArcadeCandidatesAsync(string? serverGuid, CancellationToken cancellationToken)
        => (await GetArcadeRosterAsync(serverGuid, cancellationToken)).Candidates;

    private async Task<ArcadeRoster> GetArcadeRosterAsync(string? serverGuid, CancellationToken cancellationToken)
    {
        var cacheKey = $"Arcade:Roster:{serverGuid ?? "global"}";
        if (memoryCache.TryGetValue(cacheKey, out ArcadeRoster? cached) && cached != null && cached.Candidates.Count > 0)
        {
            return cached;
        }

        try
        {
            var roster = !string.IsNullOrWhiteSpace(serverGuid)
                ? await LoadRosterForServerAsync(serverGuid, cancellationToken)
                : await LoadGlobalRosterFromDbAsync(cancellationToken);

            if (roster.Candidates.Count == 0)
            {
                roster = DefaultRoster;
            }

            memoryCache.Set(cacheKey, roster, CacheDuration);
            return roster;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to load arcade candidates for server {ServerGuid}. Using default fallback roster.", serverGuid);
            return DefaultRoster;
        }
    }

    private async Task<ArcadeRoster> LoadRosterForServerAsync(string serverGuid, CancellationToken cancellationToken)
    {
        var server = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid, cancellationToken);
        var serverName = server?.Name ?? "Selected Server";
        var serverCountry = server?.Country ?? "US";

        var serverPlayers = await dbContext.PlayerServerStats
            .AsNoTracking()
            .Where(p => p.ServerGuid == serverGuid)
            .GroupBy(p => p.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalScore = g.Sum(x => x.TotalScore),
                TotalKills = g.Sum(x => x.TotalKills),
                TotalDeaths = g.Sum(x => x.TotalDeaths),
                TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes)
            })
            .OrderByDescending(x => x.TotalScore)
            .Take(150)
            .ToListAsync(cancellationToken);

        if (serverPlayers.Count == 0)
        {
            return new ArcadeRoster([], EmptyMapSnapshots);
        }

        var playerNames = serverPlayers.Select(p => p.PlayerName).ToList();
        var mapsByPlayer = await LoadMapSnapshotsAsync(playerNames, serverGuid, cancellationToken);
        var topMapByPlayer = FavoriteMapByPlayer(mapsByPlayer);

        var badges = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(a => playerNames.Contains(a.PlayerName) && (a.ServerGuid == serverGuid || a.ServerGuid == ""))
            .Select(a => new { a.PlayerName, a.AchievementName })
            .Distinct()
            .ToListAsync(cancellationToken);

        var topBadgeByPlayer = badges
            .GroupBy(b => b.PlayerName)
            .ToDictionary(g => g.Key, g => g.First().AchievementName);

        var result = new List<ArcadeCandidate>();
        foreach (var p in serverPlayers)
        {
            topMapByPlayer.TryGetValue(p.PlayerName, out var favMap);
            favMap ??= "Wake Island";

            topBadgeByPlayer.TryGetValue(p.PlayerName, out var badge);

            var hours = p.TotalPlayTimeMinutes / 60.0;
            var kd = p.TotalDeaths > 0 ? (double)p.TotalKills / p.TotalDeaths : p.TotalKills;

            result.Add(new ArcadeCandidate(
                p.PlayerName,
                serverCountry,
                p.TotalKills,
                p.TotalScore,
                Math.Round(hours, 1),
                Math.Round(kd, 2),
                favMap,
                serverName,
                badge
            ));
        }

        return new ArcadeRoster(result, mapsByPlayer);
    }

    private async Task<ArcadeRoster> LoadGlobalRosterFromDbAsync(CancellationToken cancellationToken)
    {
        var monthlyPlayers = await dbContext.PlayerStatsMonthly
            .AsNoTracking()
            .GroupBy(p => p.PlayerName)
            .Select(g => new
            {
                PlayerName = g.Key,
                TotalScore = g.Sum(x => x.TotalScore),
                TotalKills = g.Sum(x => x.TotalKills),
                TotalDeaths = g.Sum(x => x.TotalDeaths),
                TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes)
            })
            .OrderByDescending(x => x.TotalScore)
            .Take(150)
            .ToListAsync(cancellationToken);

        if (monthlyPlayers.Count == 0)
        {
            var mapPlayers = await dbContext.PlayerMapStats
                .AsNoTracking()
                .GroupBy(p => p.PlayerName)
                .Select(g => new
                {
                    PlayerName = g.Key,
                    TotalScore = g.Sum(x => x.TotalScore),
                    TotalKills = g.Sum(x => x.TotalKills),
                    TotalDeaths = g.Sum(x => x.TotalDeaths),
                    TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes)
                })
                .OrderByDescending(x => x.TotalScore)
                .Take(150)
                .ToListAsync(cancellationToken);

            monthlyPlayers = mapPlayers;
        }

        if (monthlyPlayers.Count == 0)
        {
            return new ArcadeRoster([], EmptyMapSnapshots);
        }

        var playerNames = monthlyPlayers.Select(p => p.PlayerName).ToList();
        var mapsByPlayer = await LoadMapSnapshotsAsync(playerNames, null, cancellationToken);
        var topMapByPlayer = FavoriteMapByPlayer(mapsByPlayer);

        var playerServers = await dbContext.PlayerServerStats
            .AsNoTracking()
            .Where(s => playerNames.Contains(s.PlayerName))
            .GroupBy(s => new { s.PlayerName, s.ServerGuid })
            .Select(g => new
            {
                g.Key.PlayerName,
                g.Key.ServerGuid,
                TotalRounds = g.Sum(x => x.TotalRounds)
            })
            .ToListAsync(cancellationToken);

        var topServerGuidByPlayer = playerServers
            .GroupBy(s => s.PlayerName)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => x.TotalRounds).First().ServerGuid
            );

        var servers = await dbContext.Servers
            .AsNoTracking()
            .Select(s => new { s.Guid, s.Name, s.Country })
            .ToListAsync(cancellationToken);

        var serverDict = servers.ToDictionary(s => s.Guid, s => s);

        var badges = await dbContext.PlayerAchievements
            .AsNoTracking()
            .Where(a => playerNames.Contains(a.PlayerName))
            .Select(a => new { a.PlayerName, a.AchievementName })
            .Distinct()
            .ToListAsync(cancellationToken);

        var topBadgeByPlayer = badges
            .GroupBy(b => b.PlayerName)
            .ToDictionary(g => g.Key, g => g.First().AchievementName);

        var result = new List<ArcadeCandidate>();
        foreach (var p in monthlyPlayers)
        {
            topMapByPlayer.TryGetValue(p.PlayerName, out var favMap);
            favMap ??= "Wake Island";

            string favServer = "Global Server";
            string country = "US";

            if (topServerGuidByPlayer.TryGetValue(p.PlayerName, out var sGuid) && serverDict.TryGetValue(sGuid, out var sInfo))
            {
                favServer = sInfo.Name;
                if (!string.IsNullOrWhiteSpace(sInfo.Country))
                {
                    country = sInfo.Country;
                }
            }

            topBadgeByPlayer.TryGetValue(p.PlayerName, out var badge);

            var hours = p.TotalPlayTimeMinutes / 60.0;
            var kd = p.TotalDeaths > 0 ? (double)p.TotalKills / p.TotalDeaths : p.TotalKills;

            result.Add(new ArcadeCandidate(
                p.PlayerName,
                country,
                p.TotalKills,
                p.TotalScore,
                Math.Round(hours, 1),
                Math.Round(kd, 2),
                favMap,
                favServer,
                badge
            ));
        }

        return new ArcadeRoster(result, mapsByPlayer);
    }

    private static MysteryDossierDto BuildDossierDto(
        ArcadeCandidate target,
        string dossierToken,
        string mode,
        IReadOnlyList<ArcadeCandidate> candidates,
        int? deterministicSeed = null)
    {
        var killsLow = (target.TotalKills / 1000) * 1000;
        var killsHigh = killsLow + 1000;
        var killsBracket = $"{killsLow:N0} - {killsHigh:N0} kills";

        var hoursLow = (int)(target.PlayTimeHours / 100) * 100;
        var hoursHigh = hoursLow + 100;
        var playTimeBracket = $"{hoursLow} - {hoursHigh} hrs";

        var kdLow = Math.Floor(target.KdRatio * 2) / 2.0;
        var kdHigh = kdLow + 0.5;
        var kdBracket = $"{kdLow:F1} - {kdHigh:F1}";

        var candidateOptions = BuildCandidateOptions(target, candidates, deterministicSeed);

        return new MysteryDossierDto(
            dossierToken,
            mode,
            killsBracket,
            playTimeBracket,
            kdBracket,
            target.FavoriteMap,
            target.FavoriteServer,
            target.SignatureBadge ?? "Frontline Soldier",
            candidates.Count,
            candidateOptions
        );
    }

    private static IReadOnlyList<string> BuildCandidateOptions(
        ArcadeCandidate target,
        IReadOnlyList<ArcadeCandidate> candidates,
        int? deterministicSeed)
    {
        var others = candidates
            .Where(c => !string.Equals(c.PlayerName, target.PlayerName, StringComparison.OrdinalIgnoreCase))
            .ToList();

        // Target + 3 to 4 distractors => 4 to 5 total suspect options
        var distractorCount = others.Count >= 4 ? 4 : Math.Min(3, others.Count);
        if (distractorCount < 1)
        {
            return [target.PlayerName];
        }

        List<ArcadeCandidate> distractors;
        if (deterministicSeed.HasValue)
        {
            distractors = others
                .OrderBy(c => HashCode.Combine(deterministicSeed.Value, StringComparer.OrdinalIgnoreCase.GetHashCode(c.PlayerName)))
                .ThenBy(c => c.PlayerName, StringComparer.OrdinalIgnoreCase)
                .Take(distractorCount)
                .ToList();
        }
        else
        {
            Shuffle(others);
            distractors = others.Take(distractorCount).ToList();
        }

        var options = distractors.Select(d => d.PlayerName).Append(target.PlayerName).ToList();

        if (deterministicSeed.HasValue)
        {
            options = options
                .OrderBy(name => HashCode.Combine(deterministicSeed.Value ^ 0x5f3759df, StringComparer.OrdinalIgnoreCase.GetHashCode(name)))
                .ThenBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        else
        {
            Shuffle(options);
        }

        return options;
    }

    private async Task<HigherLowerQuestionDto> BuildNextHigherLowerAsync(
        string? serverGuid,
        string? currentCandidateName,
        string? excludeMetric,
        string? excludeMapName,
        CancellationToken cancellationToken)
    {
        var roster = await GetArcadeRosterAsync(serverGuid, cancellationToken);
        var candidates = roster.Candidates.Count >= 2 ? roster.Candidates : DefaultCandidates;
        var mapsByPlayer = roster.MapsByPlayer.Count > 0 ? roster.MapsByPlayer : DefaultMapSnapshots;

        string? serverName = null;
        if (!string.IsNullOrWhiteSpace(serverGuid))
        {
            var serverObj = await dbContext.Servers.AsNoTracking()
                .FirstOrDefaultAsync(s => s.Guid == serverGuid, cancellationToken);
            serverName = serverObj?.Name;
        }

        var matchup = TryPickMapMatchup(candidates, mapsByPlayer, currentCandidateName, excludeMetric, excludeMapName)
            ?? PickCareerMatchup(candidates, currentCandidateName, excludeMetric);

        if (RandomNumberGenerator.GetInt32(2) == 1)
        {
            matchup = new HigherLowerMatchup(
                matchup.PlayerB,
                matchup.PlayerA,
                matchup.Metric,
                matchup.ValueB,
                matchup.ValueA,
                matchup.MapName
            );
        }

        var metricLabel = GetMetricLabel(matchup.Metric, matchup.MapName, serverName);
        var prompt = BuildPrompt(matchup.Metric, matchup.MapName, serverName);

        var tokenPayload = new HigherLowerTokenPayload(
            matchup.Metric,
            matchup.PlayerA.PlayerName,
            matchup.ValueA,
            matchup.PlayerB.PlayerName,
            matchup.ValueB,
            DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            serverGuid,
            matchup.MapName
        );
        var roundToken = SignPayload(tokenPayload);

        var playerADto = new CombatantDto(
            matchup.PlayerA.PlayerName,
            matchup.PlayerA.Country,
            matchup.MapName ?? matchup.PlayerA.FavoriteMap
        );

        var playerBDto = new CombatantDto(
            matchup.PlayerB.PlayerName,
            matchup.PlayerB.Country,
            matchup.MapName ?? matchup.PlayerB.FavoriteMap
        );

        return new HigherLowerQuestionDto(
            matchup.Metric,
            metricLabel,
            playerADto,
            playerBDto,
            roundToken,
            prompt,
            matchup.MapName);
    }

    private async Task<IReadOnlyDictionary<string, IReadOnlyList<PlayerMapSnapshot>>> LoadMapSnapshotsAsync(
        IReadOnlyCollection<string> playerNames,
        string? serverGuid,
        CancellationToken cancellationToken)
    {
        if (playerNames.Count == 0)
        {
            return EmptyMapSnapshots;
        }

        IQueryable<PlayerMapStats> query = dbContext.PlayerMapStats.AsNoTracking()
            .Where(m => playerNames.Contains(m.PlayerName));

        if (!string.IsNullOrWhiteSpace(serverGuid))
        {
            query = query.Where(m => m.ServerGuid == serverGuid);
        }
        else
        {
            var hasGlobal = await query.AnyAsync(
                m => m.ServerGuid == PlayerMapStats.GlobalServerGuid,
                cancellationToken);
            query = hasGlobal
                ? query.Where(m => m.ServerGuid == PlayerMapStats.GlobalServerGuid)
                : query.Where(m => m.ServerGuid != PlayerMapStats.GlobalServerGuid);
        }

        var rows = await query
            .GroupBy(m => new { m.PlayerName, m.MapName })
            .Select(g => new
            {
                g.Key.PlayerName,
                g.Key.MapName,
                TotalKills = g.Sum(x => x.TotalKills),
                TotalDeaths = g.Sum(x => x.TotalDeaths),
                TotalScore = g.Sum(x => x.TotalScore),
                TotalPlayTimeMinutes = g.Sum(x => x.TotalPlayTimeMinutes),
                TotalRounds = g.Sum(x => x.TotalRounds)
            })
            .ToListAsync(cancellationToken);

        if (rows.Count == 0)
        {
            return EmptyMapSnapshots;
        }

        return rows
            .GroupBy(r => r.PlayerName, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => (IReadOnlyList<PlayerMapSnapshot>)g
                    .Select(r =>
                    {
                        var hours = r.TotalPlayTimeMinutes / 60.0;
                        var kd = r.TotalDeaths > 0 ? (double)r.TotalKills / r.TotalDeaths : r.TotalKills;
                        var killRate = r.TotalPlayTimeMinutes > 0 ? r.TotalKills / r.TotalPlayTimeMinutes : 0;
                        return new PlayerMapSnapshot(
                            r.MapName,
                            r.TotalKills,
                            r.TotalDeaths,
                            r.TotalScore,
                            Math.Round(hours, 1),
                            r.TotalRounds,
                            Math.Round(kd, 2),
                            Math.Round(killRate, 2));
                    })
                    .ToList(),
                StringComparer.OrdinalIgnoreCase);
    }

    private static Dictionary<string, string> FavoriteMapByPlayer(
        IReadOnlyDictionary<string, IReadOnlyList<PlayerMapSnapshot>> mapsByPlayer)
        => mapsByPlayer.ToDictionary(
            kv => kv.Key,
            kv => kv.Value.OrderByDescending(x => x.TotalRounds).First().MapName,
            StringComparer.OrdinalIgnoreCase);

    private static HigherLowerMatchup? TryPickMapMatchup(
        IReadOnlyList<ArcadeCandidate> candidates,
        IReadOnlyDictionary<string, IReadOnlyList<PlayerMapSnapshot>> mapsByPlayer,
        string? currentCandidateName,
        string? excludeMetric,
        string? excludeMapName)
    {
        if (mapsByPlayer.Count == 0 || candidates.Count < 2)
        {
            return null;
        }

        var byName = candidates.ToDictionary(c => c.PlayerName, StringComparer.OrdinalIgnoreCase);
        var playersByMap = new Dictionary<string, List<(ArcadeCandidate Player, PlayerMapSnapshot Snap)>>(
            StringComparer.OrdinalIgnoreCase);

        foreach (var (playerName, snaps) in mapsByPlayer)
        {
            if (!byName.TryGetValue(playerName, out var player))
            {
                continue;
            }

            foreach (var snap in snaps)
            {
                if (!IsEligibleMapSample(snap))
                {
                    continue;
                }

                if (!playersByMap.TryGetValue(snap.MapName, out var list))
                {
                    list = [];
                    playersByMap[snap.MapName] = list;
                }

                list.Add((player, snap));
            }
        }

        var sharedMaps = playersByMap
            .Where(kv => kv.Value.Select(x => x.Player.PlayerName).Distinct(StringComparer.OrdinalIgnoreCase).Count() >= 2)
            .Select(kv => kv.Key)
            .ToList();

        if (sharedMaps.Count == 0)
        {
            return null;
        }

        ArcadeCandidate? anchor = null;
        if (!string.IsNullOrWhiteSpace(currentCandidateName))
        {
            byName.TryGetValue(currentCandidateName, out anchor);
        }

        if (anchor != null)
        {
            var anchorMaps = sharedMaps
                .Where(map => playersByMap[map].Any(p => NamesEqual(p.Player.PlayerName, anchor.PlayerName)))
                .ToList();
            var anchored = PickFromMaps(anchorMaps, playersByMap, anchor, excludeMetric, excludeMapName);
            if (anchored != null)
            {
                return anchored;
            }
        }

        return PickFromMaps(sharedMaps, playersByMap, null, excludeMetric, excludeMapName);
    }

    private static HigherLowerMatchup? PickFromMaps(
        List<string> maps,
        Dictionary<string, List<(ArcadeCandidate Player, PlayerMapSnapshot Snap)>> playersByMap,
        ArcadeCandidate? anchor,
        string? excludeMetric,
        string? excludeMapName)
    {
        if (maps.Count == 0)
        {
            return null;
        }

        Shuffle(maps);
        foreach (var map in maps)
        {
            var occupants = playersByMap[map];
            List<(ArcadeCandidate Player, PlayerMapSnapshot Snap)> leftPool;
            if (anchor != null)
            {
                leftPool = occupants.Where(o => NamesEqual(o.Player.PlayerName, anchor.PlayerName)).ToList();
            }
            else
            {
                leftPool = occupants.ToList();
                Shuffle(leftPool);
            }

            if (leftPool.Count == 0)
            {
                continue;
            }

            var aEntry = leftPool[0];
            var rightPool = occupants
                .Where(o => !NamesEqual(o.Player.PlayerName, aEntry.Player.PlayerName))
                .ToList();
            Shuffle(rightPool);

            foreach (var bEntry in rightPool)
            {
                var metrics = MapMetrics.ToList();
                Shuffle(metrics);
                foreach (var metric in metrics)
                {
                    if (NamesEqual(map, excludeMapName) && NamesEqual(metric, excludeMetric))
                    {
                        continue;
                    }

                    if (!TryGetComparableMapValues(aEntry.Snap, bEntry.Snap, metric, out var valA, out var valB))
                    {
                        continue;
                    }

                    return new HigherLowerMatchup(aEntry.Player, bEntry.Player, metric, valA, valB, map);
                }
            }
        }

        return null;
    }

    private static HigherLowerMatchup PickCareerMatchup(
        IReadOnlyList<ArcadeCandidate> candidates,
        string? currentCandidateName,
        string? excludeMetric)
    {
        ArcadeCandidate candidateA;
        if (!string.IsNullOrWhiteSpace(currentCandidateName))
        {
            var match = candidates.FirstOrDefault(c => NamesEqual(c.PlayerName, currentCandidateName));
            candidateA = match ?? candidates[RandomNumberGenerator.GetInt32(candidates.Count)];
        }
        else
        {
            candidateA = candidates[RandomNumberGenerator.GetInt32(candidates.Count)];
        }

        var opponents = candidates
            .Where(c => !NamesEqual(c.PlayerName, candidateA.PlayerName))
            .ToList();
        if (opponents.Count == 0)
        {
            opponents = DefaultCandidates.Where(c => !NamesEqual(c.PlayerName, candidateA.PlayerName)).ToList();
        }

        Shuffle(opponents);
        var metrics = CareerMetrics.ToList();
        Shuffle(metrics);

        foreach (var opponent in opponents)
        {
            foreach (var metric in metrics)
            {
                if (NamesEqual(metric, excludeMetric))
                {
                    continue;
                }

                var valA = GetCandidateMetricValue(candidateA, metric);
                var valB = GetCandidateMetricValue(opponent, metric);
                if (!HasMeaningfulSpread(metric, valA, valB))
                {
                    continue;
                }

                return new HigherLowerMatchup(candidateA, opponent, metric, valA, valB, null);
            }
        }

        var fallbackB = opponents[0];
        var fallbackMetric = metrics.FirstOrDefault(m => !NamesEqual(m, excludeMetric)) ?? CareerMetrics[0];
        return new HigherLowerMatchup(
            candidateA,
            fallbackB,
            fallbackMetric,
            GetCandidateMetricValue(candidateA, fallbackMetric),
            GetCandidateMetricValue(fallbackB, fallbackMetric),
            null);
    }

    private static bool IsEligibleMapSample(PlayerMapSnapshot snap)
        => snap.TotalRounds >= 5 || snap.PlayTimeHours >= 0.5;

    private static bool TryGetComparableMapValues(
        PlayerMapSnapshot a,
        PlayerMapSnapshot b,
        string metric,
        out double valA,
        out double valB)
    {
        valA = 0;
        valB = 0;

        if (metric == "kd" && (a.TotalDeaths < 10 || b.TotalDeaths < 10))
        {
            return false;
        }

        if (metric == "killrate" && (a.PlayTimeHours < 0.5 || b.PlayTimeHours < 0.5))
        {
            return false;
        }

        valA = GetMapMetricValue(a, metric);
        valB = GetMapMetricValue(b, metric);
        return HasMeaningfulSpread(metric, valA, valB);
    }

    private static bool HasMeaningfulSpread(string metric, double a, double b)
    {
        var abs = Math.Abs(a - b);
        if (abs < 0.0001)
        {
            return false;
        }

        var rel = abs / Math.Max(Math.Max(Math.Abs(a), Math.Abs(b)), 1);
        return metric switch
        {
            "kills" => abs >= 40 && rel >= 0.06,
            "score" => abs >= 80 && rel >= 0.06,
            "playtime" => abs >= 0.75 && rel >= 0.08,
            "kd" => abs >= 0.10,
            "rounds" => abs >= 2 && rel >= 0.08,
            "killrate" => abs >= 0.06,
            _ => abs > 0
        };
    }

    private static double GetMapMetricValue(PlayerMapSnapshot snap, string metric) => metric switch
    {
        "kills" => snap.TotalKills,
        "score" => snap.TotalScore,
        "playtime" => snap.PlayTimeHours,
        "kd" => snap.KdRatio,
        "rounds" => snap.TotalRounds,
        "killrate" => snap.KillRatePerMinute,
        _ => snap.TotalScore
    };

    private static double GetCandidateMetricValue(ArcadeCandidate candidate, string metric) => metric switch
    {
        "kills" => candidate.TotalKills,
        "score" => candidate.TotalScore,
        "playtime" => candidate.PlayTimeHours,
        "kd" => candidate.KdRatio,
        _ => candidate.TotalScore
    };

    private static string MetricDisplayName(string metric) => metric switch
    {
        "kills" => "Kills",
        "score" => "Score",
        "playtime" => "Service Hours",
        "kd" => "K/D Ratio",
        "rounds" => "Rounds Played",
        "killrate" => "Kills / Min",
        _ => "Score"
    };

    private static (string Comparator, string Phrase) MetricPromptPhrase(string metric) => metric switch
    {
        "kills" => ("more", "kills"),
        "score" => ("more", "score"),
        "playtime" => ("more", "service hours"),
        "kd" => ("a higher", "K/D"),
        "rounds" => ("more", "rounds played"),
        "killrate" => ("a higher", "kill rate"),
        _ => ("more", "score")
    };

    private static string GetMetricLabel(string metric, string? mapName, string? serverName)
    {
        var name = MetricDisplayName(metric);
        if (!string.IsNullOrWhiteSpace(mapName))
        {
            return $"{name} on {mapName}";
        }

        if (!string.IsNullOrWhiteSpace(serverName))
        {
            return $"Career {name} on {serverName}";
        }

        return $"Career {name}";
    }

    private static string BuildPrompt(string metric, string? mapName, string? serverName)
    {
        var (comparator, phrase) = MetricPromptPhrase(metric);
        if (!string.IsNullOrWhiteSpace(mapName))
        {
            return $"Who has {comparator} {phrase} on {mapName}?";
        }

        if (!string.IsNullOrWhiteSpace(serverName))
        {
            return $"Who has {comparator} career {phrase} on {serverName}?";
        }

        return $"Who has {comparator} career {phrase}?";
    }

    private static string FormatMetricValue(string metric, double value) => metric switch
    {
        "kills" or "score" or "rounds" => $"{value:N0}",
        "playtime" => $"{value:N0} hrs",
        "kd" => $"{value:F2}",
        "killrate" => $"{value:F2} kills/min",
        _ => $"{value:N0}"
    };

    private static string FormatRevealValuePhrase(string metric, string formattedValue) => metric switch
    {
        "kills" => $"{formattedValue} kills",
        "score" => $"{formattedValue} score",
        "rounds" => $"{formattedValue} rounds",
        "kd" => $"{formattedValue} K/D",
        _ => formattedValue
    };

    private static bool NamesEqual(string? a, string? b)
        => !string.IsNullOrWhiteSpace(a)
           && !string.IsNullOrWhiteSpace(b)
           && string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

    private static void Shuffle<T>(IList<T> list)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }

    private static string SignPayload<T>(T payload)
    {
        var json = JsonSerializer.Serialize(payload);
        var bytes = Encoding.UTF8.GetBytes(json);
        using var hmac = new HMACSHA256(TokenSigningKey);
        var signature = hmac.ComputeHash(bytes);

        var combined = new byte[bytes.Length + signature.Length];
        Buffer.BlockCopy(bytes, 0, combined, 0, bytes.Length);
        Buffer.BlockCopy(signature, 0, combined, bytes.Length, signature.Length);

        return Convert.ToBase64String(combined);
    }

    private static T? ValidateToken<T>(string token) where T : class
    {
        try
        {
            var combined = Convert.FromBase64String(token);
            if (combined.Length < 32) return null;

            var payloadLength = combined.Length - 32;
            var payloadBytes = new byte[payloadLength];
            var providedSignature = new byte[32];

            Buffer.BlockCopy(combined, 0, payloadBytes, 0, payloadLength);
            Buffer.BlockCopy(combined, payloadLength, providedSignature, 0, 32);

            using var hmac = new HMACSHA256(TokenSigningKey);
            var computedSignature = hmac.ComputeHash(payloadBytes);

            if (!CryptographicOperations.FixedTimeEquals(providedSignature, computedSignature))
            {
                return null;
            }

            var json = Encoding.UTF8.GetString(payloadBytes);
            return JsonSerializer.Deserialize<T>(json);
        }
        catch
        {
            return null;
        }
    }

    private sealed record HigherLowerTokenPayload(
        string Metric,
        string PlayerA,
        double ValueA,
        string PlayerB,
        double ValueB,
        long Timestamp,
        string? ServerGuid = null,
        string? MapName = null
    );

    private sealed record PlayerMapSnapshot(
        string MapName,
        int TotalKills,
        int TotalDeaths,
        int TotalScore,
        double PlayTimeHours,
        int TotalRounds,
        double KdRatio,
        double KillRatePerMinute);

    private sealed record ArcadeRoster(
        IReadOnlyList<ArcadeCandidate> Candidates,
        IReadOnlyDictionary<string, IReadOnlyList<PlayerMapSnapshot>> MapsByPlayer);

    private sealed record HigherLowerMatchup(
        ArcadeCandidate PlayerA,
        ArcadeCandidate PlayerB,
        string Metric,
        double ValueA,
        double ValueB,
        string? MapName);

    private sealed record MysteryTokenPayload(
        string TargetPlayerName,
        string Mode,
        string Seed,
        string? ServerGuid = null
    );

    private sealed record TriviaAnswerPayload(
        string Id,
        string Question,
        string CorrectAnswer,
        string Explanation,
        string? TargetPlayerName = null,
        string? TargetRoundId = null,
        string? TargetMapName = null,
        string? TargetServerName = null
    );

    private sealed record TriviaQuizTokenPayload(
        List<TriviaAnswerPayload> Questions
    );
}
