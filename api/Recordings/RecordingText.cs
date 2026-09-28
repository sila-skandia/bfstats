using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace api.Recordings;

/// <summary>
/// The feed's user-written text: titles and comments are plain text, drawn by the page as
/// text, so they are only tidied here — control characters and bidi overrides out,
/// whitespace collapsed — never sanitised as HTML. A time in a comment (<c>0:21</c>,
/// <c>1:02:03</c>) is a place in the recording, as a time in a YouTube comment is a place
/// in the video; <c>replay-social.js</c> reads them with the same pattern.
/// </summary>
public static partial class RecordingText
{
    public const int MaxTitle = 100;
    public const int MaxComment = 1000;

    /// <summary><c>h:mm:ss</c>, or <c>m:ss</c> with up to three digits of minutes, standing
    /// alone: not part of a longer run of digits and colons.</summary>
    [GeneratedRegex(@"(?<![\d:])(?:(\d{1,2}):([0-5]\d):([0-5]\d)|(\d{1,3}):([0-5]\d))(?![\d:])", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex TimeStamp();

    [GeneratedRegex(@"\n{3,}", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex BlankLines();

    [GeneratedRegex("^[a-z0-9_-]{1,64}$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex Identifier();

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$", RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 100)]
    private static partial Regex LocalStamp();

    /// <summary>One line: newlines become spaces, runs of spaces one.</summary>
    public static string Line(string? text, int max)
    {
        var clean = Clean(Bounded(text, max), multiline: false);
        clean = string.Join(' ', clean.Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return Cut(clean, max);
    }

    /// <summary>
    /// A player's name as a recording or its uploader has it: control characters and bidi
    /// overrides out, trimmed, cut to <paramref name="max"/>, and otherwise as it came. The
    /// recorder writes a name's high bytes as U+0080 to U+00FF, and U+0080 to U+009F (cp1252's
    /// <c>€</c>, <c>™</c>, <c>•</c> in a clan tag) are control characters by Unicode's reckoning,
    /// so they stay; so do runs of spaces, which are part of some names.
    /// </summary>
    public static string Name(string? text, int max)
    {
        var bounded = Bounded(text, max);
        if (bounded.Length == 0) return "";
        var builder = new StringBuilder(bounded.Length);
        foreach (var c in bounded)
        {
            if ((char.IsControl(c) && (c is < '\u0080' or > '\u009F')) || IsBidiControl(c)) continue;
            builder.Append(c);
        }
        return Cut(builder.ToString().Trim(), max);
    }

    /// <summary>A comment: newlines kept, at most one blank line in a row.</summary>
    public static string Comment(string? text)
    {
        var clean = BlankLines().Replace(Clean(text, multiline: true), "\n\n").Trim();
        return clean;
    }

    /// <summary>A level, mod or game type as the viewer names it, lower case; '' if it is not one.</summary>
    public static string Id(string? value)
    {
        var id = (value ?? "").Trim().ToLowerInvariant();
        return Identifier().IsMatch(id) ? id : "";
    }

    /// <summary>A recorder header's local start (<c>2026-09-27T20:34:59</c>); '' if it is not one.</summary>
    public static string Stamp(string? value)
    {
        var stamp = (value ?? "").Trim();
        return LocalStamp().IsMatch(stamp) ? stamp : "";
    }

    /// <summary>The first time a comment names that falls inside the recording, in seconds.</summary>
    public static double? FirstTime(string text, double durationSeconds)
    {
        foreach (Match match in TimeStamp().Matches(text))
        {
            var groups = match.Groups;
            var at = groups[1].Success
                ? (Number(groups[1]) * 3600) + (Number(groups[2]) * 60) + Number(groups[3])
                : (Number(groups[4]) * 60) + Number(groups[5]);
            if (at <= durationSeconds + 1) return at;
        }
        return null;
    }

    private static int Number(Group group) => int.Parse(group.Value, CultureInfo.InvariantCulture);

    /// <summary>A level's folder in words: <c>el_alamein</c> is <c>El Alamein</c>.</summary>
    public static string Titled(string level) =>
        CultureInfo.InvariantCulture.TextInfo.ToTitleCase(level.Replace('_', ' ').ToLowerInvariant());

    private static string Clean(string? text, bool multiline)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var builder = new StringBuilder(text.Length);
        foreach (var c in text)
        {
            if (c == '\r') continue;
            if (c is '\n' or '\t')
            {
                builder.Append(multiline && c == '\n' ? '\n' : ' ');
                continue;
            }
            if (char.IsControl(c) || IsBidiControl(c)) continue;
            builder.Append(c);
        }
        return builder.ToString().Trim();
    }

    /// <summary>The embeddings, overrides and isolates that let text run backwards over a
    /// name beside it.</summary>
    private static bool IsBidiControl(char c) => c is >= '\u202A' and <= '\u202E' or >= '\u2066' and <= '\u2069';

    /// <summary>The front of <paramref name="text"/>, room enough for <paramref name="max"/>
    /// characters once what is dropped from it is dropped: a file can name a server in 16 MB,
    /// and only its first few characters are ever kept.</summary>
    private static string Bounded(string? text, int max) =>
        text is null ? "" : text.Length > max * 8 ? text[..(max * 8)] : text;

    private static string Cut(string text, int max)
    {
        if (text.Length <= max) return text;
        // Not through the middle of a surrogate pair.
        var end = char.IsHighSurrogate(text[max - 1]) ? max - 1 : max;
        return text[..end].TrimEnd();
    }
}
