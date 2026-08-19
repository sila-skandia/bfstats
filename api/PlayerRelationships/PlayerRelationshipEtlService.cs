using api.PlayerTracking;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Neo4j.Driver;

namespace api.PlayerRelationships;

/// <summary>
/// ETL service that syncs completed rounds from SQLite to Neo4j graph database.
/// Detects co-play pairs (players whose sessions overlapped in time within the same
/// round) and creates/updates relationship edges in Neo4j.
///
/// Correctness rests entirely on Round.SyncedToNeo4jAt / PlayerSession.SyncedToNeo4jAt:
/// a round (or session) is picked up, contributes to Neo4j, and is stamped in one
/// transaction-adjacent step, then never picked up again. PLAYED_WITH.sessionCount and
/// PLAYS_ON.sessionCount stay additive on the Neo4j side, but the SQLite watermark is
/// what guarantees each round/session can only ever add to them once.
/// </summary>
public class PlayerRelationshipEtlService(
    PlayerTrackerDbContext dbContext,
    Neo4jService neo4jService,
    ILogger<PlayerRelationshipEtlService> logger)
{
    /// <summary>
    /// Find co-play pairs across a batch of rounds in one query, by checking for time
    /// overlap between player sessions. Two players "played together" in a round if any
    /// of their sessions overlapped in time — this is deliberately session-interval-based,
    /// not round-membership-based, because a player can leave a round before another one
    /// joins and never actually cross paths.
    ///
    /// A player who reconnects mid-round has multiple sessions for the same round; any
    /// overlap between any of their sessions and the other player's sessions still
    /// yields exactly one fact for that pair for that round.
    /// </summary>
    public async Task<List<(string Player1, string Player2, DateTime Timestamp, string ServerGuid)>>
        DetectCoPlayPairsForRoundsAsync(
            List<(string RoundId, DateTime StartTime, string ServerGuid)> rounds,
            CancellationToken cancellationToken = default)
    {
        if (rounds.Count == 0)
        {
            return [];
        }

        var roundIds = rounds.Select(r => r.RoundId).ToList();
        var roundMeta = rounds.ToDictionary(r => r.RoundId);

        var sessions = await dbContext.PlayerSessions
            .Where(ps => ps.RoundId != null && roundIds.Contains(ps.RoundId))
            .Where(ps => !ps.IsDeleted)
            .Select(ps => new
            {
                ps.RoundId,
                ps.PlayerName,
                ps.StartTime,
                ps.LastSeenTime
            })
            .ToListAsync(cancellationToken);

        var facts = new List<(string, string, DateTime, string)>();

        foreach (var roundGroup in sessions.GroupBy(s => s.RoundId!))
        {
            if (!roundMeta.TryGetValue(roundGroup.Key, out var meta))
            {
                continue;
            }

            // Group by player (trimmed) to handle reconnects: a player can have
            // multiple sessions within the same round.
            var byPlayer = roundGroup
                .Select(s => new { PlayerName = s.PlayerName?.Trim() ?? "", s.StartTime, s.LastSeenTime })
                .Where(s => !string.IsNullOrEmpty(s.PlayerName))
                .GroupBy(s => s.PlayerName)
                .ToDictionary(g => g.Key, g => g.ToList());

            var players = byPlayer.Keys.OrderBy(p => p, StringComparer.Ordinal).ToList();
            if (players.Count < 2)
            {
                continue;
            }

            for (var i = 0; i < players.Count; i++)
            {
                for (var j = i + 1; j < players.Count; j++)
                {
                    var p1Sessions = byPlayer[players[i]];
                    var p2Sessions = byPlayer[players[j]];

                    var overlaps = p1Sessions.Any(s1 =>
                        p2Sessions.Any(s2 => s1.StartTime <= s2.LastSeenTime && s2.StartTime <= s1.LastSeenTime));

                    if (overlaps)
                    {
                        facts.Add((players[i], players[j], meta.StartTime, meta.ServerGuid));
                    }
                }
            }
        }

        return facts;
    }

    /// <summary>
    /// Aggregate co-play pairs into relationships with round counts.
    /// Groups by player pair and calculates metrics.
    /// </summary>
    public Dictionary<(string, string), RelationshipMetrics> AggregateRelationships(
        List<(string Player1, string Player2, DateTime Timestamp, string ServerGuid)> coPlayPairs)
    {
        var relationships = new Dictionary<(string, string), RelationshipMetrics>();

        foreach (var pair in coPlayPairs)
        {
            var key = (pair.Player1, pair.Player2);

            if (!relationships.TryGetValue(key, out var metrics))
            {
                relationships[key] = new RelationshipMetrics
                {
                    Player1Name = pair.Player1,
                    Player2Name = pair.Player2,
                    FirstSeen = pair.Timestamp,
                    LastSeen = pair.Timestamp,
                    ServerGuids = [pair.ServerGuid],
                    ObservationCount = 1
                };
            }
            else
            {
                metrics.ObservationCount++;

                if (pair.Timestamp < metrics.FirstSeen)
                    metrics.FirstSeen = pair.Timestamp;

                if (pair.Timestamp > metrics.LastSeen)
                    metrics.LastSeen = pair.Timestamp;

                if (!metrics.ServerGuids.Contains(pair.ServerGuid))
                    metrics.ServerGuids.Add(pair.ServerGuid);
            }
        }

        return relationships;
    }

    /// <summary>
    /// Sync detected relationships to Neo4j.
    /// Uses batch MERGE to create/update Player nodes and PLAYED_WITH relationships.
    /// This is additive (ON MATCH SET r.sessionCount = r.sessionCount + rel.observationCount);
    /// safety against double-counting comes from callers only ever passing a given
    /// round's contribution through here once (see Round.SyncedToNeo4jAt).
    /// </summary>
    public async Task SyncToNeo4jAsync(
        Dictionary<(string, string), RelationshipMetrics> relationships,
        CancellationToken cancellationToken = default)
    {
        _ = cancellationToken;
        if (relationships.Count == 0)
        {
            return;
        }

        var relationshipData = relationships.Select(kvp => new Dictionary<string, object>
        {
            ["player1"] = kvp.Key.Item1,
            ["player2"] = kvp.Key.Item2,
            ["observationCount"] = kvp.Value.ObservationCount,
            ["firstSeen"] = kvp.Value.FirstSeen.ToString("o"), // ISO 8601
            ["lastSeen"] = kvp.Value.LastSeen.ToString("o"),
            ["serverGuids"] = kvp.Value.ServerGuids
        }).ToList();

        // Each chunk is a separate transaction (small rows: two names, a count, two
        // dates, a server-guid list), unlike the unbatched full-graph DELETE that hit
        // Neo4j's transaction memory ceiling — that was one giant transaction, this is
        // many small ones. Round-trip count, not payload size, dominates wall-clock time
        // here since the same frequently-co-playing pair gets a separate MERGE per
        // round-batch that touches them (AggregateRelationships only dedupes within one
        // round-batch, not across the whole run).
        //
        // Deliberately no per-chunk logging here: this app's base Serilog level is
        // Debug (see Program.cs), so LogDebug is not actually suppressed by default —
        // the caller's own progress logging (SyncPendingRelationshipsAsync /
        // SyncPlayerServerRelationshipsAsync) is the only progress signal.
        const int batchSize = 5000;
        var batches = relationshipData.Chunk(batchSize).ToList();

        foreach (var batch in batches)
        {
            await neo4jService.ExecuteWriteAsync(async tx =>
            {
                // Cypher query to merge players and relationships
                var query = @"
                    UNWIND $relationships AS rel
                    MERGE (p1:Player {name: rel.player1})
                    ON CREATE SET p1.firstSeen = datetime(rel.firstSeen),
                                  p1.lastSeen = datetime(rel.lastSeen),
                                  p1.totalSessions = 0
                    ON MATCH SET p1.lastSeen = CASE
                        WHEN datetime(rel.lastSeen) > p1.lastSeen
                        THEN datetime(rel.lastSeen)
                        ELSE p1.lastSeen
                    END

                    MERGE (p2:Player {name: rel.player2})
                    ON CREATE SET p2.firstSeen = datetime(rel.firstSeen),
                                  p2.lastSeen = datetime(rel.lastSeen),
                                  p2.totalSessions = 0
                    ON MATCH SET p2.lastSeen = CASE
                        WHEN datetime(rel.lastSeen) > p2.lastSeen
                        THEN datetime(rel.lastSeen)
                        ELSE p2.lastSeen
                    END

                    MERGE (p1)-[r:PLAYED_WITH]-(p2)
                    ON CREATE SET r.sessionCount = rel.observationCount,
                                  r.firstPlayedTogether = datetime(rel.firstSeen),
                                  r.lastPlayedTogether = datetime(rel.lastSeen),
                                  r.servers = rel.serverGuids
                    ON MATCH SET r.sessionCount = r.sessionCount + rel.observationCount,
                                 r.lastPlayedTogether = CASE
                                     WHEN datetime(rel.lastSeen) > r.lastPlayedTogether
                                     THEN datetime(rel.lastSeen)
                                     ELSE r.lastPlayedTogether
                                 END,
                                 r.servers = CASE
                                     WHEN size([x IN rel.serverGuids WHERE NOT x IN r.servers]) > 0
                                     THEN r.servers + [x IN rel.serverGuids WHERE NOT x IN r.servers]
                                     ELSE r.servers
                                 END

                    RETURN count(*) as processed";

                var result = await tx.RunAsync(query, new { relationships = batch });
                var summary = await result.ConsumeAsync();
                return summary.Counters.NodesCreated + summary.Counters.RelationshipsCreated;
            });
        }
    }

    /// <summary>
    /// Process every completed round that has never been synced to Neo4j
    /// (Round.SyncedToNeo4jAt IS NULL). A batch of rounds is stamped synced only after
    /// its contribution has been successfully written to Neo4j, so a failed batch is
    /// retried on the next run but a succeeded one is never re-added.
    ///
    /// This is the method the daily background job calls, and also what a backfill
    /// drains after <see cref="ResetNeo4jSyncWatermarkAsync"/> clears the watermark for
    /// a date range — same code path either way, just a bigger backlog.
    /// </summary>
    public async Task<SyncResult> SyncPendingRelationshipsAsync(
        int roundBatchSize = 2500,
        CancellationToken cancellationToken = default)
    {
        var startTime = DateTime.UtcNow;
        var roundsProcessed = 0;
        var totalRelationshipsProcessed = 0;

        // Snapshot at the start so progress logs have a denominator. It can drift low as
        // more rounds finish and become pending during a long-running backfill — that's
        // fine, it's a progress indicator, not a completion gate.
        var totalPending = await dbContext.Rounds
            .Where(r => !r.IsDeleted && !r.IsActive && r.SyncedToNeo4jAt == null)
            .CountAsync(cancellationToken);

        logger.LogInformation("Neo4j relationship sync: {TotalPending} rounds pending", totalPending);

        // Sample progress at ~1% intervals instead of logging every round-batch — a
        // large backfill can be hundreds of batches, and one round-batch alone can be
        // well under 1%. Also log on a time interval regardless of percent crossed, so
        // a large total (or small batch share of it) can't leave the log silent for a
        // long stretch.
        const int progressSampleIntervalPercent = 1;
        var progressTimeInterval = TimeSpan.FromSeconds(15);
        var lastLoggedProgressBucket = -1;
        var lastProgressLogTime = DateTime.UtcNow;

        while (true)
        {
            var roundBatch = await dbContext.Rounds
                .Where(r => !r.IsDeleted && !r.IsActive && r.SyncedToNeo4jAt == null)
                .OrderBy(r => r.StartTime)
                .Select(r => new { r.RoundId, r.StartTime, r.ServerGuid })
                .Take(roundBatchSize)
                .ToListAsync(cancellationToken);

            if (roundBatch.Count == 0)
            {
                break;
            }

            var pairs = await DetectCoPlayPairsForRoundsAsync(
                roundBatch.Select(r => (r.RoundId, r.StartTime, r.ServerGuid)).ToList(),
                cancellationToken);

            var batchRelationships = AggregateRelationships(pairs);

            if (batchRelationships.Count > 0)
            {
                await SyncToNeo4jAsync(batchRelationships, cancellationToken);
                totalRelationshipsProcessed += batchRelationships.Count;
            }

            roundsProcessed += roundBatch.Count;

            var roundIds = roundBatch.Select(r => r.RoundId).ToList();
            var syncedAt = DateTime.UtcNow;
            await dbContext.Rounds
                .Where(r => roundIds.Contains(r.RoundId))
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.SyncedToNeo4jAt, syncedAt), cancellationToken);

            var progressPercent = totalPending == 0 ? 100 : (int)(100.0 * roundsProcessed / totalPending);
            var progressBucket = Math.Min(progressPercent, 100) / progressSampleIntervalPercent * progressSampleIntervalPercent;
            var now = DateTime.UtcNow;
            if (progressBucket > lastLoggedProgressBucket || now - lastProgressLogTime >= progressTimeInterval)
            {
                lastLoggedProgressBucket = Math.Max(lastLoggedProgressBucket, progressBucket);
                lastProgressLogTime = now;
                logger.LogInformation(
                    "Neo4j relationship sync: {ProgressPercent}% ({RoundsProcessed}/{TotalPending} rounds, {RelationshipsProcessed} relationship pairs so far)",
                    progressPercent, roundsProcessed, totalPending, totalRelationshipsProcessed);
            }

            if (roundBatch.Count < roundBatchSize)
            {
                break;
            }
        }

        var duration = DateTime.UtcNow - startTime;
        logger.LogInformation(
            "Neo4j relationship sync completed in {Duration}s: {RoundsProcessed} rounds, {RelationshipsProcessed} relationships",
            duration.TotalSeconds,
            roundsProcessed,
            totalRelationshipsProcessed);

        return new SyncResult
        {
            Success = true,
            RelationshipsProcessed = totalRelationshipsProcessed,
            RoundsProcessed = roundsProcessed,
            Duration = duration
        };
    }

    /// <summary>
    /// Clears the Neo4j sync watermark for rounds/sessions on or after <paramref name="fromDate"/>,
    /// so the next call to <see cref="SyncPendingRelationshipsAsync"/> /
    /// <see cref="SyncPlayerServerRelationshipsAsync"/> reprocesses them.
    ///
    /// This is a deliberate repair operation: it must only be called after the
    /// corresponding PLAYED_WITH / PLAYS_ON data in Neo4j has actually been wiped (or
    /// never existed), because the write side stays additive. Calling this against a
    /// range whose Neo4j data is still present will double-count.
    /// </summary>
    public async Task<(int RoundsReset, int SessionsReset)> ResetNeo4jSyncWatermarkAsync(
        DateTime fromDate,
        CancellationToken cancellationToken = default)
    {
        logger.LogWarning(
            "Resetting Neo4j sync watermark for rounds/sessions from {FromDate} onward — " +
            "the next sync pass will reprocess all of them. This assumes Neo4j has already " +
            "been cleared for this range.", fromDate);

        var roundsReset = await dbContext.Rounds
            .Where(r => r.StartTime >= fromDate)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.SyncedToNeo4jAt, (DateTime?)null), cancellationToken);

        var sessionsReset = await dbContext.PlayerSessions
            .Where(ps => ps.LastSeenTime >= fromDate)
            .ExecuteUpdateAsync(s => s.SetProperty(ps => ps.SyncedToNeo4jAt, (DateTime?)null), cancellationToken);

        logger.LogInformation(
            "Reset Neo4j sync watermark: {RoundsReset} rounds, {SessionsReset} sessions pending resync",
            roundsReset, sessionsReset);

        return (roundsReset, sessionsReset);
    }

    /// <summary>
    /// Incremental sync of player-server relationships (who plays on which servers).
    /// Only processes completed sessions that have never been synced
    /// (PlayerSession.SyncedToNeo4jAt IS NULL), mirroring
    /// <see cref="SyncPendingRelationshipsAsync"/> so a session contributes to
    /// PLAYS_ON.sessionCount at most once.
    /// </summary>
    public async Task SyncPlayerServerRelationshipsAsync(
        int sessionBatchSize = 5000,
        CancellationToken cancellationToken = default)
    {
        var totalSynced = 0;

        var totalPending = await dbContext.PlayerSessions
            .Where(ps => !ps.IsDeleted && !ps.IsActive && ps.SyncedToNeo4jAt == null)
            .CountAsync(cancellationToken);

        logger.LogInformation("Neo4j player-server sync: {TotalPending} sessions pending", totalPending);

        const int progressSampleIntervalPercent = 1;
        var progressTimeInterval = TimeSpan.FromSeconds(15);
        var lastLoggedProgressBucket = -1;
        var lastProgressLogTime = DateTime.UtcNow;

        while (true)
        {
            var sessionBatch = await dbContext.PlayerSessions
                .Where(ps => !ps.IsDeleted && !ps.IsActive && ps.SyncedToNeo4jAt == null)
                .OrderBy(ps => ps.LastSeenTime)
                .Select(ps => new
                {
                    ps.SessionId,
                    ps.PlayerName,
                    ps.ServerGuid,
                    ps.LastSeenTime,
                    ps.AveragePing
                })
                .Take(sessionBatchSize)
                .ToListAsync(cancellationToken);

            if (sessionBatch.Count == 0)
            {
                break;
            }

            var validSessions = sessionBatch
                .Select(ps => new { PlayerName = ps.PlayerName?.Trim() ?? "", ps.SessionId, ps.ServerGuid, ps.LastSeenTime, ps.AveragePing })
                .Where(ps => !string.IsNullOrEmpty(ps.PlayerName))
                .ToList();

            if (validSessions.Count == 0)
            {
                await MarkSessionsSyncedAsync(sessionBatch.Select(s => s.SessionId).ToList(), cancellationToken);
                continue;
            }

            var grouped = validSessions
                .GroupBy(ps => new { ps.PlayerName, ps.ServerGuid })
                .Select(g => new
                {
                    g.Key.PlayerName,
                    g.Key.ServerGuid,
                    SessionCount = g.Count(),
                    LastPlayed = g.Max(ps => ps.LastSeenTime),
                    AvgPing = g.Any(ps => ps.AveragePing is > 0)
                        ? g.Where(ps => ps.AveragePing is > 0).Select(ps => ps.AveragePing!.Value).Average()
                        : (double?)null
                })
                .ToList();

            var serverGuids = grouped.Select(g => g.ServerGuid).Distinct().ToList();
            var servers = await dbContext.Servers
                .Where(s => serverGuids.Contains(s.Guid))
                .Select(s => new { s.Guid, s.Name, s.Game })
                .ToListAsync(cancellationToken);
            var serverLookup = servers.ToDictionary(s => s.Guid);

            await neo4jService.ExecuteWriteAsync(async tx =>
            {
                var query = @"
                    UNWIND $relationships AS rel
                    MERGE (p:Player {name: rel.playerName})
                    MERGE (s:Server {guid: rel.serverGuid})
                    ON CREATE SET s.name = rel.serverName,
                                  s.game = rel.game

                    MERGE (p)-[r:PLAYS_ON]->(s)
                    ON CREATE SET r.sessionCount = rel.sessionCount,
                                  r.lastPlayed = datetime(rel.lastPlayed),
                                  r.avgPing = rel.avgPing
                    ON MATCH SET r.sessionCount = r.sessionCount + rel.sessionCount,
                                 r.lastPlayed = CASE
                                     WHEN datetime(rel.lastPlayed) > r.lastPlayed
                                     THEN datetime(rel.lastPlayed)
                                     ELSE r.lastPlayed
                                 END,
                                 r.avgPing = CASE
                                     WHEN r.avgPing IS NULL THEN rel.avgPing
                                     WHEN rel.avgPing IS NULL THEN r.avgPing
                                     ELSE (r.avgPing + rel.avgPing) / 2.0
                                 END

                    RETURN count(*) as processed";

                var relationshipData = grouped.Select(g => new Dictionary<string, object>
                {
                    ["playerName"] = g.PlayerName,
                    ["serverGuid"] = g.ServerGuid,
                    ["serverName"] = serverLookup.TryGetValue(g.ServerGuid, out var server) ? server.Name : "Unknown",
                    ["game"] = serverLookup.TryGetValue(g.ServerGuid, out var srv) ? srv.Game : "unknown",
                    ["sessionCount"] = g.SessionCount,
                    ["lastPlayed"] = g.LastPlayed.ToString("o"),
                    ["avgPing"] = g.AvgPing.HasValue ? g.AvgPing.Value : null!
                }).ToList();

                await tx.RunAsync(query, new { relationships = relationshipData });
                return true;
            });

            await MarkSessionsSyncedAsync(sessionBatch.Select(s => s.SessionId).ToList(), cancellationToken);
            totalSynced += validSessions.Count;

            var progressPercent = totalPending == 0 ? 100 : (int)(100.0 * totalSynced / totalPending);
            var progressBucket = Math.Min(progressPercent, 100) / progressSampleIntervalPercent * progressSampleIntervalPercent;
            var now = DateTime.UtcNow;
            if (progressBucket > lastLoggedProgressBucket || now - lastProgressLogTime >= progressTimeInterval)
            {
                lastLoggedProgressBucket = Math.Max(lastLoggedProgressBucket, progressBucket);
                lastProgressLogTime = now;
                logger.LogInformation(
                    "Neo4j player-server sync: {ProgressPercent}% ({Synced}/{TotalPending} sessions)",
                    progressPercent, totalSynced, totalPending);
            }

            if (sessionBatch.Count < sessionBatchSize)
            {
                break;
            }
        }

        logger.LogInformation("Synced {Count} player-server sessions to Neo4j", totalSynced);
    }

    private async Task MarkSessionsSyncedAsync(List<int> sessionIds, CancellationToken cancellationToken)
    {
        var syncedAt = DateTime.UtcNow;
        await dbContext.PlayerSessions
            .Where(ps => sessionIds.Contains(ps.SessionId))
            .ExecuteUpdateAsync(s => s.SetProperty(ps => ps.SyncedToNeo4jAt, syncedAt), cancellationToken);
    }

    public class RelationshipMetrics
    {
        public required string Player1Name { get; set; }
        public required string Player2Name { get; set; }
        public DateTime FirstSeen { get; set; }
        public DateTime LastSeen { get; set; }
        public int ObservationCount { get; set; }
        public List<string> ServerGuids { get; set; } = [];
    }

    public class SyncResult
    {
        public bool Success { get; set; }
        public int RelationshipsProcessed { get; set; }
        public int RoundsProcessed { get; set; }
        public TimeSpan Duration { get; set; }
        public string? ErrorMessage { get; set; }
    }
}
