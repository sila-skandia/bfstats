# Slow API: network-graph clique edges after PR #18

Seq signal `bfstats/Slow as fuck` (>= 10s) keeps paging `GET /stats/relationships/players/{name}/network-graph?depth=2&maxNodes=120` on live `main` (`e0a9a56`). The webhook has no TraceId; traces come from `ElapsedMilliseconds >= 10000`.

## Latest page (this run)

| Time (UTC) | Player | Elapsed | TraceId | Client |
|---|---|---|---|---|
| 22:00:12–25 | `M43238` | **12.9s** | `112d1be1fe05c735079ab4d0be830496` | Applebot `17.166.150.211` (`is_bot=True`) |

Four Seq events: request start, debug `Getting network graph for M43238 with depth 2`, finish HTTP 200, OTel GET span. The whole 12.9s is the Neo4j read — no SQLite.

Cache-warm immediately after: **41 nodes / 816 edges in 0.20s**. Complete clique is `41 * 40 / 2 = 820`.

## Same leftover, same day

Applebot (Safari 17.4, `17.166.*`) walks a new soldier after the 15-minute graph cache expires:

| Time (UTC) | Player | Elapsed | Nodes / edges (cache-warm) |
|---|---|---|---|
| 22:00 | M43238 | 12.9s | 41 / 816 |
| 21:41 | Brazil_Player | 13.4s | 44 / 930 |
| 20:47 | SuPa da soldier | 12.1s | 42 / 810 |
| 20:34 | {SoH} Casca | 12.1s | 49 / 1118 |
| 19:36 | Catpain Blackadder | 12.7s | 49 / 871 |
| 18:21 | R4yderPSG | 10.7s | 38 / 703 |
| 18:12 | [PHX] Flettnerman | 14.3s | 35 / 594 |
| 17:09 | imhotep | 20.8s | 52 / 1224 |
| 16:50 | H_ngm_n | 14.1s | 47 / 1035 |
| 12:21 | Phoenix | 17.5s | 40 / 780 |

`jozefciezniak` depth 1 = **24ms**, depth 2 = **6.5s**. Cost is the two-hop edge materialisation, not the player.

## Why PR #18 was not enough

#18 capped FoF expansion (`CALL { ... LIMIT 5 }`) and restored clique edges with:

```
UNWIND $names AS a
UNWIND $names AS b
WITH a, b WHERE a < b
MATCH (p1:Player {name: a})-[r:PLAYED_WITH]-(p2:Player {name: b})
```

That is N-choose-2 name-constraint seeks against Neo4j (512Mi pagecache, 1.25Gi heap, network volume). M43238 is 820 seeks; Phoenix is 780. Depth 1 never does the cartesian and stays under 30ms.

## Fix

- One two-hop Cypher: top 15 allies, per-ally top 5 FoF. Hop edges come from that result.
- Ally-ally edges only (at most `15 * 14 / 2 = 105` seeks), not every pair among the discovered ~40 names.
- Cap accepted `depth` at 2 — that is the implemented query.
- Log node/edge counts and elapsed so the next Seq page shows the query shape.

`MmPlayerNetworkVisualizer` hover highlighting uses hop edges. A 780-edge hairball is not required for that.

Cache remains 15 minutes (`CachedPlayerRelationshipService`).

Do not live-probe `/stats/relationships/players/*/network-graph?depth=2` after cache expiry until this is deployed. Cache-warm repeats (~0.2s) are fine for node/edge counts.
