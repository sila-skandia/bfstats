# CLAUDE.md

UI for bfstats.io — a statistics dashboard for Battlefield 1942,
Forgotten Hope 2, and Battlefield Vietnam servers and players.

## Tech stack

- Vue 3 + TypeScript (`<script setup>`)
- Vite build
- Playwright E2E tests
- Single design system: **Neutral Depth** (dark, scoped under `.mm`),
  defined in `src/styles/modern-minimal.css`. See
  [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

## Docs map

| Doc | What it covers |
| --- | --- |
| [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) | Overview — tokens, non-negotiable rules, where things live |
| [PATTERNS.md](./PATTERNS.md) | Recipe collection — modal, chart, hero, list, drill-in, pagination, scroll reset, timestamps, etc. |
| [MOBILE_PATTERNS.md](./MOBILE_PATTERNS.md) | Mobile layout playbook + audit checklists |

## Ship-readiness checklist

Every UI change should pass this list before being declared done.
None of these are optional; if one's been skipped, say so explicitly.

### Design system

- Every color comes from a `--mm-*` token in `modern-minimal.css`.
  No hardcoded hex in components or chart options.
- Chart series source colors from `MM_CHART` / `teamColor()` /
  `teamFill()` in `src/views/v4/mmTokens.ts`. Team-aware where
  applicable (Axis red, Allies olive).
- Standing / achievement numbers use `.mm-headline-rank`. Row
  counters in sorted tables stay small/muted via `.mm-list__rank`.
- Anchor strips (`.mm-section-bar`, `.mm-cta-strip`) use the
  `--mm-highlight` olive treatment — don't invent a new tint.
- Visual identity is **universal** — same on mobile and desktop.
  Only layout density gates by media query.

### Components, not just the page

When you change a page, walk every `<Mm*>` component it renders.
A child's `:deep(.mm-list ...)` override without a
`@media (min-width: 721px)` gate silently suppresses the global
mobile table-to-card transform. Page-level audit is necessary
but not sufficient. See MOBILE_PATTERNS.md → *Audit child
components, not just the page*.

### Mobile

- Run the audit command in MOBILE_PATTERNS.md after adding any
  new `<table>`. Unconverted `<table class="mm-list">` rows look
  unstyled on mobile.
- Ranked / scored lists with 5+ numeric cells per row use the
  `mm-session-row` dual-render pattern (cards on mobile, table
  on desktop). Canonical: `MmPlayerRecentRoundsCompact.vue` and
  the Sessions/Maps/Servers/Best-scores tabs in
  `PlayerDetailsV4.vue`.
- Verify at ≤ 640px (mobile) AND ≥ 881px (desktop) before
  declaring done. Self-audit row-by-row against the mocks /
  MOBILE_PATTERNS / PATTERNS — don't ship and let the reviewer
  find the gaps.

### Timestamps

All API timestamps are **UTC**. Always:

- Parse with the `Z`-suffix trick (see `src/utils/timeUtils.ts`)
  — `new Date(s)` on a Z-less string is local-interpreted and drifts.
- Format via `Intl.DateTimeFormat('default', …)` — never hardcode
  `en-US` / fixed strftime.
- Prefer the existing helpers in `timeUtils.ts`
  (`formatRelativeTime`, `formatAbsoluteTime`, `formatDate`, etc.)
  over rolling your own.
- **Tell the user the time is local** — tooltip the absolute value,
  or include a small "Times shown in your local time" eyebrow
  above any cluster of dates. The viewer should never have to
  guess if `14:32` is server, UTC, or their phone's clock.

See PATTERNS.md → *Recipe: Timestamps*.

### Data + APIs

- V4 list surfaces use **server-side pagination**. Default
  `pageSize=25`. Never bulk-fetch with `pageSize=500` to skip
  implementing pagination.
- Don't trust the TS interface — verify every field your template
  reads against the actual C# property and the JSON response.
  TS-declared-but-unverified fields belong on the "to verify"
  list. See PATTERNS.md → *Don't trust the TypeScript interface*.
- Player names: use `$pn(name)` in templates and
  `decodePlayerName(name)` in `<script setup>` for display only.
  Raw names for keys, router params, search queries. See the
  player-name rule in the project root `CLAUDE.md`.

### Testing

- After every change: `./scripts/verify.sh` (full) or
  `./scripts/verify.sh --skip-e2e` (fast typecheck + API tests).
- Mobile changes: always include
  `e2e/responsive-mobile.spec.ts --project=chromium`.
- Feature → test mapping is in the project root `CLAUDE.md`.
- For UI changes, also `npm run dev` and use the feature in a
  browser — type-checks verify code correctness, not feature
  correctness. If you can't browser-test (e.g. running headlessly),
  say so explicitly rather than claiming success.

### Discovery / cleanup

- `ui/scripts/reachable.mjs` walks transitive imports from the
  entry points and prints reachable files. Use it before bulk
  deletions to find orphans.

## Development

```bash
npm install
npm run dev          # Start development server
npm run build        # Build for production
npx vue-tsc --noEmit # Type check
```

## Conventions

- Don't commit or push unless explicitly asked.
- New feature documentation lives in `/features/<feature-name>/README.md`.
