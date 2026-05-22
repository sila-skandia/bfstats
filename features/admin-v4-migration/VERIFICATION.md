# Admin V4 Verification — `/v4/admin/data`

Open `/admin/data` (legacy) and `/v4/admin/data` (V4) in two browser tabs
and walk tab-by-tab. Mark each cell 🟢 (match), 🟡 (intentional divergence
documented below), 🔴 (regression).

| Tab | Renders | Same data | Same actions / API | Loading / empty / error | Mobile | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Query | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Audit | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Cron | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Merge | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Access | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Notice | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| AI feedback | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

## Per-tab notes

### Query
- Form: server search, min score, min K/D, date range, include-deleted-rounds
- Results: round-grouped table, sort by player/server/score/kills/K/D
- Pagination: 25/50/100 per page
- Inspect → round detail panel (sticky on desktop)
- Achievement panel → opened from "view" inside round detail
- Single delete (modal) + bulk delete (modal) + undelete
- LocalStorage: `bf1942_admin_data_last_search` (filters survive reload) and
  `bf1942_admin_data_game_filter` (chip selection)

### Audit
- Read-only deletion log, 50 rows
- Refresh button

### Cron
- Daily Aggregate Refresh (priority) · Weekly Cleanup · Aggregate Backfill (tier 1–4 / full) ·
  Server Map Stats Backfill · Map Hourly Patterns Backfill · Run All
- Neo4j: Sync (1/7/30/90 days) + Detect Player Communities, only when API
  reports Neo4j enabled; disabled-message row when not enabled

### Merge
- Auto-detected duplicate groups by Game / IP / Port / Name
- Per-group GUID table with radio for primary, badge for live/offline
- Confirm modal (now `MmBaseModal`)
- Manual: name search → checkbox + radio table → second confirm modal

### Access
- User table with role select (User / Support / Admin-fixed)
- Per-row saving spinner + per-row error message
- Card footer note about role taking effect on next token refresh

### Notice
- Current notice preview + meta + edit/clear actions
- Editor: content (markdown), type (info/warning/success/error), dismissible
  toggle, expiresAt datetime, live markdown preview
- Save → `setAppData('site_notice', …)` and `setGlobalNotice()`; clear →
  `deleteAppData` + `setGlobalNotice(null)`

### AI feedback
- Positive/negative counts, filter select (all/positive/negative)
- Click row → modal-style overlay with prompt / response / comment / page context
- Pagination prev/next (50 per page)

## Intentional divergences (V4 vs legacy)

- **Voice**: dropped `[ OPS ] Data Intel`, `[ CONFIRM DESTRUCTION ]`,
  `[ ROUND ]`, `⟩` tab glyphs, scanline grid, radial header glow. Page
  title is "Data intel"; section titles use the V4 uppercase-mono eyebrow.
- **Colors**: legacy used neon green (`#00e5a0`) + neon red (`#ef4444`)
  with glows. V4 uses olive (`--mm-accent`) for primary action and
  `--mm-danger` (#d65a5a) for danger, both without box-shadow glows.
- **Single/bulk delete modal**: now sits inside `MmBaseModal` (Teleport +
  Esc + backdrop click). Same impact list + danger button.
- **Round-detail panel** "Players in round" reads `Players in round`
  instead of `[ PLAYERS IN ROUND ]`. K/D column header is `K/D`.
- **AI feedback overlay** is rendered as a standalone `mm` scoped block
  (it's not a route-level modal); preserved per-section labels using
  `.mm-admin-label` (uppercase mono eyebrow).

## Known bugs

(populate as discovered during walkthrough)
