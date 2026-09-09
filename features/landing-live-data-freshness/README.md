# Landing page: show the last snapshot, chase the next one, say nothing

## The problem

The landing page carried a red "Live server data is temporarily unavailable —
showing data from N minutes ago" banner, gated on the snapshot being 90s old.
It was meant for a BFList outage, but it fired during perfectly healthy
operation: sit on the tab and it appears, then vanishes on the next 30s poll.

The banner was measuring the wrong thing. `lastUpdated` is the API's own
BFList fetch timestamp, and that timestamp only advances as fast as the
server-side pipeline lets it:

| Stage | Cadence |
| --- | --- |
| `StatsCollectionBackgroundService` poll | 30s (`STATS_COLLECTION_INTERVAL_SECONDS`) |
| `BfListApiService` hot snapshot TTL | 30s (`ServerListCacheSeconds`) |
| Cloudflare edge cache | 30s (`[EdgeCache(30, StaleWhileRevalidate = 30)]`) |

Stack those and a snapshot that is up to ~60s old is the normal, healthy
steady state. A 90s alarm sits close enough to that to trip on jitter alone —
so the warning fired on data that was fine, and the viewer was asked to worry
about a number the page could not improve by asking again.

## What it does now

No staleness state, no banner. The page paints whatever snapshot it last got
and, in the meta row, says how old that snapshot is: `12 seconds ago`,
`1 minute ago`. Full wording on desktop, abbreviated (`12s ago`) at ≤720px
where spelling it out wraps the row — the tooltip carries the absolute local
time and the aria-label keeps the full phrasing at both widths. The chip is
the refresh control: click to fetch now, and the ring around it fills toward
the next automatic fetch.

Polling is one 1s ticker (`tick`) that updates the label and decides whether
to fetch:

- **Fresh (< 60s):** fetch every 30s, matching the upstream cadence.
- **Older than 60s:** chase — first retry 5s after the last attempt.
- **Chase that ends still over 60s old:** double the gap (5 → 10 → 20 → 30s).
  A snapshot that is still old *after* a successful fetch means the upstream is
  behind, and polling it harder only buys the same bytes. Failures back off the
  same way.
- **Any attempt that ends holding fresh data:** reset to the 5s chase interval
  and the 30s cadence.

The common case — tab backgrounded for ten minutes — costs exactly one extra
fetch: the ticker is throttled while hidden, so `visibilitychange` and `focus`
call `tick` directly, one fetch catches up, and the page is back on cadence.
The pathological case — upstream permanently a few minutes behind — settles at
the same 30s cadence it would have used anyway, which matters on a single-node
deployment where a client-side retry storm lands on one API pod.

A failed refresh never clears the table. `error` is only set, and the error
state only rendered, when there is nothing else to show
(`servers.length === 0`); otherwise the rows stay and the label simply ages.

## Where it lives

- `ui/src/views/v4/LandingPageV4.vue` — `tick`, `load`, `noteAttempt`,
  `lastUpdatedChip`, and the refresh chip in the meta row
  (`[data-testid="landing-last-updated"]`).
- `ui/src/utils/timeUtils.ts` — `formatAgo` / `formatAgoShort`. They take an
  age in ms rather than a timestamp so the label recomputes in step with the
  caller's own ticking `now`, and they keep seconds instead of collapsing
  everything under a minute to "Just now" the way `formatRelativeTime` does.
- `ui/e2e/landing.spec.ts` — three tests covering the contract: data older
  than a minute is chased without warning the viewer, a failed refresh keeps
  the last snapshot on screen, and the meta row reports the age and refreshes
  on click.

## If you change the thresholds

`CHASE_AFTER_MS` is not an arbitrary 60s — it is the sum of the server-side
cadences in the table above. Shorten it and the page chases data that was
never going to be newer; lengthen it past a couple of minutes and a genuinely
wedged tab takes too long to notice. If the collector interval or the edge
cache TTL changes, this constant moves with them.
