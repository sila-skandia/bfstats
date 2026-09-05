using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using api.Arcade.Models;
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
    private static readonly string[] AvailableMetrics = ["kills", "score", "playtime", "kd"];

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

    public async Task<HigherLowerQuestionDto> GetNextHigherLowerQuestionAsync(
        string? serverGuid = null,
        string? currentCandidateName = null,
        CancellationToken cancellationToken = default)
    {
        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);
        if (candidates.Count < 2)
        {
            candidates = DefaultCandidates;
        }

        var metric = AvailableMetrics[RandomNumberGenerator.GetInt32(AvailableMetrics.Length)];
        string? serverName = null;
        if (!string.IsNullOrWhiteSpace(serverGuid))
        {
            var serverObj = await dbContext.Servers.AsNoTracking().FirstOrDefaultAsync(s => s.Guid == serverGuid, cancellationToken);
            serverName = serverObj?.Name;
        }

        var metricLabel = GetMetricLabel(metric, serverName);

        ArcadeCandidate candidateA;
        if (!string.IsNullOrWhiteSpace(currentCandidateName))
        {
            var match = candidates.FirstOrDefault(c =>
                string.Equals(c.PlayerName, currentCandidateName, StringComparison.OrdinalIgnoreCase));
            candidateA = match ?? candidates[RandomNumberGenerator.GetInt32(candidates.Count)];
        }
        else
        {
            candidateA = candidates[RandomNumberGenerator.GetInt32(candidates.Count)];
        }

        ArcadeCandidate candidateB;
        var availableForB = candidates.Where(c => !string.Equals(c.PlayerName, candidateA.PlayerName, StringComparison.OrdinalIgnoreCase)).ToList();
        if (availableForB.Count > 0)
        {
            candidateB = availableForB[RandomNumberGenerator.GetInt32(availableForB.Count)];
        }
        else
        {
            candidateB = DefaultCandidates.First(c => !string.Equals(c.PlayerName, candidateA.PlayerName, StringComparison.OrdinalIgnoreCase));
        }

        var valA = GetCandidateMetricValue(candidateA, metric);
        var valB = GetCandidateMetricValue(candidateB, metric);

        var tokenPayload = new HigherLowerTokenPayload(
            metric,
            candidateA.PlayerName,
            valA,
            candidateB.PlayerName,
            valB,
            DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            serverGuid
        );
        var roundToken = SignPayload(tokenPayload);

        var playerADto = new CombatantDto(
            candidateA.PlayerName,
            candidateA.Country,
            candidateA.FavoriteMap,
            valA,
            FormatMetricValue(metric, valA)
        );

        var playerBDto = new CombatantDto(
            candidateB.PlayerName,
            candidateB.Country,
            candidateB.FavoriteMap
        );

        return new HigherLowerQuestionDto(metric, metricLabel, playerADto, playerBDto, roundToken);
    }

    public async Task<HigherLowerRevealResultDto> RevealHigherLowerAsync(
        HigherLowerRevealRequest request,
        CancellationToken cancellationToken = default)
    {
        var payload = ValidateToken<HigherLowerTokenPayload>(request.RoundToken);
        if (payload == null)
        {
            throw new ArgumentException("Invalid or expired round token.");
        }

        var guess = request.Guess.Trim().ToLowerInvariant();
        bool isCorrect;

        if (Math.Abs(payload.ValueB - payload.ValueA) < 0.0001)
        {
            isCorrect = true;
        }
        else if (guess == "higher")
        {
            isCorrect = payload.ValueB >= payload.ValueA;
        }
        else if (guess == "lower")
        {
            isCorrect = payload.ValueB <= payload.ValueA;
        }
        else
        {
            throw new ArgumentException("Guess must be 'higher' or 'lower'.");
        }

        var formattedValB = FormatMetricValue(payload.Metric, payload.ValueB);
        var metricLabel = GetMetricLabel(payload.Metric, null);

        string message;
        if (isCorrect)
        {
            message = $"Correct! {payload.PlayerB} has {formattedValB} {metricLabel.ToLowerInvariant()}.";
        }
        else
        {
            message = $"Not quite! {payload.PlayerB} has {formattedValB} {metricLabel.ToLowerInvariant()}.";
        }

        var nextQuestion = await GetNextHigherLowerQuestionAsync(payload.ServerGuid, payload.PlayerB, cancellationToken);

        return new HigherLowerRevealResultDto(
            isCorrect,
            payload.ValueA,
            payload.ValueB,
            formattedValB,
            message,
            nextQuestion
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

        var serverName = server.Name;
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
                Team1Wins = g.Sum(x => x.Team1Victories),
                Team2Wins = g.Sum(x => x.Team2Victories),
                Team1Label = g.Select(x => x.Team1Label).FirstOrDefault(x => !string.IsNullOrEmpty(x)),
                Team2Label = g.Select(x => x.Team2Label).FirstOrDefault(x => !string.IsNullOrEmpty(x))
            })
            .OrderByDescending(x => x.TotalRounds)
            .Take(8)
            .ToListAsync(cancellationToken);

        var candidates = await GetArcadeCandidatesAsync(serverGuid, cancellationToken);
        if (candidates.Count < 4 || topMaps.Count < 4)
        {
            return null;
        }

        var bestScores = await dbContext.PlayerBestScores
            .AsNoTracking()
            .Where(pbs => pbs.ServerGuid == serverGuid && pbs.Period == "all_time")
            .OrderByDescending(pbs => pbs.FinalScore)
            .Take(5)
            .ToListAsync(cancellationToken);

        var questions = new List<TriviaQuestionInternal>();
        var composed = new List<TriviaQuestionInternal>();
        await AddCombinatorialMapTriviaQuestionsAsync(composed, serverGuid, cancellationToken);

        // Q1: Most contested map on this server
        var mostPlayed = topMaps[0];
        var otherMaps = topMaps.Skip(1).Take(3).Select(m => m.MapName).ToList();
        var mapOptions = new List<string> { mostPlayed.MapName };
        mapOptions.AddRange(otherMaps);
        Shuffle(mapOptions);

        questions.Add(new TriviaQuestionInternal(
            "srv_most_played_map",
            $"{serverName} History",
            $"What is the most contested map in {serverName}'s recorded history?",
            mapOptions,
            mostPlayed.MapName,
            $"{mostPlayed.MapName} leads with over {mostPlayed.TotalRounds:N0} total rounds played on {serverName}!"
        ));

        // Q2: Highest scoring round or top career score
        if (bestScores.Count > 0)
        {
            var topRound = bestScores[0];
            var scoreOptions = bestScores.Skip(1).Take(3).Select(s => s.PlayerName).ToList();
            while (scoreOptions.Count < 3)
            {
                var extra = candidates.First(c => c.PlayerName != topRound.PlayerName && !scoreOptions.Contains(c.PlayerName));
                scoreOptions.Add(extra.PlayerName);
            }
            scoreOptions.Add(topRound.PlayerName);
            Shuffle(scoreOptions);

            questions.Add(new TriviaQuestionInternal(
                "srv_best_round_score",
                "Server Legend",
                $"Who holds the record for highest single-round score ever achieved on {serverName}?",
                scoreOptions,
                topRound.PlayerName,
                $"{topRound.PlayerName} scored an unbelievable {topRound.FinalScore:N0} points on {topRound.MapName}!"
            ));
        }
        else
        {
            var topScore = candidates.OrderByDescending(c => c.TotalScore).First();
            var scoreOptions = candidates
                .Where(c => c.PlayerName != topScore.PlayerName)
                .Take(3)
                .Select(c => c.PlayerName)
                .Concat([topScore.PlayerName])
                .ToList();
            Shuffle(scoreOptions);

            questions.Add(new TriviaQuestionInternal(
                "srv_top_career_score",
                "Server Veteran",
                $"Which regular combatant holds the all-time career scoring crown on {serverName}?",
                scoreOptions,
                topScore.PlayerName,
                $"{topScore.PlayerName} reigns supreme with {topScore.TotalScore:N0} total points on {serverName}!"
            ));
        }

        // Q3: Map-scoped player comparison (kills / K/D / kill rate) from combinatorial templates
        var mapCompare = composed
            .Where(q => q.Id.StartsWith("map_player_", StringComparison.Ordinal))
            .ToList();
        if (mapCompare.Count > 0)
        {
            questions.Add(mapCompare[RandomNumberGenerator.GetInt32(mapCompare.Count)]);
        }
        else
        {
            var mapForKills = topMaps[RandomNumberGenerator.GetInt32(Math.Min(4, topMaps.Count))];
            var mapKillLeaders = await dbContext.PlayerMapStats
                .AsNoTracking()
                .Where(m => m.ServerGuid == serverGuid && m.MapName == mapForKills.MapName)
                .GroupBy(m => m.PlayerName)
                .Select(g => new { PlayerName = g.Key, TotalKills = g.Sum(x => x.TotalKills) })
                .OrderByDescending(x => x.TotalKills)
                .Take(4)
                .ToListAsync(cancellationToken);

            if (mapKillLeaders.Count >= 4)
            {
                var topMapKiller = mapKillLeaders[0];
                var killOptions = mapKillLeaders.Select(x => x.PlayerName).ToList();
                Shuffle(killOptions);
                questions.Add(new TriviaQuestionInternal(
                    "srv_map_top_kills",
                    "Map Dominance",
                    $"On {mapForKills.MapName} on {serverName}, which combatant has recorded the most kills?",
                    killOptions,
                    topMapKiller.PlayerName,
                    $"{topMapKiller.PlayerName} leads {mapForKills.MapName} on {serverName} with {topMapKiller.TotalKills:N0} kills!"
                ));
            }
            else
            {
                var topKiller = candidates.OrderByDescending(c => c.TotalKills).First();
                var killOptions = candidates
                    .Where(c => c.PlayerName != topKiller.PlayerName)
                    .Take(3)
                    .Select(c => c.PlayerName)
                    .Concat([topKiller.PlayerName])
                    .ToList();
                Shuffle(killOptions);

                questions.Add(new TriviaQuestionInternal(
                    "srv_top_kills",
                    "Server Dominance",
                    $"Which soldier has logged the most career kills on {serverName}?",
                    killOptions,
                    topKiller.PlayerName,
                    $"{topKiller.PlayerName} leads the server killboard with {topKiller.TotalKills:N0} confirmed frags!"
                ));
            }
        }

        // Q4: Longest average round duration
        var longestMap = topMaps.OrderByDescending(m => m.AvgDurationMinutes).First();
        var durOptions = topMaps.Where(m => m.MapName != longestMap.MapName).Take(3).Select(m => m.MapName).ToList();
        durOptions.Add(longestMap.MapName);
        Shuffle(durOptions);

        questions.Add(new TriviaQuestionInternal(
            "srv_longest_map",
            "Theater Endurance",
            $"Which map typically features the longest average round duration on {serverName}?",
            durOptions,
            longestMap.MapName,
            $"Rounds on {longestMap.MapName} average {longestMap.AvgDurationMinutes:F1} minutes of combat on this server."
        ));

        // Q5: Player's strongest map, faction balance, or lethal KD
        var playerMapQuestions = composed
            .Where(q => q.Id.StartsWith("player_map_", StringComparison.Ordinal))
            .ToList();
        if (playerMapQuestions.Count > 0)
        {
            questions.Add(playerMapQuestions[RandomNumberGenerator.GetInt32(playerMapQuestions.Count)]);
        }
        else
        {
            var balancedMap = topMaps.FirstOrDefault(m =>
            m.Team1Wins > 0 && m.Team2Wins > 0 &&
            !string.IsNullOrEmpty(m.Team1Label) && !string.IsNullOrEmpty(m.Team2Label) &&
            m.Team1Wins != m.Team2Wins);

        if (balancedMap != null)
        {
            var t1Wins = balancedMap.Team1Wins;
            var t2Wins = balancedMap.Team2Wins;
            var winner = t1Wins > t2Wins ? balancedMap.Team1Label! : balancedMap.Team2Label!;
            var loser = t1Wins > t2Wins ? balancedMap.Team2Label! : balancedMap.Team1Label!;
            var winCount = Math.Max(t1Wins, t2Wins);
            var loseCount = Math.Min(t1Wins, t2Wins);

            var otherFactionLabels = topMaps
                .SelectMany(m => new[] { m.Team1Label, m.Team2Label })
                .Where(l => !string.IsNullOrEmpty(l) && l != winner && l != loser)
                .Cast<string>()
                .Distinct()
                .ToList();

            if (otherFactionLabels.Count < 2)
            {
                var globalLabels = await dbContext.ServerMapStats
                    .AsNoTracking()
                    .Select(s => new { s.Team1Label, s.Team2Label })
                    .ToListAsync(cancellationToken);

                otherFactionLabels = globalLabels
                    .SelectMany(m => new[] { m.Team1Label, m.Team2Label })
                    .Where(l => !string.IsNullOrEmpty(l) && l != winner && l != loser)
                    .Cast<string>()
                    .Distinct()
                    .ToList();
            }

            var teamOptions = new List<string> { winner, loser };
            teamOptions.AddRange(otherFactionLabels.Take(2));

            if (teamOptions.Count >= 4)
            {
                Shuffle(teamOptions);
                questions.Add(new TriviaQuestionInternal(
                    "srv_team_balance",
                    "Tactical Superiority",
                    $"On {balancedMap.MapName} on {serverName}, which faction holds the higher all-time victory count?",
                    teamOptions.Take(4).ToList(),
                    winner,
                    $"{winner} has dominated {balancedMap.MapName} with {winCount:N0} wins versus {loser}'s {loseCount:N0} wins!"
                ));
            }
            else
            {
                TryAddPlayerMetricQuestion(
                    questions,
                    candidates,
                    "srv_top_kd",
                    "Sharpshooter Intel",
                    $"Which veteran boasts the most lethal career Kill/Death ratio on {serverName}?",
                    c => c.KdRatio,
                    c => $"{c.PlayerName} boasts a lethal {c.KdRatio:F2} K/D ratio on {serverName}!");
            }
        }
        else
        {
            TryAddPlayerMetricQuestion(
                questions,
                candidates,
                "srv_top_kd",
                "Sharpshooter Intel",
                $"Which veteran boasts the most lethal career Kill/Death ratio on {serverName}?",
                c => c.KdRatio,
                c => $"{c.PlayerName} boasts a lethal {c.KdRatio:F2} K/D ratio on {serverName}!");
        }
        }

        if (questions.Count < 5)
        {
            TryAddPlayerMetricQuestion(
                questions,
                candidates,
                "srv_top_playtime",
                "Server Endurance",
                $"Which regular has logged the most playtime on {serverName}?",
                c => c.PlayTimeHours,
                c => $"{c.PlayerName} has {c.PlayTimeHours:N0} hours recorded on {serverName}!");
        }

        var quizTokenPayload = new TriviaQuizTokenPayload(
            questions.Select(q => new TriviaAnswerPayload(
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

        var dtoList = questions.Select(q => new TriviaQuestionDto(
            q.Id,
            q.Category,
            q.Question,
            q.Options,
            null,
            null,
            q.TargetMapName,
            q.TargetServerName
        )).ToList();

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
                null,
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
        var candidates = await LoadGlobalCandidatesFromDbAsync(cancellationToken);

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

    private static List<TriviaQuestionInternal> SelectDiverseTriviaQuestions(
        IReadOnlyList<TriviaQuestionInternal> pool,
        int count)
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

        if (hasScoped)
        {
            var scopedCandidate = candidatePool.FirstOrDefault(q => IsScopedTriviaQuestion(q.Id));
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
        || id.StartsWith("map_best_", StringComparison.Ordinal);

    private async Task AddCombinatorialMapTriviaQuestionsAsync(
        List<TriviaQuestionInternal> pool,
        string? serverGuid,
        CancellationToken cancellationToken)
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

        pool.AddRange(TriviaQuestionComposer.Compose(facts, distractorMaps));
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
    {
        var cacheKey = $"Arcade:Candidates:{serverGuid ?? "global"}";
        if (memoryCache.TryGetValue(cacheKey, out IReadOnlyList<ArcadeCandidate>? cached) && cached != null && cached.Count > 0)
        {
            return cached;
        }

        try
        {
            var candidates = !string.IsNullOrWhiteSpace(serverGuid)
                ? await LoadCandidatesForServerAsync(serverGuid, cancellationToken)
                : await LoadGlobalCandidatesFromDbAsync(cancellationToken);

            if (candidates.Count == 0)
            {
                candidates = DefaultCandidates;
            }

            memoryCache.Set(cacheKey, candidates, CacheDuration);
            return candidates;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to load arcade candidates for server {ServerGuid}. Using default fallback roster.", serverGuid);
            return DefaultCandidates;
        }
    }

    private async Task<IReadOnlyList<ArcadeCandidate>> LoadCandidatesForServerAsync(string serverGuid, CancellationToken cancellationToken)
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
            return [];
        }

        var playerNames = serverPlayers.Select(p => p.PlayerName).ToList();

        var playerMaps = await dbContext.PlayerMapStats
            .AsNoTracking()
            .Where(m => m.ServerGuid == serverGuid && playerNames.Contains(m.PlayerName))
            .GroupBy(m => new { m.PlayerName, m.MapName })
            .Select(g => new
            {
                g.Key.PlayerName,
                g.Key.MapName,
                TotalRounds = g.Sum(x => x.TotalRounds)
            })
            .ToListAsync(cancellationToken);

        var topMapByPlayer = playerMaps
            .GroupBy(m => m.PlayerName)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => x.TotalRounds).First().MapName
            );

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

        return result;
    }

    private async Task<IReadOnlyList<ArcadeCandidate>> LoadGlobalCandidatesFromDbAsync(CancellationToken cancellationToken)
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
            return [];
        }

        var playerNames = monthlyPlayers.Select(p => p.PlayerName).ToList();

        var playerMaps = await dbContext.PlayerMapStats
            .AsNoTracking()
            .Where(m => playerNames.Contains(m.PlayerName))
            .GroupBy(m => new { m.PlayerName, m.MapName })
            .Select(g => new
            {
                g.Key.PlayerName,
                g.Key.MapName,
                TotalRounds = g.Sum(x => x.TotalRounds)
            })
            .ToListAsync(cancellationToken);

        var topMapByPlayer = playerMaps
            .GroupBy(m => m.PlayerName)
            .ToDictionary(
                g => g.Key,
                g => g.OrderByDescending(x => x.TotalRounds).First().MapName
            );

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

        return result;
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

    private static double GetCandidateMetricValue(ArcadeCandidate candidate, string metric) => metric switch
    {
        "kills" => candidate.TotalKills,
        "score" => candidate.TotalScore,
        "playtime" => candidate.PlayTimeHours,
        "kd" => candidate.KdRatio,
        _ => candidate.TotalScore
    };

    private static string GetMetricLabel(string metric, string? serverName)
    {
        var suffix = !string.IsNullOrWhiteSpace(serverName) ? $" on {serverName}" : "";
        return metric switch
        {
            "kills" => $"Total Kills{suffix}",
            "score" => $"Total Score{suffix}",
            "playtime" => $"Service Hours{suffix}",
            "kd" => $"K/D Ratio{suffix}",
            _ => $"Score{suffix}"
        };
    }

    private static string FormatMetricValue(string metric, double value) => metric switch
    {
        "kills" or "score" => $"{value:N0}",
        "playtime" => $"{value:N0} hrs",
        "kd" => $"{value:F2}",
        _ => $"{value:N0}"
    };

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
        string? ServerGuid = null
    );

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
