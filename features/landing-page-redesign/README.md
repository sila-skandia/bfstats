# Landing Page Redesign — Command Center (V3)

## Thesis

The current landing page (`ui/src/views/LandingPageV2.vue`) frames BF Stats as a
server browser — a list of servers you might want to connect to. Most visitors
are returners checking in on a community that is slowly fading 25 years after
BF1942's release; they don't need a shopping list, they need a pulse read on
**their** battlefield.

V3 reframes the page as a living command center. The server table survives as a
collapsible section near the bottom. The top of the fold becomes:

1. Live theater banner (what's happening right now).
2. Your front — the 2-3 servers you've been visiting, pinned by cookie.
3. Live rounds ribbon — in-progress rounds ranked by drama.
4. Just-ended feed — last rounds wrapped up, with map, winner, MVP.
5. Network heatmap — when the battlefield is busiest, at a glance.
6. (Collapsible) server browser — the classic list.

## Deployment strategy

V3 ships behind a new route (`/servers/:game/v3`). V2 stays untouched and the
default. A thin beta banner on V2 links to V3 with a one-line pitch. No feature
flag service needed — the URL is the switch.

## Data model choices (MVP)

No new tables for MVP. Everything is built from existing entities:

- `Round` (active + recently ended) — already indexed by StartTime.
- `PlayerSession` — for per-round participant counts and MVP.
- `GameServer` — for current map/players/country when rendering cards.
- `ServerOnlineCount` + `HourlyActivityPattern` — for the network heatmap
  (already precomputed hourly, 168 rows per game).
- `localStorage` — for "Your front" (no server-side cookie tracking yet).

Deferred tables we'd add if we want server-side analytics on V3 adoption:

- `SiteVisit` (anonymous session telemetry — view counts, server clicks).
- `DailyUniquePlayerCounts` (resurgence chart).

## New API surface (under `stats/landing/*` + `stats/rounds/*`)

- `GET /stats/rounds/live?game=bf1942&limit=12`
  Live rounds currently in progress, ranked by drama score (close tickets ×
  fill rate × time remaining). Returns map, server, tickets, team labels, top
  3 players by score. Cached 30s.

- `GET /stats/rounds/recent-summaries?game=bf1942&limit=10`
  Most recently completed rounds (past 6h). Compact payload: map, server,
  duration, winner label, MVP, ticket margin. Cached 60s.

- `GET /stats/landing/network-pulse?game=bf1942`
  Single aggregate call powering the hero + heatmap:
  - Hero: total players online, active servers, capacity %
  - Sparkline: last 60 minutes of concurrent-player counts (6 × 10-min bins)
  - Heatmap: 7 × 24 weekly busy pattern from `HourlyActivityPattern`
  Cached 120s.

## Rollout checklist

- [x] Plan doc (this file).
- [ ] Backend: 3 new endpoints, wired through existing DI + caching.
- [ ] Frontend: 1 new composable (`useVisitedServers`), 1 service, 1 view, 4
      sub-components.
- [ ] Route: `/servers/:game/v3` with the same `initialMode` props as V2.
- [ ] Beta banner on V2 pointing at V3.
- [ ] Verify via `./scripts/verify.sh --skip-e2e` (logic) and landing spec.

## Post-MVP ideas (tracked here, not built)

- Returner delta (`/stats/landing/since?ts=…&servers=…`).
- Map rotation "up next" previews (we already have
  `ServerRotationInsightDto` — trivial add after MVP lands).
- Community pulse: rivalries and active squads (from `Communities`).
- Server race: animated weekly playtime bar-chart race.
- Login-backed "Your front" merging `UserFavoriteServer` with localStorage.
- Notable-moment clips: multi-kill streaks, comebacks.

## Why this bet

Five years from now, if BF1942 servers are still up, this audience wants a
front page that says "your war is still happening — here's what's going on" —
not a turnstile. If the bet is wrong and we need to optimise for *new* player
acquisition instead, the structure changes: short highlight clips, not live
tickers. That would be V4, not a patch on V3.
