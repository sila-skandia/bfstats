using api.Arcade.Models;
using api.PlayerRelationships.Models;

namespace api.Arcade;

/// <summary>
/// Builds Field Lore questions from a single PLAYED_WITH neighbor list.
/// All answers come from properties already returned by that lookup — no extra queries.
/// </summary>
internal static class ArcadeRelationshipTrivia
{
    public static List<TriviaQuestionInternal> FromCoPlayers(
        string orbitPlayer,
        IReadOnlyList<PlayerRelationship> coPlayers)
    {
        var ranked = coPlayers
            .Where(p => !string.IsNullOrWhiteSpace(p.Player2Name)
                        && !string.Equals(p.Player2Name, orbitPlayer, StringComparison.OrdinalIgnoreCase))
            .GroupBy(p => p.Player2Name, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.OrderByDescending(p => p.SessionCount).First())
            .ToList();

        if (ranked.Count < 4)
        {
            return [];
        }

        var questions = new List<TriviaQuestionInternal>();
        var slug = SanitizeId(orbitPlayer);

        var bySessions = ranked
            .OrderByDescending(p => p.SessionCount)
            .ThenBy(p => p.Player2Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var wingman = bySessions[0];
        if (wingman.SessionCount > bySessions[1].SessionCount)
        {
            var options = bySessions.Take(4).Select(p => p.Player2Name).ToList();
            questions.Add(new TriviaQuestionInternal(
                $"rel_wingman_{slug}",
                "Squad Orbit",
                $"Who has shared the most overlapping sessions with {orbitPlayer}?",
                options,
                wingman.Player2Name,
                $"{wingman.Player2Name} has overlapped with {orbitPlayer} in {wingman.SessionCount:N0} sessions — their most frequent recorded squadmate.",
                TargetPlayerName: wingman.Player2Name,
                Highlights: [orbitPlayer]
            ));
        }

        var byFirst = ranked
            .Where(p => p.FirstPlayedTogether != default)
            .OrderBy(p => p.FirstPlayedTogether)
            .ThenBy(p => p.Player2Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (byFirst.Count >= 4 && byFirst[0].FirstPlayedTogether < byFirst[1].FirstPlayedTogether)
        {
            var oldest = byFirst[0];
            var options = byFirst.Take(4).Select(p => p.Player2Name).ToList();
            questions.Add(new TriviaQuestionInternal(
                $"rel_longest_{slug}",
                "Longest Alliance",
                $"Who has the longest recorded co-play history with {orbitPlayer}?",
                options,
                oldest.Player2Name,
                $"{oldest.Player2Name} first overlapped with {orbitPlayer} on {oldest.FirstPlayedTogether:yyyy-MM-dd}, earlier than any other soldier in this orbit.",
                TargetPlayerName: oldest.Player2Name,
                Highlights: [orbitPlayer]
            ));
        }

        var byLast = ranked
            .Where(p => p.LastPlayedTogether != default)
            .OrderByDescending(p => p.LastPlayedTogether)
            .ThenBy(p => p.Player2Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (byLast.Count >= 4 && byLast[0].LastPlayedTogether > byLast[1].LastPlayedTogether)
        {
            var newest = byLast[0];
            var options = byLast.Take(4).Select(p => p.Player2Name).ToList();
            questions.Add(new TriviaQuestionInternal(
                $"rel_recent_{slug}",
                "Recent Encounter",
                $"Who most recently shared a round with {orbitPlayer}?",
                options,
                newest.Player2Name,
                $"{newest.Player2Name} last overlapped with {orbitPlayer} on {newest.LastPlayedTogether:yyyy-MM-dd}.",
                TargetPlayerName: newest.Player2Name,
                Highlights: [orbitPlayer]
            ));
        }

        return questions;
    }

    private static string SanitizeId(string value)
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
}
