# V4 Migration Inventory

Two tables:

1. **[Per-route component dependency tree](#1-per-route-component-dependency-tree)** — every in-scope public route, the view that handles it, and the components it directly imports.
2. **[Component classification](#2-component-classification)** — every legacy component, classified, with target action.

Status legend:

- **DONE** — already migrated under `views/v4/` or `components/v4/`.
- **TWIN** — needs an `Mm*` twin under `components/v4/` (or a `V4` view under `views/v4/`).
- **INLINE** — small enough to inline into the consuming V4 page; no separate file.
- **REFACTOR** — refactor legacy file in place (rare; only for theme-neutral leaves).
- **DROP** — legacy chrome that V4 replaces with its own (e.g. `ModernShell` replaces `DashboardLayout` + `Sidebar`).
- **SKIP** — out of scope (admin / internal).

Theme coupling counts (for reference — full sweep results):

- `var(--color-text)`: 60 occurrences
- `var(--color-text-muted)`: 56
- `var(--color-primary)`: 24
- `var(--color-background-mute)`: 23
- `var(--color-border)`: 21
- `var(--color-card-bg)`: 10
- `.dashboard-*` classes: ~12 total (mostly grid/layout, low impact)
- `<style scoped>` blocks: 122 files
- Sidecar `.vue.css` files: 20
- Files with `isDarkMode` / `dark-mode` / `prefers-color-scheme`: 10
- Heavy-Tailwind files (gradient/blur/glow utilities): ~15

---

## 1. Per-route component dependency tree

### Servers

| Route | View | Direct children | Sidecar CSS | Dark mode | Status |
| --- | --- | --- | --- | --- | --- |
| `/` | redirect | — | — | — | route-only |
| `/landing` and `/servers/bf1942` `/servers/fh2` `/servers/bfv` | `views/LandingPageV2.vue` | `PlayersPanel`, `PlayerSearch`, `InstallationLinksDropdown`, `PlayerHistorySection`, `landing-v3/BetaV3Banner` | `LandingPageV2.vue.css` | yes | TWIN as `views/v4/LandingPageV4.vue` (partial — needs `MmPlayersPanel`, `MmPlayerSearch`, etc.) |
| `/servers/:serverName` | `views/ServerDetails.vue` | `PlayersPanel`, `PlayerHistoryChart`, `ServerLeaderboards`, `ServerRecentSessionsFeed`, `data-explorer/MapRotationTable`, `data-explorer/ServerMapDetailPanel`, `data-explorer/WinStatsBar`, `data-explorer/ActivityHeatmap`, `data-explorer/LeaderboardPreview`, `MapRankingsPanel`, `ServerComments`, `ForecastModal`, `PingProximityOrbit`, `ServerSignatureBuilder` | `ServerDetails.vue.css` | yes | TWIN as `views/v4/ServerDetailsV4.vue` (partial — needs all data-explorer children + leaderboards) |
| `/servers/:serverName/sessions` | `components/ServerSessionsPage.vue` → wraps `SessionsPage.vue` | `SessionsPage` → `HeroBackButton` | `SessionsPage.vue.css` | check | TWIN as `views/v4/ServerSessionsV4.vue` + `components/v4/MmSessionsPage.vue` |

### Players

| Route | View | Direct children | Sidecar CSS | Dark mode | Status |
| --- | --- | --- | --- | --- | --- |
| `/players` | `views/Players.vue` → wraps `PlayersPage.vue` | `PlayersPage` (1337 lines) | `PlayersPage.vue.css` | yes | TWIN as `views/v4/PlayersV4.vue` (partial — needs `MmPlayersPage`) |
| `/players/compare` | `views/PlayerComparison.vue` | `AchievementModal`, `PlayerSearchInput`, `ComparisonSummary`, `ComparisonCoreStats`, `PerformanceOverTime`, `CommonServersSelector`, `HourlyOverlapChart`, `MapPerformanceTable`, `HeadToHeadTable`, `MilestoneAchievementsSection` | `PlayerComparison.vue.css` | yes | TWIN as `views/v4/PlayerComparisonV4.vue` |
| `/players/:playerName` | `views/PlayerDetails.vue` | `PlayerAchievementSummary`, `PlayerRecentRoundsCompact`, `PlayerAchievementHeroBadges`, `PlayerServerMapStats`, `MapRankingsPanel`, `data-explorer/PlayerDetailPanel`, `data-explorer/PlayerMapDetailPanel`, `data-explorer/ServerMapDetailPanel`, `data-explorer/PlayerCompetitiveRankings`, `data-explorer/MapPerformanceRace`, `PlayerActivityHeatmap`, `PlayerMapPreference`, `PingProximityOrbit`, `PlayerComments`, `PlayerSignatureBuilder`, `CommunityCard` | `PlayerDetails.vue.css` | yes | TWIN as `views/v4/PlayerDetailsV4.vue` (partial — needs all child twins) |
| `/players/:playerName/sessions` | `components/PlayerSessionsPage.vue` → wraps `SessionsPage.vue` | (same as server sessions) | `SessionsPage.vue.css` | check | TWIN as `views/v4/PlayerSessionsV4.vue` (shares `MmSessionsPage`) |
| `/players/:playerName/achievements` | `views/PlayerAllAchievements.vue` | `AchievementModal`, `StreakModal`, `HeroBackButton` | — | check | TWIN as `views/v4/PlayerAllAchievementsV4.vue` |
| `/players/:playerName/network` | `views/PlayerNetworkView.vue` | `PlayerNetworkGraph`, `PingProximityOrbit` | — | check | TWIN as `views/v4/PlayerNetworkV4.vue` |

### Rounds

| Route | View | Direct children | Sidecar CSS | Dark mode | Status |
| --- | --- | --- | --- | --- | --- |
| `/rounds/:roundId/report` | `components/RoundReportPageV2.vue` → `RoundReportV2.vue` | `round-report/BattleSummary`, `BattleHighlight`, `BattleVisualizer` (+ `PlaybackControls`, `PlayerPinnedChart` transitively) | `RoundReportV2.vue.css` | yes | TWIN as `views/v4/RoundReportV4.vue` + `components/v4/round-report/*` |

### Public Tournaments

| Route | View | Direct children | Sidecar CSS | Dark mode | Status |
| --- | --- | --- | --- | --- | --- |
| `/t/:id` | `views/PublicTournament.vue` | `TournamentHero`, `TournamentNewsFeed`, `TournamentPromoVideo`, `MatchDetailsModal` | `PublicTournament.vue.css` | check | TWIN as `views/v4/PublicTournamentV4.vue` |
| `/t/:id/rankings` | `views/PublicTournamentRankings.vue` | `TournamentHero`, `TournamentRankingsTable` | — | check | TWIN as `views/v4/PublicTournamentRankingsV4.vue` |
| `/t/:id/rules` | `views/PublicTournamentRules.vue` | `TournamentHero` | — | check | TWIN as `views/v4/PublicTournamentRulesV4.vue` |
| `/t/:id/teams` | `views/PublicTournamentTeams.vue` | `TournamentHero`, `CreateTeamModal`, `JoinTeamModal`, `TeamManagementPanel` | `PublicTournamentTeams.vue.css` | check | TWIN as `views/v4/PublicTournamentTeamsV4.vue` |
| `/t/:id/matches` | `views/PublicTournamentMatches.vue` | `TournamentHero`, `TournamentMatchesTable`, `MatchDetailsModal` | — | check | TWIN as `views/v4/PublicTournamentMatchesV4.vue` |
| `/t/:id/stats` | `views/PublicTournamentStats.vue` | `TournamentHero` | — | check | TWIN as `views/v4/PublicTournamentStatsV4.vue` |
| `/t/:id/files` | `views/PublicTournamentFiles.vue` | `TournamentHero` | — | check | TWIN as `views/v4/PublicTournamentFilesV4.vue` |

### Communities / map popularity / system / dashboard

| Route | View | Direct children | Sidecar CSS | Dark mode | Status |
| --- | --- | --- | --- | --- | --- |
| `/communities/:id` | `views/CommunityDetailsView.vue` | `community-details/CommunityMembersSection`, `community-details/CommunityActivityChart`, `data-explorer/PlayerServerMap` | — | check | TWIN as `views/v4/CommunityDetailsV4.vue` |
| `/map-popularity/:serverGuid` | `views/MapPopularityView.vue` | (self-contained) | — | check | TWIN as `views/v4/MapPopularityV4.vue` |
| `/system-stats` | `views/SystemStats.vue` | (self-contained) | — | check | TWIN as `views/v4/SystemStatsV4.vue` (may inline) |
| `/dashboard` | `views/Dashboard.vue` | `dashboard/PlayerNameCard`, `FavoriteServerCard`, `BuddyCard`, `EmptyStateCard`, `AddPlayerModal`, `AddServerModal`, `AddBuddyModal`, `ConfirmationModal`, `TournamentCard`, `SimpleAddTournamentModal` | `Dashboard.vue.css` | yes | TWIN as `views/v4/DashboardV4.vue` (Phase 6; biggest bag of modals) |

### Out of scope

- `/admin/tournaments/:id/...` → `TournamentDetails.vue` — **SKIP** (admin
  console; stays on legacy `DashboardLayout` + dark theme indefinitely)
- `/admin/data` → `AdminDataManagement.vue` — **SKIP** (admin)
- `/alias-detection` → `AliasDetectionView.vue` — **SKIP** (admin)
- `/auth/discord/callback` → `DiscordCallback.vue` — **SKIP** (utility)
- `/servers/:game/v3` → `LandingPageV3.vue` — **DROP** entirely (deprecated
  beta; the whole `components/landing-v3/` folder goes with it)

---

## 2. Component classification

Bucket key (matches the classification system used to decide twin vs inline vs drop):

- **L** = layout/structural shell
- **C** = chart / data-viz (Chart.js, ECharts, D3, SVG-heavy)
- **M** = modal/dialog (extends BaseModal or has a backdrop)
- **F** = feed/list/table (renders rows; leaderboard, sessions feed)
- **W** = small leaf widget (badge, indicator, button, hint)
- **S** = signature/banner image builder
- **N** = navigation / footer / shell chrome
- **B** = composite "big page" component (1000+ lines, mixed concerns)
- **D** = admin-only (skip)

### Top-level `components/*.vue`

| File | LOC | Bucket | Sidecar CSS | Used by (in-scope) | Status |
| --- | --- | --- | --- | --- | --- |
| `AIChatButton.vue` | 198 | W | — | global (App-level) | REFACTOR in place (retheme to `mm-*` tokens, no twin) — Phase 1 |
| `AIChatDrawer.vue` | 1307 | M | — | global | REFACTOR in place (retheme to `mm-*` tokens, no twin) — Phase 1 |
| `AchievementModal.vue` | — | M | — | PlayerComparison, PlayerAllAchievements | TWIN as `MmAchievementModal` |
| `ActivityTimelineBar.vue` | — | C | — | check usage | TWIN if used |
| `AliasDetectionForm.vue` etc. | — | D | — | alias-detection only | SKIP |
| `BaseModal.vue` | 375 | M | — | EVERY modal in the app | TWIN as `MmBaseModal` — Phase 1 |
| `CombinedPlayerPingChart.vue` | — | C | — | check usage | TWIN if used by in-scope page |
| `CommonServersSelector.vue` | — | F | — | PlayerComparison | TWIN |
| `CommunityCard.vue` | — | W | — | PlayerDetails | TWIN as `MmCommunityCard` |
| `ComparisonCoreStats.vue` | — | F | — | PlayerComparison | TWIN |
| `ComparisonSummary.vue` | — | W | — | PlayerComparison | TWIN |
| `CreateTeamModal.vue` | — | M | `CreateTeamModal.vue.css` | PublicTournamentTeams | TWIN as `MmCreateTeamModal` |
| `DetailedChartPopup.vue` | — | M | `DetailedChartPopup.vue.css` | check usage | TWIN if used |
| `Footer.vue` | 228 | N | — | DashboardLayout | DROP (ModernShell has its own footer) |
| `ForecastModal.vue` | — | M | — | ServerDetails | TWIN as `MmForecastModal` |
| `GameFilterButtons.vue` | 46 | W | — | (check) | TWIN as `MmGameFilterButtons` — Phase 1 |
| `HeadToHeadTable.vue` | — | F | — | PlayerComparison | TWIN |
| `HeroBackButton.vue` | 66 | W | — | SessionsPage, PlayerAllAchievements | TWIN as `MmHeroBackButton` — Phase 1 |
| `HourlyOverlapChart.vue` | — | C | — | PlayerComparison | TWIN |
| `InlinePlayersDisplay.vue` | — | F | `InlinePlayersDisplay.vue.css` | check usage | TWIN if used |
| `InstallationLinksDropdown.vue` | 99 | W | — | LandingPageV2 | TWIN as `MmInstallationLinks` — Phase 1 |
| `JoinTeamModal.vue` | — | M | `JoinTeamModal.vue.css` | PublicTournamentTeams | TWIN as `MmJoinTeamModal` |
| `LoginBenefitsModal.vue` | 114 | M | — | (check) | TWIN as `MmLoginBenefitsModal` |
| `LoginButton.vue` | 195 | W | — | Sidebar | TWIN as `MmLoginButton` (relocate into `ModernShell` topbar) |
| `MapPerformanceTable.vue` | — | F | — | PlayerComparison | TWIN |
| `MapRankingsPanel.vue` | — | F | — | ServerDetails, PlayerDetails | TWIN as `MmMapRankingsPanel` |
| `MatchDetailsModal.vue` | — | M | — | PublicTournament, PublicTournamentMatches | TWIN as `MmMatchDetailsModal` |
| `MilestoneAchievementsSection.vue` | — | F | — | PlayerComparison | TWIN |
| `MilestoneModal.vue` | — | M | — | check usage | TWIN if used |
| `MultiPlayerSelector.vue` | — | W | — | check usage | TWIN if used in-scope |
| `OlympicLeaderboard.vue` | — | F | `OlympicLeaderboard.vue.css` | check usage | TWIN if used |
| `PerformanceOverTime.vue` | — | C | — | PlayerComparison | TWIN |
| `PingProximityOrbit.vue` | 1135 | C | — | ServerDetails, PlayerDetails, PlayerNetworkView | TWIN as `MmPingProximityOrbit` |
| `PlayerAchievementHeroBadges.vue` | 223 | F | — | PlayerDetails | TWIN |
| `PlayerAchievementSummary.vue` | 221 | F | — | PlayerDetails | TWIN |
| `PlayerActivityHeatmap.vue` | 379 | C | — | PlayerDetails | TWIN |
| `PlayerComments.vue` | 716 | F | — | PlayerDetails | TWIN as `MmPlayerComments` |
| `PlayerHistoryChart.vue` | 509 | C | — | ServerDetails | TWIN as `MmPlayerHistoryChart` |
| `PlayerHistorySection.vue` | 202 | F | — | LandingPageV2 | TWIN |
| `PlayerLeaderboard.vue` | 502 | F | `PlayerLeaderboard.vue.css` | check usage | TWIN if used |
| `PlayerListItem.vue` | 137 | W | — | check usage (likely PlayersPage) | TWIN |
| `PlayerMapPreference.vue` | 398 | C | — | PlayerDetails | TWIN |
| `PlayerName.vue` | 74 | W | — | round-report/PlayerPinnedChart and likely others | REFACTOR in place (theme-neutral; small) |
| `PlayerNetworkGraph.vue` | 1273 | C | — | PlayerNetworkView | TWIN as `MmPlayerNetworkGraph` (biggest single component) |
| `PlayerRecentRoundsCompact.vue` | 307 | F | — | PlayerDetails | TWIN |
| `PlayerSearch.vue` | 207 | W | — | LandingPageV2, dashboard modals | TWIN as `MmPlayerSearch` — Phase 1 |
| `PlayerSearchInput.vue` | 235 | W | — | PlayerComparison | TWIN as `MmPlayerSearchInput` — Phase 1 |
| `PlayerServerInsights.vue` | 504 | F | — | check usage | TWIN if used in-scope |
| `PlayerServerMapStats.vue` | 408 | F | — | PlayerDetails | TWIN |
| `PlayerSessionsPage.vue` | 12 | route wrapper | — | route `/players/:name/sessions` | DROP (V4 route imports `MmSessionsPage` directly) |
| `PlayerSignatureBuilder.vue` | 597 | S | — | PlayerDetails | TWIN |
| `PlayersModal.vue` | 184 | M | — | check usage | TWIN if used in-scope |
| `PlayersPage.vue` | 1337 | B | `PlayersPage.vue.css` | Players (route `/players`) | TWIN as `MmPlayersPage` |
| `PlayersPanel.vue` | 1448 | B | — | LandingPageV2, ServerDetails | TWIN as `MmPlayersPanel` (biggest B-bucket) |
| `RoundReportPageV2.vue` | 26 | route wrapper | — | `/rounds/:roundId/report` | DROP (V4 imports `MmRoundReportV2` directly) |
| `RoundReportV2.vue` | 1080 | B | `RoundReportV2.vue.css` | RoundReportPage | TWIN as `MmRoundReportV2` |
| `ServerComments.vue` | 715 | F | — | ServerDetails | TWIN |
| `ServerLeaderboard.vue` | 530 | F | — | check vs ServerLeaderboards | TWIN if used |
| `ServerLeaderboards.vue` | 610 | F | `ServerLeaderboards.vue.css` | ServerDetails | TWIN as `MmServerLeaderboards` |
| `ServerPlayerActivityChart.vue` | 681 | C | — | check usage | TWIN if used in-scope |
| `ServerRecentSessionsFeed.vue` | 822 | F | — | ServerDetails | TWIN |
| `ServerSearch.vue` | 241 | W | — | dashboard `AddServerModal` | TWIN as `MmServerSearch` — Phase 1 |
| `ServerSessionsPage.vue` | 26 | route wrapper | — | `/servers/:name/sessions` | DROP |
| `ServerSignatureBuilder.vue` | 549 | S | — | ServerDetails | TWIN |
| `ServerWithInsights.vue` | 244 | F | — | check usage | TWIN if used in-scope |
| `SessionsPage.vue` | 1303 | B | `SessionsPage.vue.css` | Player + Server sessions | TWIN as `MmSessionsPage` |
| `Sidebar.vue` | 394 | N | — | DashboardLayout | DROP (ModernShell topbar replaces it) |
| `SimilarityRadarChart.vue` | 427 | C | — | check usage | TWIN if used |
| `SiteNoticeBanner.vue` | 80 | N | — | DashboardLayout | DROP or TWIN — TBD |
| `StreakModal.vue` | 189 | M | — | PlayerAllAchievements | TWIN |
| `TeamManagementPanel.vue` | 990 | B | `TeamManagementPanel.vue.css` | PublicTournamentTeams | TWIN |
| `ToastNotifications.vue` | 423 | W | — | DashboardLayout | TWIN as `MmToastNotifications` (mount into ModernShell) |
| `TournamentFeedEvent.vue` | 175 | F | — | TournamentNewsFeed | TWIN |
| `TournamentFeedPost.vue` | 190 | F | — | TournamentNewsFeed | TWIN |
| `TournamentHero.vue` | 397 | L | — | every Public Tournament page | TWIN — Phase 5 anchor |
| `TournamentMatchesTable.vue` | 394 | F | — | PublicTournamentMatches | TWIN |
| `TournamentNewsFeed.vue` | 361 | F | — | PublicTournament | TWIN |
| `TournamentPageNav.vue` | 184 | N | — | PublicTournament* views | TWIN |
| `TournamentPromoVideo.vue` | 69 | W | — | PublicTournament | TWIN |
| `TournamentRankingsTable.vue` | 317 | F | — | PublicTournamentRankings | TWIN |
| `TrendIndicator.vue` | 119 | W | — | many | REFACTOR in place (theme-neutral) or TWIN |

### `components/admin-data/*` — SKIP (admin only)

### `components/community-details/*`

| File | Bucket | Used by | Status |
| --- | --- | --- | --- |
| `CommunityActivityChart.vue` | C | CommunityDetailsView | TWIN |
| `CommunityActivityTimeline.vue` | C | (check) | TWIN if used |
| `CommunityMembersSection.vue` | F | CommunityDetailsView | TWIN |
| `CommunityNetworkGraph.vue` | C | (check) | TWIN if used |
| `CommunityServersSection.vue` | F | (check) | TWIN if used |

### `components/dashboard/*` — Phase 6

All used by `views/Dashboard.vue` (the user's personal dashboard) and by
admin tournament management (which is SKIP). Map each file to V4 only if
it's reachable from the personal dashboard:

| File | Bucket | Sidecar CSS | Status |
| --- | --- | --- | --- |
| `AddBuddyModal.vue` | M | — | TWIN |
| `AddFileModal.vue` | M | — | SKIP (admin tournament only) |
| `AddMatchModal.vue` | M | `AddMatchModal.vue.css` | SKIP (admin) |
| `AddPlayerModal.vue` | M | — | TWIN |
| `AddPostModal.vue` | M | `AddPostModal.vue.css` | SKIP (admin) |
| `AddRoundModal.vue` | M | `AddRoundModal.vue.css` | SKIP (admin) |
| `AddServerModal.vue` | M | — | TWIN |
| `AddTeamModal.vue` | M | — | SKIP (admin) |
| `AddTournamentModal.vue` | M | `AddTournamentModal.vue.css` | SKIP (admin) |
| `AddWeekModal.vue` | M | — | SKIP (admin) |
| `BuddyCard.vue` | W | — | TWIN |
| `ConfirmationModal.vue` | M | — | TWIN (shared utility) |
| `EditMapResultsModal.vue` | M | `EditMapResultsModal.vue.css` | SKIP (admin) |
| `EditTournamentThemeModal.vue` | M | — | SKIP (admin) |
| `EmptyStateCard.vue` | W | — | TWIN (shared utility) |
| `FavoriteServerCard.vue` | W | — | TWIN |
| `GameSelector.vue` | W | — | (verify usage in dashboard) |
| `ImageUpload.vue` | W | — | SKIP (admin) |
| `MapImageSelectorModal.vue` | M | `MapImageSelectorModal.vue.css` | SKIP (admin) |
| `MarkdownEditor.vue` | W | — | SKIP (admin) |
| `MarkdownHelpModal.vue` | M | — | SKIP (admin) |
| `MatchFilesAndCommentsModal.vue` | M | `MatchFilesAndCommentsModal.vue.css` | SKIP (admin) |
| `PlayerNameCard.vue` | W | — | TWIN |
| `PlayerProfileCard.vue` | W | — | TWIN (verify usage) |
| `RecentActivityFeed.vue` | F | — | TWIN (verify usage) |
| `ServerSelector.vue` | W | — | SKIP (admin) |
| `SimpleAddTournamentModal.vue` | M | — | TWIN |
| `SocialMediaLinks.vue` | W | — | SKIP (admin) |
| `TournamentCard.vue` | W | — | TWIN |

### `components/data-explorer/*` — Phase 2 / 3

All used by ServerDetails, PlayerDetails, or CommunityDetailsView.

| File | Bucket | Status |
| --- | --- | --- |
| `ActivityHeatmap.vue` | C | TWIN |
| `LeaderboardCard.vue` | F | TWIN |
| `LeaderboardPreview.vue` | F | TWIN |
| `LeaderboardTable.vue` | F | TWIN |
| `MapPerformanceRace.vue` | C | TWIN |
| `MapPlayerRankings.vue` | F | TWIN |
| `MapRotationTable.vue` | F | TWIN |
| `PlayerCompetitiveRankings.vue` | F | TWIN |
| `PlayerCompetitiveRankingsChart.vue` | C | TWIN |
| `PlayerDetailPanel.vue` | F | TWIN |
| `PlayerMapDetailPanel.vue` | F | TWIN |
| `PlayerMapServerTable.vue` | F | (verify usage) |
| `PlayerServerMap.vue` | C | TWIN (CommunityDetailsView) |
| `RecentSessionsList.vue` | F | TWIN (used inside ServerMapDetailPanel) |
| `ServerMapDetailPanel.vue` | F | TWIN |
| `ServerRotationTable.vue` | F | (verify usage) |
| `WinStatsBar.vue` | W | TWIN |

### `components/round-report/*` — Phase 4

| File | Bucket | Status |
| --- | --- | --- |
| `BattleHighlight.vue` | F | TWIN |
| `BattleSummary.vue` | F | TWIN |
| `BattleVisualizer.vue` | C | TWIN |
| `PlaybackControls.vue` | W | TWIN |
| `PlayerPinnedChart.vue` | C | TWIN |

### `components/landing-v3/*` — DROP

The whole folder (`BetaV3Banner`, `LiveRoundsRibbon`, `NetworkHeatmap`,
`RecentRoundsFeed`, `YourFrontStrip`) deletes at cutover. V3 isn't being
migrated.

### `components/icons/*` — keep

`IconCommunity`, `IconDocumentation`, `IconEcosystem`, `IconSupport`,
`IconTooling` — theme-neutral SVG. **REFACTOR** (audit fill colors, then
keep as-is).

### `components/tournament-admin/*` and `components/admin-data/*` — SKIP

Admin only.

---

## Surprises and gotchas

- **Tailwind utility classes are concentrated**: `Sidebar.vue` (41 lines
  with Tailwind utility classes), `views/PlayerAllAchievements.vue` (31),
  `ServerPlayerActivityChart.vue` (14). Most files have ≤ 10. The legacy
  theme is not "Tailwind-everywhere" — it's CSS-vars-everywhere with
  Tailwind sprinkled on a handful of recently-redesigned files.
- **`<style scoped>` is the dominant pattern** (122 files). The
  modern-minimal theme is **not scoped** — it relies on the global `.mm`
  ancestor selector. When migrating, either:
  - Keep `<style scoped>` and rewrite every selector to use mm tokens, or
  - Remove `<style scoped>` and assume the template uses `.mm-*` classes
    (preferred — fewer maintenance points).
- **Sidecar `.vue.css` files (20 of them)** mostly hold layout grids and
  responsive media queries that conflict with the V4 typography scale.
  None of them should be carried over verbatim — fold the rules into the
  V4 SFC or replace them with `.mm-*` classes from `modern-minimal.css`.
- **`PingProximityOrbit.vue` (1135 lines) and `PlayerNetworkGraph.vue`
  (1273 lines)** are SVG/D3 heavy and use inline color logic — they will
  need `mmTokens.ts` extensions for the color band logic that's currently
  hard-coded against legacy colors.
- **`PlayersPanel.vue` is used by both LandingPageV2 and ServerDetails**;
  it's the single most-reused big component (1448 lines, "B" bucket). Get
  this one right in Phase 2 — it pays back twice.
- **Route wrappers** (`PlayerSessionsPage.vue`, `ServerSessionsPage.vue`,
  `RoundReportPageV2.vue`) are 12–26-line files that exist purely because
  vue-router needs a top-level component for some paths. The V4 router
  can import the actual page component directly and these wrappers
  delete at cutover.
- **`AIChatDrawer.vue` (1307 lines)** is mounted globally via `App.vue`
  somewhere — verify exactly where and decide whether the V4 layout
  mounts it or whether AI chat gets redesigned. Flagged in
  [Open Q3](./README.md#open-questions).
- **No router calls inside `LandingPageV4`, `PlayersV4` (so far)** — the
  existing V4 pages are intentionally minimal, which is why your "change
  a page" prompts haven't pulled in the children. Once we wire up
  `MmPlayersPanel`, `MmPlayerHistoryChart`, etc., a "change this page"
  prompt will start cascading because the component dependency tree is
  finally real.
