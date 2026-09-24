namespace api.PlayerRelationships;

/// <summary>
/// Cypher for the player network visualizer. Depth-2 used to induce the full
/// subgraph with a pairwise seek on every discovered name; well-connected
/// veterans turn that into thousands of Expand(Into) hops on Neo4j's 512Mi
/// pagecache. Discovery already knows the tree edges, so the only extra hop
/// is the top-ally clique (at most 15 names).
/// </summary>
internal static class PlayerNetworkGraphQueries
{
    public const int FofPerAlly = 5;

    public static int AllyLimit(int maxNodes) => Math.Clamp(maxNodes / 6, 8, 15);

    public const string Allies = """
        MATCH (p:Player {name: $playerName})-[r:PLAYED_WITH]-(ally:Player)
        RETURN ally.name AS allyName,
               r.sessionCount AS allyWeight,
               r.lastPlayedTogether AS lastPlayed
        ORDER BY r.sessionCount DESC
        LIMIT $allyLimit
        """;

    public const string FriendsOfFriends = """
        UNWIND $allyNames AS allyName
        MATCH (ally:Player {name: allyName})
        CALL {
            WITH ally
            MATCH (ally)-[r2:PLAYED_WITH]-(fof:Player)
            WHERE fof.name <> $playerName AND NOT fof.name IN $allyNames
            RETURN fof.name AS fofName,
                   r2.sessionCount AS fofWeight,
                   r2.lastPlayedTogether AS lastPlayed
            ORDER BY r2.sessionCount DESC
            LIMIT $fofPerAlly
        }
        RETURN allyName, fofName, fofWeight, lastPlayed
        """;

    public const string AllyClique = """
        UNWIND $allyNames AS a
        UNWIND $allyNames AS b
        WITH a, b WHERE a < b
        MATCH (p1:Player {name: a})-[r:PLAYED_WITH]-(p2:Player {name: b})
        RETURN p1.name AS player1,
               p2.name AS player2,
               r.sessionCount AS sessionCount,
               r.lastPlayedTogether AS lastPlayed
        """;

    public static string EdgeKey(string a, string b) =>
        string.Compare(a, b, StringComparison.OrdinalIgnoreCase) <= 0
            ? a + "\x1f" + b
            : b + "\x1f" + a;
}
