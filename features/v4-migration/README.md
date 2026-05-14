# V4 Theme Migration — Modern-Minimal Replaces Legacy

## Thesis

The legacy UI is a dark "command center" theme: gradient-glass cards, neon
cyan/purple accents, animated background blurs, dark/light mode toggle, and
a heavy mix of Tailwind utilities, scoped `<style>` blocks, and sidecar
`.vue.css` files. It works, but it reads as generic SaaS and visually fights
the data.

V4 ("modern-minimal", scoped under `.mm` in
`ui/src/styles/modern-minimal.css`) is a quiet editorial theme — cream
background, ink-on-paper typography, hairline rules, semantic numeric tints
(K/D bands, server load tints), no dark mode. It's already partially shipped
under `/v4/*` as a parallel preview with four pages:

- `views/v4/LandingPageV4.vue`
- `views/v4/PlayerDetailsV4.vue`
- `views/v4/PlayersV4.vue`
- `views/v4/ServerDetailsV4.vue`

…plus two SVG primitives in `components/v4/` (`MmSparkline`, `MmBars`).

The remaining ~30 legacy views and ~80 legacy components are not yet
migrated, and the four V4 pages above are largely **self-contained inline
templates** — they don't yet reuse the heavier shared components
(`PlayerHistoryChart`, `PlayerNetworkGraph`, leaderboards, sessions feeds,
modals, etc.) that the legacy pages depend on.

This migration finishes that job, then deletes the legacy theme.

## Decisions locked in

- **End state**: V4 replaces legacy entirely. Legacy views, `DashboardLayout`,
  `Sidebar`, dark-mode CSS, and `--color-*` tokens all get deleted at the
  cutover.
- **Free to break**: We do not need to keep the legacy theme working during
  the migration. We can rewrite shared components in place; we don't need
  parallel `Mm`-prefixed twins for every primitive.
- **Scope**: User-facing pages only. Admin (`/admin/*`, `/alias-detection`)
  **stays on the legacy theme indefinitely** as an internal admin
  console — its own dark-themed shell with `DashboardLayout`, `Sidebar`,
  the `--color-*` tokens, and the dark/light-mode toggle all survive.
- **Build under `/v4/*` then cut over**: Each migrated page lives at
  `/v4/<route>` so we can validate it in isolation against the real legacy
  page at `<route>`. When every in-scope page is done, the cutover swaps
  routes, drops the `/v4/` prefix, deletes the in-scope legacy files
  only, and drops the `.mm` scope. Admin's slice of legacy CSS stays.
- **Shell selector flips**: today `App.vue` renders `ModernShell` when
  `route.startsWith('/v4')`; after cutover it renders `DashboardLayout`
  when `route.startsWith('/admin') || route === '/alias-detection'` and
  `ModernShell` otherwise.

See [INVENTORY.md](./INVENTORY.md) for the per-route component-dependency
matrix and [CROSSWALK.md](./CROSSWALK.md) for the token/class/pattern map.

## Verification — required before marking a page done

Every page-level migration cycle ends with a **verification pass** against
the legacy version. See [verification/README.md](./verification/README.md)
for the protocol and [verification/MATRIX.md](./verification/MATRIX.md)
for the live status of every in-scope page.

The protocol catches the regressions type-checks can't:

- **Wrong filter key** — `playerName` vs `playerNames` was caught here.
  Type-safe on both ends, broken in production.
- **Wrong endpoint** — V4 hitting `/stats/sessions` instead of
  `/stats/rounds`, or missing a query param.
- **Wrong data** — Lifetime kills time-boxed when it should be true
  lifetime; tabs that swap but render different columns; filters that
  silently no-op.
- **Wrong navigation** — `router.push('/players/...')` instead of
  `/v4/players/...`. Dead-end routes (built but unreachable).

A page may not transition from `in_progress` to `completed` in the task
list until its verification doc exists and shows 🟢. Pages with
documented intentional divergences ship at 🟡; pages with unresolved
bugs stay 🔴 and block the cycle.

## How a single component gets migrated

For any legacy component or view, the recipe is:

1. **Read the legacy file end-to-end.** Note its props, emits, and the
   external state it touches (services, composables, stores). Those don't
   change — only the chrome does.
2. **Locate it in [INVENTORY.md](./INVENTORY.md)** to confirm its target
   status (V4 twin, refactor in place, or drop).
3. **Pick the target location**:
   - **View** → mirror the legacy path under `views/v4/` (e.g.
     `views/PlayerComparison.vue` → `views/v4/PlayerComparisonV4.vue`).
   - **Shared component** → mirror under `components/v4/` with an `Mm`
     prefix (e.g. `PlayerHistoryChart.vue` →
     `components/v4/MmPlayerHistoryChart.vue`). The `Mm` prefix is a marker
     that this component renders inside an `.mm`-scoped tree; it gets
     stripped at the cutover.
   - **Subfolder component** (e.g. `round-report/`, `data-explorer/`) →
     mirror under `components/v4/round-report/`, etc.
4. **Translate the template**:
   - Strip Tailwind utility classes and `dashboard-*` classes. Replace with
     semantic `.mm-*` classes (see [CROSSWALK.md](./CROSSWALK.md)).
   - Strip dark-mode branches (`isDarkMode`, `dark-mode` class checks).
   - Strip animated background blurs, gradient glow, and any pulse
     decorations that aren't core to the data.
5. **Translate the styles**:
   - Inline `<style scoped>` blocks: rewrite to use `--mm-*` tokens and the
     modern-minimal type/spacing scale.
   - Sidecar `.vue.css` files: do not migrate as-is. Either fold the
     necessary rules back into the SFC or replace them with the equivalent
     `.mm-*` utility classes. The sidecar file does **not** get a V4 twin —
     it stays unreferenced by the V4 component and gets deleted at cutover
     along with its legacy SFC.
6. **Reuse `mmTokens.ts`** for numeric coloring (`kdClass`, `streakClass`,
   `loadClass`). Extend it if you find a new semantic numeric band
   (accuracy, win rate, etc.) — keep the band logic in one place.
6a. **Verify every API field you read is actually populated.** The TS
    interfaces in `services/` and `types/` are hand-maintained and
    routinely lie — fields declared with no C# property behind them
    are common. Before binding `{{ response.someField }}` in a
    template, trace the controller → service → model and confirm a
    C# property writes that field. See
    [CROSSWALK § Don't trust the TypeScript interface](./CROSSWALK.md#recipe-dont-trust-the-typescript-interface--check-the-actual-payload)
    for the full check.
7. **Decode player names** per the project rule: `$pn(name)` in templates,
   `decodePlayerName(name)` in TS. Never decode when the value is used as a
   key or router param.
8. **Update the route**: add or update the entry in
   `ui/src/router/index.ts` so the V4 view is reachable under `/v4/<path>`.
   Keep the legacy route untouched until cutover.

## Decision rules

- **When to make a new `Mm*` twin vs. inline a small element**: if a
  component is used by **2 or more** in-scope V4 pages, give it a twin in
  `components/v4/`. If it's used by exactly one page, inline it into that
  page's template unless it crosses ~120 lines or owns non-trivial logic.
- **When to refactor in place instead of writing a twin**: only for tiny,
  stateless leaves that have no theme-specific styling to begin with
  (`PlayerName.vue`, `TrendIndicator.vue`, plain icon files in
  `components/icons/`). For everything else, write a twin — even though we
  said we could refactor in place, the twins keep the cutover review
  tractable.
- **When to drop a component entirely**: see [INVENTORY.md](./INVENTORY.md)
  — components marked **DROP** are legacy-only chrome (Sidebar's gradient
  panel, SiteNoticeBanner if not needed, Footer's legacy variant). V4 has
  its own `ModernShell` topbar + footer.

## Roadmap

Phases group pages that share components — finishing a phase finishes the
shared deps and unlocks the next phase cheaply.

### Phase 0 — Foundation (already done)
- `ModernShell` layout, `modern-minimal.css`, `mmTokens.ts`,
  `MmSparkline`, `MmBars`. The four V4 pages are skeletons that need to
  pull in the migrated child components produced in later phases.

### Phase 1 — Shared chrome and primitives
- **Self-host the Geist font family**. `modern-minimal.css` lists
  `'Geist'` and `'Geist Mono'` as primary fonts. Drop the woff2 files into
  `ui/public/fonts/` (or `ui/src/assets/fonts/`) and add `@font-face`
  declarations to `modern-minimal.css` so the font ships with the build.
  Fallback to Google Fonts via `<link>` in `index.html` is acceptable if
  hosting the woff2 files is friction — but self-host is preferred (no
  third-party request on every page load).
- **Retheme `AIChatButton.vue` and `AIChatDrawer.vue` in place** —
  these are not getting V4 twins; they stay at their existing file
  paths and get rewritten to use `mm-*` tokens directly. Verify they
  render acceptably both inside `ModernShell` (V4 user-facing pages)
  and inside `DashboardLayout` (admin pages, post-cutover) — if they
  only mount on user-facing pages today, we can simplify to mm-only
  styling; if they mount everywhere, they need to look at least neutral
  on the admin dark theme.

Build the `Mm*` twins that almost every page consumes:
- `MmHeroBackButton` (legacy `HeroBackButton`)
- `MmPlayerName` (or refactor `PlayerName.vue` in place — it's 74 lines)
- `MmTrendIndicator` (legacy `TrendIndicator`)
- `MmBaseModal` (legacy `BaseModal` — drives every dialog)
- `MmFooter` (legacy `Footer` — `ModernShell` already has a footer; decide
  whether to keep V4's inline one or extract)
- `MmInstallationLinks` (legacy `InstallationLinksDropdown`)
- `MmPlayerSearch` / `MmPlayerSearchInput` / `MmServerSearch`
- `MmGameFilterButtons` (the BF1942/FH2/BFV switcher)
- `MmToastNotifications` — likely stays untouched if it has no theme
  coupling; verify.

### Phase 2 — Servers surface
Pages: `/v4/servers/bf1942` (already partly done), `/v4/servers/detail/:name`
(already partly done), `/v4/servers/:name/sessions` (new).
Components to twin:
- `MmPlayersPanel` (legacy `PlayersPanel` — 1448 lines, the biggest one)
- `MmPlayerHistoryChart` (Chart.js)
- `MmServerLeaderboards` + `MmServerLeaderboard`
- `MmServerRecentSessionsFeed`
- `MmMapRotationTable`, `MmServerMapDetailPanel`, `MmWinStatsBar`,
  `MmActivityHeatmap`, `MmLeaderboardPreview` (all from
  `components/data-explorer/`)
- `MmMapRankingsPanel`, `MmServerComments`, `MmForecastModal`,
  `MmPingProximityOrbit`, `MmServerSignatureBuilder`
- `MmSessionsPage` (legacy `SessionsPage` — 1303 lines, shared with player
  sessions in Phase 3)

### Phase 3 — Players surface
Pages: `/v4/players` (already partly done), `/v4/players/:name` (already
partly done), `/v4/players/:name/sessions`, `/v4/players/:name/achievements`,
`/v4/players/:name/network`, `/v4/players/compare`.
Components to twin:
- `MmPlayersPage` (legacy `PlayersPage` — 1337 lines)
- `MmPlayerAchievementSummary`, `MmPlayerAchievementHeroBadges`
- `MmPlayerRecentRoundsCompact`
- `MmPlayerServerMapStats`, `MmPlayerMapPreference`,
  `MmPlayerActivityHeatmap`, `MmPlayerComments`
- `MmPlayerSignatureBuilder`
- `MmAchievementModal`, `MmStreakModal`, `MmMilestoneAchievementsSection`,
  `MmMilestoneModal`
- `MmPlayerNetworkGraph` (1273 lines — biggest data-viz)
- `MmCommunityCard`
- `MmComparisonSummary`, `MmComparisonCoreStats`,
  `MmPerformanceOverTime`, `MmCommonServersSelector`,
  `MmHourlyOverlapChart`, `MmMapPerformanceTable`, `MmHeadToHeadTable`
- `MmPlayerDetailPanel`, `MmPlayerMapDetailPanel`,
  `MmPlayerCompetitiveRankings` + chart (from `data-explorer/`)

### Phase 4 — Round report
Page: `/v4/rounds/:roundId/report`.
Components: `MmRoundReportV2` (1080 lines, sidecar CSS) and its three
children (`BattleSummary`, `BattleHighlight`, `BattleVisualizer`,
`PlaybackControls`, `PlayerPinnedChart`).

### Phase 5 — Public tournaments
Pages: `/v4/t/:id`, `/v4/t/:id/rankings`, `/v4/t/:id/rules`, `/v4/t/:id/teams`,
`/v4/t/:id/matches`, `/v4/t/:id/stats`, `/v4/t/:id/files`.
Components to twin:
- `MmTournamentHero` (drives every tournament page header)
- `MmTournamentPageNav`, `MmTournamentNewsFeed`,
  `MmTournamentFeedEvent`, `MmTournamentFeedPost`,
  `MmTournamentPromoVideo`, `MmTournamentRankingsTable`,
  `MmTournamentMatchesTable`, `MmMatchDetailsModal`,
  `MmCreateTeamModal`, `MmJoinTeamModal`, `MmTeamManagementPanel`

### Phase 6 — Communities, map popularity, system stats, dashboard
Pages: `/v4/communities/:id`, `/v4/map-popularity/:serverGuid`,
`/v4/system-stats`, `/v4/dashboard`.
Components to twin:
- `MmCommunityActivityChart`, `MmCommunityMembersSection`,
  `MmCommunityActivityTimeline`, `MmCommunityNetworkGraph`,
  `MmCommunityServersSection`
- All `components/dashboard/*` (private dashboard) — biggest pile of
  modals; defer this phase until last if pressed for time.

### Phase 7 — Cutover
See [Cutover checklist](#cutover-checklist).

## Cutover checklist

When every Phase 1–6 page has a V4 twin shipping at `/v4/*` and verified
against its legacy counterpart:

1. **Flip the routes** in `ui/src/router/index.ts`: in-scope V4 routes
   lose the `/v4/` prefix and take over the legacy paths. Legacy
   redirects (`/explore/*` etc.) collapse to point at the new paths. The
   `/v4` namespace is removed. Admin routes (`/admin/*`,
   `/alias-detection`) are untouched.
2. **Flip the shell selector** in `App.vue`: change the condition from
   `route.startsWith('/v4')` (renders `ModernShell`) to
   `!(route.startsWith('/admin') || route === '/alias-detection')`
   (renders `ModernShell`). The complement still renders
   `DashboardLayout`. The `body.mm-body` toggle inverts in lockstep.
3. **Delete in-scope legacy view files**: every `ui/src/views/*.vue`
   that has a V4 twin per [INVENTORY.md](./INVENTORY.md). Drop their
   sidecar `.vue.css` files. **Do not** delete `AdminDataManagement.vue`,
   `AliasDetectionView.vue`, `TournamentDetails.vue` — those stay.
4. **Delete in-scope legacy components** that have V4 twins. Anything
   marked **DROP** in [INVENTORY.md](./INVENTORY.md) goes. Components
   still consumed by admin (e.g. `BaseModal` if admin imports it
   directly — verify) **stay**.
5. **Drop the `.mm` scope** from the V4 styles: the modern-minimal
   styles need to apply globally to non-admin pages. Either rename `.mm`
   to a body-level selector that admin pages don't match, or keep the
   `.mm` class and have `ModernShell` always apply it (current approach).
   The latter is simpler and preserves admin isolation — recommend
   keeping it.
6. **Rename `Mm*` files back to their plain names**: `MmPlayerHistoryChart`
   → `PlayerHistoryChart`, `views/v4/PlayerDetailsV4.vue` →
   `views/PlayerDetails.vue`, etc. Single big sed pass; commit separately
   so the diff is reviewable. (Components that still also exist as
   legacy versions get a rename collision — resolve by deleting the
   legacy first, then renaming.)
7. **Keep dark mode and `--color-*` tokens**: admin pages still use
   them. The dark/light toggle in `App.vue` stays. The
   `prefers-color-scheme` listener stays. Audit which `--color-*` vars
   are actually referenced post-migration (run a grep) and prune any
   that have zero admin usage.
8. **Delete `views/LandingPageV3.vue`** and the `components/landing-v3/`
   folder — V3 was a beta side-quest and isn't migrated.
9. **Keep `DashboardLayout.vue` and `Sidebar.vue`** — admin uses them.
   But verify the sidebar links: post-cutover, the Sidebar's
   non-admin links (Servers, Players, Dashboard, etc.) should either
   route to the now-default V4 pages or be removed entirely (admin
   sidebar should probably only show admin links).
10. **Run** `./scripts/verify.sh` end-to-end on the full E2E suite. Pay
    special attention to `e2e/responsive-mobile.spec.ts`,
    `e2e/landing.spec.ts`, `e2e/player-search.spec.ts`,
    `e2e/server-details.spec.ts`, `e2e/data-explorer.spec.ts`.
11. **Audit Playwright tests for legacy selectors**: tests that select
    `.dashboard-*`, `.bg-cyan-*`, etc. break at cutover. Sweep + update
    selectors to `.mm-*` equivalents per [CROSSWALK.md](./CROSSWALK.md).
12. **Smoke-test the deployed build** against every in-scope route before
    flipping production traffic.

## Constraints inherited from the project

These are not optional and apply to every page/component migrated:

- **Mobile friendly**: every V4 page must render cleanly on phones. The
  modern-minimal CSS already has `@media (max-width: 720px)` /
  `@media (max-width: 880px)` blocks for `mm-list`, `mm-stats`,
  `mm-topbar`, `mm-overview__row`, `mm-subtabs` — reuse those breakpoints,
  don't invent new ones.
- **E2E coverage**: every migrated page must keep its Playwright suite
  passing. When the legacy DOM structure changes (e.g. `.player-card` →
  `.mm-card`), update the test selectors in the same commit.
- **Player name decoding**: `$pn(name)` in templates,
  `decodePlayerName(name)` in TS. Never decode for keys / router params.
- **No `Co-Authored-By` lines** in commit messages.
- **Do not commit or push** unless explicitly asked.

## Resolutions

These were open questions when the plan was first drafted; the answers
below are now load-bearing for the rest of the document.

1. **Admin pages stay on legacy.** `/admin/*` and `/alias-detection` keep
   `DashboardLayout`, `Sidebar`, the `.dark-mode` / `.light-mode` CSS
   blocks, and the `--color-*` token surface. They are an internal admin
   console and that's where the dark visual identity lives. Implications
   are reflected in [Decisions locked in](#decisions-locked-in) and the
   [Cutover checklist](#cutover-checklist).
2. **Dashboard (`/dashboard`) is in scope.** Phase 6 still owns it.
   When a dashboard modal has unused complexity, simplify during the
   migration rather than carrying it forward — the migration is a
   reasonable time to take refactor liberties on the personal-dashboard
   surface.
3. **AIChat retheme in place — no twin.** `AIChatButton.vue` and
   `AIChatDrawer.vue` get rewritten at their existing paths to use
   `mm-*` tokens. They're not duplicated to `components/v4/`. Phase 1
   includes them.
4. **LandingPageV3 is deletable.** The `views/LandingPageV3.vue` view,
   the `components/landing-v3/` folder, and the three `/servers/:game/v3`
   routes all delete at cutover (or earlier — they're not blocking the
   migration).
5. **`/system-stats` is public.** It stays in scope; Phase 6 builds
   `SystemStatsV4`.
6. **Geist self-hosted.** Foundation task in Phase 1: drop Geist + Geist
   Mono woff2 files into the repo and add `@font-face` declarations.
   Google Fonts is an acceptable fallback if the woff2 files are
   friction, but self-hosting is preferred.
