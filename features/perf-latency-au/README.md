# Perceived-speed work for distant clients (AU → Finland)

Origin is a single Hetzner node in Finland. This pass was driven by the site feeling
slow from Australia. Measurements below were taken through the Brisbane Cloudflare
edge (`cf-ray: …-BNE`), so they reflect a real Australian visitor rather than a
synthetic local run.

## The shape of the problem

Distance is not the story on its own — *how many times we pay for it* is.

| | measured |
| --- | --- |
| Request served from the edge | **47 ms** |
| Any request that reaches the origin | **~370 ms** |
| Fixed penalty per origin round trip | **~320 ms** |

Almost nothing was edge-cached, and the pages chained their requests, so a page cost
`320ms × chain depth` before it settled. The origin itself is mostly fine: six
concurrent API calls returned in ~420 ms each, the same as sequentially, so the
backend parallelises fine — the front end just wasn't asking in parallel.

## Baseline (production, captured 2026-08-13)

Route timings from the browser's Resource Timing API:

| Route | Time to settled | Dominant cost |
| --- | --- | --- |
| Landing `/v4/servers/bf1942` | ~2.3 s | doc 370 ms uncached + `liveservers` 1080 ms |
| Server details | ~2.85 s | **six serial API calls**, ~390 ms each |
| Player details | ~5.6 s | 1.9 s cold-chunk gap, then two serial waves |

Per-endpoint server time, from Seq (`ElapsedMilliseconds`, ~3 h window):

| Endpoint | n | p50 | p95 |
| --- | --- | --- | --- |
| `/stats/liveservers/bf1942/servers` | 212 | 478 ms | 539 ms |
| `/stats/servers/{name}/banner.png` | 78 | 460 ms | 714 ms |
| `/stats/players/{name}` | ~15 | ~310 ms | ~478 ms |
| `/stats/data-explorer/players/{name}/competitive-rankings` | 1 | 4867 ms | — |

## What was wrong, and what changed

### 1. 50 indexes existed in the migration history but not in the database

The single biggest server-side finding. `Rounds` had **no indexes at all** beyond the
primary-key autoindex, so the landing page's live-server query full-scanned ~707k rows.
Seq's own step logging showed it plainly — steps 1 and 2 were 3–6 ms, step 4 was
451–524 ms of the endpoint's ~500 ms.

Cause: EF's SQLite provider implements `DropColumn` by rebuilding the table, and
several of those rebuilds did not recreate the table's indexes. The model snapshot
still declares every one of them, so EF believes they exist and
`dotnet ef migrations add` produces an empty migration. It does not self-heal.

Sweep of all migrations vs. the live database: **migrations create 119 indexes, the
database has 83, 50 are missing** across 17 tables — including `Users.Email`,
`RefreshTokens.TokenHash`, all of `UserFavoriteServers` and `ServerPlayerRankings`
(zero indexes each), and the tournament tables.

`api/Migrations/20260814093000_RestoreMissingIndexes.cs` restores 49 of them with raw
`CREATE INDEX IF NOT EXISTS` (11 more were correctly skipped — dropped tables or
renamed columns). Up and Down were both verified against a copy of the production
schema.

Two things to know about that migration:

- **`IX_Rounds_ServerGuid` is created non-unique**, unlike its original definition.
  Production currently holds a server with two active rounds, and
  `LiveServersController` is explicitly written to tolerate that ("server merges can
  leave multiple IsActive rounds per ServerGuid"). As a unique index it would fail —
  and migrations run via `Database.Migrate()` at startup, so that would take the pod
  down. `OnModelCreating` and the snapshot were updated to match.
- **`IX_Rounds_ServerGuid_IsActive` is new.** The restored partial index
  (`WHERE IsActive = 1`) turns out to be unreachable from LINQ: SQLite only uses a
  partial index when the SQL contains a literal `IsActive = 1`, and EF renders
  `r.IsActive` as a bare boolean. Measured on a copy of the real 707k-row table:

  | index available | plan | time |
  | --- | --- | --- |
  | none (production today) | `SCAN Rounds` | **72 ms** |
  | `IX_Rounds_ServerGuid_StartTime` | `SEARCH` (then filters every round per server) | 37 ms |
  | `IX_Rounds_ServerGuid_IsActive` | `SEARCH` | **1.7 ms** |
  | partial index + literal `IsActive = 1` | `SEARCH` | 0.05 ms |

  The composite was chosen over rewriting the query because it works with the LINQ as
  written — `r.IsActive == true` risks being optimised straight back to a bare boolean.

  **Applied and verified against the real 18 GB database** (a local dev API picked the
  migration up at startup). All 49 statements succeeded, including every `UNIQUE` one.
  Re-running the live-servers query for all 88 online servers afterwards:

  ```
  SEARCH Rounds USING INDEX IX_Rounds_ServerGuid_IsActive (ServerGuid=?)
  → 12.6–21 ms, was a full scan of 707k rows
  ```

### 2. No cache headers at all on the static bundle

`ui/nginx.conf` set none, so Cloudflare applied its 4 h default and revalidated every
asset against Finland (`cf-cache-status: REVALIDATED`). Content-hashed files now get
`max-age=31536000, immutable`; `index.html` gets `s-maxage` so the edge can serve it
instead of classifying it `DYNAMIC` and sending every visitor to Finland for 2.5 KB of
markup. Also enabled gzip.

### 3. Server details made six serial requests

`ServerDetailsV4.load()` had a comment saying "fire-and-forget the optional feeds" —
but every one was `await`ed in sequence. Only two genuinely depend on the details
payload. Restructured into two waves: everything keyed off `serverName` fires at once,
and the two dependants wait on that one request rather than the whole first wave.

### 4. A render-blocking stylesheet on a third-party origin

`index.html` pulled primeicons from unpkg.com, so first paint waited on a fresh
DNS + TCP + TLS handshake to a host we don't control — and only the tournament pages
use an icon from it. Now imported by the components that need it.

Lazy-loading `DashboardLayout` in `App.vue` (it only renders for `/tournaments/*` and
`/alias-detection`) kept it out of the entry bundle:

| | before | after |
| --- | --- | --- |
| main render-blocking CSS | 135.8 KB (22.2 KB gz) | **113.0 KB (17.6 KB gz)** |
| third-party requests before paint | 1 | **0** |

### 5. Banner PNGs were uncacheable in both directions

`ServerBannerController` sent `no-store` (→ `cf-cache-status: BYPASS`) *and* the client
appended a unique `_t=Date.now()` per page load, so a ~460 ms render happened for every
single view. The header is now `public, max-age=30` (the freshest the stats collector
can make it) and the cache-buster is bucketed to the same 30 s window, so everyone
loading a server in that window shares one URL.

### 6. Rounds removed from the main nav

Not a performance change — the round report only makes sense when you arrive at a
specific round. Routes and inbound links are untouched.

## Still to do — needs the Cloudflare dashboard

**Cloudflare is ignoring the origin's `Cache-Control` on `/stats/*`.** `/stats/app/initialdata`
returns `public, max-age=3600` from the origin and still comes back `cf-cache-status: DYNAMIC`,
because Cloudflare only caches by file extension unless a Cache Rule says otherwise. Every
`[ResponseCache]` attribute in the API — `AppController`, `LandingController`,
`GameTrendsV2Controller`, `RoundsController`, `PlayerBannerController` — is currently doing
nothing at the edge.

Two rules to add:

1. **Match** `http.request.uri.path starts_with "/stats/"` **and** `http.request.method eq "GET"`
   → *Cache eligibility: eligible for cache*, *Edge TTL: use cache-control header from origin*.
   Endpoints that must stay live simply keep sending `no-store` and are unaffected.
2. **Match** `http.request.uri.path eq "/"` or `eq "/index.html"`
   → *Cache eligibility: eligible*, *Edge TTL: respect origin*. This is what activates the
   `s-maxage=300` added to nginx.

Expected effect for a distant visitor: cacheable API calls drop from ~380 ms to ~40 ms,
and the landing document from ~370 ms to near-zero.

## Measured after deploy (2026-08-14)

| | baseline | deployed |
| --- | --- | --- |
| Landing, settled | 2.3 s | ~0.9 s |
| Server details, settled | 2.83 s | **1.20 s** |
| Player details, settled | 5.6 s | 4.9 s (see below) |
| `liveservers` wall time from AU | 870 ms | ~460 ms |
| `liveservers` server time | 462–686 ms | **88–112 ms** |
| └ step 4, the former full scan | 451–524 ms | **76–90 ms** |
| `/assets/*` edge status | `REVALIDATED` | **`HIT`**, 30–45 ms |
| Third-party requests before paint | 1 | 0 |

`liveservers` no longer appears among Seq's 22 slowest endpoints. Server details now
shows four calls starting together at 380 ms and the two dependants at 734 ms — the two
waves, as intended. The player page's 1.9 s cold-chunk gap is gone; chunks resolve in
14 ms.

### Cloudflare Cache Rule — applied

A single zone-wide rule now does it, rather than the two path-specific ones originally
proposed:

- Expression: `http.host eq "bfstats.io"`
- Cache eligibility: **Eligible for cache**
- Edge TTL: **Use cache-control header if present, bypass cache if not**
  (`edge_ttl.mode: bypass_by_default`)

The zone-wide form matters. The first attempt matched only `/` and `/index.html`, which
missed every SPA deep link — nginx serves the same `index.html` for `/v4/players/X` via
`try_files`, but Cloudflare matches on request path, so a visitor arriving from a shared
link or search result still paid full origin latency. Matching the whole zone makes the
origin headers the single source of truth and needs no update when routes change.

"Bypass if not present" rather than "Cloudflare default TTL if not present" is a
deliberate safety choice: `/stats/` contains authenticated routes (`Auth`, `AdminData`,
`AdminJobs`, the comment controllers, team registration) that send no cache header at
all. Defaulting those to cacheable could serve one user's response to another. Bypassing
means only the endpoints that explicitly opt in via `[ResponseCache]` are ever cached.

Verified after applying:

| | status |
| --- | --- |
| `/`, `/v4/servers/bf1942`, `/v4/players/{name}`, `/v4/players` | `HIT` ~38 ms |
| `/assets/*` | `HIT` ~37 ms |
| `app/initialdata`, `systemstats`, `network-pulse`, both banners | `HIT` ~40 ms |
| `liveservers`, `players/{name}` | `BYPASS` |
| `auth/me`, player comments, server comments | `BYPASS` |

Browser, server details, warm: document TTFB **9 ms** (`cfOrigin: 0`), wave 1 starting at
92 ms, `busy-indicator` served from the edge in 4 ms, settled 1614 ms — down from 2832 ms.
The remaining tail is the server banner at ~1.1 s on a cold render; its 30 s TTL means it
re-renders often. Excluding it, the page's data settles at ~910 ms.

## Second pass: ranking queries that ranked everybody

With the above deployed, the player page was left with two endpoints accounting for
almost all of its remaining time — everything else settled by ~1.24 s:

| endpoint | observed |
| --- | --- |
| `data-explorer/players/{name}/competitive-rankings` | 4061 ms |
| `data-explorer/players/{name}/maps` | 2192 ms |

Both shared one shape: to produce **one** player's rank they aggregated and ranked every
player × every map (× every server, for the second), then filtered to that player at the
very end. `WHERE PlayerName` can never use an index there because it applies after the
window function. On production data that is 739k global rows across 1897 maps and 44,766
players, ranked to return about ten.

Fixed by adding a `PlayerMaps` CTE that restricts the ranking to the maps the player has
actually played, before the window function runs. Rank is partitioned by `MapName` and
the output is a single player, so no other map can contribute a row; narrowing cannot
change a rank inside a partition it doesn't remove. The planner then seeks via
`IX_PlayerMapStats_ServerGuid_MapName` instead of scanning.

| query | before | after |
| --- | --- | --- |
| competitive-rankings | 332 ms | 77 ms |
| maps rankings | 219 ms | 66 ms |

Three query sites changed — competitive-rankings does this twice, for the current and
previous period. Results verified **row-for-row identical** to the unrestricted queries
across five players, not just matching row counts.

Local timings run roughly 4x faster than the node, so expect something like 4061 → ~950 ms
and 2192 → ~650 ms in production. Re-measure rather than trusting the extrapolation.

## Verifying after deploy

The bundle and query numbers above were measured directly and hold now. The network and
cache numbers are *predictions* until the change is deployed — they depend on Cloudflare
behaviour that can't be exercised from the local build.

Re-run after deploy:

```bash
curl -s -o /dev/null --compressed -w 'ttfb=%{time_starttransfer}s\n' https://bfstats.io/
```

and check `cf-cache-status` flips from `DYNAMIC` to `HIT` on `/` and from `REVALIDATED`
to `HIT` on `/assets/*`. For the server-side half, the same Seq query that produced the
baseline table:

```
select count(*) as n, percentile(ElapsedMilliseconds,50) as p50, percentile(ElapsedMilliseconds,95) as p95
from stream where Has(ElapsedMilliseconds) and RequestPath like '/stats/%'
group by RequestPath order by p50 desc limit 25
```

The one to watch is `/stats/liveservers/bf1942/servers`: p50 478 ms today, and step 4
should fall from ~470 ms to single digits once the indexes land.
