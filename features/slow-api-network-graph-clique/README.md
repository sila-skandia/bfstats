# Slow API: player network-graph clique seeks

Seq signal `bfstats/Slow as fuck` (>= 10s) fired at 03:13 UTC and 01:32 UTC on 2026-09-07.

## What paged

| Time (UTC) | Path | Elapsed | Client |
|---|---|---|---|
| 03:13:14 | `GET /stats/relationships/players/little CARMINE/network-graph?depth=2&maxNodes=120` | **56.5s** | Applebot |
| 01:32:14 | `GET /stats/relationships/players/Childhood Memory/network-graph?depth=2&maxNodes=120` | **19.5s** | Applebot |
| 00:32:18 | `GET /stats/relationships/players/Sweet Potatoes!/network-graph?depth=2&maxNodes=120` | **12.0s** | Applebot |
| 00:01:11 | `GET /stats/relationships/players/Emmanuel Macron/network-graph?depth=2&maxNodes=120` | **18.7s** | Chrome |

Trace for the 03:13 page: `3871322047ff33cab79009e1fd3bf5b6`. Request start 03:12:18, `Getting network graph` (cache miss), finish 03:13:14 HTTP 200.

A cache-warm repeat of little CARMINE after the miss was **0.20s** with **57 nodes / 1097 edges**. The site was otherwise healthy (homepage 0.16s, 95 live servers `lastUpdated` 03:15:16Z, players 1.14s).

Every `ElapsedMilliseconds >= 10000` event since 18:21 UTC 09-06 is this endpoint at `depth=2`, except leftover `/stats/rounds?serverName=` scans that belong on `dad2`.

## Why it is still slow after PR #18

`2f725b2` (PR #18) stopped expanding every `PLAYED_WITH` neighbour and filtering with `IN`. It replaced that with pairwise `Player.name` seeks:

```
UNWIND $names AS a
UNWIND $names AS b
WITH a, b WHERE a < b
MATCH (p1:Player {name: a})-[r:PLAYED_WITH]-(p2:Player {name: b})
```

`$names` is **every discovered node** (center + 15 allies + FoF). Childhood Memory is 53 names: **1,378** Neo4j seeks. little CARMINE is 57 names: **1,596** seeks, **56.5s** cold. Those players form a near-clique (1,097 edges / 1,596 possible on little CARMINE; 1,237 / 1,378 on Childhood Memory), so most seeks hit a relationship. Neo4j lives on the same network-attached volume as SQLite (512Mi pagecache). Cold, that cartesian is 10–56s. Warm, the same payload is 0.2s.

## Fix

1. Keep the two-hop node set (top 8–15 allies, top 5 FoF each, allies excluded from FoF).
2. Emit tree edges from those hops (center-ally, ally-FoF).
3. Clique **allies only** — 15 names is 105 seeks, not 1,378–1,596.
4. Clamp API `depth` to 1–2 (depth 3 was accepted and then ignored).
5. Cache the graph for 1 hour (was 15 minutes). Applebot recrawls the same soldiers inside the old window.

The visualizer still gets ally cliques for hover. It no longer gets FoF–FoF hairball edges; those were the bulk of the 1,237 and are not needed to place the 2nd-degree nodes.

## Not this page

- SignalR `ClientTimeoutInterval` at 01:15 UTC is a separate leftover (`69a8`).
- `/stats/rounds?serverName=` leftover stays on `dad2`.
