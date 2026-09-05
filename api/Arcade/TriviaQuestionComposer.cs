using System.Security.Cryptography;
using api.Arcade.Models;

namespace api.Arcade;

internal sealed record PlayerMapFact(
    string PlayerName,
    string MapName,
    int TotalKills,
    int TotalDeaths,
    int TotalScore,
    double TotalPlayTimeMinutes,
    int TotalRounds)
{
    public double KdRatio => TotalDeaths > 0 ? (double)TotalKills / TotalDeaths : TotalKills;
    public double KillRate => TotalPlayTimeMinutes > 0 ? TotalKills / TotalPlayTimeMinutes : 0;
}

/// <summary>
/// Instantiates trivia from player-map facts and metric templates.
/// Combinations are generated at request time; nothing is stored as canned questions.
/// </summary>
internal static class TriviaQuestionComposer
{
    private sealed record TriviaStatTemplate(
        string IdSlug,
        string MapPlayerCategory,
        string PlayerMapCategory,
        string MapPlayerQuestion,
        string PlayerMapQuestion,
        Func<PlayerMapFact, double> Value,
        Func<PlayerMapFact, bool> HasSample,
        Func<PlayerMapFact, string> MapPlayerExplanation,
        Func<PlayerMapFact, string> PlayerMapExplanation,
        double TieEpsilon);

    private static readonly TriviaStatTemplate[] Templates =
    [
        new(
            "kills",
            "Map Dominance",
            "Soldier Theaters",
            "On {0}, which combatant has recorded the most kills?",
            "On which map has {0} recorded the most kills?",
            f => f.TotalKills,
            f => f.TotalKills >= 20,
            f => $"{f.PlayerName} leads {f.MapName} with {f.TotalKills:N0} confirmed kills.",
            f => $"{f.PlayerName} has {f.TotalKills:N0} kills on {f.MapName}, more than on any other recorded map.",
            0),
        new(
            "killrate",
            "Map Lethality",
            "Soldier Lethality",
            "On {0}, which combatant has the highest kill rate (kills per minute)?",
            "On which map does {0} have the highest kill rate (kills per minute)?",
            f => f.KillRate,
            f => f.TotalKills >= 20 && f.TotalPlayTimeMinutes >= 30,
            f => $"{f.PlayerName} leads {f.MapName} at {f.KillRate:F2} kills/min.",
            f => $"{f.PlayerName} peaks at {f.KillRate:F2} kills/min on {f.MapName}.",
            0.01),
        new(
            "kd",
            "Map Sharpshooter",
            "Soldier Sharpshooter",
            "On {0}, which combatant has the highest Kill/Death ratio?",
            "On which map does {0} have the highest Kill/Death ratio?",
            f => f.KdRatio,
            f => f.TotalKills >= 20 && f.TotalDeaths >= 5,
            f => $"{f.PlayerName} leads {f.MapName} with a {f.KdRatio:F2} K/D ratio.",
            f => $"{f.PlayerName} records a {f.KdRatio:F2} K/D on {f.MapName}, their strongest theater.",
            0.01),
        new(
            "score",
            "Map Scoreboard",
            "Soldier Scoreboard",
            "On {0}, which combatant holds the highest recorded total score?",
            "On which map has {0} scored the most points?",
            f => f.TotalScore,
            f => f.TotalScore >= 20,
            f => $"{f.PlayerName} leads {f.MapName} with {f.TotalScore:N0} total score.",
            f => $"{f.PlayerName} has {f.TotalScore:N0} score on {f.MapName}, their highest-scoring theater.",
            0),
        new(
            "playtime",
            "Map Endurance",
            "Soldier Endurance",
            "On {0}, which veteran has logged the most combat hours?",
            "On which map has {0} logged the most combat hours?",
            f => f.TotalPlayTimeMinutes,
            f => f.TotalPlayTimeMinutes >= 30,
            f => $"{f.PlayerName} has {f.TotalPlayTimeMinutes / 60.0:N0} hours recorded on {f.MapName}.",
            f => $"{f.PlayerName} has {f.TotalPlayTimeMinutes / 60.0:N0} hours on {f.MapName}, more than on any other map.",
            0.01),
        new(
            "rounds",
            "Map Deployments",
            "Soldier Deployments",
            "On {0}, which soldier has deployed into the most recorded rounds?",
            "On which map has {0} deployed into the most recorded rounds?",
            f => f.TotalRounds,
            f => f.TotalRounds >= 3,
            f => $"{f.PlayerName} has fought in {f.TotalRounds:N0} rounds on {f.MapName}.",
            f => $"{f.PlayerName} has {f.TotalRounds:N0} rounds on {f.MapName}, their most-played theater.",
            0)
    ];

    public static IReadOnlyList<TriviaQuestionInternal> Compose(
        IReadOnlyList<PlayerMapFact> facts,
        IReadOnlyList<string> distractorMaps)
    {
        if (facts.Count == 0)
        {
            return [];
        }

        var pool = new List<TriviaQuestionInternal>();
        var maps = facts.Select(f => f.MapName).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var optionMaps = maps
            .Concat(distractorMaps)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var template in Templates)
        {
            AddMapBestPlayerQuestions(pool, facts, template);
            AddPlayerBestMapQuestions(pool, facts, optionMaps, template);
        }

        return pool;
    }

    private static void AddMapBestPlayerQuestions(
        List<TriviaQuestionInternal> pool,
        IReadOnlyList<PlayerMapFact> facts,
        TriviaStatTemplate template)
    {
        foreach (var mapGroup in facts.GroupBy(f => f.MapName, StringComparer.OrdinalIgnoreCase))
        {
            var ranked = mapGroup
                .Where(template.HasSample)
                .GroupBy(f => f.PlayerName, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.MaxBy(template.Value)!)
                .OrderByDescending(template.Value)
                .ToList();

            if (ranked.Count < 4)
            {
                continue;
            }

            if (!IsUniqueLeader(template.Value(ranked[0]), template.Value(ranked[1]), template.TieEpsilon))
            {
                continue;
            }

            var options = ranked.Take(4).Select(f => f.PlayerName).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            if (options.Count < 4)
            {
                continue;
            }

            var winner = ranked[0];
            var mapSlug = SanitizeTriviaId(winner.MapName);
            Shuffle(options);

            pool.Add(new TriviaQuestionInternal(
                $"map_player_{template.IdSlug}_{mapSlug}",
                template.MapPlayerCategory,
                string.Format(template.MapPlayerQuestion, winner.MapName),
                options,
                winner.PlayerName,
                template.MapPlayerExplanation(winner),
                TargetPlayerName: winner.PlayerName,
                TargetMapName: winner.MapName
            ));
        }
    }

    private static void AddPlayerBestMapQuestions(
        List<TriviaQuestionInternal> pool,
        IReadOnlyList<PlayerMapFact> facts,
        IReadOnlyList<string> optionMaps,
        TriviaStatTemplate template)
    {
        foreach (var playerGroup in facts.GroupBy(f => f.PlayerName, StringComparer.OrdinalIgnoreCase))
        {
            var ranked = playerGroup
                .Where(template.HasSample)
                .GroupBy(f => f.MapName, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.MaxBy(template.Value)!)
                .OrderByDescending(template.Value)
                .ToList();

            if (ranked.Count == 0 || !template.HasSample(ranked[0]))
            {
                continue;
            }

            if (ranked.Count >= 2 &&
                !IsUniqueLeader(template.Value(ranked[0]), template.Value(ranked[1]), template.TieEpsilon))
            {
                continue;
            }

            var winner = ranked[0];
            var options = new List<string> { winner.MapName };
            foreach (var map in ranked.Skip(1).Select(f => f.MapName))
            {
                if (options.Count >= 4) break;
                if (!options.Contains(map, StringComparer.OrdinalIgnoreCase))
                {
                    options.Add(map);
                }
            }

            foreach (var map in optionMaps)
            {
                if (options.Count >= 4) break;
                if (!options.Contains(map, StringComparer.OrdinalIgnoreCase))
                {
                    options.Add(map);
                }
            }

            if (options.Count < 4)
            {
                continue;
            }

            var playerSlug = SanitizeTriviaId(winner.PlayerName);
            Shuffle(options);

            pool.Add(new TriviaQuestionInternal(
                $"player_map_{template.IdSlug}_{playerSlug}",
                template.PlayerMapCategory,
                string.Format(template.PlayerMapQuestion, winner.PlayerName),
                options.Take(4).ToList(),
                winner.MapName,
                template.PlayerMapExplanation(winner),
                TargetPlayerName: winner.PlayerName,
                TargetMapName: winner.MapName
            ));
        }
    }

    private static bool IsUniqueLeader(double first, double second, double epsilon) =>
        first > second + epsilon;

    internal static string SanitizeTriviaId(string value)
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

    private static void Shuffle<T>(IList<T> list)
    {
        for (var i = list.Count - 1; i > 0; i--)
        {
            var j = RandomNumberGenerator.GetInt32(i + 1);
            (list[i], list[j]) = (list[j], list[i]);
        }
    }
}
