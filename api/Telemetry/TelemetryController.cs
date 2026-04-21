using System.Diagnostics;
using api.Telemetry.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace api.Telemetry;

[ApiController]
[Route("stats/telemetry")]
public class TelemetryController(ILogger<TelemetryController> logger) : ControllerBase
{
    private static readonly HashSet<string> AllowedPageTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "landing",
        "dashboard",
        "server_list",
        "server_details",
        "server_sessions",
        "players",
        "player_details",
        "player_sessions",
        "player_achievements",
        "player_network",
        "player_comparison",
        "round_report",
        "tournament",
        "tournament_rankings",
        "tournament_rules",
        "tournament_teams",
        "tournament_matches",
        "tournament_stats",
        "tournament_files",
        "community_details",
        "map_popularity",
        "alias_detection",
        "system_stats",
        "admin_data",
        "admin_tournament",
        "discord_callback",
        "other"
    };

    [HttpPost("page-view")]
    public IActionResult RecordPageView([FromBody] PageViewRequest request)
    {
        if (request is null ||
            string.IsNullOrWhiteSpace(request.PageType) ||
            string.IsNullOrWhiteSpace(request.VisitorId) ||
            string.IsNullOrWhiteSpace(request.SessionId))
        {
            return NoContent();
        }

        var isBotTag = Activity.Current?.GetTagItem("is_bot") as string;
        if (string.Equals(isBotTag, "true", StringComparison.OrdinalIgnoreCase))
        {
            return NoContent();
        }

        var pageType = AllowedPageTypes.Contains(request.PageType)
            ? request.PageType.ToLowerInvariant()
            : "other";

        var slug = Truncate(request.Slug, 200);
        var referrer = Truncate(request.Referrer, 500);
        var routeName = Truncate(request.RouteName, 100);
        var path = Truncate(request.Path, 500);
        var visitorId = Truncate(request.VisitorId, 64)!;
        var sessionId = Truncate(request.SessionId, 64)!;

        logger.LogInformation(
            "PageView {PageType} slug={PageSlug} visitor={VisitorId} session={SessionId} route={PageRouteName} path={PagePath} referrer={PageReferrer}",
            pageType,
            slug,
            visitorId,
            sessionId,
            routeName,
            path,
            referrer);

        return NoContent();
    }

    private static string? Truncate(string? value, int max)
    {
        if (string.IsNullOrEmpty(value)) return null;
        return value.Length <= max ? value : value[..max];
    }
}
