using api.Bflist;
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

    // Treat sessions seen in the last minute as currently online — same threshold the
    // live-servers controller uses, so the banner agrees with what the live UI shows.
    private static readonly TimeSpan ActiveSessionWindow = TimeSpan.FromMinutes(1);

    public async Task<byte[]?> RenderAsync(
        string serverName,
        ServerBannerStyle style,
        bool showTickets = true,
        CancellationToken cancellationToken = default)
    {
        var stats = await ResolveStatsAsync(serverName, style, showTickets, cancellationToken);
        if (stats is null)
        {
            return null;
        }

        return await renderer.RenderAsync(stats, style, cancellationToken);
    }

    private async Task<ServerBannerStats?> ResolveStatsAsync(
        string serverName,
        ServerBannerStyle style,
        bool showTickets,
        CancellationToken cancellationToken)
    {
        var server = await dbContext.Servers
            .Where(s => s.Name == serverName)
            .Select(s => new
            {
                s.Guid,
                s.Name,
                s.Ip,
                s.Port,
                s.Game,
                s.MaxPlayers,
                s.MapName,
                s.IsOnline
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (server is null)
        {
            return null;
        }

        var cutoff = DateTime.UtcNow - ActiveSessionWindow;
        var numPlayers = await dbContext.PlayerSessions
            .Where(ps => ps.ServerGuid == server.Guid
                         && ps.IsActive
                         && ps.LastSeenTime >= cutoff
                         && !ps.Player.AiBot)
            .CountAsync(cancellationToken);

        var currentRound = await dbContext.Rounds
            .Where(r => r.ServerGuid == server.Guid && r.IsActive)
            .Select(r => new { r.MapName, r.GameType })
            .FirstOrDefaultAsync(cancellationToken);

        var map = !string.IsNullOrWhiteSpace(currentRound?.MapName)
            ? currentRound.MapName
            : server.MapName;

        var tickets = showTickets
            ? await ResolveTicketsAsync(server.Game, server.Ip, server.Port, cancellationToken)
            : null;

        // Only the Waveform style renders the population timeline, so skip the extra
        // query for the other three.
        var activity = style == ServerBannerStyle.Waveform
            ? await ResolveActivityAsync(server.Guid, numPlayers, cancellationToken)
            : null;

        return new ServerBannerStats(
            ServerName: server.Name,
            IpPort: $"{server.Ip}:{server.Port}",
            Map: map,
            GameMode: currentRound?.GameType,
            NumPlayers: numPlayers,
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
    /// Pulls the live team ticket scoreboard from the BFList feed. Best-effort: any
    /// failure (upstream down, server offline, no ticket data) just drops the tickets
    /// from the banner rather than failing the whole render.
    /// </summary>
    private async Task<ServerBannerTickets?> ResolveTicketsAsync(
        string? game,
        string ip,
        int port,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(game) || string.IsNullOrWhiteSpace(ip))
        {
            return null;
        }

        try
        {
            var summary = await bfListApiService.FetchSingleServerSummaryAsync(game, $"{ip}:{port}");
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
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to resolve live tickets for {Ip}:{Port} ({Game})", ip, port, game);
            return null;
        }
    }

    private static string Label(string? raw, string fallback) =>
        string.IsNullOrWhiteSpace(raw) ? fallback : raw.Trim().ToUpperInvariant();
}
