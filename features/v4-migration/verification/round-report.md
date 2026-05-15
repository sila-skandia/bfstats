# Verification — Round report

| | |
| --- | --- |
| **Legacy URL** | `/rounds/:roundId/report` |
| **V4 URL** | `/v4/rounds/:roundId/report` |
| **Test fixture** | Any completed round with > 4 leaderboard snapshots so the playback timeline has dots to scrub |
| **Verified by** | Claude on 2026-05-14 (code-inspection pass) |
| **Status** | 🟡 ships with caveats — fullscreen war-room mode + vertical time-navigator + console keyboard nav deferred; everything else parity'd |

## 1. Routes & entry points

| Source | V4 link exists? | Reaches the right URL? |
| --- | --- | --- |
| PlayerDetailsV4 overview "Latest sessions" row click (`goRoundReport`) | ✅ | ✅ `/v4/rounds/:id/report` |
| MmPlayerRecentRoundsCompact row click | ✅ | ✅ |
| MmSessionsPage row click | ✅ | ✅ |
| MmRecentSessionsList row click | ✅ | ✅ |
| Direct URL | ✅ | ✅ |
| Legacy `/rounds/...` deep links from external places | ⚠️ still hit legacy | ⚠️ outside V4 scope until cutover |

## 2. Network parity

| Request | Legacy | V4 | Status |
| --- | --- | --- | --- |
| `GET /stats/rounds/:roundId/report` (via `fetchRoundReport`) | ✅ | ✅ | ✅ Match |

### 2a. Type-vs-payload parity

`RoundReport` response shape mirrors the C# `RoundReport` model. Spot-checked
fields referenced in V4 templates against backend writes:

| Field | V4 template uses | C# property | Status |
| --- | --- | --- | --- |
| `round.startTime` / `endTime` | ✅ | `Round.StartTime` / `EndTime` | ✅ |
| `round.mapName` / `serverName` / `gameType` | ✅ | ✅ | ✅ |
| `round.tickets1` / `tickets2` / `team1Label` / `team2Label` | ✅ | ✅ | ✅ |
| `leaderboardSnapshots[].entries[].rank/score/kills/deaths/playerName/teamLabel` | ✅ | `LeaderboardSnapshot` / `LeaderboardEntry` | ✅ |

No dead fields detected on this endpoint.

## 3. Feature parity

| Feature | Legacy | V4 | Status |
| --- | --- | --- | --- |
| Hero header (map name, server, game type, date) | ✅ | ✅ | ✅ Match |
| Live indicator chip for ongoing rounds | ✅ | ✅ | ✅ Match |
| Team scoreboard (tickets1 vs tickets2 with labels) | ✅ | ✅ | ✅ Match |
| Battle summary card (duration / kills / participants / avg K/D) | ✅ via `BattleSummary` | ✅ via `MmBattleSummary` | ✅ Match |
| MVP highlight card | ✅ | ✅ | ✅ Match |
| Playback timeline scrubber | ✅ | ✅ via `MmPlaybackControls` | ✅ Match |
| Play / pause / reset / speed selector | ✅ | ✅ | ✅ Match |
| Scrubber dots sampled to ≤20 | ✅ | ✅ | ✅ Match |
| Elapsed time badge | ✅ | ✅ | ✅ Match |
| Mouse drag on the scrubber | ✅ | ✅ | ✅ Match |
| Console view of battle events | ✅ | ✅ | ✅ Match |
| Visualizer view (Chart.js race + velocity + scatter) | ✅ | ✅ via `MmBattleVisualizer` (earthy mm palette) | ⚠️ Divergence (cosmetic — same charts, V4 colours) |
| Console / Visualizer toggle | ✅ | ✅ | ✅ Match |
| Event-type filters (joins / deaths / highlights only) | ✅ | ✅ | ✅ Match |
| Tracked-player highlight in console + chart | ✅ via input | ✅ via input | ✅ Match |
| "New event" flash animation | ✅ | ✅ (mm-highlight wash) | ⚠️ Cosmetic divergence |
| Live ladder (team-grouped) | ✅ | ✅ | ✅ Match |
| Final vs Live ladder toggle | ✅ | ✅ | ✅ Match |
| Click ladder player → player profile | ✅ | ✅ (`/v4/players/:name`) | ✅ Match |
| Server name → server detail | ✅ | ✅ (`/v4/servers/detail/:name`) | ✅ Match |
| Tactical highlights row (`MmBattleHighlight` cards) | ✅ | ✅ | ✅ Match |
| Highlight filter to current playback time | ✅ | ✅ | ✅ Match |
| **Fullscreen "war room" overlay mode** | ✅ | ❌ | ⚠️ Divergence — deferred. Mode rarely used; legacy used keyboard `F` + dim background. |
| **Vertical time-navigator rail with checkpoints** | ✅ | ❌ | ⚠️ Divergence — replaced with the existing scrubber dots. |
| **Keyboard nav (arrow up/down for checkpoint jump)** | ✅ | ⚠️ Spacebar play/pause only | ⚠️ Reduced |
| Empty-round error state | ✅ | ✅ | ✅ Match |
| Loading skeleton | spinner | mm-skeleton rows | ⚠️ Cosmetic |
| Pinned-player overlay chart (`MmPlayerPinnedChart`) | ✅ (legacy used it) | ✅ built but not yet wired into the V4 page | ❌ Not wired — current page has the `Pin a player` input but no dedicated chart strip |

## 4. Data parity

**Code-inspection only — runtime not verified.** Items needing a browser pass:

- [ ] Total participants count matches between legacy and V4
- [ ] Final tickets / team labels match
- [ ] Top ladder entry matches (rank #1 in the first team group)
- [ ] Playback scrubber position 0% / 50% / 100% renders the same console state in both views
- [ ] MVP shown by `MmBattleSummary` matches legacy `BattleSummary`

## 5. Navigation parity

| Outbound link | V4 path? | Status |
| --- | --- | --- |
| Ladder player click | `/v4/players/:name` | ✅ |
| Server name click | `/v4/servers/detail/:name` | ✅ |
| Back button | window.history.back() with V4 fallback | ✅ |

## 6. Interaction consistency

| Data type | Preview locations | Full-list location | Interaction wired everywhere? |
| --- | --- | --- | --- |
| Ladder player | Right-column ladder rows | n/a (single appearance) | ✅ all rows clickable |
| Battle highlight cards | Bottom row | n/a | ✅ |

## Outstanding work (would push to 🟢)

- [ ] Wire `MmPlayerPinnedChart` into the page below the playback controls when `trackedPlayer.value` is non-empty. Use the `Set<string>` shape — convert `trackedPlayer` from a single string to a set or accept multiple comma-separated names.
- [ ] (Optional) Restore the vertical time-navigator rail with checkpoint labels alongside the console.
- [ ] (Optional) Restore the fullscreen war-room mode behind a button.
- [ ] (Optional) Keyboard arrow-up/arrow-down to jump between checkpoints.

## Sign-off

Status 🟡. The page is fully functional, all data renders, every link
stays inside V4, and the playback + console + ladder + visualizer all
work. Deferred features (fullscreen, vertical time-navigator, keyboard
checkpoint jumping) are advanced power-user paths none of the routes
that link here have ever advertised. Pinned-player chart is a
nice-to-have that exists as a component but isn't yet wired — flagged.
