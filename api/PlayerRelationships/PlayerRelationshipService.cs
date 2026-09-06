using System.Diagnostics;
using api.PlayerRelationships.Models;
using Microsoft.Extensions.Logging;
using Neo4j.Driver;

namespace api.PlayerRelationships;

/// <summary>
/// Service for querying player relationships from Neo4j graph database.
/// Provides high-level queries for player networks, communities, and analytics.
/// </summary>
public class PlayerRelationshipService(
    Neo4jService neo4jService,
    ILogger<PlayerRelationshipService> logger) : IPlayerRelationshipService
{
    private static DateTime ToDateTime(object value)
    {
        if (value is ZonedDateTime zdt) return zdt.ToDateTimeOffset().UtcDateTime;
        if (value is LocalDateTime ldt) return ldt.ToDateTime();
        if (value is DateTimeOffset dto) return dto.UtcDateTime;
        if (value is DateTime dt) return dt;
        return DateTime.Parse(value?.ToString() ?? "");
    }

    private static DateTime? ToNullableDateTime(object? value)
    {
        if (value is null) return null;
        try { return ToDateTime(value); }
        catch { return null; }
    }

    /// <summary>
    /// Get players who most frequently play with the specified player.
    /// </summary>
    public async Task<List<PlayerRelationship>> GetMostFrequentCoPlayersAsync(
        string playerName, 
        int limit = 20,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting frequent co-players for {PlayerName}", playerName);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (p:Player {name: $playerName})-[r:PLAYED_WITH]-(other:Player)
                RETURN other.name AS otherPlayer,
                       r.sessionCount AS sessionCount,
                       r.firstPlayedTogether AS firstPlayed,
                       r.lastPlayedTogether AS lastPlayed,
                       r.servers AS servers
                ORDER BY r.sessionCount DESC
                LIMIT $limit";

            var cursor = await tx.RunAsync(query, new { playerName, limit });
            var results = new List<PlayerRelationship>();

            await foreach (var record in cursor)
            {
                results.Add(new PlayerRelationship
                {
                    Player1Name = playerName,
                    Player2Name = record["otherPlayer"].As<string>(),
                    SessionCount = record["sessionCount"].As<int>(),
                    FirstPlayedTogether = ToDateTime(record["firstPlayed"]),
                    LastPlayedTogether = ToDateTime(record["lastPlayed"]),
                    ServerGuids = record["servers"].As<List<string>>() ?? [],
                    TotalMinutes = 0, // Not tracked in current schema
                    AvgScoreDiff = 0  // Not tracked in current schema
                });
            }

            return results;
        });
    }

    /// <summary>
    /// Get players who play on the same servers but have never played together.
    /// Great for finding potential squad mates.
    /// </summary>
    public async Task<List<string>> GetPotentialConnectionsAsync(
        string playerName,
        int limit = 20,
        int daysActive = 30,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Finding potential connections for {PlayerName}", playerName);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var cutoffDate = DateTime.UtcNow.AddDays(-daysActive);
            
            var query = @"
                // Find servers where the player is active
                MATCH (p:Player {name: $playerName})-[r1:PLAYS_ON]->(s:Server)
                WHERE r1.lastPlayed > $cutoffDate
                
                // Find other players on same servers
                WITH p, s
                MATCH (other:Player)-[r2:PLAYS_ON]->(s)
                WHERE other.name <> $playerName 
                  AND r2.lastPlayed > $cutoffDate
                  AND NOT EXISTS((p)-[:PLAYED_WITH]-(other))
                
                // Count common servers and sort by overlap
                WITH other.name AS otherPlayer, COUNT(DISTINCT s) AS commonServers
                ORDER BY commonServers DESC
                LIMIT $limit
                
                RETURN otherPlayer";

            var cursor = await tx.RunAsync(query, new { playerName, cutoffDate, limit });
            var results = new List<string>();

            await foreach (var record in cursor)
            {
                results.Add(record["otherPlayer"].As<string>());
            }

            return results;
        });
    }

    /// <summary>
    /// Get all servers where two players have played together.
    /// </summary>
    public async Task<List<string>> GetSharedServersAsync(
        string player1Name,
        string player2Name,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting shared servers for {Player1} and {Player2}", player1Name, player2Name);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (p1:Player {name: $player1Name})-[r:PLAYED_WITH]-(p2:Player {name: $player2Name})
                RETURN r.servers AS servers";

            var cursor = await tx.RunAsync(query, new { player1Name, player2Name });
            var record = await cursor.SingleOrDefaultAsync();

            if (record == null)
                return new List<string>();

            return record["servers"].As<List<string>>() ?? new List<string>();
        });
    }

    /// <summary>
    /// Find recent new connections (players who started playing together recently).
    /// </summary>
    public async Task<List<PlayerRelationship>> GetRecentConnectionsAsync(
        string playerName,
        int daysSince = 7,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting recent connections for {PlayerName} in last {Days} days", playerName, daysSince);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var cutoffDate = DateTime.UtcNow.AddDays(-daysSince);

            var query = @"
                MATCH (p:Player {name: $playerName})-[r:PLAYED_WITH]-(other:Player)
                WHERE r.firstPlayedTogether > $cutoffDate
                   OR r.lastPlayedTogether > $cutoffDate
                RETURN other.name AS otherPlayer,
                       r.sessionCount AS sessionCount,
                       r.firstPlayedTogether AS firstPlayed,
                       r.lastPlayedTogether AS lastPlayed,
                       r.servers AS servers
                ORDER BY r.firstPlayedTogether DESC
                LIMIT 50";

            var cursor = await tx.RunAsync(query, new { playerName, cutoffDate });
            var results = new List<PlayerRelationship>();

            await foreach (var record in cursor)
            {
                results.Add(new PlayerRelationship
                {
                    Player1Name = playerName,
                    Player2Name = record["otherPlayer"].As<string>(),
                    SessionCount = record["sessionCount"].As<int>(),
                    FirstPlayedTogether = ToDateTime(record["firstPlayed"]),
                    LastPlayedTogether = ToDateTime(record["lastPlayed"]),
                    ServerGuids = record["servers"].As<List<string>>() ?? [],
                    TotalMinutes = 0,
                    AvgScoreDiff = 0
                });
            }

            return results;
        });
    }

    /// <summary>
    /// Get relationship strength between two players.
    /// Returns null if they've never played together.
    /// </summary>
    public async Task<PlayerRelationship?> GetRelationshipAsync(
        string player1Name,
        string player2Name,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting relationship between {Player1} and {Player2}", player1Name, player2Name);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (p1:Player {name: $player1Name})-[r:PLAYED_WITH]-(p2:Player {name: $player2Name})
                RETURN r.sessionCount AS sessionCount,
                       r.firstPlayedTogether AS firstPlayed,
                       r.lastPlayedTogether AS lastPlayed,
                       r.servers AS servers";

            var cursor = await tx.RunAsync(query, new { player1Name, player2Name });
            var record = await cursor.SingleOrDefaultAsync();

            if (record == null)
                return null;

            return new PlayerRelationship
            {
                Player1Name = player1Name,
                Player2Name = player2Name,
                SessionCount = record["sessionCount"].As<int>(),
                FirstPlayedTogether = ToDateTime(record["firstPlayed"]),
                LastPlayedTogether = ToDateTime(record["lastPlayed"]),
                ServerGuids = record["servers"].As<List<string>>() ?? [],
                TotalMinutes = 0,
                AvgScoreDiff = 0
            };
        });
    }

    /// <summary>
    /// Get network statistics for a player.
    /// </summary>
    public async Task<PlayerNetworkStats> GetPlayerNetworkStatsAsync(
        string playerName,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting network stats for {PlayerName}", playerName);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (p:Player {name: $playerName})
                OPTIONAL MATCH (p)-[r:PLAYED_WITH]-(other:Player)
                WITH p, COUNT(DISTINCT other) AS connectionCount, 
                     SUM(r.sessionCount) AS totalSessions,
                     COLLECT(DISTINCT r.servers) AS allServers
                
                OPTIONAL MATCH (p)-[ps:PLAYS_ON]->(s:Server)
                
                RETURN connectionCount,
                       totalSessions,
                       COUNT(DISTINCT s) AS serverCount,
                       p.firstSeen AS firstSeen,
                       p.lastSeen AS lastSeen,
                       SIZE([item IN REDUCE(s = [], list IN allServers | s + list) WHERE item IS NOT NULL | item]) AS uniqueServersWithFriends";

            var cursor = await tx.RunAsync(query, new { playerName });
            var record = await cursor.SingleOrDefaultAsync();

            if (record == null)
            {
                return new PlayerNetworkStats
                {
                    PlayerName = playerName,
                    ConnectionCount = 0,
                    TotalCoPlaySessions = 0,
                    ServerCount = 0,
                    FirstSeen = DateTime.UtcNow,
                    LastSeen = DateTime.UtcNow
                };
            }

            return new PlayerNetworkStats
            {
                PlayerName = playerName,
                ConnectionCount = record["connectionCount"].As<int>(),
                TotalCoPlaySessions = record["totalSessions"].As<int?>() ?? 0,
                ServerCount = record["serverCount"].As<int>(),
                FirstSeen = ToNullableDateTime(record["firstSeen"]) ?? DateTime.UtcNow,
                LastSeen = ToNullableDateTime(record["lastSeen"]) ?? DateTime.UtcNow
            };
        });
    }

    private const int NetworkGraphAllyLimit = 15;
    private const int NetworkGraphFofPerAlly = 5;

    /// <summary>
    /// Get the player's extended network (friends of friends).
    /// </summary>
    public async Task<PlayerNetworkGraph> GetPlayerNetworkGraphAsync(
        string playerName,
        int depth = 2,
        int maxNodes = 100,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting network graph for {PlayerName} with depth {Depth}", playerName, depth);
        var started = Stopwatch.StartNew();

        var graph = await neo4jService.ExecuteReadAsync(async tx =>
        {
            if (depth <= 1)
            {
                return await BuildDirectNetworkAsync(tx, playerName, maxNodes, depth);
            }

            return await BuildTwoHopNetworkAsync(tx, playerName, depth);
        });

        logger.LogInformation(
            "Network graph for {PlayerName} depth {Depth} returned {NodeCount} nodes {EdgeCount} edges in {ElapsedMs}ms",
            playerName, depth, graph.Nodes.Count, graph.Edges.Count, started.ElapsedMilliseconds);

        return graph;
    }

    private async Task<PlayerNetworkGraph> BuildDirectNetworkAsync(
        IAsyncQueryRunner tx,
        string playerName,
        int maxNodes,
        int depth)
    {
        var directQuery = @"
            MATCH (p:Player {name: $playerName})-[r:PLAYED_WITH]-(other:Player)
            RETURN p.name AS player1,
                   other.name AS player2,
                   r.sessionCount AS sessionCount,
                   r.lastPlayedTogether AS lastPlayed
            ORDER BY r.sessionCount DESC
            LIMIT $maxNodes";

        var cursor = await tx.RunAsync(directQuery, new { playerName, maxNodes });
        var nodes = new Dictionary<string, NetworkNode>(StringComparer.OrdinalIgnoreCase)
        {
            [playerName] = new NetworkNode { Id = playerName, Label = playerName, Degree = 0, Weight = 0 }
        };
        var edges = new List<NetworkEdge>();

        await foreach (var record in cursor)
        {
            var player1 = record["player1"].As<string>();
            var player2 = record["player2"].As<string>();
            var weight = record["sessionCount"].As<int>();
            var lastPlayed = ToNullableDateTime(record["lastPlayed"]) ?? DateTime.MinValue;

            var other = player1 == playerName ? player2 : player1;
            if (!nodes.ContainsKey(other))
            {
                nodes[other] = new NetworkNode { Id = other, Label = other, Degree = 1, Weight = weight };
            }

            edges.Add(new NetworkEdge
            {
                Source = player1,
                Target = player2,
                Weight = weight,
                LastInteraction = lastPlayed
            });
        }

        return new PlayerNetworkGraph
        {
            CenterPlayer = playerName,
            Nodes = nodes.Values.ToList(),
            Edges = edges,
            Depth = depth
        };
    }

    private async Task<PlayerNetworkGraph> BuildTwoHopNetworkAsync(
        IAsyncQueryRunner tx,
        string playerName,
        int depth)
    {
        // Per-ally CALL LIMIT keeps each hop at top-N instead of materialising
        // every PLAYED_WITH neighbour of the 15 allies, then slicing. Edges are
        // the hops themselves plus ally-ally pairs (index lookups), not a second
        // expand of every discovered node's full neighbourhood.
        var twoHopQuery = @"
            MATCH (p:Player {name: $playerName})-[r:PLAYED_WITH]-(ally:Player)
            WITH p, ally, r
            ORDER BY r.sessionCount DESC
            LIMIT $allyLimit
            CALL {
                WITH ally, p
                OPTIONAL MATCH (ally)-[r2:PLAYED_WITH]-(fof:Player)
                WHERE fof <> p
                WITH fof, r2
                ORDER BY r2.sessionCount DESC
                LIMIT $fofLimit
                RETURN collect(
                    CASE WHEN fof IS NULL THEN null
                         ELSE {
                             name: fof.name,
                             weight: r2.sessionCount,
                             lastPlayed: r2.lastPlayedTogether
                         }
                    END
                ) AS fofRaw
            }
            WITH ally, r, [x IN fofRaw WHERE x IS NOT NULL] AS fofs
            RETURN ally.name AS allyName,
                   r.sessionCount AS allyWeight,
                   r.lastPlayedTogether AS allyLastPlayed,
                   fofs";

        var nodesMap = new Dictionary<string, NetworkNode>(StringComparer.OrdinalIgnoreCase)
        {
            [playerName] = new NetworkNode { Id = playerName, Label = playerName, Degree = 0, Weight = 0 }
        };
        var edgeKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var edges = new List<NetworkEdge>();
        var allyNames = new List<string>();

        var twoHopCursor = await tx.RunAsync(twoHopQuery, new
        {
            playerName,
            allyLimit = NetworkGraphAllyLimit,
            fofLimit = NetworkGraphFofPerAlly
        });

        await foreach (var rec in twoHopCursor)
        {
            if (rec["allyName"] == null) continue;
            var allyName = rec["allyName"].As<string>();
            var allyWeight = rec["allyWeight"].As<int>();
            var allyLastPlayed = ToNullableDateTime(rec["allyLastPlayed"]) ?? DateTime.MinValue;

            allyNames.Add(allyName);
            nodesMap[allyName] = new NetworkNode { Id = allyName, Label = allyName, Degree = 1, Weight = allyWeight };
            TryAddEdge(edges, edgeKeys, playerName, allyName, allyWeight, allyLastPlayed);

            foreach (var fof in ReadFofMaps(rec["fofs"]))
            {
                if (!nodesMap.ContainsKey(fof.Name))
                {
                    nodesMap[fof.Name] = new NetworkNode
                    {
                        Id = fof.Name,
                        Label = fof.Name,
                        Degree = 2,
                        Weight = fof.Weight
                    };
                }

                TryAddEdge(edges, edgeKeys, allyName, fof.Name, fof.Weight, fof.LastPlayed);
            }
        }

        if (allyNames.Count > 1)
        {
            var pairs = new List<object>(allyNames.Count * (allyNames.Count - 1) / 2);
            for (var i = 0; i < allyNames.Count; i++)
            {
                for (var j = i + 1; j < allyNames.Count; j++)
                {
                    var a = allyNames[i];
                    var b = allyNames[j];
                    if (string.CompareOrdinal(a, b) < 0)
                        pairs.Add(new { a, b });
                    else
                        pairs.Add(new { a = b, b = a });
                }
            }

            var allyEdgesQuery = @"
                UNWIND $pairs AS pair
                MATCH (p1:Player {name: pair.a})-[r:PLAYED_WITH]-(p2:Player {name: pair.b})
                RETURN p1.name AS player1,
                       p2.name AS player2,
                       r.sessionCount AS sessionCount,
                       r.lastPlayedTogether AS lastPlayed";

            var allyEdgeCursor = await tx.RunAsync(allyEdgesQuery, new { pairs });
            await foreach (var edgeRecord in allyEdgeCursor)
            {
                TryAddEdge(
                    edges,
                    edgeKeys,
                    edgeRecord["player1"].As<string>(),
                    edgeRecord["player2"].As<string>(),
                    edgeRecord["sessionCount"].As<int>(),
                    ToNullableDateTime(edgeRecord["lastPlayed"]) ?? DateTime.MinValue);
            }
        }

        return new PlayerNetworkGraph
        {
            CenterPlayer = playerName,
            Nodes = nodesMap.Values.ToList(),
            Edges = edges,
            Depth = depth
        };
    }

    private static void TryAddEdge(
        List<NetworkEdge> edges,
        HashSet<string> edgeKeys,
        string source,
        string target,
        int weight,
        DateTime lastInteraction)
    {
        if (string.IsNullOrWhiteSpace(source) || string.IsNullOrWhiteSpace(target)
            || string.Equals(source, target, StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        var key = string.CompareOrdinal(source, target) < 0
            ? $"{source}\u001f{target}"
            : $"{target}\u001f{source}";
        if (!edgeKeys.Add(key))
            return;

        edges.Add(new NetworkEdge
        {
            Source = source,
            Target = target,
            Weight = weight,
            LastInteraction = lastInteraction
        });
    }

    private List<(string Name, int Weight, DateTime LastPlayed)> ReadFofMaps(object? value)
    {
        var result = new List<(string Name, int Weight, DateTime LastPlayed)>();
        if (value is not System.Collections.IEnumerable items)
            return result;

        foreach (var item in items)
        {
            if (item is not System.Collections.IDictionary map || !map.Contains("name"))
                continue;

            var nameObj = map["name"];
            if (nameObj is null)
                continue;

            var name = nameObj.As<string>();
            if (string.IsNullOrWhiteSpace(name))
                continue;

            var weight = map.Contains("weight") && map["weight"] is not null
                ? Convert.ToInt32(map["weight"])
                : 0;
            var lastPlayed = map.Contains("lastPlayed")
                ? ToNullableDateTime(map["lastPlayed"]) ?? DateTime.MinValue
                : DateTime.MinValue;
            result.Add((name, weight, lastPlayed));
        }

        return result;
    }

    /// <summary>
    /// Get social statistics for a server.
    /// </summary>
    public async Task<ServerSocialStats> GetServerSocialStatsAsync(
        string serverGuid,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting social stats for server {ServerGuid}", serverGuid);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            // Get various social metrics for the server
            var query = @"
                MATCH (s:Server {guid: $serverGuid})
                OPTIONAL MATCH (p:Player)-[:PLAYS_ON]->(s)
                WITH s, COUNT(DISTINCT p) AS uniquePlayers
                
                // Count relationships between players who play on this server
                OPTIONAL MATCH (p1:Player)-[:PLAYS_ON]->(s)<-[:PLAYS_ON]-(p2:Player)
                WHERE p1 <> p2
                OPTIONAL MATCH (p1)-[r:PLAYED_WITH]-(p2)
                WHERE $serverGuid IN r.servers
                
                WITH s, uniquePlayers, COUNT(DISTINCT r) AS relationshipCount
                
                // Calculate average connections per player
                WITH s, uniquePlayers, relationshipCount,
                     CASE WHEN uniquePlayers > 0 
                          THEN toFloat(relationshipCount * 2) / uniquePlayers 
                          ELSE 0 
                     END AS avgConnections
                
                // Get retention rate (players active in last 30 days vs last 90 days)
                OPTIONAL MATCH (recent:Player)-[r1:PLAYS_ON]->(s)
                WHERE r1.lastPlayed > datetime() - duration('P30D')
                WITH s, uniquePlayers, relationshipCount, avgConnections, 
                     COUNT(DISTINCT recent) AS recentPlayers
                
                OPTIONAL MATCH (older:Player)-[r2:PLAYS_ON]->(s)
                WHERE r2.lastPlayed > datetime() - duration('P90D')
                WITH s, uniquePlayers, relationshipCount, avgConnections, recentPlayers,
                     COUNT(DISTINCT older) AS olderPlayers
                
                RETURN uniquePlayers,
                       avgConnections,
                       CASE WHEN olderPlayers > 0 
                            THEN toFloat(recentPlayers) / olderPlayers 
                            ELSE 0 
                       END AS retentionRate,
                       relationshipCount";

            var cursor = await tx.RunAsync(query, new { serverGuid });
            var record = await cursor.SingleOrDefaultAsync();

            if (record == null)
            {
                return new ServerSocialStats
                {
                    ServerGuid = serverGuid,
                    UniquePlayerCount = 0,
                    AverageConnectionsPerPlayer = 0,
                    CommunityCount = 0,
                    RetentionRate = 0
                };
            }

            // TODO: Add community detection in a future phase
            return new ServerSocialStats
            {
                ServerGuid = serverGuid,
                UniquePlayerCount = record["uniquePlayers"].As<int>(),
                AverageConnectionsPerPlayer = record["avgConnections"].As<double>(),
                CommunityCount = 0, // Will be implemented with community detection
                RetentionRate = record["retentionRate"].As<double>()
            };
        });
    }

    /// <summary>
    /// Get all detected communities.
    /// </summary>
    public async Task<List<PlayerCommunity>> GetCommunitiesAsync(
        int minSize = 3,
        bool activeOnly = true,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting communities with minSize={MinSize}, activeOnly={ActiveOnly}", minSize, activeOnly);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var cutoffDate = activeOnly ? DateTime.UtcNow.AddDays(-30) : DateTime.MinValue;

            // Query for communities (stored as Community nodes after detection)
            var query = @"
                MATCH (c:Community)
                WHERE SIZE(c.members) >= $minSize
                  AND (c.lastActiveDate IS NULL OR c.lastActiveDate > $cutoffDate)
                RETURN c.id AS id,
                       c.name AS name,
                       c.members AS members,
                       c.coreMembers AS coreMembers,
                       c.formationDate AS formationDate,
                       c.lastActiveDate AS lastActiveDate,
                       c.avgSessionsPerPair AS avgSessionsPerPair,
                       c.cohesionScore AS cohesionScore,
                       c.primaryServers AS primaryServers
                ORDER BY c.cohesionScore DESC";

            var cursor = await tx.RunAsync(query, new { minSize, cutoffDate });
            var communities = new List<PlayerCommunity>();

            await foreach (var record in cursor)
            {
                var primaryServersData = record["primaryServers"].As<List<string>>() ?? [];

                communities.Add(new PlayerCommunity
                {
                    Id = record["id"].As<string>(),
                    Name = record["name"].As<string>(),
                    Members = record["members"].As<List<string>>(),
                    CoreMembers = record["coreMembers"].As<List<string>>(),
                    PrimaryServers = primaryServersData,
                    FormationDate = ToDateTime(record["formationDate"]),
                    LastActiveDate = ToDateTime(record["lastActiveDate"]),
                    AvgSessionsPerPair = record["avgSessionsPerPair"].As<double>(),
                    CohesionScore = record["cohesionScore"].As<double>()
                });
            }

            return communities;
        });
    }

    /// <summary>
    /// Get a specific community by ID.
    /// </summary>
    public async Task<PlayerCommunity?> GetCommunityByIdAsync(
        string communityId,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting community {CommunityId}", communityId);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (c:Community)
                WHERE c.id = $communityId
                RETURN c.id AS id,
                       c.name AS name,
                       c.members AS members,
                       c.coreMembers AS coreMembers,
                       c.formationDate AS formationDate,
                       c.lastActiveDate AS lastActiveDate,
                       c.avgSessionsPerPair AS avgSessionsPerPair,
                       c.cohesionScore AS cohesionScore,
                       c.primaryServers AS primaryServers";

            var cursor = await tx.RunAsync(query, new { communityId });
            var record = await cursor.SingleOrDefaultAsync();

            if (record == null)
                return null;

            var primaryServersData = record["primaryServers"].As<List<string>>() ?? [];

            return new PlayerCommunity
            {
                Id = record["id"].As<string>(),
                Name = record["name"].As<string>(),
                Members = record["members"].As<List<string>>(),
                CoreMembers = record["coreMembers"].As<List<string>>(),
                PrimaryServers = primaryServersData,
                FormationDate = ToDateTime(record["formationDate"]),
                LastActiveDate = ToDateTime(record["lastActiveDate"]),
                AvgSessionsPerPair = record["avgSessionsPerPair"].As<double>(),
                CohesionScore = record["cohesionScore"].As<double>()
            };
        });
    }

    /// <summary>
    /// Get communities that a player belongs to.
    /// </summary>
    public async Task<List<PlayerCommunity>> GetPlayerCommunitiesAsync(
        string playerName,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting communities for player {PlayerName}", playerName);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (c:Community)
                WHERE $playerName IN c.members
                RETURN c.id AS id,
                       c.name AS name,
                       c.members AS members,
                       c.coreMembers AS coreMembers,
                       c.formationDate AS formationDate,
                       c.lastActiveDate AS lastActiveDate,
                       c.avgSessionsPerPair AS avgSessionsPerPair,
                       c.cohesionScore AS cohesionScore,
                       c.primaryServers AS primaryServers
                ORDER BY c.cohesionScore DESC";

            var cursor = await tx.RunAsync(query, new { playerName });
            var communities = new List<PlayerCommunity>();

            await foreach (var record in cursor)
            {
                var primaryServersData = record["primaryServers"].As<List<string>>() ?? [];

                communities.Add(new PlayerCommunity
                {
                    Id = record["id"].As<string>(),
                    Name = record["name"].As<string>(),
                    Members = record["members"].As<List<string>>(),
                    CoreMembers = record["coreMembers"].As<List<string>>(),
                    PrimaryServers = primaryServersData,
                    FormationDate = ToDateTime(record["formationDate"]),
                    LastActiveDate = ToDateTime(record["lastActiveDate"]),
                    AvgSessionsPerPair = record["avgSessionsPerPair"].As<double>(),
                    CohesionScore = record["cohesionScore"].As<double>()
                });
            }

            return communities;
        });
    }

    /// <summary>
    /// Get server-player network map for a community (bipartite graph visualization).
    /// Shows which players play on which servers with session count weighting.
    /// </summary>
    public async Task<CommunityServerMap> GetCommunityServerMapAsync(
        string communityId,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting server map for community {CommunityId}", communityId);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            // First, get the community to access members list
            var communityQuery = @"
                MATCH (c:Community)
                WHERE c.id = $communityId
                RETURN c.members AS members, c.coreMembers AS coreMembers";

            var communityCursor = await tx.RunAsync(communityQuery, new { communityId });
            var communityRecord = await communityCursor.SingleOrDefaultAsync();

            if (communityRecord == null)
                throw new ArgumentException($"Community {communityId} not found");

            var members = communityRecord["members"].As<List<string>>();
            var coreMembers = communityRecord["coreMembers"].As<List<string>>() ?? [];

            // Get all player-server relationships for community members
            var mapQuery = @"
                UNWIND $members AS memberName
                MATCH (p:Player {name: memberName})-[ps:PLAYS_ON]->(s:Server)
                RETURN DISTINCT
                       p.name AS playerName,
                       s.guid AS serverGuid,
                       s.name AS serverName,
                       ps.sessionCount AS sessionCount,
                       ps.lastPlayed AS lastPlayed
                ORDER BY p.name, ps.sessionCount DESC";

            var cursor = await tx.RunAsync(mapQuery, new { members });

            var playerNodes = new Dictionary<string, ServerMapNode>();
            var serverNodes = new Dictionary<string, ServerMapNode>();
            var edges = new List<ServerMapEdge>();

            await foreach (var record in cursor)
            {
                var playerName = record["playerName"].As<string>();
                var serverGuid = record["serverGuid"].As<string>();
                var serverName = record["serverName"].As<string>();
                var sessionCount = record["sessionCount"].As<int>();
                var lastPlayed = ToNullableDateTime(record["lastPlayed"]) ?? DateTime.UtcNow;

                // Add player node if not exists
                if (!playerNodes.ContainsKey(playerName))
                {
                    playerNodes[playerName] = new ServerMapNode
                    {
                        Id = playerName,
                        Label = playerName,
                        Type = "player",
                        IsCore = coreMembers.Contains(playerName)
                    };
                }

                // Add server node if not exists
                if (!serverNodes.ContainsKey(serverGuid))
                {
                    serverNodes[serverGuid] = new ServerMapNode
                    {
                        Id = serverGuid,
                        Label = serverName,
                        Type = "server",
                        IsCore = false
                    };
                }

                // Add edge
                edges.Add(new ServerMapEdge
                {
                    Source = playerName,
                    Target = serverGuid,
                    Weight = sessionCount,
                    LastPlayed = lastPlayed
                });
            }

            // Also get co-play relationships between members within the community
            var memberRelQuery = @"
                UNWIND $members AS m1Name
                MATCH (p1:Player {name: m1Name})-[r:PLAYED_WITH]-(p2:Player)
                WHERE p2.name IN $members AND p1.name < p2.name
                RETURN p1.name AS player1,
                       p2.name AS player2,
                       r.sessionCount AS sessionCount,
                       r.lastPlayedTogether AS lastPlayed
                ORDER BY r.sessionCount DESC";

            var memberRelCursor = await tx.RunAsync(memberRelQuery, new { members });
            var memberEdges = new List<ServerMapEdge>();

            await foreach (var record in memberRelCursor)
            {
                memberEdges.Add(new ServerMapEdge
                {
                    Source = record["player1"].As<string>(),
                    Target = record["player2"].As<string>(),
                    Weight = record["sessionCount"].As<int>(),
                    LastPlayed = ToNullableDateTime(record["lastPlayed"]) ?? DateTime.UtcNow
                });
            }

            // Ensure all members exist in playerNodes even if they haven't played on recorded servers yet
            foreach (var m in members)
            {
                if (!playerNodes.ContainsKey(m))
                {
                    playerNodes[m] = new ServerMapNode
                    {
                        Id = m,
                        Label = m,
                        Type = "player",
                        IsCore = coreMembers.Contains(m)
                    };
                }
            }

            return new CommunityServerMap
            {
                Players = playerNodes.Values.ToList(),
                Servers = serverNodes.Values.ToList(),
                Edges = edges,
                MemberEdges = memberEdges
            };
        });
    }

    /// <summary>
    /// Get the server-player network for a specific player.
    /// Returns the player, their teammates, and the servers they play on together.
    /// </summary>
    public async Task<CommunityServerMap> GetPlayerServerMapAsync(
        string playerName,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting server map for player {PlayerName}", playerName);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            // Get the focal player and their teammates (connected players)
            var playerQuery = @"
                MATCH (p:Player {name: $playerName})
                OPTIONAL MATCH (p)-[r:CO_PLAYED_WITH]-(teammate:Player)
                RETURN DISTINCT p.name AS playerName
                UNION ALL
                MATCH (p:Player {name: $playerName})-[r:CO_PLAYED_WITH]-(teammate:Player)
                RETURN DISTINCT teammate.name AS playerName";

            var cursor = await tx.RunAsync(playerQuery, new { playerName });
            var playerNames = new List<string> { playerName };

            await foreach (var record in cursor)
            {
                var name = record["playerName"].As<string>();
                if (!playerNames.Contains(name))
                    playerNames.Add(name);
            }

            // Get all player-server relationships for the focal player and their teammates
            var mapQuery = @"
                UNWIND $playerNames AS name
                MATCH (p:Player {name: name})-[ps:PLAYS_ON]->(s:Server)
                RETURN DISTINCT
                       p.name AS playerName,
                       s.guid AS serverGuid,
                       s.name AS serverName,
                       ps.sessionCount AS sessionCount,
                       ps.lastPlayed AS lastPlayed
                ORDER BY p.name, ps.sessionCount DESC";

            var mapCursor = await tx.RunAsync(mapQuery, new { playerNames });

            var playerNodes = new Dictionary<string, ServerMapNode>();
            var serverNodes = new Dictionary<string, ServerMapNode>();
            var edges = new List<ServerMapEdge>();

            await foreach (var record in mapCursor)
            {
                var pName = record["playerName"].As<string>();
                var serverGuid = record["serverGuid"].As<string>();
                var serverName = record["serverName"].As<string>();
                var sessionCount = record["sessionCount"].As<int>();
                var lastPlayed = ToNullableDateTime(record["lastPlayed"]) ?? DateTime.UtcNow;

                // Add player node if not exists (mark focal player as core)
                if (!playerNodes.ContainsKey(pName))
                {
                    playerNodes[pName] = new ServerMapNode
                    {
                        Id = pName,
                        Label = pName,
                        Type = "player",
                        IsCore = pName == playerName  // Focal player is marked as core
                    };
                }

                // Add server node if not exists
                if (!serverNodes.ContainsKey(serverGuid))
                {
                    serverNodes[serverGuid] = new ServerMapNode
                    {
                        Id = serverGuid,
                        Label = serverName,
                        Type = "server",
                        IsCore = false
                    };
                }

                // Add edge
                edges.Add(new ServerMapEdge
                {
                    Source = pName,
                    Target = serverGuid,
                    Weight = sessionCount,
                    LastPlayed = lastPlayed
                });
            }

            return new CommunityServerMap
            {
                Players = playerNodes.Values.ToList(),
                Servers = serverNodes.Values.ToList(),
                Edges = edges
            };
        });
    }

    /// <summary>
    /// Run community detection algorithm and store results.
    /// Uses pure Cypher-based clustering (no GDS required for Kubernetes deployment).
    /// </summary>
    public async Task<string> DetectAndStoreCommunities(CancellationToken cancellationToken = default)
    {
        logger.LogInformation("Starting community detection (Cypher-based clustering)");

        const int minSessions = 5;
        var runId = Guid.NewGuid().ToString("N");

        try
        {
            // Per-player batched assignment. A single write that COLLECTs every
            // PLAYED_WITH neighbour for every player has OOM'd / deadlocked Neo4j
            // since the co-rounds backfill grew the graph (last successful nightly
            // run stamped Community.formationDate = 2026-08-20).
            logger.LogInformation(
                "Assigning communityIds in batched transactions (minSessions={MinSessions})",
                minSessions);

            await neo4jService.RunAutoCommitAsync(
                $$"""
                MATCH (p:Player)
                CALL {
                    WITH p
                    OPTIONAL MATCH (p)-[rel:PLAYED_WITH]-(teammate)
                    WHERE rel.sessionCount >= {{minSessions}}
                    WITH p, collect(DISTINCT teammate.name) AS teammates
                    WITH p, teammates,
                         CASE WHEN size(teammates) >= 1
                              THEN reduce(min = p.name, n IN teammates | CASE WHEN n < min THEN n ELSE min END)
                              ELSE null
                         END AS leader
                    SET p.communityId = leader
                } IN TRANSACTIONS OF 200 ROWS
                """);

            cancellationToken.ThrowIfCancellationRequested();

            logger.LogDebug("Creating community nodes for run {RunId}", runId);
            var createdCount = await neo4jService.ExecuteWriteAsync(async tx =>
            {
                var createCursor = await tx.RunAsync(CreateCommunitiesQuery, new { runId });
                var createResult = await createCursor.SingleAsync();
                return createResult["createdCommunities"].As<int>();
            });

            cancellationToken.ThrowIfCancellationRequested();

            var syntheticCount = 0;
            try
            {
                logger.LogDebug("Creating synthetic communities for unassigned highly-connected players");
                syntheticCount = await neo4jService.ExecuteWriteAsync(async tx =>
                {
                    var syntheticCursor = await tx.RunAsync(SyntheticCommunitiesQuery, new { runId });
                    var syntheticResult = await syntheticCursor.SingleAsync();
                    return syntheticResult["createdSyntheticCommunities"].As<int>();
                });
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    "Synthetic community creation failed after {CreatedCount} natural communities; swapping in natural results anyway. {ExceptionType}: {Message}",
                    createdCount, ex.GetType().Name, ex.Message);
            }

            cancellationToken.ThrowIfCancellationRequested();

            await neo4jService.ExecuteWriteAsync(async tx =>
            {
                var cursor = await tx.RunAsync(
                    """
                    MATCH (c:Community)
                    WHERE c.detectedRunId <> $runId OR c.detectedRunId IS NULL
                    DELETE c
                    """,
                    new { runId });
                await cursor.ConsumeAsync();
                return 0;
            });

            logger.LogInformation(
                "Community detection completed: created {CreatedCount} natural + {SyntheticCount} synthetic communities",
                createdCount, syntheticCount);
            return $"Successfully detected and created {createdCount + syntheticCount} communities ({createdCount} natural + {syntheticCount} synthetic)";
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Error during community detection");
            throw;
        }
    }

    private const string CreateCommunitiesQuery = """
        MATCH (p:Player)
        WHERE p.communityId IS NOT NULL
        WITH p.communityId AS communityId, COLLECT(p.name) AS members
        WHERE SIZE(members) >= 3 AND SIZE(members) <= 20

        UNWIND members AS m1
        UNWIND members AS m2
        WITH communityId, members, m1, m2
        WHERE m1 < m2
        MATCH (p1:Player {name: m1})-[r:PLAYED_WITH]-(p2:Player {name: m2})
        WITH communityId, members, AVG(r.sessionCount) AS avgSessions,
             MAX(r.lastPlayedTogether) AS lastActive, COUNT(r) AS edgeCount

        WITH communityId, members, avgSessions, lastActive, edgeCount,
             CASE WHEN SIZE(members) <= 1
                  THEN 0.0
                  ELSE toFloat(edgeCount * 2) / (SIZE(members) * (SIZE(members) - 1))
             END AS cohesion

        WHERE cohesion >= 0.3 AND avgSessions >= 2

        UNWIND members AS member
        MATCH (p:Player {name: member})-[r:PLAYED_WITH]-(other:Player)
        WHERE other.name IN members
        WITH communityId, members, avgSessions, lastActive, cohesion, member, COUNT(r) AS degree
        ORDER BY degree DESC
        WITH communityId, members, avgSessions, lastActive, cohesion, COLLECT(member)[0..5] AS coreMembers

        UNWIND members AS member
        MATCH (p:Player {name: member})-[ps:PLAYS_ON]->(s:Server)
        WITH communityId, members, avgSessions, lastActive, cohesion, coreMembers,
             s.guid AS serverGuid, s.name AS serverName, COUNT(*) AS playCount
        ORDER BY playCount DESC
        WITH communityId, members, avgSessions, lastActive, cohesion, coreMembers,
             COLLECT(serverGuid)[0..5] AS serverGuids,
             COLLECT(serverName)[0..5] AS serverNames

        CREATE (c:Community {
            id: 'comm_' + SUBSTRING(communityId, 0, 20),
            name: 'Squad: ' + coreMembers[0],
            members: members,
            coreMembers: coreMembers,
            primaryServers: serverNames,
            formationDate: datetime(),
            lastActiveDate: lastActive,
            avgSessionsPerPair: avgSessions,
            cohesionScore: cohesion,
            detectedRunId: $runId
        })
        RETURN COUNT(c) AS createdCommunities
        """;

    private const string SyntheticCommunitiesQuery = """
        MATCH (p:Player)
        WHERE p.communityId IS NULL
        MATCH (p)-[r:PLAYED_WITH]-(teammate)
        WITH p, teammate, r.sessionCount AS sessions
        ORDER BY p.name, sessions DESC
        WITH p, COLLECT({name: teammate.name, sessions: sessions})[0..7] AS topTeammates
        WHERE SIZE(topTeammates) >= 3
        WITH p, topTeammates, [t IN topTeammates | t.name] AS topNames

        WITH p, topNames, topNames + [p.name] AS allNames,
             reduce(sum = 0, t IN topTeammates | sum + t.sessions) / toFloat(SIZE(topTeammates)) AS avgSessions,
             MAX(datetime()) AS lastActive

        UNWIND allNames AS m1
        UNWIND allNames AS m2
        WITH p, topNames, allNames, avgSessions, lastActive, m1, m2
        WHERE m1 < m2
        OPTIONAL MATCH (p1:Player {name: m1})-[r:PLAYED_WITH]-(p2:Player {name: m2})
        WITH p, topNames, allNames, avgSessions, lastActive, COUNT(r) AS edgeCount

        WITH p, topNames, allNames, avgSessions, lastActive, edgeCount,
             CASE WHEN SIZE(allNames) <= 1
                  THEN 0.0
                  ELSE toFloat(edgeCount * 2) / (SIZE(allNames) * (SIZE(allNames) - 1))
             END AS cohesion

        UNWIND allNames AS member
        MATCH (pl:Player {name: member})-[ps:PLAYS_ON]->(s:Server)
        WITH p, topNames, allNames, avgSessions, lastActive, cohesion,
             s.guid AS serverGuid, s.name AS serverName, COUNT(*) AS playCount
        ORDER BY playCount DESC
        WITH p, topNames, allNames, avgSessions, lastActive, cohesion,
             COLLECT(serverGuid)[0..5] AS serverGuids,
             COLLECT(serverName)[0..5] AS serverNames

        CREATE (c:Community {
            id: 'synth_' + SUBSTRING(p.name, 0, 15) + '_' + SUBSTRING(randomUUID(), 0, 8),
            name: 'Squad: ' + p.name + ' & Co',
            members: allNames,
            coreMembers: [p.name] + topNames[0..4],
            primaryServers: serverNames,
            formationDate: datetime(),
            lastActiveDate: lastActive,
            avgSessionsPerPair: avgSessions,
            cohesionScore: cohesion,
            detectedRunId: $runId
        })
        RETURN COUNT(c) AS createdSyntheticCommunities
        """;

    public async Task<List<Models.ServerPlayerCloseness>> GetServerPlayerClosenessAsync(
        string serverGuid,
        int maxPing = 200,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting player closeness for server {ServerGuid} (maxPing={MaxPing})", serverGuid, maxPing);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (p:Player)-[r:PLAYS_ON]->(s:Server {guid: $serverGuid})
                WHERE r.avgPing IS NOT NULL AND r.avgPing <= $maxPing
                RETURN p.name AS playerName,
                       r.avgPing AS avgPing,
                       r.sessionCount AS sessionCount,
                       r.lastPlayed AS lastPlayed
                ORDER BY r.avgPing ASC";

            var cursor = await tx.RunAsync(query, new { serverGuid, maxPing });
            var results = new List<Models.ServerPlayerCloseness>();

            await foreach (var record in cursor)
            {
                results.Add(new Models.ServerPlayerCloseness(
                    PlayerName: record["playerName"].As<string>(),
                    AvgPing: record["avgPing"].As<double>(),
                    SessionCount: record["sessionCount"].As<int>(),
                    LastPlayed: ToDateTime(record["lastPlayed"])));
            }

            return results;
        });
    }

    public async Task<List<Models.NearbyPlayer>> GetNearbyPlayersAsync(
        string playerName,
        string serverGuid,
        int pingTolerance = 30,
        int limit = 50,
        CancellationToken cancellationToken = default)
    {
        logger.LogDebug("Getting nearby players for {PlayerName} on server {ServerGuid} (tolerance={Tolerance}ms)",
            playerName, serverGuid, pingTolerance);

        return await neo4jService.ExecuteReadAsync(async tx =>
        {
            var query = @"
                MATCH (p:Player {name: $playerName})-[r1:PLAYS_ON]->(s:Server {guid: $serverGuid})<-[r2:PLAYS_ON]-(other:Player)
                WHERE r1.avgPing IS NOT NULL
                  AND r2.avgPing IS NOT NULL
                  AND abs(r1.avgPing - r2.avgPing) <= $pingTolerance
                RETURN other.name AS otherName,
                       r1.avgPing AS playerPing,
                       r2.avgPing AS otherPing,
                       abs(r1.avgPing - r2.avgPing) AS pingDiff,
                       r2.sessionCount AS sessionCount
                ORDER BY pingDiff ASC
                LIMIT $limit";

            var cursor = await tx.RunAsync(query, new { playerName, serverGuid, pingTolerance, limit });
            var results = new List<Models.NearbyPlayer>();

            await foreach (var record in cursor)
            {
                results.Add(new Models.NearbyPlayer(
                    PlayerName: record["otherName"].As<string>(),
                    PlayerPing: record["playerPing"].As<double>(),
                    OtherPing: record["otherPing"].As<double>(),
                    PingDiff: record["pingDiff"].As<double>(),
                    SessionCount: record["sessionCount"].As<int>()));
            }

            return results;
        });
    }
}