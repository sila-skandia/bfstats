using System.Diagnostics;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace api.Recordings;

/// <summary>
/// Who watches and uses the replay system, as one structured Seq event per action
/// (features/replay-usage-metrics). The play front end is not the SPA, so its visitors never
/// reach <c>stats/telemetry/page-view</c>; the API sees every one of them anyway, because the
/// replay page calls it to open a recording, comment, share and so on.
///
/// Every event is <c>ReplayUsage</c> with a <c>ReplayAction</c> and the same properties, so a
/// dashboard groups by action and counts distinct <c>ReplayViewerId</c>s for the audience. The
/// event is logged at the moment of the request: it is not the deduplicated count in
/// <c>Recordings.ViewCount</c> (which counts a viewer once per window), it is what happened.
///
/// <para>Privacy: <c>ReplayViewerId</c> is the signed-in account's id or a keyed hash of the
/// address and browser, under a key of its own so it cannot be joined to the stored view keys.
/// Neither the address nor the browser string goes into the event's own properties.</para>
/// </summary>
public static class ReplayUsage
{
    public const string Feed = "feed";
    public const string Link = "link_open";
    public const string View = "view";
    public const string Comment = "comment";
    public const string Reaction = "reaction";
    public const string Upload = "upload";
    public const string EditShare = "edit_share";
    public const string ShortLink = "short_link_open";
    public const string ShortView = "short_view";
    public const string ShortShare = "short_share";

    /// <summary>Logs one action. Never throws and never blocks: a metric must not fail a request.</summary>
    /// <param name="http">The request the action came in on.</param>
    /// <param name="action">One of the constants above.</param>
    /// <param name="slug">The recording or Short it was about, when it was about one.</param>
    /// <param name="detail">One short word that qualifies the action (the feed's sort, a reaction's kind).</param>
    public static void Record(HttpContext? http, string action, string? slug = null, string? detail = null)
    {
        try
        {
            if (http is null) return;
            // The SPA's page-view beacon drops crawlers the same way.
            if (string.Equals(Activity.Current?.GetTagItem("is_bot") as string, "true", StringComparison.OrdinalIgnoreCase)) return;
            var logger = http.RequestServices?.GetService<ILoggerFactory>()?.CreateLogger(typeof(ReplayUsage).FullName!);
            if (logger is null || !logger.IsEnabled(LogLevel.Information)) return;

            var userId = UserId(http.User);
            logger.LogInformation(
                "ReplayUsage {ReplayAction} slug={ReplaySlug} viewer={ReplayViewerId} signedIn={ReplaySignedIn} surface={ReplaySurface} detail={ReplayDetail}",
                action,
                slug,
                ViewerId(http, userId),
                userId is not null,
                Surface(http),
                detail);
        }
        catch
        {
            // Telemetry never breaks the replay.
        }
    }

    /// <summary>The signed-in account's id, or null for a visitor with no account.</summary>
    public static int? UserId(ClaimsPrincipal user)
    {
        if (user.Identity?.IsAuthenticated != true) return null;
        var id = user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub");
        return int.TryParse(id, out var userId) ? userId : null;
    }

    /// <summary>The same person across every action: <c>u:&lt;id&gt;</c> when signed in, else a
    /// keyed hash of address and browser.</summary>
    internal static string ViewerId(HttpContext http, int? userId)
    {
        if (userId is { } id) return $"u:{id}";
        var configuration = http.RequestServices?.GetService<IConfiguration>();
        var secret = configuration?["RefreshToken:Secret"] ?? configuration?["Jwt:Issuer"] ?? "bfstats";
        var key = SHA256.HashData(Encoding.UTF8.GetBytes($"replay-usage|{secret}"));
        var visitor = Encoding.UTF8.GetBytes($"{ClientAddress.Of(http)}|{http.Request.Headers.UserAgent}");
        return $"a:{Convert.ToHexStringLower(HMACSHA256.HashData(key, visitor))[..32]}";
    }

    /// <summary>Which page the action came from: the host of the request's <c>Origin</c>, else
    /// of its <c>Referer</c> (<c>play.bfstats.io</c>, <c>replay.bfstats.io</c>, a local viewer).
    /// Host only: a path or query can carry a recording a player did not share.</summary>
    internal static string? Surface(HttpContext http)
    {
        foreach (var header in new[] { "Origin", "Referer" })
        {
            var value = http.Request.Headers[header].ToString();
            if (Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Host.Length > 0)
            {
                return uri.Host.Length <= 100 ? uri.Host.ToLowerInvariant() : null;
            }
        }
        return null;
    }
}
