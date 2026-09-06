# Slow API: network-graph clique edges after PR #18

Seq signal `bfstats/Slow as fuck` (>= 10s) keeps paging `GET /stats/relationships/players/{name}/network-graph?depth=2&maxNodes=120` on live `main` (`e0a9a56`). The webhook has no TraceId; traces come from `ElapsedMilliseconds >= 10000`.

## Latest page (this run, 22:17 UTC)

| Time (UTC) | Player | Elapsed | TraceId | Client |
|---|---|---|---|---|
| 22:16:12–26 | `M43238` | **13.6s** | `c2d6b474dea4944d331d3a5235ef7b6f` | `3.214.230.10` UA `Mozilla/5.0` (`is_bot=False`) |
| 22:14:33–43 | `AJesuitPriest` | **10.5s** | `f974ff4bfeb91b57930a0fed455880d1` | Applebot `17.166.155.199` (`is_bot=True`) |
| 22:00:12–25 | `M43238` | **12.9s** | `112d1be1fe05c735079ab4d0be830496` | Applebot `17.166.150.211` (`is_bot=True`) |

Three Seq events each: request start, debug `Getting network graph for {name} with depth 2`, finish HTTP 200. The whole span is the Neo4j read — no SQLite. Same pod `bf42-stats-6b4d7c9b65-fh4tb`. M43238 at 22:16 is a cache miss 16 minutes after the 22:00 Applebot hit (15-minute graph cache).

Cache-warm immediately after: **M43238 41 / 816 in 0.18s** (`41 * 40 / 2 = 820`). **AJesuitPriest 42 / 858 in 0.19s** (`42 * 41 / 2 = 861`).

## Same leftover, same day

Applebot (Safari 17.4, `17.166.*`) walks a new soldier after the 15-minute graph cache expires. M43238 22:16 is a non-Applebot repeat of the same clique.

| Time (UTC) | Player | Elapsed | Nodes / edges (cache-warm) |
|---|---|---|---|
| 22:16 | M43238 | 13.6s | 41 / 816 |
| 22:14 | AJesuitPriest | 10.5s | 42 / 858 |
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
