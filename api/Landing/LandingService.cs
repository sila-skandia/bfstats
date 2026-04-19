using api.Landing.Models;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using NodaTime;

namespace api.Landing;

public class LandingService(PlayerTrackerDbContext dbContext) : ILandingService
{
    public async Task<NetworkPulseResponse> GetNetworkPulseAsync(string? game, int trendHours, CancellationToken cancellationToken = default)
    {
        var normalisedGame = game?.ToLowerInvariant();
        var now = SystemClock.Instance.GetCurrentInstant();
        var trendCutoff = now.Minus(Duration.FromHours(trendHours));

        var onlineCountQuery = dbContext.ServerOnlineCounts.AsNoTracking()
            .Where(s => s.HourTimestamp >= trendCutoff);

        if (!string.IsNullOrWhiteSpace(normalisedGame))
        {
            onlineCountQuery = onlineCountQuery.Where(s => s.Game == normalisedGame);
        }

        var trendRows = await onlineCountQuery
            .GroupBy(s => s.HourTimestamp)
            .Select(g => new
            {
                HourTimestamp = g.Key,
                AvgPlayers = g.Sum(x => x.AvgPlayers),
                PeakPlayers = g.Sum(x => x.PeakPlayers)
            })
            .OrderBy(r => r.HourTimestamp)
            .ToListAsync(cancellationToken);

        var recentTrend = trendRows
            .Select(r => new NetworkPulseHourlyPoint(
                r.HourTimestamp.ToDateTimeUtc(),
                Math.Round(r.AvgPlayers, 2),
                r.PeakPlayers))
            .ToList();

        var heatmapQuery = dbContext.HourlyActivityPatterns.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(normalisedGame))
        {
            heatmapQuery = heatmapQuery.Where(h => h.Game == normalisedGame);
        }

        var weeklyHeatmap = await heatmapQuery
            .GroupBy(h => new { h.DayOfWeek, h.HourOfDay })
            .Select(g => new NetworkPulseHeatmapCell(
                g.Key.DayOfWeek,
                g.Key.HourOfDay,
                g.Sum(x => x.UniquePlayersAvg)))
            .ToListAsync(cancellationToken);

        NetworkPulsePeakInfo? peakToday = null;
        NetworkPulsePeakInfo? peakWeek = null;

        if (recentTrend.Count > 0)
        {
            var todayCutoff = now.Minus(Duration.FromHours(24));
            var todayPoints = trendRows.Where(r => r.HourTimestamp >= todayCutoff).ToList();
            if (todayPoints.Count > 0)
            {
                var top = todayPoints.OrderByDescending(p => p.AvgPlayers).First();
                peakToday = new NetworkPulsePeakInfo(
                    Math.Round(top.AvgPlayers, 2),
                    top.PeakPlayers,
                    top.HourTimestamp.ToDateTimeUtc());
            }

            var weekTop = trendRows.OrderByDescending(p => p.AvgPlayers).First();
            peakWeek = new NetworkPulsePeakInfo(
                Math.Round(weekTop.AvgPlayers, 2),
                weekTop.PeakPlayers,
                weekTop.HourTimestamp.ToDateTimeUtc());
        }

        return new NetworkPulseResponse(
            normalisedGame,
            now.ToDateTimeUtc(),
            recentTrend,
            weeklyHeatmap,
            peakToday,
            peakWeek);
    }
}
