using api.Bflist;
using api.Bflist.Models;
using api.PlayerTracking;
using api.ServerBanners.Models;
using api.Signatures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.ServerBanners;

public sealed class ServerBannerService(
    PlayerTrackerDbContext dbContext,
    IBfListApiService bfListApiService,
    SignatureArtCatalogue art,
    ServerSignatureRenderer renderer,
    ILogger<ServerBannerService> logger) : IServerBannerService
{
    public async Task<byte[]?> RenderAsync(
        string serverName,
        string? modId,
        string? scene,
        bool showTickets = true,
        int width = SignatureCanvas.DefaultWidth,
        CancellationToken cancellationToken = default)
    {
        var stats = await ResolveStatsAsync(serverName, showTickets, cancellationToken);
        if (stats is null)
        {
            return null;
        }

        // Unless the caller picks one, the signature wears the server's own mod.
        var choice = art.Pick(modId, scene, stats.GameId);
        if (choice is null)
        {
            logger.LogWarning("No signature art in the catalogue; is Signatures/Art in the image?");
            return null;
        }

        return await renderer.RenderAsync(stats, choice, width, cancellationToken);
    }

    internal async Task<ServerBannerStats?> ResolveStatsAsync(
        string serverName,
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

        return new ServerBannerStats(
            ServerName: server.Name,
            IpPort: $"{ip}:{port}",
            Map: map,
            GameMode: gameMode,
            NumPlayers: server.CurrentNumPlayers,
            MaxPlayers: server.MaxPlayers ?? 0,
            IsOnline: server.IsOnline,
            Tickets: tickets,
            GameId: server.Game);
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

    private static ServerBannerTickets? TicketsFrom(ServerSummary? summary)
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
