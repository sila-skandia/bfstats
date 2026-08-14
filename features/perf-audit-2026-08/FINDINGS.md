# Live-site performance audit — landing / player details / server details

Measured against **https://bfstats.io** on 2026-08-14 from Brisbane (Cloudflare edge `BNE`,
origin Hetzner/Finland). All numbers are Resource Timing from the live site, not local dev.

## Baseline: the network floor

Every `/stats/*` response comes back with:

```
cf-cache-status: BYPASS
(no Cache-Control header at all)
```

So every API call pays a full AU→Finland round trip. Even `POST /stats/telemetry/page-view`
— a 204 with no body — measured **339–427ms**. That ~400ms is the floor under everything
below; the rest is server time on top.

Measured request→response for representative calls:

| Endpoint | Bytes (br) | TTFB |
|---|---|---|
| `telemetry/page-view` (204, empty) | 0 | 397–427ms |
| `servers/{name}` | 896 | 1005ms |
| `servers/{name}/comments` (empty thread) | 69 | 1016ms |
| `liveservers/bf1942/servers` | 24 307 | 463–1174ms |
| `data-explorer/players/{n}/maps?days=60` | 1 649 | **2 346ms** |
| `data-explorer/players/{n}/competitive-rankings` | 1 457 | **2 511ms** |

Payload size is irrelevant here. Latency and server time are everything.

---

## Page-by-page

### Landing (`/`)

Time to first server row: **~1.8–2.5s**.

- Cold document TTFB **1080ms**.
- `GET /stats/liveservers/bf1942/servers` does not start until **t=1334ms** — not because of a
  data dependency, but because the fetch lives inside `LandingPageV4.vue`'s `onMounted`, so it
  can't fire until the whole module graph (`index` → `ModernShell` → `LandingPageV4` →
  `serverDetailsService` → `countryCodes` → `timeUtils`) has downloaded and executed.
  `timeUtils` finished at 1320ms; the fetch started 14ms later.
- The payload ships a full `players[]` roster **and** unused geo metadata (`loc`, `postal`,
  `org`, `timezone`, `geoLookupDate`, `city`) for **all ~90 servers** — 3.7KB of raw JSON per
  server. Only 5 servers have any players, and the UI renders exactly one roster (the
  selected server, [LandingPageV4.vue:425](ui/src/views/v4/LandingPageV4.vue:425)).
- Fonts are discovered late — both `.woff2` files start at t=1337ms via CSS and take
  409ms / 432ms, so headline text re-flows well after first paint.

**Skeletons here are already right.** `isInitialLoad` drives counter skeletons and a six-row
table skeleton ([LandingPageV4.vue:178-231](ui/src/views/v4/LandingPageV4.vue:178)). This is the
pattern the other two pages are missing.

### Server details (`/v4/servers/detail/{name}`)

Time to full content: **~2.6s**. Two serial waves.

```
t=278   servers/{name}                    1005ms
t=278   servers/{name}/insights           1033ms
t=279   v2/servers/{name}/leaderboards    1092ms
t=279   servers/{name}/maps-insights      1024ms
        ── wave 2 cannot start until wave 1 resolves ──
t=1302  relationships/servers/{guid}/proximity  1022ms
t=1310  servers/{name}/comments                 1016ms
t=1310  servers/{name}/banner.png               1250ms
t=1312  liveservers/bf1942/{ip}/{port}          1068ms
```

The second wave exists **because of the loading gate**:

```html
<div v-if="loading" style="padding: 40px 0">
  <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
</div>
<div v-else-if="error" class="mm-empty">{{ error }}</div>
<template v-else-if="details">
```
[ServerDetailsV4.vue:332-341](ui/src/views/v4/ServerDetailsV4.vue:332)

Everything — including `<h1>{{ details.serverName }}</h1>` — sits inside `v-else`. The child
components that own the wave-2 fetches don't mount until `loading` flips false, so the gate
costs a full extra round trip (~1s from AU) on top of hiding the page.

And the server name is **already in the URL** (`/v4/servers/detail/MoonGamers.com%20|%20Est.%202004`).
The user stares at five grey bars for a second while the app waits for an API to tell it a
name the browser address bar already has.

### Player details (`/v4/players/{name}`)

Time to full content: **~3.6s**. Same structure, worse endpoints.

```
t=473   players/{name}                          563ms
t=473   communities/players/{name}              946ms
t=473   gamification/player/{name}/achievement-groups  952ms
        ── gate ──
t=1037  players/{name}/map-stats                1080ms
t=1043  gamification/player/{name}/hero-achievements  1054ms
t=1043  data-explorer/.../activity-heatmap      1073ms
t=1044  data-explorer/.../maps?days=60          2346ms
t=1044  data-explorer/.../competitive-rankings  2511ms
t=1052  relationships/servers/{guid}/proximity  1040ms
t=1054  players/{name}/comments                 1067ms
```

Same whole-page gate at [PlayerDetailsV4.vue:417-421](ui/src/views/v4/PlayerDetailsV4.vue:417),
same "name is already in the URL" problem.

Additionally, `loadStats()` awaits two calls back to back:

```ts
stats.value = await fetchPlayerStats(rawName.value)
...
mapStats.value = await fetchPlayerMapStats(rawName.value, primaryGameId.value, 365)
```
[PlayerDetailsV4.vue:73-90](ui/src/views/v4/PlayerDetailsV4.vue:73)

The dependency is real but weak: `primaryGameId` only reads
`stats.servers[0].gameId` and **defaults to `'bf1942'`** — which is right for the overwhelming
majority of players.

### Bundle: 131KB of rich-text editor on both detail pages

`index-Bhhthy9v.js` is **343KB raw / 131KB brotli** — larger than `vue-vendor` and
`misc-vendor` combined, and 41% of the 316KB total JS on player details. It is TipTap +
DOMPurify, pulled in by a static import chain:

```
PlayerDetailsV4.vue → MmPlayerComments.vue → MmCommentsThread.vue → @tiptap/*, dompurify
ServerDetailsV4.vue → MmServerComments.vue → MmCommentsThread.vue → @tiptap/*, dompurify
```

It downloads and parses on every player and server page view — for anonymous visitors who
cannot post, for a thread that is below the fold, and (in every case measured) for a comments
response of **69 bytes**.

`misc-vendor` (47KB br) also bundles `@microsoft/signalr` and `marked` into a chunk loaded on
*every* page including landing (see `vite.config.js` `manualChunks`).

---

## Recommendations, ranked by payoff

### 1. Edge-cache the read-only API responses — biggest single win

Nothing on these three pages is per-user. `cf-cache-status: BYPASS` on everything means an
Australian visitor pays 400ms+ to Finland for data that is identical for every visitor on
earth. Add `[ResponseCache]` (the pattern already exists in `GameTrendsV2Controller`,
`AppController`, `LandingController`) plus a Cloudflare cache rule for `/stats/*`:

| Endpoint | Suggested TTL | Notes |
|---|---|---|
| `liveservers/*` | 20–30s | matches the UI's 30s refresh interval |
| `servers/{name}`, `/insights`, `/maps-insights`, `/leaderboards` | 5–15 min | aggregates |
| `players/{name}`, `data-explorer/players/*` | 5–15 min | aggregates |
| `relationships/*/proximity` | 30–60 min | |
| `servers/{name}/banner.png` | 1 hr | already has a `_t` cache-buster in the URL |

With `stale-while-revalidate`, a Brisbane repeat visitor drops from ~1000ms to ~20ms on a warm
edge. This alone would take player details from ~3.6s to well under 1s for anyone but the
first visitor in each region.

### 2. Kill the whole-page loading gate; paint the hero from the URL

On both detail pages, restructure so the hero renders immediately from `route.params`:

- Render `<h1>` (server name / player name), the back link, the tab bar, and the panel
  chrome unconditionally.
- Scope skeletons to the individual panels that are still loading, not the whole page.
- Keep child components mounted from the start so their fetches join wave 1 instead of
  waiting for it.

Two wins at once: perceived load goes to ~0ms for the identity of the page, and the actual
second round trip (~1s from AU) disappears because wave 2 collapses into wave 1.

For the player hero specifically, `decodePlayerName(route.params.playerName)` gives you the
display name and the avatar initial with no API call at all. For the server hero, the name
is `route.params.serverName` verbatim.

Watch the guardrails while doing this: `primaryServer.serverGuid` isn't known until
`players/{name}` returns, so the proximity orbit genuinely has to stay in wave 2 — give that
one panel its own skeleton rather than blocking the page.

### 3. Trim the landing payload

Add a lightweight shape for the list (`?include=summary` or a separate `servers/summary`
route) that omits `players[]`, `teams`, and the unused geo fields, and fetch the full roster
only for the selected server. ~90 servers × 3.7KB of raw JSON collapses to a fraction of that.
The brotli wire size barely moves, but the parse + reactivity cost on mobile does.

### 4. Start the landing fetch before the JS module graph resolves

The landing API call is idle-blocked for ~250ms after DOMContentLoaded waiting on module
execution. Either:

- add `<link rel="preload" as="fetch" crossorigin href="/stats/liveservers/bf1942/servers">`
  to `index.html`, or
- fire the fetch from a tiny inline script in `<head>` and stash the promise on `window` for
  `LandingPageV4` to await.

Same trick applies to the detail routes if you're willing to parse the route from
`location.pathname` in the inline script.

While in `index.html`, preload the two `.woff2` files — they're currently discovered at
t=1337ms via CSS and take ~420ms each.

### 5. Lazy-load the comment editor

`MmCommentsThread` should be a `defineAsyncComponent`, and within it the TipTap editor should
only load when an authenticated user actually focuses the composer. Render the read-only
thread (which needs `marked` + `DOMPurify` at most, not TipTap) eagerly. Removes 131KB br /
343KB of parse from both detail pages.

Also consider splitting `@microsoft/signalr` out of `misc-vendor` so the landing page stops
paying for it.

### 6. The two 2.3–2.5s player endpoints

`data-explorer/players/{name}/competitive-rankings` and `.../maps` are the slowest things on
the site by a wide margin. `GetPlayerCompetitiveRankingsAsync`
([DataExplorerServiceOptimized.cs:2213](api/DataExplorer/DataExplorerServiceOptimized.cs:2213))
already carries the `PlayerMaps` CTE restriction from the recent optimisation pass, but still
issues **three sequential** DB round trips — an existence check, the current-period ranking,
and the previous-period ranking — each doing windowed aggregation over `PlayerMapStats`.

- The existence check is redundant; the main query already returns nothing for an unknown
  player.
- The previous-period query is independent of the current-period one. They can't share a
  `DbContext` concurrently, but they can be merged into a single statement with one
  `PlayerMaps` CTE and two conditional aggregates, halving the scans.
- Given caching (#1), this endpoint being slow matters far less — but it's still the one to
  fix if you want cold-cache numbers to look sane.

---

## What's already good

- The inline pre-mount shell in `index.html` (topbar skeleton, correct `#131313` background)
  — no flash of legacy layout.
- The landing page's `isInitialLoad` skeletons.
- PrimeIcons already removed from the render-blocking path; fonts self-hosted.
- Brotli on everything; HTTP/3 advertised.
- `busy-indicator` and `app/initialdata` do carry `ResponseCache` and were served from cache
  in ~1ms — proof that #1 works, it just isn't applied to the endpoints that matter here.
