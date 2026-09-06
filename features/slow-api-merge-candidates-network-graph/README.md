# Slow API: merge-candidates + player network-graph

Seq signal `bfstats/Slow as fuck` (>= 10s) fired at 08:59 UTC on 2026-09-06.

## What paged

| Time (UTC) | Path | Elapsed |
|---|---|---|
| 08:59:36 | `GET /stats/admin/data/servers/merge-candidates?game=bf1942` | **11.6s** |
| 08:58:45 | `GET /stats/relationships/players/lop\|arcy/network-graph?depth=2&maxNodes=120` | **19.2s** |

The webhook has no TraceId. Both traces were loaded from Seq (`ElapsedMilliseconds >= 10000`).

Same window also has a follow-up merge-candidates call at 08:59:41 (3.9s) — the first call paid the full `PlayerSessions` scan.

## merge-candidates (this alert)

Trace `f8d4fdef0ffd3e90afced3b4c35e8646`:

- Request start 08:59:25
- `Executed DbCommand (2ms)` — SQLite `ExecuteReader` only; the real work is the first `sqlite3_step`
- Request finish 08:59:36 (11.6s)

The query was:

```sql
FROM Servers s
LEFT JOIN PlayerSessions ps ON ps.ServerGuid = s.Guid AND ps.IsDeleted = 0
WHERE @p0 = '' OR s.Game = @p0
GROUP BY s.Guid
```

plus `julianday()` on every session. That is a full scan of `PlayerSessions` (the bulk of the ~24GB volume) just to rank a handful of duplicate GUIDs.

Yesterday 21:36 UTC the same endpoint was 9.3s.

### Fix

1. Group `Servers` in memory for duplicate `(Game, Ip, Port, Name)` — the table is tiny.
2. If there are no duplicates, return `[]` without touching sessions.
3. Session count / first / last only for those GUIDs (`IX_PlayerSessions_ServerGuid_*`).
4. Playtime from `PlayerServerStats` (already weekly-aggregated, indexed on `ServerGuid`).

## network-graph (repeat 10s+ offender)

`depth=2` is the default on `MmPlayerNetworkVisualizer`. Seq shows 15–56s cache misses all day (`fracula` 56s, `YxngWxlf` 36s, `Galaxy_S26_Ultra` 26s). Depth-1 teammates on the same players are typically <3s.

The old Cypher:

- `OPTIONAL MATCH` every `PLAYED_WITH` neighbour of the top 15 allies, then `collect(...)[0..5]`
- a second query that expanded **all** neighbours of every discovered node and filtered with `IN`

On a well-connected soldier that is tens of thousands of relationships. Neo4j on this node is 512Mi pagecache / 1.25Gi heap.

### Fix

- First query: top N direct allies only (same shape as depth 1).
- Second query: per-ally `CALL { ... ORDER BY sessionCount DESC LIMIT 5 }` so FoF expansion is capped in the planner, not after materialisation.
- Third query: edges among the discovered names only, via pairwise `Player.name` seeks (`UNWIND` × `UNWIND` + `MATCH (p1 {name: a})-[r]-(p2 {name: b})`). That restores ally cliques and hover edges in `MmPlayerNetworkVisualizer` without expanding every `PLAYED_WITH` neighbour and filtering with `IN`.

Cache remains 15 minutes (`CachedPlayerRelationshipService`).
