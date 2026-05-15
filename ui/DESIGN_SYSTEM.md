# Design System

The UI uses a single design system — **Neutral Depth**, scoped under `.mm`
in `src/styles/modern-minimal.css`. Dark, ink-on-surface, hairlines over
borders, olive accent, semantic numeric tints (K/D bands, load bands,
team colors). No "themes" to toggle, no dark/light split, no per-page
palettes.

**Exception**: tournament pages and `AdminDataManagement` keep their
legacy `DashboardLayout` chrome by explicit decision. Don't extend
that chrome; new surfaces ship under `/v4/*` (or anywhere outside
tournament/admin) and use Neutral Depth.

## Where things live

| Concern | Source of truth |
| --- | --- |
| Color, type, spacing, component classes | `src/styles/modern-minimal.css` (search the `.mm` block) |
| Chart series colors, K/D bands, team colors, load bands | `src/views/v4/mmTokens.ts` (`MM_CHART`, `kdClass`, `loadClass`, `teamColor`, `teamFill`) |
| Pattern recipes (modal, chart, hero, list, drill-in, pagination, scroll reset, timestamps, …) | [`PATTERNS.md`](./PATTERNS.md) |
| Mobile layout playbook (hero stack, status chip row, card lists, win/loss row, headline rank, audit checklist) | [`MOBILE_PATTERNS.md`](./MOBILE_PATTERNS.md) |

## Non-negotiable rules

1. **The design system is universal — same on every viewport.** Color,
   type, the olive table-header anchor, accent rules, headline-rank
   treatment apply identically on mobile and desktop. Only **layout
   density** is viewport-aware (tables collapse to cards, secondary
   numeric columns hide). If you're tempted to gate a visual treatment
   behind `@media (max-width: 720px)` — don't.

2. **Tokens, not hex.** Every color comes from a `--mm-*` variable.
   Chart series source colors from `MM_CHART` / `teamColor()` /
   `teamFill()`. Hardcoded hex in a component or chart options block
   is a bug.

3. **Headline rank vs sequence index.** A number that's a player's
   *standing* (`#23 of 1,500`) renders with `.mm-headline-rank` —
   large, olive accent, `#` prefix. A number that's just a *row
   counter* in a sorted table stays small and muted via
   `.mm-list__rank`. Ask: does this number stand alone as a fact?

4. **Hairlines, not cards.** The aesthetic is whitespace + 1px rules
   (`var(--mm-rule)`). Resist re-skinning everything as a panel with
   border + shadow.

5. **Timestamps are UTC; rendering is user-locale.** Use the helpers in
   `src/utils/timeUtils.ts` (they handle the missing-Z parsing trap).
   Tell the viewer the time is local — tooltip the absolute value or
   add an eyebrow ("Times shown in your local time"). See PATTERNS.md
   → *Recipe: Timestamps*.

6. **Server-side pagination.** V4 lists hit the API per page; never
   `pageSize=500` to skip implementing it.

7. **Audit child components.** A page-level pass isn't enough — a
   child's `:deep(.mm-list ...)` override without a `(min-width: 721px)`
   gate silently suppresses the global mobile transform. See
   MOBILE_PATTERNS.md → *Audit child components, not just the page*.

## When in doubt

- Open a reference file (see end of `PATTERNS.md`) and copy from it.
- If the layout doesn't match any pattern, ask for a mock before
  improvising — repeatability across surfaces is the whole point.
