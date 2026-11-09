using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Unicode;
using api.Recordings.Models;
using api.Utils;

namespace api.Recordings;

/// <summary>
/// A recording's short link, <c>replay.bfstats.io/&lt;slug&gt;[?t=&lt;seconds&gt;]</c>
/// (features/replay-feed, "Short links"), and the first form of it,
/// <c>play.bfstats.io/replay/&lt;slug&gt;</c>. HAProxy sends both to the API's
/// <c>/replay/&lt;slug&gt;</c>. The answer is a page that sends the browser on to the replay on
/// the play host, the address the feed's Copy link used to hand out, and that tells whatever
/// unfurls the link (Discord, a messenger) the recording's title, round and cover: behind a
/// redirect it would see only map.html's own tags, the same for every recording.
/// </summary>
public static class RecordingShortLink
{
    /// <summary>Markup and quotes escaped; a title's other characters stay as written.</summary>
    private static readonly HtmlEncoder Encoder = HtmlEncoder.Create(UnicodeRanges.All);

    /// <summary>The replay's address on the play host, root-relative, as <c>watchHref</c> in
    /// recordings-api.js writes it: <c>/map.html?mod=…&amp;map=…&amp;replay=/stats/recordings/&lt;slug&gt;.ndjson…</c>.</summary>
    public static string WatchPath(RecordingDetailDto recording, int? at, string? edit = null)
    {
        (string Name, string? Value)[] pairs =
        [
            ("mod", recording.Mod),
            ("map", recording.Level),
            ("replay", recording.RecordingUrl),
            ("serverlog", recording.ServerLogUrl),
            ("t", at?.ToString(CultureInfo.InvariantCulture)),
            ("edit", edit),
        ];
        return "/map.html?" + string.Join('&', pairs
            .Where(p => !string.IsNullOrEmpty(p.Value))
            .Select(p => $"{p.Name}={Readable(p.Value!)}"));
    }

    /// <summary>The page for a recording: its preview tags, and a refresh to the replay on
    /// <paramref name="playOrigin"/> (a refresh replaces the history entry, so Back leaves the
    /// replay for where the link was). <paramref name="linkOrigin"/> is the short link's host.</summary>
    public static string Page(RecordingDetailDto recording, string playOrigin, string linkOrigin, int? at, RecordingEditDto? edit = null)
    {
        var watch = playOrigin + WatchPath(recording, at, edit?.Code);
        var self = edit is null ? $"{linkOrigin}/{recording.Slug}" : RecordingEditService.Link(linkOrigin, recording.Slug, edit.Code);
        // An edit's link names the edit and who cut it (features/replay-creator-view,
        // "Sharing an edit"), then the recording it is of.
        var title = edit is null ? recording.Title : EditTitle(edit);
        var description = edit is null ? Description(recording) : $"An edit of {recording.Title} · {Description(recording)}";
        var cover = recording.ThumbnailUrl
            ?? recording.Round?.Select(m => m.ThumbnailUrl).FirstOrDefault(url => url is not null);
        var html = new StringBuilder();
        html.Append("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
        html.Append("<meta name=\"color-scheme\" content=\"dark light\">\n");
        Tag(html, "title", $"{title} · BattleView | bfstats.io");
        Meta(html, "http-equiv", "refresh", $"0; url={watch}");
        Meta(html, "property", "og:site_name", "bfstats.io");
        Meta(html, "property", "og:type", "website");
        Meta(html, "property", "og:title", title);
        Meta(html, "property", "og:description", description);
        Meta(html, "property", "og:url", self);
        if (cover is not null) Meta(html, "property", "og:image", playOrigin + cover);
        Meta(html, "name", "twitter:card", cover is null ? "summary" : "summary_large_image");
        Meta(html, "name", "theme-color", "#a39c6c");
        html.Append($"<link rel=\"canonical\" href=\"{Encode(self)}\">\n");
        html.Append("</head>\n<body>\n");
        html.Append($"<p><a href=\"{Encode(watch)}\">{Encode(title)}</a></p>\n");
        html.Append("</body>\n</html>\n");
        return html.ToString();
    }

    /// <summary><c>Mustang bomb · skandia's edit</c>; an edit by an account with no linked
    /// name is just its name.</summary>
    internal static string EditTitle(RecordingEditDto edit)
    {
        var author = edit.AuthorName.Length > 0 ? Shown(edit.AuthorName) : "";
        return author.Length > 0 ? $"{edit.Name} · {author}'s edit" : edit.Name;
    }

    /// <summary>The page for a link to no recording: one deleted, one whose file has gone, a
    /// slug mistyped.</summary>
    public static string Missing(string playOrigin) =>
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n" +
        "<meta name=\"color-scheme\" content=\"dark light\">\n" +
        "<meta name=\"robots\" content=\"noindex\">\n" +
        "<title>Recording not found · BattleView | bfstats.io</title>\n" +
        "</head>\n<body>\n" +
        "<p>This recording is not shared any more.</p>\n" +
        $"<p><a href=\"{Encode(playOrigin)}/play/?tab=replay\">The replays</a></p>\n" +
        "</body>\n</html>\n";

    /// <summary>A link's <c>?t=</c>: whole seconds into the recording, or null for none.</summary>
    public static int? Moment(string? t) =>
        t is { Length: > 0 and <= 6 } && t.All(char.IsAsciiDigit) ? int.Parse(t, CultureInfo.InvariantCulture) : null;

    /// <summary><c>Midway · Conquest · 14:43 · MoonGamers.com · shared by skandia</c>.</summary>
    internal static string Description(RecordingDetailDto recording)
    {
        var uploader = Shown(recording.UploaderName);
        string?[] parts =
        [
            recording.Level.Length > 0 ? RecordingText.Titled(recording.Level) : null,
            recording.GameMode.Length > 0 ? RecordingText.Titled(recording.GameMode) : null,
            Clock(recording.DurationSeconds),
            Shown(recording.ServerName),
            uploader.Length > 0 ? $"shared by {uploader}" : null,
        ];
        return string.Join(" · ", parts.Where(p => !string.IsNullOrEmpty(p)));
    }

    /// <summary><c>m:ss</c>, or <c>h:mm:ss</c> from an hour, as the feed says a length.</summary>
    internal static string Clock(double seconds)
    {
        var s = (int)Math.Max(0, Math.Floor(seconds));
        return s >= 3600
            ? FormattableString.Invariant($"{s / 3600}:{s / 60 % 60:00}:{s % 60:00}")
            : FormattableString.Invariant($"{s / 60}:{s % 60:00}");
    }

    /// <summary>A recorded name for eyes (CLAUDE.md, "Server and player name rendering").</summary>
    internal static string Shown(string name) => PlayerNameDecoder.Decode(PlayerNameDecoder.FromRecording(name));

    /// <summary>A query value with its slashes and colons left readable, as readableQuery does.</summary>
    private static string Readable(string value) =>
        Uri.EscapeDataString(value).Replace("%2F", "/", StringComparison.Ordinal).Replace("%3A", ":", StringComparison.Ordinal);

    internal static void Meta(StringBuilder html, string key, string name, string content) =>
        html.Append($"<meta {key}=\"{name}\" content=\"{Encode(content)}\">\n");

    internal static void Tag(StringBuilder html, string tag, string text) =>
        html.Append($"<{tag}>{Encode(text)}</{tag}>\n");

    internal static string Encode(string value) => Encoder.Encode(value);
}
