# Cold-cache performance audit — landing + player details

Measured 2026-08-16 against production, after the volume-migration perf work
(`f89fb22` … `e62c79e`). Cold state was controlled with `redis-cli FLUSHALL` on the
`hetzner` context plus edge cache-busting. OS page cache was deliberately **not**
dropped — see `PRODUCTION_ISSUES.md` #2.

Three measurement points were used, and keeping them apart is the whole story:

| point | how | what it includes |
|---|---|---|
| **origin** | `curl` on the node → pod IP `10.42.0.158:8080` | server time only |
| **edge** | `curl` from Brisbane → `bfstats.io` | + Cloudflare + AU↔Finland RTT |
| **browser** | Resource Timing on a real page load | + module graph + request ordering |

> **Methodology warning.** `kubectl port-forward` tunnels through the k8s API server.
> Measured from Australia it added a flat **~950ms to every request, including 404s**.
> An early pass using it produced entirely fictitious numbers. Never time this stack
> through a port-forward; run `curl` on the node instead.

---

## Headline

**The API is not slow.** Cold origin server time for the whole landing page is
**12–14ms**, and 7 of the 9 player-details endpoints are **2–8ms**. The
post-migration work landed.

What users experience as slowness is now almost entirely:

1. Cloudflare cache **misses** on content that is perfectly cacheable, and
2. **two** remaining slow queries on player details.

---

## Landing page

| layer | measurement |
|---|---|
| origin, cold Redis | **12–14ms** |
| edge HIT | 42ms |
| edge EXPIRED | **1164ms** |
| real browser load, to first server row | **~2.16s** |

Browser waterfall shows two serial ~1s waits and almost no server time:

```
t=0      document                       TTFB 1069ms
t=1097   liveservers/bf1942/servers      TTFB 1040ms   (origin: 12ms)
t=1171   app/initialdata                 TTFB   16ms   <- edge HIT, proof the mechanism works
```

The module-graph delay called out in the 2026-08-14 audit is **fixed** — the fetch now
starts 28ms after the document instead of 250ms.

### L1. `stale-while-revalidate` is not being honoured

`liveservers` sends `s-maxage=20, stale-while-revalidate=15`. Sampled repeatedly:

```
run 1: 1164ms  cf=EXPIRED
run 2:    42ms  cf=HIT  age=2
run 3:    41ms  cf=HIT  age=4
```

Under a working SWR the expiry would be absorbed in the background and *nobody* would
see 1164ms. `cf=EXPIRED` with a full origin round trip means Cloudflare revalidated
**synchronously**. With a 20s TTL, every visitor arriving in a gap pays it.

Raising `s-maxage` is the cheap mitigation; the UI already polls every 30s, so the
20s TTL buys freshness nobody consumes.

---

## Player details

Real browser load: **~4.06s**, 9 API calls.

Cold origin server time, by endpoint:

| endpoint | LtHawk | Chumpy | FlameHaze | ImmaculateConstellation |
|---|---|---|---|---|
| `players/{name}` | 726 | 464 | 722 | 526 |
| `data-explorer/.../maps` | 767 | 1376 | 861 | **2708** |
| `communities/players/{name}` | 8 | | | |
| `gamification/.../achievement-groups` | 6 | | | |
| `players/{name}/map-stats` | 7 | | | |
| `gamification/.../hero-achievements` | 6 | | | |
| `data-explorer/.../activity-heatmap` | 4 | | | |
| `players/{name}/comments` | 6 | | | |

Two endpoints own everything. The other seven are free.

### P1. `data-explorer/players/{name}/maps` scans 690 servers to rank 7 — **worst offender**

One statement is **2517ms of the 2707ms** request. It ranks the player on each map by
computing `ROW_NUMBER()` over **every player** on **every server for the game**, then
filters to one player at the very end.

The `IN` list is built from *all* servers for the game and passed as **690 literal
parameters — twice** ([DataExplorerServiceOptimized.cs:939](api/DataExplorer/DataExplorerServiceOptimized.cs:939)).
`playerStats`, materialised 40 lines earlier, already knows the servers the player
actually appears on:

```
bf1942 servers:                     690
servers ImmaculateConstellation is on: 8   (7 within the game)
```

The plans differ on exactly this:

```
CURRENT  SEARCH PlayerMapStats USING COVERING INDEX ...MapRanking_Covering (MapName=?)
FIXED    SEARCH PlayerMapStats USING COVERING INDEX ...MapRanking_Covering (MapName=? AND ServerGuid=?)
```

Benchmarked on production data via the `sqlite-tools` sidecar, literal `IN` lists both
sides so the plans are comparable:

| scope | wall | rows |
|---|---|---|
| all 690 game servers | **52.0s** | 49 |
| the 7 the player is on | **24.7s** | 49 |

**Identical output, 2.1× faster.** (Both absolute numbers are inflated ~10× by
contending with the live app for the volume's ~691 IOPS; the ratio is the signal.)

The fix is local — derive the ranking scope from `playerStats` instead of from
`Servers`:

```csharp
// playerStats already names every server this player appears on. Ranking any other
// server only builds partitions the player isn't in, so they cost scan time and
// cannot change a single rank. 690 -> a handful.
var rankedGuids = playerStats.Select(ps => ps.ServerGuid).Distinct().ToList();
var rankingGuidParams = string.Join(", ", rankedGuids.Select((_, i) => $"@p{i + 2}"));
var playerNameParamIndex = 2 + rankedGuids.Count;
// ...
rankingParams.AddRange(rankedGuids.Cast<object>());
```

The `PlayerMaps` CTE can use the same narrowed list: it is already filtered to
`PlayerName`, so restricting it to servers derived from that player's own rows selects
the identical map set.

This is the same class of bug as `f15f9cd` ("without 90-parameter IN scans"), which
fixed it for live servers. It is worth grepping the other five `Select(s => s.Guid)`
sites in `DataExplorerServiceOptimized.cs` for the same shape.

### P2. `players/{name}` — 19 sequential round trips

464ms for Chumpy, of which 333ms is SQL spread over **19 statements**. No single
disaster; the shape is the cost. Largest contributor is one 207ms `ServerTotals` CTE
over `ServerPlayerRankings`. On a volume where every cache miss is a ~1.4ms network
round trip and a single query cannot exceed ~691 reads/sec, 19 serial statements is
the thing to attack — not any one of them.

### P3. `map-stats` is serialised behind `players/{name}` for no reason

```
t=322   players/Chumpy                     ends 3613
t=3617  players/Chumpy/map-stats?…          ends 4061   <- starts only after the above
```

[PlayerDetailsV4.vue:86](ui/src/views/v4/PlayerDetailsV4.vue:86) awaits
`fetchPlayerStats` before `fetchPlayerMapStats`. The 2026-08-14 audit flagged the
dependency as "real but weak" — it is now **entirely gone**: `primaryGameId` is a
hardcoded `'bf1942'` constant at
[PlayerDetailsV4.vue:369](ui/src/views/v4/PlayerDetailsV4.vue:369).

Firing both in parallel removes ~440ms from every player page. The other eight calls
already fire together in one wave, so the whole-page gate from the previous audit is
fixed — this one straggler is what's left.

### P4. Two player endpoints are `cf-cache-status: BYPASS`

`communities/players/{name}` and `gamification/player/{name}/achievement-groups` send
**no `Cache-Control` header at all**
([GamificationController.cs:38](api/Controllers/GamificationController.cs:38) has no
cache attribute), so Cloudflare refuses to cache them. Origin cost is **3–8ms**; every
visitor pays a full ~1s round trip for them anyway. Adding `[EdgeCache]` is a one-line
change per endpoint.

### P5. The player Redis cache expires before it can be used

`e62c79e` added Redis caching for `player_stats:{name}` with
`TimeSpan.FromSeconds(30)` ([PlayerStatsService.cs:519](api/Players/PlayerStatsService.cs:519)).
A `FLUSHALL`-then-browse cycle showed the cache holding **30 keys total and not one
player key** — at 30s they expire faster than a second visitor arrives. For a payload
that costs 464–726ms to build and changes only when the player plays, this TTL makes
the cache close to dead weight. Minutes, not seconds.

---

## Cross-cutting

### X1. Cloudflare is overwriting `max-age=0` with `max-age=14400` — correctness bug

`EdgeCacheAttribute`'s entire purpose is `max-age=0, s-maxage=N`: the edge absorbs
traffic while the browser still revalidates, so an SPA route change never serves a
stale payload from disk. Verified end to end:

```
origin (node -> pod)   Cache-Control: public, max-age=0, s-maxage=20, stale-while-revalidate=15
edge   (bfstats.io)    Cache-Control: public, max-age=14400, s-maxage=20, stale-while-revalidate=15
```

The ingress does not touch cache headers (checked). By elimination this is
Cloudflare's zone-level **Browser Cache TTL**, set to 4 hours, which rewrites
`max-age` on proxied responses.

Consequence: live server data and player profiles sit in visitors' browser disk cache
for **4 hours**. This silently defeats `EdgeCacheAttribute` and undoes `3b2a471`
("prevent stale browser caching"). `app/initialdata` is affected too (`3600` → `14400`).

**Fix is a dashboard setting, not code:** Caching → Configuration → Browser Cache TTL
→ *Respect Existing Headers*. Worth a note in `NODE_TUNING.md`, since like the other
entries there no manifest captures it.

### X2. The SPA shell is cached per-URL though it is byte-identical everywhere

```
/                                  1aae713ad84f6ed04d50f57feae90b15
/v4/players/Chumpy                 1aae713ad84f6ed04d50f57feae90b15
/v4/players/SomeoneElse            1aae713ad84f6ed04d50f57feae90b15
/v4/servers/detail/whatever        1aae713ad84f6ed04d50f57feae90b15
```

One file, and Cloudflare holds a separate 5-minute (`s-maxage=300`) entry per URL.
The landing page is visited often enough to stay warm; individual player pages are not:

```
/v4/players/Chumpy    45ms  HIT     (just visited)
/v4/players/LtHawk    41ms  HIT     (just visited)
/v4/players/Snail   1082ms  MISS
/v4/players/Lecter  1154ms  MISS
```

So a player page nobody opened in the last five minutes spends **~1.1s fetching an
HTML file the edge already has under another key**, before a single line of JS runs.

Two options: raise `s-maxage` on the shell substantially (it only changes on deploy,
and `last-modified` is already deploy-stamped), or add a Cloudflare Cache Rule
normalising the cache key for SPA routes to a single entry. The second is strictly
better and fixes the long tail permanently.

### X3. WAL is at 261MB and still growing

`PRODUCTION_ISSUES.md` lists WAL growth as *open/watch* at 216MB. It is now
**261,212,152 bytes** against a 4MB `wal_autocheckpoint` target — 65× over. Every
reader consults the WAL index, so this is a slow tax on every query above. Unchanged
in cause since it was logged; worth its own investigation as that entry says.

---

## Ranked by payoff

| # | Change | Where | Expected | Status |
|---|---|---|---|---|
| 1 | Browser Cache TTL → *Respect Existing Headers* | Cloudflare dashboard | fixes 4h stale data; unblocks the whole `EdgeCache` design | **dashboard — outstanding** |
| 2 | Normalise SPA shell cache key (or raise its `s-maxage`) | Cloudflare Cache Rule | −1.1s on every cold player/server page | **dashboard — outstanding** |
| 3 | Scope the ranking `IN` to the player's own servers | `DataExplorerServiceOptimized.cs:944` | 2.1× on the worst endpoint, verified identical output | applied |
| 4 | Fire `map-stats` in parallel | `PlayerDetailsV4.vue:72` | −440ms | applied |
| 5 | `[EdgeCache]` on `communities` + achievement endpoints | 2 controllers | −1s each on cold loads | applied |
| 6 | Raise `player_stats` TTL from 30s to minutes | `PlayerStatsService.cs:519` | makes an already-written cache actually work | applied — 5 min |
| 7 | Raise `liveservers` `s-maxage` above 20s | `LiveServersController.cs:31` | fewer visitors eating the 1164ms EXPIRED path | applied — 30s |
| 8 | Collapse the 19 statements in `players/{name}` | `PlayerStatsService.cs` | biggest remaining *server* win, biggest effort | not attempted |

Nothing above requires touching a SQLite pragma, a connection string, or a container
limit — the three things that have taken this node down before.

### What landed (2026-08-16)

Code changes 3–7, plus test coverage:

- `tests/api/DataExplorer/PlayerMapRankingsTests.cs` — new. Pins the invariant that makes
  #3 safe: narrowing by `ServerGuid` must **not** narrow by `PlayerName`. One test ranks
  the player against rivals on their own server, another proves a high-scoring stranger
  on an untouched server cannot displace them.
- `EdgeCacheAttributeTests` — the previously-BYPASS player endpoints are now in the
  theory, so dropping the attribute is a failure rather than a silent regression.

Two expectation-only test updates were needed, both asserting values changed on purpose:
`liveservers` s-maxage 20 → 30, and the `player_stats` TTL 30s → 5min.

**#1 and #2 are the two largest wins on the list and neither is in this repo.** Until the
Browser Cache TTL is changed, #5, #6 and #7 are all still capped by a 4-hour browser
`max-age` that overrides what the API asks for.
