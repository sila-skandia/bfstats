# Verification — Server detail

| | |
| --- | --- |
| **Legacy URL** | `/servers/:serverName` |
| **V4 URL** | `/v4/servers/detail/:serverName` |
| **Test fixture** | Any active BF1942 server (e.g. one with > 50 rounds in the last 30 days so leaderboards populate) |
| **Verified by** | Claude on 2026-05-14 (code-inspection pass) |
| **Status** | 🟡 ships with caveats — three legacy sections still pending port; runtime data parity not yet verified |

## What this pass covers

Code-inspection of `views/ServerDetails.vue` (legacy, 4771 lines) and
`views/v4/ServerDetailsV4.vue` (current V4). Runtime data parity needs a
browser pass.

## 1. Routes & entry points

| Source | V4 link exists? | Reaches the right URL? |
| --- | --- | --- |
| LandingPageV4 row click | ✅ `goServer` | ✅ `/v4/servers/detail/:name` |
| LandingPageV4 "Roster" button → modal | ✅ (modal, not nav) | ✅ |
| PlayerDetailsV4 "currently on …" link in hero | ✅ | ✅ |
| Round-row click on PlayerSessionsV4 → server name | ✅ | ✅ |
| Direct URL | ✅ | ✅ |

## 2. Network parity

| Request | Legacy | V4 | Status |
| --- | --- | --- | --- |
| `GET /stats/servers/:name` (server details) | ✅ | ✅ | ✅ Match |
| `GET /stats/servers/:name/insights?days=30&period=7d` | ✅ | ✅ | ✅ Match |
| `GET /stats/servers/:name/leaderboards?period=month` | ✅ | ✅ | ✅ Match |
| `GET /stats/liveservers/:game/:ip/:port` (live roster) | ✅ | ✅ | ✅ Match |
| `GET /stats/data-explorer/servers/:guid/busy-indicators` (forecast) | ✅ | ✅ | ✅ Match |
| `GET /stats/data-explorer/servers/:guid` (server-detail explorer payload: overall win stats, activity patterns, per-map stats) | ✅ | ❌ — V4 doesn't fetch this | ❌ Missing |
| `GET /stats/data-explorer/servers/:guid/map-rotation` (detected rotation) | ✅ | ❌ | ⚠️ Optional — V4 has its own inline maps table |

## 3. Feature parity

| Feature | Legacy | V4 | Status |
| --- | --- | --- | --- |
| Hero — server name, region, game, IP | ✅ | ✅ slim header (one line meta row) | ⚠️ Divergence (intentional simplification) |
| Hero — 4-cell stat strip (avg / peak / unique / top map) | ✅ | ❌ removed | ⚠️ Divergence (intentional) — the stats were taking disproportionate real estate; same numbers still live in Overview tab cards |
| Hero — favourite-map tagline | ✅ | ❌ removed | ⚠️ Divergence (intentional) |
| Hero — action button row (Forecast / Rounds / Maps / Ranks) | ✅ | ❌ removed; Forecast moved to a single inline link in the meta row, tab shortcuts are duplicates of the tabs bar | ⚠️ Divergence (intentional) |
| Forecast modal trigger | ✅ | ✅ | ✅ Match |
| Live roster (PlayersPanel embedded) | ✅ — with full 4-cell stat strip + sort row | ✅ — compact: only the map + game type + round-time context strip; team tables follow directly | ⚠️ Divergence (intentional) — engaged / top-score / kills / avg-ping cells dropped; the same data is in the team tables. Map name is now always shown in the context strip. |
| Comments | ✅ ServerComments | ✅ MmServerComments (via MmCommentsThread) | ✅ Match |
| Signature builder | ✅ | ✅ | ✅ Match |
| Ping proximity orbit | ✅ | ✅ | ✅ Match |
| Map rotation table | ✅ MapRotationTable component (detected rotation pattern) | ⚠️ inline `popularMaps` table — different data | ⚠️ Divergence — V4 uses popular-map stats, not detected rotation |
| Tabs / sections layout | Two-section flat layout ("Active Roster" + "Telemetry") + "Deep Dive" sub-tab | Three tabs (Overview / Ranks / Maps) — Rounds tab dropped this cycle because its sole content (`topScores`) is corrupted upstream | ⚠️ Divergence — V4 reorganises (intentional) |
| **Overall server win stats (WinStatsBar)** | ✅ team-win % across all rounds | ❌ | ❌ **Missing** |
| **Server-wide activity heatmap** (7×24 weekly busy pattern) | ✅ ActivityHeatmap | ❌ | ❌ **Missing** |
| **Top players by map** (per-map LeaderboardPreview cards) | ✅ | ❌ | ❌ **Missing** |
| Player history chart (Chart.js) | ✅ | ⚠️ MmSparkline as a quieter equivalent | ⚠️ Divergence (intentional — V4 dropped Chart.js for editorial sparklines) |
| Detected rotation pattern + cycle visualisation | ✅ MapRotationTable | ❌ | ❌ Missing (different data, lower priority) |
| Ranks tab (Most active / Top K/D / Top kill rate / Top placements) | n/a in legacy (legacy uses ServerLeaderboards instead) | ✅ | ✅ V4-only feature |
| Maps tab drill-in → ServerMapDetailPanel | ✅ | ✅ (via `useDrillIn`) | ✅ Match |
| Rounds tab (top scores from leaderboards) | ✅ similar via ServerRecentSessionsFeed | ✅ | ✅ Match |

## 4. Data parity

**Code inspection only — runtime values not validated.** Items needing a
browser pass:

- [ ] Average / peak / unique player counts on the hero stat strip
- [ ] Ranks tab Top K/D row ordering matches between legacy ServerLeaderboards and V4 (after the `friendlyRelative` + DTO-field-mismatch fix this cycle)
- [ ] Forecast modal hourly buckets match legacy ForecastModal bars
- [ ] Live roster team labels render correctly (verified in earlier cycle after the `team.index` filter fix)

## 5. Navigation parity

| Outbound link | V4 path? | Status |
| --- | --- | --- |
| Player row click in Ranks/Overview lists | `/v4/players/:name` | ✅ |
| Click a map row → drill-in panel | inline (useDrillIn) | ✅ |
| Drill-in panel "Back to maps" | scroll-restored | ✅ |
| Click a player inside the proximity orbit | `/v4/players/:name` | ✅ |

## Outstanding work to reach 🟢

- [ ] **Fetch `serverDetailExplorer`** payload (`fetchServerDetail(serverGuid)`) once details load. It carries `overallWinStats`, `activityPatterns`, `perMapStats`.
- [ ] Add **server-wide WinStatsBar** to the Overview tab (using `MmWinStatsBar` already built for the data-explorer drill-in).
- [ ] Add **server-wide ActivityHeatmap** to the Overview tab (using `MmActivityHeatmap` already built).
- [ ] Add **Top players by map** cards/strip — preview top 3 per popular map. Reuse `MmRankCell` for the player rows.
- [ ] Decide: keep the legacy "Detected map rotation" pattern visualisation or drop. V4's inline `popularMaps` table already covers the basic data; the detected-rotation pattern (e.g. "MapA → MapB → MapC, repeats") is a niche feature. Defer to a follow-up unless we hear from a user.

## Sign-off

Status 🟡. The page is functional and covers most of the legacy surface;
the three outstanding items are all data we can backfill without
restructuring the page. None are bugs.
