# Slow `GET /stats/relationships/players/{name}/network-graph?depth=2`

Seq signal `bfstats/Slow as fuck (>= 10 seconds)`.

## Trace

`GET /stats/relationships/players/Daz28/network-graph?depth=2&maxNodes=120`

TraceId `ac4695c90b149a65f40a1424dfc0b0c3` at 2026-09-24 21:52:41–21:53:08Z. HTTP 200, **27.3s**. Real Edge browser, not a bot. Same millisecond `depth=1&maxNodes=100` for Daz28 finished in **18ms**. Pod `bf42-stats-7fdc675f5-m7kjn` (Application started 22:13:16Z 09-23). No hourly/daily writer overlap; collection cycles around the request were 3–4s.

The pairwise-seek rewrite from `36ae8da5` is already the running image. It is not leftover 5e18.

| span | cost | notes |
|---|---|---|
| depth-1 teammates | **18ms** | same player, same second |
| depth-2 start → debug | 2ms | `Getting network graph for Daz28 with depth 2` |
| Neo4j (unlogged) | **~27.3s** | no EF / no Cypher timing |
| HTTP total | **27,344ms** | 200 |

Same path the same day, all `depth=2&maxNodes=120`:

| When (UTC) | Player | Elapsed | Bot |
|---|---|---|---|
| 21:53 | Daz28 | 27.3s | no |
| 21:08 | Pet error | 7.6s | yes |
| 20:30 | RoyLeesen | 20.6s | yes |
| 20:29 | Andrey | 27.8s | yes |
| 19:51 | Bob_0403 | 11.5s | yes |
| 16:35 | GI fuzzy nuts | 28.6s | yes |
| 14:14 | VeganerJager Killer | 27.8s | yes |
| 10:43 | Fran | 26.9s | yes |

Cache hits stay cheap (15 min Redis). Misses on well-connected soldiers stay 10–47s.

## Cause

Depth 2 discovers ~15 top allies and up to 5 FoF each (~90 names), then induced the full subgraph:

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

After this is the running image, a still >=10s depth-2 whose new log shows `fof` or `clique` still >=10s is a new bug — do not re-add the full-name pairwise unwind. A slow depth-2 with no new log is the old image.
