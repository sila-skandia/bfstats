using System.Globalization;
using System.Text;
using api.Recordings;
using api.Shorts.Models;
using static api.Recordings.RecordingShortLink;

namespace api.Shorts;

/// <summary>
/// A Short's share link, <c>replay.bfstats.io/s/&lt;slug&gt;</c> (features/replay-shorts,
/// "Share links"). HAProxy turns the replay host's path into the API's <c>/replay/s/&lt;slug&gt;</c>,
/// as it does a recording's. The answer is a page that sends a browser on to the Short in the
/// REPLAY tab's player and tells whatever unfurls the link the video itself: Discord plays an
/// <c>og:video</c> MP4 in the chat, with the poster as its still before a click.
/// </summary>
public static class ShortLink
{
    /// <summary>Every Short is filmed at this size (scripts/shorts-runner.mjs).</summary>
    public const int Width = 1080;
    public const int Height = 1920;

    /// <summary>An action roll's link copy and poster are 16:9 (scripts/action-roll.mjs): the
    /// copy is 1280x720, the poster 1920x1080.</summary>
    public const int RollVideoWidth = 1280;
    public const int RollVideoHeight = 720;
    public const int RollPosterWidth = 1920;
    public const int RollPosterHeight = 1080;

    /// <summary>The Short open in the REPLAY tab's player, root-relative on the play host.</summary>
    public static string WatchPath(string slug) => $"/play/?tab=replay&short={Uri.EscapeDataString(slug)}";

    /// <summary>The page for a Short: its video and poster tags, and a refresh to the player on
    /// <paramref name="playOrigin"/>. <paramref name="linkOrigin"/> is the share link's host.</summary>
    public static string Page(ShortDto s, string playOrigin, string linkOrigin)
    {
        var watch = playOrigin + WatchPath(s.Slug);
        var self = $"{linkOrigin}/s/{s.Slug}";
        // The link copy when there is one: Discord shows a linked video over about 50 MB as a
        // bare link (2026-11-12, a roll's 479 MB 4K take).
        var video = playOrigin + (s.LinkVideoUrl ?? s.VideoUrl);
        var poster = playOrigin + s.PosterUrl;
        var width = Text(s.Landscape ? RollVideoWidth : Width);
        var height = Text(s.Landscape ? RollVideoHeight : Height);
        var posterWidth = Text(s.Landscape ? RollPosterWidth : Width);
        var posterHeight = Text(s.Landscape ? RollPosterHeight : Height);
        var html = new StringBuilder();
        html.Append("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
        html.Append("<meta name=\"color-scheme\" content=\"dark light\">\n");
        Tag(html, "title", $"{s.Title} · Replay Shorts | bfstats.io");
        Meta(html, "http-equiv", "refresh", $"0; url={watch}");
        Meta(html, "property", "og:site_name", "bfstats.io · Replay Shorts");
        Meta(html, "property", "og:type", "video.other");
        Meta(html, "property", "og:title", s.Title);
        Meta(html, "property", "og:description", Description(s));
        Meta(html, "property", "og:url", self);
        Meta(html, "property", "og:image", poster);
        Meta(html, "property", "og:image:type", "image/jpeg");
        Meta(html, "property", "og:image:width", posterWidth);
        Meta(html, "property", "og:image:height", posterHeight);
        Meta(html, "property", "og:video", video);
        Meta(html, "property", "og:video:url", video);
        Meta(html, "property", "og:video:secure_url", video);
        Meta(html, "property", "og:video:type", "video/mp4");
        Meta(html, "property", "og:video:width", width);
        Meta(html, "property", "og:video:height", height);
        Meta(html, "name", "twitter:card", "player");
        Meta(html, "name", "twitter:title", s.Title);
        Meta(html, "name", "twitter:image", poster);
        Meta(html, "name", "twitter:player", watch);
        Meta(html, "name", "twitter:player:width", width);
        Meta(html, "name", "twitter:player:height", height);
        Meta(html, "name", "twitter:player:stream", video);
        Meta(html, "name", "twitter:player:stream:content_type", "video/mp4");
        Meta(html, "name", "theme-color", "#a39c6c");
        html.Append($"<link rel=\"canonical\" href=\"{Encode(self)}\">\n");
        html.Append("</head>\n<body>\n");
        html.Append($"<p><a href=\"{Encode(watch)}\">{Encode(s.Title)}</a></p>\n");
        html.Append("</body>\n</html>\n");
        return html.ToString();
    }

    /// <summary><c>skandia → Ju88A · M3A1 · 257 m · Midway</c>.</summary>
    internal static string Description(ShortDto s)
    {
        var killer = Shown(s.Killer);
        var victim = Shown(s.Victim);
        var weapon = s.Weapon.Length > 0 ? s.Weapon : s.KillerVehicle ?? "";
        string?[] parts =
        [
            killer.Length > 0 || victim.Length > 0 ? $"{Or(killer, "Someone")} → {Or(victim, "someone")}" : null,
            weapon.Length > 0 ? weapon : null,
            s.Distance > 0 ? FormattableString.Invariant($"{Math.Round(s.Distance):0} m") : null,
            s.Level.Length > 0 ? RecordingText.Titled(s.Level) : null,
        ];
        return string.Join(" · ", parts.Where(p => !string.IsNullOrEmpty(p)));
    }

    private static string Text(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string Or(string value, string fallback) => value.Length > 0 ? value : fallback;
}
