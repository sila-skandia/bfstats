using api.PlayerTracking;
using api.ServerBanners.Models;
using Microsoft.EntityFrameworkCore;

namespace api.ServerBanners;

public sealed class ServerBannerService(
    PlayerTrackerDbContext dbContext,
    ServerBannerRenderer renderer) : IServerBannerService
{
    // Treat sessions seen in the last minute as currently online — same threshold the
    // live-servers controller uses, so the banner agrees with what the live UI shows.
    private static readonly TimeSpan ActiveSessionWindow = TimeSpan.FromMinutes(1);

    public async Task<byte[]?> RenderAsync(
        string serverName,
        ServerBannerStyle style,
        CancellationToken cancellationToken = default)
    {
        var stats = await ResolveStatsAsync(serverName, cancellationToken);
        if (stats is null)
        {
            return null;
        }

        return await renderer.RenderAsync(stats, style, cancellationToken);
    }

    private async Task<ServerBannerStats?> ResolveStatsAsync(string serverName, CancellationToken cancellationToken)
    {
        var server = await dbContext.Servers
            .Where(s => s.Name == serverName)
            .Select(s => new
            {
                s.Guid,
                s.Name,
                s.Ip,
                s.Port,
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

        return new ServerBannerStats(
            ServerName: server.Name,
            IpPort: $"{server.Ip}:{server.Port}",
            Map: map,
            GameMode: currentRound?.GameType,
            NumPlayers: numPlayers,
            MaxPlayers: server.MaxPlayers ?? 0,
            IsOnline: server.IsOnline);
    }
}
