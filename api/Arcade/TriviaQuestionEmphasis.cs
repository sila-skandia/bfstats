using System.Text.RegularExpressions;
using api.Arcade.Models;

namespace api.Arcade;

/// <summary>
/// Collects the interpolated entities in a trivia prompt so the UI can
/// emphasize them. Answer values are omitted unless they actually appear
/// in the sentence (they normally do not).
/// </summary>
internal static class TriviaQuestionEmphasis
{
    private static readonly HashSet<string> Stopwords = new(StringComparer.OrdinalIgnoreCase)
    {
        "a", "an", "the", "on", "in", "of", "to", "for", "and", "or", "at", "by",
        "from", "with", "who", "which", "what", "when", "where", "how", "does",
        "has", "have", "is", "are", "was", "were", "map", "most", "more", "than"
    };

    private static readonly Regex PeriodPattern = new(
        @"\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b|(?<=\b(?:In|During) )\d{4}\b",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    public static IReadOnlyList<string> From(TriviaQuestionInternal question) =>
        Resolve(
            question.Question,
            question.TargetPlayerName,
            question.TargetMapName,
            question.TargetServerName,
            question.Highlights);

    public static IReadOnlyList<string> Resolve(
        string question,
        string? targetPlayerName,
        string? targetMapName,
        string? targetServerName,
        IEnumerable<string>? extras = null)
    {
        var terms = new List<string>();
        Add(terms, question, targetPlayerName);
        Add(terms, question, targetMapName);
        Add(terms, question, targetServerName);

        if (extras != null)
        {
            foreach (var extra in extras)
            {
                Add(terms, question, extra);
            }
        }

        foreach (Match match in PeriodPattern.Matches(question))
        {
            Add(terms, question, match.Value);
        }

        return terms
            .Distinct(StringComparer.Ordinal)
            .OrderByDescending(t => t.Length)
            .ToList();
    }

    private static void Add(List<string> terms, string question, string? term)
    {
        if (string.IsNullOrWhiteSpace(term))
        {
            return;
        }

        var value = term.Trim();
        if (value.Length < 2 || Stopwords.Contains(value))
        {
            return;
        }

        if (!question.Contains(value, StringComparison.Ordinal))
        {
            return;
        }

        terms.Add(value);
    }
}
