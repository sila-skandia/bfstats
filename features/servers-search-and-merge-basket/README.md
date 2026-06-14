# Servers search + manual merge basket

Two related features around the server registry.

## 1. Servers search page

A name search over **every tracked server** (online or offline), mirroring the
players search.

- **Route:** `/v4/servers/search` (`v4-servers-search`).
- **View:** `ui/src/views/v4/ServersV4.vue` — modelled on `PlayersV4.vue`
  (debounced input, deep-linkable `?q=`/`?page=`, server-side pagination,
  click-through to the server detail page).
- **API:** existing `GET /stats/servers/search?query=&game=&page=&pageSize=`
  (returns `PagedResult<ServerBasicInfo>`). New typed wrapper
  `searchServers()` in `ui/src/services/serverDetailsService.ts`.
- **Entry point:** "Search all servers" link on the landing page
  (`LandingPageV4.vue`), beneath the live server list — the live list is
  online-only, this finds historical/offline servers by name.
- Row click → `/v4/servers/detail/:serverName` (server **name**, raw, not
  decoded — it's an identifier).

## 2. Manual merge basket (admin)

Problem: an on-demand server comes online at night and **changes its name over
time** while staying the same physical host. A single name search can't surface
all of its identities, and the old manual-merge UI replaced its results on each
search and could only merge what one query returned.

### Changes (`MmAdminMergeTab.vue`)

- The manual section now has a **search pool** (replaced each search) and a
  persistent **merge basket** that accumulates across searches. Search by each
  name the server used, "Add" the matching rows, repeat, then pick a primary and
  merge the whole basket.
- "Add all", per-row "Remove", and "Clear" basket controls.

### Backend: forced merge

`ServerMergeService.MergeServersAsync` enforces a Game/Ip/Port/Name **identity
check** — it would *refuse* to merge servers with different names, which is
exactly this scenario. Added an opt-in bypass:

- `MergeServersRequest.Force` (bool, default false) →
  `MergeServersAsync(..., bool allowMismatchedIdentity = false)`.
- When `true`, the identity check is skipped. The auto-detected duplicates path
  still runs the check (force is false); only the manual basket sends
  `force: true`.
- The forced flag is logged and written into the `merge_servers` audit-log
  details. The confirm modal shows a prominent warning that the check is being
  skipped.

## Notes / not done

- The API test project has a **pre-existing** compile error
  (`RoundReportSnapshotsTests.cs` → `SnapshotObservation` inaccessible) that
  fails on clean `HEAD`; unrelated to this work. The `api` project itself builds
  clean and the touched UI files type-check clean.
