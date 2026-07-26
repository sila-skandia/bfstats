# Public Tournaments — V2 Redesign

Redesign the public-facing tournament experience (`/t/:id/*`) to the new
**"Silver Bullet" league theme** in `tournaments-site-v2/`, while leaving
existing tournaments on their current layout untouched.

## The new theme (canonical source: `tournaments-site-v2/Tournament v3.dc.html`)

Deliberately **breaks out** of the site-wide "Neutral Depth" v4 theme. It is a
warm, editorial, broadcast-league look:

- **Surface:** warm near-black `--t-bg #14100c` (not the v4 `#131313`), surfaces
  derived via `color-mix` off the text colour.
- **Accent:** gold `--t-accent #c8a24a` (per-tournament configurable).
- **Type:** `Oswald` (condensed uppercase display/headings), `Barlow` (body),
  `Geist Mono` (labels, stats, timestamps). Loaded from Google Fonts + PrimeIcons
  7.0 (already used elsewhere).
- **Signature devices:** `//` olive-gold section markers, 2px accent rules under
  table heads, hairline dividers (no cards-with-shadows), timeline activity feed,
  gradient/thumbnail map tiles, condensed-uppercase team names.
- `Tournament.dc.html` and `Tournament v2.dc.html` are **earlier iterations** —
  v3 is the reference. (v3 differs mainly in the compact cover-band hero and the
  two-column overview.)

The theme is driven by the same 3 fields we already store on `TournamentTheme`:
`BackgroundColour` / `TextColour` / `AccentColour`. **No new theme fields needed.**

## Versioning mechanism (decided)

Add `LayoutVersion int` to `Tournament` (default `1`).

- Existing rows → `1` → **legacy components render unchanged**.
- New tournaments → default `2` → new V2 shell.
- `/t/:id/*` routes are **unchanged**; the view layer branches on
  `tournament.layoutVersion`.
- Admin gets a per-tournament toggle to flip between v1 and v2.

## Features dropped (no backing data)

- **"Season 1 · Battle of Africa" subtitle** — no season/subtitle field exists.
  Use tournament `name` only. Everything else in the design maps to real schema.

---

## Complete component inventory (public tournament subsystem)

Everything below renders inside the themed public pages and must be covered so no
old-styled component is left behind.

### Routed views (7) — `ui/src/views/`
- [ ] `PublicTournament.vue` (overview: registration banner, activity feed, promo)
- [ ] `PublicTournamentRankings.vue` (season leaderboard + week filter)
- [ ] `PublicTournamentMatches.vue` (week groups, match cards, per-map accordion)
- [ ] `PublicTournamentTeams.vue` (team grid, rosters, register/join/manage)
- [ ] `PublicTournamentStats.vue` (player performance leaderboard)
- [ ] `PublicTournamentFiles.vue` (categorised downloads)
- [ ] `PublicTournamentRules.vue` (general + registration rules markdown)

### Shell / shared
- [ ] `components/TournamentHero.vue` — organiser strip + hero + **nav tabs**
- [ ] `composables/usePublicTournamentPage.ts` — data + theme-var engine
- [ ] `composables/useTournamentCache.ts`, `usePlayerComparison.ts` (behaviour reuse)

### Overview body
- [ ] `components/TournamentNewsFeed.vue`
  - [ ] `components/TournamentFeedEvent.vue`
  - [ ] `components/TournamentFeedPost.vue`
- [ ] `components/TournamentPromoVideo.vue`

### Rankings / Matches body
- [ ] `components/TournamentRankingsTable.vue`
- [ ] `components/TournamentMatchesTable.vue`
- [ ] `components/MatchDetailsModal.vue`
  - [ ] `components/dashboard/MatchFilesAndCommentsModal.vue`
  - [ ] player comparison view (via `usePlayerComparison`)

### Teams body (registration workflow)
- [ ] `components/CreateTeamModal.vue` → `PlayerSearch.vue`
- [ ] `components/JoinTeamModal.vue` → `PlayerSearch.vue`
- [ ] `components/TeamManagementPanel.vue` → `MultiPlayerSelector.vue`

> `PlayerSearch` / `MultiPlayerSelector` are shared app widgets; inside V2 pages
> they'll be wrapped/scoped so they inherit the `--t-*` theme rather than the
> global look.

---

## Implementation strategy

Build a **parallel V2 component tree** rather than mutating legacy files, so v1
tournaments keep working and the branch is a clean `layoutVersion` switch.

- New V2 components live in `ui/src/components/tournament-v2/` and
  `ui/src/views/tournament-v2/` (naming TBD during build).
- A single `PublicTournamentShellV2.vue` owns the organiser strip + cover-band
  hero + sticky nav, and renders the section matching the current route's
  subpage — preserving deep links while giving the cohesive single-page feel.
- All colours come from `--t-*` CSS vars set by the existing theme engine (extend
  `usePublicTournamentPage` to also emit the warm-surface / mono-font tokens the
  design uses). **No hardcoded hex** in components.
- Routing: each `/t/:id/*` route resolves tournament, then renders V2 shell if
  `layoutVersion === 2`, else the current legacy view.

---

## Checkpoints

### CP0 — Schema + plumbing ✅
- [x] `LayoutVersion` (int, default 1) on `Tournament` + EF migration
      `20260725230608_AddTournamentLayoutVersion` (existing rows default 1,
      `HasDefaultValue(1)` in model config).
- [x] `layoutVersion` in `PublicTournamentDetailResponse` + admin
      `TournamentDetailResponse` + TS interfaces (public + admin services).
- [x] Admin toggle: "Public Page Layout" select (Legacy v1 / League v2) in
      `TournamentSettingsTab`; create endpoint defaults new tournaments to 2;
      update endpoint validates 1|2.
- [x] `/t/:id/*` routes now point at `PublicTournamentGate.vue` which renders
      the untouched legacy views for v1 and the V2 shell for v2.

### CP1 — V2 shell + theme tokens ✅
- [x] `ui/src/styles/tournament-v2.css` — `.t2` scope; 3 inputs
      (`--t-bg/--t-text/--t-accent` from `TournamentTheme`, defaults
      `#14100c / #f2ece0 / #c8a24a`), all other tints derived via `color-mix`.
      Legacy `--color-*` vars bridged so reused modals inherit the palette.
- [x] `PublicTournamentShellV2`: organiser strip (logo/dot + name +
      "Hosted on bfstats"), cover-band hero (status chip w/ live dot,
      "Presented by organizer", title, game/mode/teams/since meta,
      match-progress bar from `anticipatedRoundCount`, Watch-live CTA +
      Discord/YouTube/Twitch/Forum icons), sticky nav with count badges, footer.
- [x] Oswald/Barlow loaded once from Google Fonts by the shell; Geist Mono +
      PrimeIcons reuse the app's existing loads.

### CP2 — Overview ✅ (`T2Overview.vue`)
- [x] Registration-open banner → Teams CTA.
- [x] Timeline activity feed (all 4 event types, markdown posts, relative
      timestamps w/ local tooltips, cursor "load earlier" pagination).
- [x] Top-4 standings sidebar (via leaderboard API) + promo video embed.

### CP3 — Rankings ✅ (`T2Rankings.vue`)
- [x] Full leaderboard table (MP V T L RW RT RL TF TA +/- PTS), gold/silver/
      bronze podium tints, week filter pills (Overall + schedule weeks).

### CP4 — Matches ✅ (`T2Matches.vue`)
- [x] Week-grouped list, aggregate tickets + round-wins, winner/Tie/Upcoming
      badges, map tiles (uploaded `imagePath` art or deterministic gradient,
      picked-by, per-round scores), local times with eyebrow notice.
- [x] Match details & demos reuses `MatchDetailsModal` (incl. referee comments
      + compare players) with V2 palette passed as props.

### CP5 — Teams ✅ (`T2Teams.vue`)
- [x] Team grid (name/tag/leader/reg date, recruitment chip), roster rows
      (CAPT marker, pending status), viewer's team highlighted + sorted first,
      leader sees pending members. *(rules-ack ✓ dropped — not in public DTO.)*
- [x] Create / Join / Manage workflows reuse the shared modals with V2 palette;
      refresh flows re-fetch via gate (no full reload). Discord sign-in prompt.

### CP6 — Stats, Files, Rules
- [x] ~~Player performance leaderboard~~ **dropped** — no public player-stats
      endpoint exists (legacy page was "Coming Soon"). No Stats tab in V2 nav;
      direct `/stats` URL shows a dry empty state.
- [x] Categorised file downloads (`T2Files.vue`) with per-category icons.
- [x] Rules + registration rules markdown, two-column (`T2Rules.vue`).

### CP7 — Polish + verify ✅
- [x] Mobile audit at 390px: matches (single-column map tiles + compressed
      scoreline), teams (single-column cards), rankings (table scrolls inside
      `overflow-x` wrapper, podium tints + wrapping week pills). Desktop 1280px
      matches the mock.
- [x] Player-name decoding: `$pn()` on organizer, team leader, roster names.
- [x] Timestamps: `timeUtils` helpers (UTC-safe parse), local tooltips,
      "Times shown in your local time" eyebrow on Matches.
- [x] Browser-tested both layouts against the dev app (v1 → legacy
      `.portal-page`, v2 → `.t2` shell; verified via the gate).

## Verification notes
- `npx vue-tsc --noEmit`: no errors in any new/modified file (the remaining
  `TS6133` unused-var warnings are pre-existing in `TournamentSettingsTab.vue`,
  which was already WIP-modified before this work).
- `npm run build`: ✅
- API unit tests: 78/78 ✅.
- Tournament E2E (`tournament-management` + `-deep`): 3 pass; 1 deep-suite
  failure is in the **Weeks-tab date inputs** (unrelated admin form, not my
  change) — pre-existing flake in the user's WIP admin edits.
- Live DB check: existing tournaments report `layoutVersion: 1` after the
  migration; flipping to 2 renders the league layout; both restored to 1 after
  testing (admin toggle is the intended way to switch).

## Follow-ups / notes for later
- **Map tile art**: uses uploaded `imagePath` when set, else a deterministic
  hue gradient. If a map-thumbnail asset convention exists, wire it in
  `T2Matches.mapArtStyle`.
- **Referee comments / demos**: surfaced through the reused `MatchDetailsModal`
  ("Match details & demos" link) rather than reskinned inline — it already
  carries the V2 palette via props.
- **Rules-ack ✓** on rosters is intentionally omitted (not in the public team
  DTO). Add `rulesAcknowledged` to `PublicTournamentTeamPlayerResponse` if it
  should show publicly.
