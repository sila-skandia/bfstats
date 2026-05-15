# Verification — Player sessions

| | |
| --- | --- |
| **Legacy URL** | `/players/:playerName/sessions` |
| **V4 URL** | `/v4/players/:playerName/sessions` |
| **Test fixture** | Any active player with > 20 rounds (to exercise the charts) |
| **Verified by** | Claude on 2026-05-13 (code-inspection pass; runtime verification still pending) |
| **Status** | 🔴 — blocking gaps in feature parity (charts + aggregate stats card missing) |

## Note on what this verification does and doesn't cover

This pass was done by **reading the legacy and V4 source files
end-to-end** and diffing them. It catches missing markup, missing API
calls, mis-spelled filter keys, mismatched router pushes — anything
that's visible in the code.

It does **not** cover what only a running app reveals: did the chart
actually render the expected data? Did pagination produce the same
ordering with the same fixture? Did the active-state indicator pulse on
a live round? Those need a manual browser pass with the test fixture
above, devtools network panel open, and a side-by-side compare.

The 🔴 status below reflects feature gaps caught by code reading alone.
A future runtime pass may surface more.

## 1. Routes & entry points

| Source | V4 link exists? | Reaches the right URL? |
| --- | --- | --- |
| PlayerDetailsV4 hero "Sessions →" button | ✅ | ✅ `/v4/players/:name/sessions` |
| PlayerDetailsV4 overview "Latest sessions" → row click | ✅ | Goes to round report directly (intentional — same as legacy) |
| Direct URL `/v4/players/:name/sessions` | ✅ | ✅ |

## 2. Network parity

| Request | Legacy | V4 | Status |
| --- | --- | --- | --- |
| `GET /stats/rounds?…&playerNames=<name>&onlySpecifiedPlayers=false` | ✅ | ✅ (after `playerName` → `playerNames` fix this cycle) | ✅ Match |
| `GET /stats/rounds?…&playerNames=<name>&onlySpecifiedPlayers=true` (K/D overlay) | ✅ | ✅ | ✅ Match |
| `pageSize` query param | `100` | `25` | ⚠️ Divergence — see Feature parity, undecided |
| Filter params (`mapName`, `minParticipants`, `startTimeFrom`, `startTimeTo`) | sent on filter apply | sent on filter apply | ✅ Match |

**Root cause of the original bug:** the backend `RoundsController.GetRounds`
binds `[FromQuery] List<string>? playerNames` (plural). My port wrote
`filters.playerName` (singular), which silently dropped the filter and
returned every round. Fixed by renaming to `playerNames` in
`MmSessionsPage` (line 89). The same off-by-one-letter trap is what
this verification protocol is designed to catch going forward.

## 3. Feature parity

| Feature | Legacy | V4 | Status |
| --- | --- | --- | --- |
| Page header with player name | ✅ | ✅ | ✅ Match |
| Back link to player profile | ✅ | ✅ | ✅ Match |
| Filter: map name | ✅ | ✅ | ✅ Match |
| Filter: min participants | ✅ | ✅ | ✅ Match |
| Filter: date from/to | ✅ | ✅ | ✅ Match |
| Filters collapsible | ✅ | ✅ | ✅ Match |
| Active-filter count badge | ✅ | ❌ | ❌ Missing — small but informative |
| **Player Aggregate Stats card** (Avg Kills / Overall K/D / Best Kills / Best Score) | ✅ | ❌ | ❌ **Missing** |
| **Charts collapsible header** | ✅ | ❌ | ❌ **Missing** |
| **Chart: My Performance worm** (player context — score/K/D across rounds, chronological) | ✅ | ❌ | ❌ **Missing** |
| **Chart: Team Scores Over Time** (line, team1 vs team2 tickets) | ✅ | ❌ | ❌ **Missing** |
| **Chart: Top Player Placements** (top 15 horizontal bar — 1st/2nd/3rd counts, non-player context) | ✅ | ❌ | ❌ Missing — non-player context (not blocking for player surface, but reused for server sessions) |
| **Chart: Team Wins** (non-player context) | ✅ | ❌ | ❌ Missing — same caveat |
| Top pagination | ✅ | ❌ | ⚠️ Missing — V4 only has bottom pagination. Defensible; flag for review. |
| Bottom pagination | ✅ | ✅ | ✅ Match |
| Page-size selector | ✅ (10/25/50/100/200) | ❌ | ❌ Missing |
| Default page size | `100` | `25` | ⚠️ Divergence — V4 reads better in the editorial layout, but produces a perceived "missing data" for power users. Reconsider. |
| Round row: team labels + scoreboard | ✅ | ✅ | ✅ Match |
| Round row: map name + server | ✅ | ✅ | ✅ Match |
| Round row: duration, started time | ✅ | ✅ | ✅ Match |
| Round row: live indicator | ✅ | ✅ | ✅ Match |
| **Performance column (player context):** own K/D prominent + top 3 context underneath | ✅ | partial — V4 shows player K/D inline only, no top 3 below | ⚠️ Divergence |
| Mobile: hidden columns (matchup/participants/duration) | ✅ | ✅ (via `data-cell-label`) | ✅ Match |
| Loading state | spinner | mm-skeleton rows | ⚠️ Divergence (cosmetic) |
| Empty state | "No sessions found." | "No sessions match the current filters." | ⚠️ Divergence (improvement) |
| Error state | red banner | mm-empty + retry button | ⚠️ Divergence (improvement) |

## 4. Data parity

**Cannot be verified by code reading.** Items below need a runtime pass:

- [ ] Total rounds count for a given player matches between legacy and V4
- [ ] First round on page 1 with default sort (`startTime desc`) matches
- [ ] K/D overlay values per row match
- [ ] Filtered totals (apply same date range / map filter on both)

The `playerNames` filter fix means data parity *should* now be correct,
but it needs eyes on the rendered numbers to confirm.

## 5. Navigation parity

| Outbound link | Legacy goes to | V4 goes to | Status |
| --- | --- | --- | --- |
| Click round row | `/rounds/:id/report` | `/v4/rounds/:id/report` + `?players=<name>` | ✅ V4 path |
| Click server name in row | `/servers/detail/:name` | `/v4/servers/detail/:name` | ✅ V4 path |
| "Back to player" link | `/players/:name` | `/v4/players/:name` | ✅ V4 path |

## Outstanding work (blocks 🟢)

- [x] Fix `MmSessionsPage` filter key: `playerName` → `playerNames`.
- [ ] Build the **Player Aggregate Stats card** (Avg Kills / Overall K/D / Best Kills / Best Score) for player context. Source: `playerStatsData` already fetched.
- [ ] Build the **Charts** section with the collapsible header.
  - [ ] **My Performance worm** chart (player context) — line chart of score per round, oldest → newest. Replace Chart.js with `MmSparkline` if the V4 budget for Chart.js is "no Chart.js." Decision pending.
  - [ ] **Team Scores Over Time** line chart. Same Chart.js / Mm-primitive decision.
  - [ ] **Top Player Placements** horizontal bar (non-player context). Defer until server-sessions cycle.
  - [ ] **Team Wins** chart (non-player context). Defer.
- [ ] Add **active-filter count** badge next to the "Filters" button.
- [ ] Add **page-size selector**; reconsider default of 25 vs 100.
- [ ] Restore **top pagination** in addition to bottom.
- [ ] (Player context) under each round row's Performance column, show the **top 3 players** beneath the contextual player's own stats.

## Sign-off

Status remains 🔴 until the bracketed feature gaps above are either ported
or explicitly downgraded to documented ⚠️ divergences with the user's
sign-off. **The protocol caught real gaps the type-check missed** —
exactly its purpose.
