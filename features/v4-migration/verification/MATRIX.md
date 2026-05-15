# V4 Verification Matrix

Per-page parity status. See [`README.md`](./README.md) for the protocol.

Legend:
- 🟢 — ship-ready, no outstanding bugs
- 🟡 — ships with documented divergences (no bugs)
- 🔴 — has known bugs / blocked
- ⚪ — page exists in V4 but hasn't been verified yet

| Page | V4 route | Status | Doc |
| --- | --- | --- | --- |
| Landing (servers list) | `/v4/servers/bf1942` | ⚪ unverified | — |
| Server detail | `/v4/servers/detail/:name` | 🟡 slim-hero redesign + three legacy sections deferred | [server-detail.md](./server-detail.md) |
| Players list | `/v4/players` | 🟢 ship-ready | [players.md](./players.md) |
| Player detail | `/v4/players/:name` | ⚪ unverified | — |
| Player — achievements | `/v4/players/:name/achievements` | ⚪ unverified | — |
| Player — sessions | `/v4/players/:name/sessions` | ⚪ unverified — aggregate card + charts restored | [player-sessions.md](./player-sessions.md) |
| Player — network | `/v4/players/:name/network` | ⚪ unverified | — |
| Server — sessions | `/v4/servers/:name/sessions` | ⚪ unverified | — |
| Rounds index | `/v4/rounds` | ⚪ unverified | — |
| Round report | `/v4/rounds/:id/report` | 🟡 ships with caveats | [round-report.md](./round-report.md) |
| System stats | `/v4/system-stats` | ⚪ unverified | — |
| Map popularity | `/v4/map-popularity/:guid` | ⚪ unverified | — |
| Community detail | `/v4/communities/:id` | ⚪ unverified — built without network graph (members + servers tabs only) | — |
| Dashboard (signed-in home) | `/v4/dashboard` | 🟢 ship-ready — Squad/Servers tabs, online+offline buddies, favourite servers grid, bulk-add modals, sign-out, tournaments shortcut | — |
| Discord OAuth callback | `/auth/discord/callback` | 🟢 ship-ready — V4-themed loading state, post-auth redirect lands at `/v4/dashboard` | — |

**Legacy V3 surface — DELETED:**
- All `views/Dashboard.vue`, `views/LandingPageV2.vue`, `views/LandingPageV3.vue`, `views/Players.vue`, `views/PlayerDetails.vue`, `views/PlayerAllAchievements.vue`, `views/ServerDetails.vue`, `views/PlayerComparison.vue`, `views/SystemStats.vue`, `views/CommunityDetailsView.vue`, `views/MapPopularityView.vue`, `views/PlayerNetworkView.vue` files removed.
- All legacy public URLs (`/dashboard`, `/players`, `/players/:name`, `/servers/:name`, `/system-stats`, `/communities/:id`, `/map-popularity/:guid`, `/rounds/:id/report`, etc.) now redirect to their V4 equivalents in `router/index.ts`.
- App.vue routes `/v4/*` and `/auth/*` through the standalone shell so the legacy DashboardLayout never wraps a V4 page.
- Tournament (`/t/:id/*`, `/admin/tournaments/*`) and admin (`/admin/data`, `/alias-detection`) pages keep their legacy chrome by explicit decision.

Out of scope (stay on legacy until explicitly migrated):
- Public tournaments (`/t/:id`, `/t/:id/{rankings,rules,teams,matches,stats,files}`)
- Dashboard (`/dashboard`)
- All admin pages

Update this table whenever a page-level verification doc is added or
status changes.
