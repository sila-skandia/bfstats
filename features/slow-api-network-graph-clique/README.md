# Slow `GET /stats/relationships/players/{name}/network-graph?depth=2`

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/relationships/players/DakDogg's Hotdog Cart/network-graph?depth=2&maxNodes=120`

TraceId `78c190df8d7eb0a91240457e1ae36246` at 2026-10-11 03:00:04–03:01:07Z. HTTP 200, **63.1s**. Safari on iPhone, not a bot. Host `bfstats.io`. Pod `bf42-stats-58994ccf96-cgc74`.

No hop log — the pairwise-seek rewrite (`36ae8da5`) is the running image; the ally-clique bound from closed **PR #45** never landed after `main` was rewritten. Do not reopen #45.

| span | cost | notes |
|---|---|---|
| request start → debug | 2ms | `Getting network graph for DakDogg's Hotdog Cart with depth 2` |
| Neo4j (unlogged) | **~63.1s** | no EF / no Cypher timing |
| HTTP total | **63,080ms** | 200 |

Hourly incremental finished 02:50:29 (61449 / 83054ms). Ranking finished 02:51:17. Collection around the request was 3–4s. Not volume-writer contention.

Same path in the surrounding 24h, all `depth=2&maxNodes=120`:

| When (UTC) | Player | Elapsed | Bot |
|---|---|---|---|
| 10-11 03:01 | DakDogg's Hotdog Cart | **63.1s** | no |
| 10-11 01:39 | Neo | 40.8s | yes |
| 10-10 23:01 | BALDERI | 34.1s | yes |
| 10-10 12:17 | shr00m | 18.5s | yes |
| 10-10 06:21 | Bushwhacker | 28.9s | yes |

Cache hits stay cheap (15 min Redis). Misses on well-connected soldiers stay 10–63s. Closed **PR #45** (Daz28, 27.3s on 09-24) had this same bound.

## Cause

Depth 2 discovers ~15 top allies and up to 5 FoF each (~90 names), then induces the full subgraph:

```
UNWIND $names AS a
UNWIND $names AS b
WITH a, b WHERE a < b
MATCH (p1:Player {name: a})-[r:PLAYED_WITH]-(p2:Player {name: b})
```

That is C(n,2) unique-name seeks plus Expand(Into) on each pair. Veterans have thousands of `PLAYED_WITH` relationships. Neo4j on this node is 512Mi pagecache / 1.25Gi heap on the same Hetzner volume; a few thousand Expand(Into) hops miss cache and land on disk.

The visualizer (`MmPlayerNetworkVisualizer`, default depth=2) uses edges for the force layout and hover adjacency. It does not need FoF–FoF or FoF–other-ally edges. The list view defaults to depth=1 and only needs center–ally weights.

## Change

1. Emit tree edges from the discovery queries (center–ally and ally–FoF), including `lastPlayedTogether`.
2. Keep a pairwise clique, but only among the top allies (`$allyNames`, at most 15 → 105 pairs).
3. Log `Network graph {PlayerName} depth {Depth}: {NodeCount} nodes, {EdgeCount} edges in {ElapsedMs}ms (allies {AlliesMs}ms, fof {FofMs}ms, clique {CliqueMs}ms)` so the next miss names the hop.

No Neo4j index, no pagecache raise, no pragma. Hover on a FoF still highlights the parent ally; hover on an ally still highlights the center, that ally's FoF, and the other top allies they play with.

Do not live-probe `GET /stats/relationships/players/{name}/network-graph?depth=2&maxNodes=120` until a request emits that hop log. After it is live, a still >=10s depth-2 whose new log shows `fof` or `clique` still >=10s is a new bug — do not re-add the full-name pairwise unwind. A slow depth-2 with no new log is the old image.
