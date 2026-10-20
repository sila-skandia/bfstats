# Browser load performance and asset prefetch

What opening a level in the browser costs today, measured on the live site, and
what was changed: the page now reads the level's own asset list and asks for all
of it at once instead of discovering the files one glb at a time.

Everything below was measured on 2026-10-20 against `play.bfstats.io` from
Dylan's laptop, opening the 2:16 vanilla Aberdeen replay
(`/stats/recordings/bcv83r7jc8.ndjson`), with the browser cache cleared first.

## What one replay open asks for

| | requests | unique files | bytes (unique) |
|---|---|---|---|
| textures (`/textures/**/*.webp`) | 672 | 310 | 35.3 MB |
| HUD and shared art (`/maps/_shared/**/*.png`) | 535 | 521 | 4.4 MB |
| audio (`/maps/_shared/**/*.mp3`, `/models/sounds/`) | 187 | 187 | 2.5 MB |
| glb (`/glbs/*.glb` and `/models/**/*.glb`) | 73 | 62 | 5.2 MB |
| json (manifests, scene, reports) | 80 | 61 | 1.0 MB |
| page modules (`/play`, `/vendor`, root `.js`) | 360 | 356 | 3.4 MB |
| **total** | **1,920** | **1,516** | **51.8 MB** |

The 1,920 request count is with the cache disabled, which also disables
in-flight coalescing: 103 URLs are requested twice for 404 extra requests and
16.8 MB of duplicated transfer. A real first visit transfers the 51.8 MB of
unique files.

Timing of the same load:

- The first 240 requests start inside the first second (page shell, then the
  scene). Asset traffic then runs in waves until 21 s: bursts of 140 to 185
  requests in flight at 6 s and 8.5 s, separated by gaps where the page has no
  textures outstanding because it has not parsed the glb that names them yet.
- Last asset response lands at 63 s (the tail is a trickle of sounds and
  reports while the replay plays).
- Bytes completing inside the 1.5 s to 21.5 s window run at 3.0 MB/s.
- Per-request latency, from `PerformanceResourceTiming`: textures p50 235 ms,
  p90 842 ms; glb p50 483 ms; json p50 486 ms; page modules p50 170 ms.

Compare that with the floor. The same 310 textures, fetched straight from this
machine with `curl`/`urllib` at 4, 16 and 48 parallel, move 35.3 MB in 6.3 s,
8.0 s and 5.4 s. The link tops out at about 6 MB/s and does not care about the
request count. Bytes are about 6 s of that load; the page spends about 20 s,
and the difference is the dependency chain in the page, not the network.

## The pipe the bytes come down

The edge caches what it is configured to cache, and the configuration is
extension-based:

```
$ curl -sI https://play.bfstats.io/textures/3a/3a81b1e3....webp
cf-cache-status: HIT            cache-control: public, max-age=31536000, immutable
ttfb 54 ms

$ curl -sI https://play.bfstats.io/maps/aberdeen/scene.glb        (8.9 MB)
cf-cache-status: DYNAMIC        cache-control: public, max-age=300, s-maxage=86400
ttfb 497 ms

$ curl -sI https://play.bfstats.io/glbs/90d09c2d....glb
cf-cache-status: DYNAMIC        ttfb 502 ms

$ curl -sI https://play.bfstats.io/maps/maps.json
cf-cache-status: DYNAMIC        ttfb 504 ms
```

`nginx.conf` sets `s-maxage=86400` on `/models/` and `/maps/` and
`immutable` on `/textures/` and `/glbs/`, but Cloudflare only applies its own
extension list without a rule, and `.glb`, `.json` and `.ndjson` are not on it.
Every glb and every json request reaches the single Hetzner node through the
tunnel, at 0.45 to 0.50 s time to first byte instead of 0.05 s. That is 62 glb
and 61 json requests per level open, each of them an origin round trip, so
about 5 MB of the 52 MB comes off the node for every viewer.

Warm visits are cheaper but not free. A second open with the browser cache
enabled made 904 network requests and transferred 0.28 MB: nearly all of them
are 304 revalidations (`/maps/` is `max-age=300`, and every page module is
`no-cache` by design, so a deploy cannot leave a stale module against a fresh
page). 904 round trips at 50 to 500 ms each, in waves, is what a returning
player waits through.

## Why a batch endpoint is not the fix

The obvious answer is a server endpoint that answers a list of paths with one
response. It does not fit this deployment:

- The mesh container has a 64 Mi memory limit (`deploy/app/mesh-deployment.yaml`,
  and `deploy/PRODUCTION_ISSUES.md` records what happens when that is
  overrun). Concatenating a batch means holding it in a buffer, and nginx's
  njs runtime has nothing better than a full in-memory copy. Three concurrent
  4 MB batches would eat a third of the container.
- A dynamic batch response is uncacheable by definition (a query string, an
  unknown type), so every batch would be served from the origin. Textures are
  the one asset class the edge caches well today (HIT, 54 ms), and this change
  would move 35 MB per view onto the node.
- It still transfers the same bytes. On the 6 MB/s link measured above, the
  request count is not what costs the 14 extra seconds.

What works with both constraints is a list of files that already exist as
static, immutable, edge-cacheable objects, asked for in parallel as early as
possible. That is what the page does now.

## What changed

`viewer/asset-prefetch.js` reads `<maps>/<level>/assets.json` as a level
opens, and fetches everything it names at low priority with
`cache: 'force-cache'`, up to 64 at a time, into the browser's HTTP cache. The
page's own loads then find each texture and glb already there, so the requests
all leave at once instead of in the level's dependency waves.

`tools/bf1942-models/capture_level_assets.mjs` writes that file. The set
cannot be derived from the tree offline without re-implementing the page's
model resolution (which mod tree, which level paint, which cockpit or wreck
variant, which pose), so the capture records it from the page itself: one
headless local load of the level, every same-origin asset response kept,
written as root-absolute paths so the prefetch's request is the same URL the
page will later ask for and therefore a cache hit.

```
python3 serve_viewer.py 5299 &
node capture_level_assets.mjs --level aberdeen --base http://127.0.0.1:5299
node capture_level_assets.mjs --level berlin --base https://play.bfstats.io \
  --url 'https://play.bfstats.io/map.html?mod=bf1942&map=berlin&replay=/stats/recordings/4xhtpkm8bv.ndjson'
```

`--url` captures whatever page shape the level is served through. A replay
loads the vehicles and poses a plain open does not, so capture the shape people
open. `viewer/maps` is volume-only, so the manifest publishes like any other
level file: `scripts/publish-mesh-delta.py maps --hash`.

A level with no `assets.json` loads exactly as before, and any entry that
fails only costs that entry. Aberdeen's plain capture came out at 892 files and
57.0 MB (the level's own files plus the shared HUD and sound art the page
touches while it loads); the replay-shaped one at 1,174 files and 53.3 MB,
including all 318 textures the replay asks for.

## Measured effect

The module ships with the page, and the level's manifest is a file on the
volume, so the whole change cannot be measured from a local tree. What was
measured is the mechanism on the real pipe: the same Aberdeen replay on
`play.bfstats.io`, browser cache cleared before each run, against a script that
does exactly what `asset-prefetch.js` does (read the manifest, fetch every
entry at `cache: 'force-cache'`, `priority: 'low'`, 64 at a time) starting at
5.5 s, which is when the page in the run below starts its level.

| | no manifest | manifest prefetched |
|---|---|---|
| resource entries | 1,899 | 2,572 |
| network requests | 1,510 | 1,755 |
| transferred | 51.7 MB | 52.3 MB |
| texture requests, by second started | 7: 165, 9: 88, 10: 54, 11: 18, 14: 71, 15: 190, then 36 to 50 s | 8: 210, 9: 353, 11: 213, 12: 53, 13: 16 |
| last texture response | 50.7 s | 13.4 s |
| last response of any kind | 53.5 s | 15.1 s |

The bytes are the same, which is the point: the twenty-second texture storm
and the thirty seconds of trickle after it were the page waiting on its own
dependency chain, and asking for the set up front removes that wait. A repeat
of the prefetch run with the replay-shaped capture described above (1,174
files, 318 textures) landed the last texture at 15.2 s and the last request at
16.1 s, so the two runs agree within a couple of seconds. The 892-file manifest
used for the table was captured from a plain local open and carries 248 of this
replay's 310 textures, so about a fifth of the textures were still discovered
the old way there; the replay-shaped one carries all 318.

Local A/B runs are useless for this, for the record: `serve_viewer.py` is
HTTP/1.1, so the browser caps it at six connections and the prefetch queues
behind its own first six requests. With 80 ms of emulated latency the local
baseline reproduced the production shape (waves at 6, 9, 10, 13 and 15 s) and
the prefetch made no difference at all, because the server could not carry the
requests any faster than the page was issuing them.

## What 13.4 s still is

About 52 MB at the 6 MB/s this laptop gets from the edge is 8.7 s of pure
download, so the floor for this level on this link is around nine seconds.
Everything left above that is the page's own work plus the edge rule in item 1
below. The only way past it is fewer bytes, see item 4.

## Still open

1. Edge cache rule. A Cloudflare Cache Rule for `play.bfstats.io` and
   `mesh.bfstats.io` set to cache everything and respect origin headers would
   take the 62 glb and 61 json requests per level off the origin and cut their
   time to first byte from 0.5 s to 0.05 s. This is configuration, not code,
   and it is the largest single win left.
2. Cache lifetimes for level art. `/maps/` at `max-age=300` makes a returning
   player revalidate 631 shared files. The HUD pack and the level's json are
   content-stable between deploys; a longer browser TTL with a cache-busted
   name (or a purge on publish, which the pipeline already does) removes most
   of the 904 warm requests.
3. Fewer requests, if that is still wanted. With the prefetch in place the
   page asks for the right thing at the right time, so a per-level pack becomes
   a pure request-count change: chunked (4 MB) static files written beside the
   level, served immutable, consumed through a `LoadingManager` URL modifier.
   It needs the Cloudflare rule from item 1 to be worth anything, because a
   pack file is an unknown extension and would otherwise be DYNAMIC.
4. Bytes. 35 MB of the 52 MB is lossless WebP textures. Nothing on the request
   side changes what a 10 Mbit phone spends: lossy WebP or KTX2 at the same
   look would cut that several times over, and it is the only remaining lever
   for a bandwidth-bound client.
5. Page modules. 356 module requests, all revalidated on a warm visit. A
   single bundled build would take that to a handful, at the cost of the
   per-file debugging this tree is built around.

## Non-goals

- Re-baking or re-publishing any level. The change reads a file that sits
  beside the level and falls back when it is absent.
- A dynamic batch API in the mesh pod. The memory limit rules it out, see
  above.
- Touching the texture codec. That is item 4, and it changes every glb's
  bytes.
