using api.PlayerBanners.Models;
using api.PlayerStats;
using api.PlayerTracking;
using api.Signatures;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Logging;

namespace api.PlayerBanners;

public sealed class PlayerBannerService(
    PlayerTrackerDbContext dbContext,
    ISqlitePlayerStatsService playerStatsService,
    SignatureArtCatalogue art,
    PlayerSignatureRenderer renderer,
    IDistributedCache cache,
    ILogger<PlayerBannerService> logger) : IPlayerBannerService
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromHours(1);

    public async Task<byte[]?> RenderAsync(
        string playerName,
        string? modId,
        string? scene,
        string? serverGuid,
        int width,
        CancellationToken cancellationToken = default)
    {
        var choice = art.Pick(modId, scene);
        if (choice is null)
        {
            logger.LogWarning("No signature art in the catalogue; is Signatures/Art in the image?");
            return null;
        }

        var cacheKey = BuildCacheKey(playerName, $"{choice.Mod.Id}/{choice.Scene.Id}", serverGuid, width);
        var cached = await cache.GetAsync(cacheKey, cancellationToken);
        if (cached is { Length: > 0 })
        {
            return cached;
        }

        var stats = await ResolveStatsAsync(playerName, serverGuid, cancellationToken);
        if (stats is null)
        {
            return null;
        }

        var bytes = await renderer.RenderAsync(stats, choice, width, cancellationToken);

        await cache.SetAsync(cacheKey, bytes, new DistributedCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = CacheDuration
        }, cancellationToken);

        return bytes;
    }

    private async Task<BannerStats?> ResolveStatsAsync(
        string playerName,
        string? serverGuid,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(serverGuid))
        {
            // lookBackDays: 0 == lifetime
            var lifetime = await playerStatsService.GetPlayerStatsAsync(playerName, lookBackDays: 0);
            if (lifetime is null) return null;

            return new BannerStats(
                PlayerName: lifetime.PlayerName,
                ServerName: null,
                TotalKills: lifetime.TotalKills,
                TotalScore: lifetime.TotalScore,
                KdRatio: Math.Round(lifetime.KdRatio, 2),
                TotalHours: lifetime.TotalPlayTimeMinutes / 60.0);
        }

        // Per-server: aggregate across all weekly buckets, no minimum-time filter.
        var serverStats = await dbContext.PlayerServerStats
            .Where(p => p.PlayerName == playerName && p.ServerGuid == serverGuid)
            .GroupBy(_ => 1)
            .Select(g => new
            {
                TotalKills = g.Sum(p => p.TotalKills),
                TotalDeaths = g.Sum(p => p.TotalDeaths),
                TotalScore = g.Sum(p => p.TotalScore),
                TotalPlayTimeMinutes = g.Sum(p => p.TotalPlayTimeMinutes)
            })
            .SingleOrDefaultAsync(cancellationToken);

        if (serverStats is null)
        {
            return null;
        }

        var serverName = await dbContext.Servers
            .Where(s => s.Guid == serverGuid)
            .Select(s => s.Name)
            .SingleOrDefaultAsync(cancellationToken);

        var kd = serverStats.TotalDeaths > 0
            ? Math.Round((double)serverStats.TotalKills / serverStats.TotalDeaths, 2)
            : serverStats.TotalKills;

        return new BannerStats(
            PlayerName: playerName,
            ServerName: serverName,
            TotalKills: serverStats.TotalKills,
            TotalScore: serverStats.TotalScore,
            KdRatio: kd,
            TotalHours: serverStats.TotalPlayTimeMinutes / 60.0);
    }

    private static string BuildCacheKey(string playerName, string art, string? serverGuid, int width)
    {
        var safeName = playerName.Replace(":", "_").ToLowerInvariant();
        var serverPart = string.IsNullOrWhiteSpace(serverGuid) ? "all" : serverGuid;
        return $"banner:v2:{safeName}:{art}:{serverPart}:{width}";
    }
}
