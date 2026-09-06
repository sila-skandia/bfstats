# Slow API: network-graph clique edges after PR #18

Seq signal `bfstats/Slow as fuck` (>= 10s) fired again at 14:10 UTC on 2026-09-06
(same leftover as Phoenix at 12:22). Production still runs the PR #18 pairwise
clique because this rewrite is not merged yet.

## What paged

| Time (UTC) | Path | Elapsed |
|---|---|---|
| 14:10:43 | `GET /stats/relationships/players/Lt.  Tommy Gunn/network-graph?depth=2&maxNodes=120` | **15.7s** |
| 12:21:57 | `GET /stats/relationships/players/Phoenix/network-graph?depth=2&maxNodes=120` | **17.5s** |

Trace `af11db6419af5dd9a0cf025ac9d8e059` (Tommy Gunn): start 14:10:27, debug,
finish 14:10:43. HTTP 200. Four Seq events, all in the request span — Neo4j
read, no SQLite. Live cache-warm payload afterwards was **70 nodes / 1278
edges** (52% of a 2415-pair clique). Depth 1 for the same player is 30 nodes /
29 edges and ~180ms.

Trace `c0211c2672db2de5328c29a589047d02` (Phoenix): start 12:21:39, debug,
finish 12:21:57. HTTP 200. Live payload **40 nodes / 780 edges** — a complete
clique (`40 * 39 / 2 = 780`).

Same window as Phoenix: `jozefciezniak` depth 1 = **24ms**, depth 2 = **6.5s**.
Cost is the two-hop edge materialisation, not the node or the player.

## Why PR #18 was not enough

#18 capped FoF expansion (`CALL { ... LIMIT 5 }`) and restored clique edges with:

```
UNWIND $names AS a
UNWIND $names AS b
WITH a, b WHERE a < b
MATCH (p1:Player {name: a})-[r:PLAYED_WITH]-(p2:Player {name: b})
```

Phoenix's live payload is **40 nodes / 780 edges** — a complete clique (`40 * 39 / 2 = 780`). That is 780 name-constraint seeks against Neo4j (512Mi pagecache, network volume). Depth 1 for the same players stays under 30ms because it never does the cartesian.

## Fix

- One two-hop Cypher: top 15 allies, per-ally top 5 FoF. Hop edges come from that result.
- Ally-ally edges only (at most `15 * 14 / 2 = 105` seeks), not every pair among the discovered ~40 names.
- Cap accepted `depth` at 2 — that is the implemented query.
- Log node/edge counts and elapsed so the next Seq page shows the query shape.

`MmPlayerNetworkVisualizer` hover highlighting uses hop edges. A 780-edge hairball is not required for that.

Cache remains 15 minutes (`CachedPlayerRelationshipService`).
