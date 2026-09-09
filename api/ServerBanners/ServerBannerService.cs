using api.Bflist;
using api.Bflist.Models;
using api.GameTrends;
using api.PlayerTracking;
using api.ServerBanners.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.ServerBanners;

public sealed class ServerBannerService(
    PlayerTrackerDbContext dbContext,
    IBfListApiService bfListApiService,
    ISqliteGameTrendsService gameTrendsService,
    ServerBannerRenderer renderer,
    ILogger<ServerBannerService> logger) : IServerBannerService
{
    // Past + future hours shown either side of "now" on the Waveform timeline.
    private const int ActivityHourRange = 4;

    public async Task<byte[]?> RenderAsync(
        string serverName,
        ServerBannerStyle style,
        bool showTickets = true,
        int width = ServerBannerRenderer.DefaultWidth,
        CancellationToken cancellationToken = default)
    {
        var stats = await ResolveStatsAsync(serverName, style, showTickets, cancellationToken);
        if (stats is null)
        {
            return null;
        }

        return await renderer.RenderAsync(stats, style, width, cancellationToken);
    }

    internal async Task<ServerBannerStats?> ResolveStatsAsync(
        string serverName,
        ServerBannerStyle style,
        bool showTickets,
        CancellationToken cancellationToken = default)
    {
        var server = await dbContext.Servers
            .Where(s => s.Name == serverName)
            .OrderByDescending(s => s.IsOnline)
            .ThenByDescending(s => s.LastSeenTime)
            .Select(s => new
            {
                s.Guid,
                s.Name,
                s.Ip,
                s.Port,
                s.Game,
                s.MaxPlayers,
                s.CurrentNumPlayers,
                s.MapName,
                s.CurrentMap,
                s.IsOnline
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (server is null)
        {
            return null;
        }

        // Map/mode/tickets come from Servers + the warm BFList snapshot, looked up by
        // name (so a duplicate-name row's stale IP doesn't matter) - fetched regardless
        // of showTickets, since the renderer paints GameMode in the tickets' slot when
        // the scoreboard is off. Touching Rounds on this path contends with the 30s
        // collector on the volume, so it's never queried here.
        var live = string.IsNullOrWhiteSpace(server.Game)
            ? null
            : await bfListApiService.TryGetCachedServerByNameAsync(server.Game, server.Name);

        var ip = !string.IsNullOrWhiteSpace(live?.Ip) ? live.Ip : server.Ip;
        var port = live is { Port: > 0 } ? live.Port : server.Port;
        var map = FirstNonEmpty(live?.MapName, server.CurrentMap, server.MapName);
        var gameMode = FirstNonEmpty(live?.GameType, live?.GameMode);

        var tickets = showTickets
            ? live != null
                ? TicketsFrom(live)
                : await ResolveTicketsAsync(server.Game, ip, port, cancellationToken)
            : null;

        // Only the Waveform style renders the population timeline, so skip the extra
        // query for the other three.
        var activity = style == ServerBannerStyle.Waveform
            ? await ResolveActivityAsync(server.Guid, server.CurrentNumPlayers, cancellationToken)
            : null;

        return new ServerBannerStats(
            ServerName: server.Name,
            IpPort: $"{ip}:{port}",
            Map: map,
            GameMode: gameMode,
            NumPlayers: server.CurrentNumPlayers,
            MaxPlayers: server.MaxPlayers ?? 0,
            IsOnline: server.IsOnline,
            Tickets: tickets,
            Activity: activity);
    }

    /// <summary>
    /// Builds the Waveform population timeline from the pre-computed hourly busy
    /// patterns: typical players for the past <see cref="ActivityHourRange"/> hours, the
    /// live count for the current hour, and the forecast for the next few hours.
    /// Best-effort — any failure just drops the timeline and the renderer falls back.
    /// </summary>
    private async Task<ServerBannerActivity?> ResolveActivityAsync(
        string serverGuid,
        int currentPlayers,
        CancellationToken cancellationToken)
    {
        _ = cancellationToken;
        try
        {
            var grouped = await gameTrendsService.GetServerBusyIndicatorAsync([serverGuid], ActivityHourRange);
            var timeline = grouped.ServerResults.FirstOrDefault()?.HourlyTimeline;
            if (timeline is null || timeline.Count == 0)
            {
                return null;
            }

            var currentIndex = timeline.FindIndex(h => h.IsCurrentHour);
            var bars = new List<ServerBannerActivityBar>(timeline.Count);
            for (var i = 0; i < timeline.Count; i++)
            {
                var entry = timeline[i];
                // The current bar carries the live count; the rest use the hourly average.
                var players = entry.IsCurrentHour ? currentPlayers : entry.TypicalPlayers;
                var isFuture = currentIndex >= 0 && i > currentIndex;
                bars.Add(new ServerBannerActivityBar(players, entry.IsCurrentHour, isFuture));
            }

            // No history and nobody on now — let the renderer use its static fallback
            // rather than paint a flat, empty equalizer.
            return bars.Any(b => b.Players > 0) ? new ServerBannerActivity(bars) : null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to resolve activity timeline for {ServerGuid}", serverGuid);
            return null;
        }
    }

    /// <summary>
    /// Cache-miss fallback: pulls the live team ticket scoreboard directly from the
    /// BFList feed when the warm name-keyed snapshot didn't have this server. Best-
    /// effort - any failure just drops the tickets from the banner.
    /// </summary>
    private async Task<ServerBannerTickets?> ResolveTicketsAsync(
        string? game,
        string ip,
        int port,
        CancellationToken cancellationToken)
    {
        _ = cancellationToken;
        if (string.IsNullOrWhiteSpace(game) || string.IsNullOrWhiteSpace(ip))
        {
            return null;
        }

        try
        {
            return TicketsFrom(await bfListApiService.FetchSingleServerSummaryAsync(game, $"{ip}:{port}"));
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to resolve live tickets for {Ip}:{Port} ({Game})", ip, port, game);
            return null;
        }
    }

    private static ServerBannerTickets? TicketsFrom(api.Bflist.Models.ServerSummary? summary)
    {
        if (summary is null)
        {
            return null;
        }

        var team1 = summary.Teams?.FirstOrDefault(t => t.Index == 1);
        var team2 = summary.Teams?.FirstOrDefault(t => t.Index == 2);

        var t1 = team1?.Tickets ?? summary.Tickets1;
        var t2 = team2?.Tickets ?? summary.Tickets2;

        // No live ticket data (e.g. between rounds, or a game that doesn't report it).
        if (t1 <= 0 && t2 <= 0)
        {
            return null;
        }

        return new ServerBannerTickets(
            Team1Label: Label(team1?.Label, "AXIS"),
            Team2Label: Label(team2?.Label, "ALLIES"),
            Team1Tickets: Math.Max(0, t1),
            Team2Tickets: Math.Max(0, t2));
    }

    private static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v));


    private static string Label(string? raw, string fallback) =>
        string.IsNullOrWhiteSpace(raw) ? fallback : raw.Trim().ToUpperInvariant();
}
