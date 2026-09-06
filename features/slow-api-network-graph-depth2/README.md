# Slow API: network-graph depth 2 and merge-candidates

## Trigger

Seq `bfstats/Slow as fuck (>= 10 seconds)` at 2026-09-06 09:12 UTC.

- `GET /stats/relationships/players/maskitou/network-graph?depth=2&maxNodes=120`
- 12,580 ms, HTTP 200
- TraceId `1ff628d2393d2ddecd7dffdb8d0faf6d`
- Applebot. Same path has been 13–56s all morning for other player names.

A second path the same hour:

- `GET /stats/admin/data/servers/merge-candidates?game=bf1942` at 08:59 UTC
- 11,640 ms, TraceId `f8d4fdef0ffd3e90afced3b4c35e8646`

## Cause

### Network graph

Depth 2 did two unbounded Neo4j expansions:

1. `OPTIONAL MATCH (ally)-[:PLAYED_WITH]-(fof)` over the top 15 allies, then sort the full cartesian and slice to 5 names each.
2. For every discovered node (~90), expand **all** `PLAYED_WITH` neighbours and filter to the in-graph set.

Neo4j sits on the same Hetzner volume with a 512M page cache. A popular player's allies have thousands of edges; the second query scanned tens of thousands of relationships from disk.

The Seq trace has no intermediate spans — the whole 12.5s is that read transaction.

### Merge candidates

`FindDuplicateCandidatesAsync` left-joined **all** `PlayerSessions` onto **all** `Servers` and ran `julianday()` per row. EF's "Executed DbCommand (2ms)" is time-to-open-reader; the first `sqlite3_step` did the scan.

## Fix

- Two-hop graph: per-ally `CALL { ... ORDER BY sessionCount DESC LIMIT 5 }`. Edges are the hops plus ally-ally pair lookups (at most 105 name-index matches). No all-neighbour expand.
- Controller depth cap is 2 (depth 3 was accepted but still ran the 2-hop query).
- Merge candidates: find duplicate `(Game, Ip, Port, Name)` groups from `Servers` first; `COUNT/MIN/MAX` only those GUIDs on `PlayerSessions`; playtime from `PlayerServerStats`.
- Request-path timing log: `Network graph for {PlayerName} ... in {ElapsedMs}ms`.

Cache (15 min, per player) does not help crawlers hitting a new name each time. The query change is the fix.
