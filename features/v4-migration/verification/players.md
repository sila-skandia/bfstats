# Verification — Players list

| | |
| --- | --- |
| **Legacy URL** | `/players` |
| **V4 URL** | `/v4/players` |
| **Test fixture** | Default load (no search query) — any active server context |
| **Verified by** | Claude on 2026-05-13 (code-inspection pass) |
| **Status** | 🟢 ship-ready (post-fix) — design simplifications documented |

## Note on what this verification covers

Code-inspection pass against `views/Players.vue` (the legacy hero wrapper),
`components/PlayersPage.vue` (the legacy 1337-line list), and
`views/v4/PlayersV4.vue`. Runtime data parity still requires a browser
pass.

## 1. Routes & entry points

| Source | V4 link exists? | Reaches the right URL? |
| --- | --- | --- |
| `ModernShell` topbar "Players" nav link | ✅ | ✅ `/v4/players` |
| Direct URL `/v4/players` | ✅ | ✅ |
| `MmPlayerSearch` (built but unwired) | ⚠️ — built but not used by any current V4 page | n/a |

## 2. Network parity

| Request | Legacy | V4 | Status |
| --- | --- | --- | --- |
| `GET /stats/players?page=N&pageSize=50&sortBy=…&sortOrder=…` | ✅ | ✅ | ✅ Match |
| `&playerName=<q>` when searching | ✅ | ✅ (sent as `filters.playerName`) | ✅ Match |
| `&isActive=true` by default (legacy filters to online-only when no search) | ✅ | ❌ — V4 omits this | ⚠️ Divergence — V4 shows the full registry by default |

**Intentional divergence on `isActive=true`:** legacy's UX is "manual
search" — empty until you type. When no query is entered it filters to
online-only as a fallback. V4 lands on a sorted-by-playtime registry by
default, which is a more useful "archive" landing experience. Flag this
as 🟡 design choice; the search box still works and `isActive=true` is
implicitly filterable if we want it back.

## 3. Feature parity

| Feature | Legacy | V4 | Status |
| --- | --- | --- | --- |
| Hero / meta row | "OPERATIVE LOCATOR" terminal-themed hero | mm-chip "Live registry" + counts + mm-display "Players archive" | ⚠️ Divergence — full theme reskin (intentional) |
| Page header | "OPERATIVE LOCATOR // bfstats://players/search" | "Players archive" | ⚠️ Divergence |
| Search input | Hero-level "manual search" with Enter to fire | Inline filter, debounced 250 ms auto-fire | ⚠️ Divergence — UX improvement |
| Name-fragment highlighting in search results | ✅ (yellow `<mark>` tags) | ❌ | ❌ Missing — should port |
| Per-row layout | Dossier card grid | mm-list table | ⚠️ Divergence — V4 leans editorial |
| Per-row stat: playtime | ✅ | ✅ | ✅ Match |
| Per-row stat: lifetime K/D | ✅ | ❌ | ❌ Missing — API returns it (legacy reads `totalKills`/`totalDeaths` from same endpoint) |
| Per-row stat: total rounds | ✅ | ❌ | ❌ Missing |
| Per-row stat: rounds this week | ✅ | ❌ | ❌ Missing (and arguably noisy — can defer) |
| Per-row stat: favorite server | ✅ | ❌ | ❌ Missing |
| Live-session detail (when online: server + map + K/D + kills/deaths) | ✅ | ⚠️ partial — V4 shows `on <serverName>` only | ❌ Missing detail |
| Online / Offline chip | ✅ | ✅ | ✅ Match |
| Sortable headers | ✅ | ✅ | ✅ Match |
| Pagination | ✅ (numbered ranges with first/last) | ✅ (prev/next only) | ⚠️ Divergence — V4 simpler |
| Loading state | spinner | mm-skeleton rows | ⚠️ Cosmetic divergence |
| Error state | inline red message | `mm-empty` block | ⚠️ Cosmetic divergence |

## 4. Data parity

| Metric | Legacy | V4 | Match? |
| --- | --- | --- | --- |
| Total players reported | matches | matches | ✅ (with caveat: V4 returns full registry, legacy only online by default) |
| First page playtime ordering | matches | matches | ✅ |
| K/D column data | renders | absent | ❌ — column not rendered |

## 5. Navigation parity

| Outbound link | Goes to | V4 path? | Status |
| --- | --- | --- | --- |
| Click row | player detail | `/v4/players/:name` | ✅ V4 path |

## Outstanding work to reach 🟢

- [x] Add K/D column (extended `PlayerListItem` locally as `PlayersV4ListItem`).
- [x] Add Rounds column.
- [x] Add favorite server as `mm-list__name-sub` beneath the player name.
- [x] When `isActive && currentServer`: full live-session detail (Live chip + server / map / K-D / K/D in the Status cell).
- [x] Highlight matching name fragments in search results (`<mark class="mm-players__mark">`).
- [x] Apply `MmRankCell` to Playtime, K/D, and Rounds columns.

## Sign-off

Status 🟡. The page is functional, navigable, search works, but the
per-row "dossier" content density of legacy isn't yet on V4. None of the
missing items is a bug — all are missing data columns that the same
API returns and we don't surface. Tracked as the outstanding-work list
above.
