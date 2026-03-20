using api.DataExplorer.Models;
using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace api.DataExplorer;

public interface IMapPopularityService
{
    Task<MapPopularityResponse?> GetMapPopularityAsync(string serverGuid, int days = 7);
}

public class MapPopularityService(
    PlayerTrackerDbContext dbContext,
    ILogger<MapPopularityService> logger) : IMapPopularityService
{
    private const int BucketMinutes = 10;
    private const int MaxBuckets = 7 * 24 * 6; // 7 days at 10-min intervals

    public async Task<MapPopularityResponse?> GetMapPopularityAsync(string serverGuid, int days = 7)
    {
        days = Math.Clamp(days, 1, 30);
        var cutoff = DateTime.UtcNow.AddDays(-days);

        var serverExists = await dbContext.Servers
            .AsNoTracking()
            .AnyAsync(s => s.Guid == serverGuid);

        if (!serverExists)
            return null;

        // Get completed rounds for this server
        var rounds = await dbContext.Rounds
            .AsNoTracking()
            .Where(r => r.ServerGuid == serverGuid
                        && r.StartTime >= cutoff
                        && !r.IsDeleted
                        && !r.IsActive
                        && r.EndTime != null)
            .OrderBy(r => r.StartTime)
            .Select(r => new MapPopularityRound(
                r.RoundId,
                r.MapName,
                r.StartTime,
                r.EndTime,
                r.ParticipantCount))
            .ToListAsync();

        if (rounds.Count == 0)
            return new MapPopularityResponse([], [], []);

        // Get session boundaries for sweep line
        var sessions = await dbContext.PlayerSessions
            .AsNoTracking()
            .Where(s => s.ServerGuid == serverGuid
                        && s.LastSeenTime >= cutoff
                        && !s.IsDeleted)
            .Select(s => new { s.StartTime, s.LastSeenTime })
            .ToListAsync();

        logger.LogDebug(
            "Map popularity: {RoundCount} rounds, {SessionCount} sessions for server {ServerGuid} over {Days} days",
            rounds.Count, sessions.Count, serverGuid, days);

        // Build sweep line events.
        // The -1 event is placed one bucket after LastSeenTime so the player
        // is still counted in their final observed bucket.
        var events = new List<(DateTime Time, int Delta)>(sessions.Count * 2);
        foreach (var s in sessions)
        {
            events.Add((s.StartTime, 1));
            events.Add((s.LastSeenTime.AddMinutes(BucketMinutes), -1));
        }

        events.Sort((a, b) => a.Time.CompareTo(b.Time));

        // Use cutoff as timeline start so the warm-up loop boundary matches the session query
        var timelineStart = cutoff;
        var timelineEnd = DateTime.UtcNow;
        var totalBuckets = Math.Min(
            (int)Math.Ceiling((timelineEnd - timelineStart).TotalMinutes / BucketMinutes),
            MaxBuckets);

        var timeline = new List<PopulationTimelinePoint>(totalBuckets);

        // Process events before timeline start to get initial concurrent count
        int eventIdx = 0;
        int concurrent = 0;
        while (eventIdx < events.Count && events[eventIdx].Time < timelineStart)
        {
            concurrent += events[eventIdx].Delta;
            eventIdx++;
        }

        for (int i = 0; i < totalBuckets; i++)
        {
            var bucketTime = timelineStart.AddMinutes(i * BucketMinutes);
            var nextBucketTime = timelineStart.AddMinutes((i + 1) * BucketMinutes);

            // Process all events in this bucket
            while (eventIdx < events.Count && events[eventIdx].Time < nextBucketTime)
            {
                concurrent += events[eventIdx].Delta;
                eventIdx++;
            }

            var mapName = FindActiveMap(bucketTime, rounds);

            timeline.Add(new PopulationTimelinePoint(
                bucketTime,
                Math.Max(0, concurrent),
                mapName));
        }

        var mapSummaries = ComputeMapSummaries(timeline, rounds);

        return new MapPopularityResponse(timeline, rounds, mapSummaries);
    }

    /// <summary>
    /// Find the map active at a given time. Rounds are sorted by StartTime ascending.
    /// Since rounds don't overlap on the same server, the last round that started
    /// before the given time is the active one (if it hasn't ended).
    /// </summary>
    private static string? FindActiveMap(DateTime time, List<MapPopularityRound> rounds)
    {
        for (int i = rounds.Count - 1; i >= 0; i--)
        {
            var r = rounds[i];
            if (r.StartTime <= time)
                return (r.EndTime == null || r.EndTime >= time) ? r.MapName : null;
        }

        return null;
    }

    private static List<MapPopularitySummary> ComputeMapSummaries(
        List<PopulationTimelinePoint> timeline,
        List<MapPopularityRound> rounds)
    {
        // Avg concurrent per map from timeline
        var mapAvgConcurrent = timeline
            .Where(p => p.MapName != null)
            .GroupBy(p => p.MapName!)
            .ToDictionary(g => g.Key, g => g.Average(p => p.PlayerCount));

        // Compute avg player count per round for delta calculation
        var roundAvgs = new double[rounds.Count];
        for (int i = 0; i < rounds.Count; i++)
        {
            var round = rounds[i];
            var pointsDuringRound = timeline
                .Where(p => p.Timestamp >= round.StartTime
                            && (round.EndTime == null || p.Timestamp <= round.EndTime))
                .ToList();

            roundAvgs[i] = pointsDuringRound.Count > 0
                ? pointsDuringRound.Average(p => p.PlayerCount)
                : 0;
        }

        // Delta: when this map starts, what's the change vs the previous round?
        var mapDeltas = new Dictionary<string, List<double>>();
        for (int i = 1; i < rounds.Count; i++)
        {
            var delta = roundAvgs[i] - roundAvgs[i - 1];
            if (!mapDeltas.TryGetValue(rounds[i].MapName, out var deltas))
            {
                deltas = [];
                mapDeltas[rounds[i].MapName] = deltas;
            }

            deltas.Add(delta);
        }

        // Hourly avg per map
        var mapHourly = timeline
            .Where(p => p.MapName != null)
            .GroupBy(p => (Map: p.MapName!, Hour: p.Timestamp.Hour))
            .ToDictionary(g => g.Key, g => g.Average(p => p.PlayerCount));

        // Round counts per map
        var mapRoundCounts = rounds
            .GroupBy(r => r.MapName)
            .ToDictionary(g => g.Key, g => g.Count());

        return mapRoundCounts.Keys
            .Select(mapName =>
            {
                var hourlyAvg = new double[24];
                for (int h = 0; h < 24; h++)
                    hourlyAvg[h] = mapHourly.TryGetValue((mapName, h), out var avg)
                        ? Math.Round(avg, 1) : 0;

                return new MapPopularitySummary(
                    mapName,
                    mapRoundCounts.GetValueOrDefault(mapName, 0),
                    Math.Round(mapAvgConcurrent.GetValueOrDefault(mapName, 0), 1),
                    Math.Round(mapDeltas.TryGetValue(mapName, out var d) ? d.Average() : 0, 1),
                    hourlyAvg);
            })
            .OrderByDescending(s => s.TotalRounds)
            .ToList();
    }
}
