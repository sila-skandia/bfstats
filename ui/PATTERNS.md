# Patterns & Tokens

The playbook for building UI in this app. Every surface — every page,
every component, every chart — should fit one of the recipes below.

The full token surface is defined in `ui/src/styles/modern-minimal.css`
and scoped under `.mm`. Helpers for numeric-band coloring (K/D bands,
load bands, team colors) live in `ui/src/views/v4/mmTokens.ts`.

Companion docs: [`MOBILE_PATTERNS.md`](./MOBILE_PATTERNS.md) (mobile
layout playbook — read before improvising mobile markup),
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) (high-level overview).

## Tokens — Neutral Depth (dark)

The full palette lives in `modern-minimal.css` at the top of the `.mm`
block. Chart series use the centralised palette from `mmTokens.ts`
(`MM_CHART.*`, `teamColor()`, `teamFill()`). Headline values:

- `--mm-bg`: `#131313` (Neutral Depth surface — never pure black)
- `--mm-bg-soft`: `#1a1a1a` (slight elevation — tooltips, drill panels)
- `--mm-ink`: `#ffffff` (primary text), `--mm-ink-soft`: `#c8c8c8` (secondary)
- `--mm-accent`: `#7d8849` (muted olive — brand, active states, K/D ramp)
- `--mm-highlight`: `#847d4c` + `--mm-highlight-ink`: `#000` — the **anchor
  treatment** for `.mm-section-bar` and `.mm-cta-strip`. Reserve for
  high-hierarchy strips; don't paint half the viewport with it.
- `--mm-kill`: `#d65a5a` (brightened red — Axis side, loss, danger)
- `--mm-success`: `#7da34c` (brightened olive-green — Allies, win)

**Chart rule:** every Chart.js / D3 series must source colors from
`mmTokens.MM_CHART`. Team-coloured lines use `teamColor(label)` /
`teamFill(label, opacity)` so Axis lines are red, Allied lines are olive,
and unknown labels fall back to the accent. Never hardcode hex in a
chart options block — the `feedback-self-audit-before-done` audit script
scans for this.

**Universal design system — applies to mobile AND desktop equally.**
Visual identity (colour, type, anchor bars, accent rules) is the *same
on every viewport*. Don't gate a visual treatment behind `@media
(max-width: 720px)` — that's how `<thead>` rows ended up with the old
muted treatment on desktop while the rest of the page moved to the olive
table anchor. The only thing viewport-aware is **layout density**:
`.mm-list--dense` vs `.mm-list`, `mm-card-list` swap-in on mobile,
`mm-list__col--hide-sm` etc. Those are about *how much* content fits
per row; they're not about *what* the brand looks like.

The brief's olive `#847d4c` table-header anchor applies to:
- `.mm-list thead th` — every V4 table on every viewport.
- `.mm-section-bar` — strip above any long list ("Recent rounds · Tap
  for debrief", "Online now").
- `.mm-cta-strip` — primary discovery CTA ("Get online ▼").

If a new surface needs an anchor, use these classes — don't invent a
new tint.

**Headline-rank rule:** numbers that represent a player's **standing or
achievement** (server rank, leaderboard slot, podium finish) render in
`.mm-headline-rank` — large display font, olive accent, with a small
`__hash` `#` prefix. Add `.mm-headline-rank--podium` for top-3 standings
so they pick up the lifted-olive `--mm-kd-elite` tone.

The inverse — **sequence indexes** like the `01 02 03 …` prefix on every
row of a sorted table — stay small and muted via `.mm-list__rank`. The
difference is whether the number *means* something on its own. "Rank #23
of 1,500" is meaningful. "Row 23 of a sorted list" is not. When in doubt,
ask: does this number stand alone or is it a row counter?

Canonical example: PlayerDetailsV4 Server rankings preview rows render
the rank as large olive `.mm-headline-rank`. Don't downgrade these to
small muted prefixes — they're the answer to "how am I doing?", not a
row count.

---

## Pattern recipes

### Recipe: Modal / dialog

Legacy uses `BaseModal.vue` as a slot-based wrapper around a backdrop +
panel. V4 replaces it with `MmBaseModal.vue` that:

- Uses `var(--mm-bg)` as the panel background (no glassmorphism).
- Uses `border: 1px solid var(--mm-rule-strong)` instead of a shadow.
- Has the modal title styled with `.mm-h2` and a `.mm-eyebrow` overline.
- Uses `<hr class="mm-rule" />` to separate header / body / footer.
- Buttons live in a `<div class="mm-btn-row">` at the bottom right.
- Mobile: panel becomes full-screen at `< 720px`.

Backdrop: `rgba(26, 26, 26, 0.5)` (V4 ink at 50% — not the legacy
`rgba(0,0,0,0.7)` near-black).

### Recipe: Chart / data-viz

Legacy Chart.js / SVG charts use `--color-text` etc. for axis labels and
`--color-primary` for the series. V4 charts:

- Series stroke: `var(--mm-ink)` for primary, `var(--mm-accent)` for an
  emphasized series, `var(--mm-ink-faint)` for muted/comparison series.
- Axis text: `font-family: var(--mm-font-mono); font-size: 10px;
  letter-spacing: 0.06em; color: var(--mm-ink-muted)`.
- Grid lines: `var(--mm-rule)` at 1px, or drop entirely.
- No drop shadows on series, no gradient fills.
- Sparklines: use `<MmSparkline :values="…" />` directly — props
  `width`, `height`, `fill`, `accent`.
- Tiny bar charts: use `<MmBars :values="…" />` for horizontal trickle
  bars (60-minute traces, hourly buckets, etc.).

Numeric values rendered next to the chart get the K/D / load /
streak tints via the helpers in `mmTokens.ts`.

### Recipe: Hero / page-header

Legacy hero patterns are dark, with a gradient text title and a row of
stat tiles below. V4 hero:

```html
<div class="mm-container mm-section">
  <div class="mm-meta-row" style="margin-bottom: 14px">
    <span class="mm-chip"><span class="mm-chip__dot" /> Live</span>
    <span class="mm-meta-row__sep">·</span>
    <span class="mm-meta-row__strong">{{ contextNumber }}</span> {{ unit }}
  </div>

  <h1 class="mm-display">
    <span :class="loadClass(load)">{{ headlineNumber }}</span>
    <span class="mm-display__muted" style="margin-left: 0.3em">{{ headlineLabel }}</span>
  </h1>

  <hr class="mm-rule" style="margin-top: 32px" />

  <div class="mm-stats" style="border-top: 0; margin-top: 0">
    <!-- four cells -->
  </div>
</div>
```

See `views/v4/LandingPageV4.vue` for a working reference.

### Recipe: List / leaderboard

```html
<table class="mm-list">
  <thead>
    <tr>
      <th class="mm-list__rank">#</th>
      <th>Player</th>
      <th class="is-num">Kills</th>
      <th class="is-num">K/D</th>
    </tr>
  </thead>
  <tbody>
    <tr v-for="(row, i) in rows" :key="row.id" @click="goPlayer(row)">
      <td class="mm-list__rank" data-cell-label="Rank">{{ i + 1 }}</td>
      <td class="mm-list__name-cell">
        <div class="mm-list__name">
          <span class="mm-list__name-primary">{{ $pn(row.name) }}</span>
          <span class="mm-list__name-sub">{{ row.country }}</span>
        </div>
      </td>
      <td class="is-num mm-num--kill" data-cell-label="Kills">{{ row.kills }}</td>
      <td class="is-num" :class="kdClass(row.kd)" data-cell-label="K/D">{{ row.kd.toFixed(2) }}</td>
    </tr>
  </tbody>
</table>
```

Notes:

- `data-cell-label` drives the mobile responsive layout — set it on
  every non-name cell.
- `$pn(row.name)` decodes the player name for display only; keep the
  raw value for router params (`@click="$router.push('/v4/players/' +
  encodeURIComponent(row.name))"`).

### Recipe: Section split (overview row)

Legacy "two-column section":

```html
<section class="mm-overview__row mm-overview__row--split">
  <div class="mm-card">
    <div class="mm-eyebrow">Recent rounds</div>
    <h2 class="mm-h2">Last 24 hours</h2>
    <!-- content -->
  </div>
  <aside class="mm-card">
    <div class="mm-eyebrow">Quick links</div>
    <!-- content -->
  </aside>
</section>
```

Mobile collapses to a single column at `< 880px` automatically.

### Recipe: Same data, same interactions — everywhere

V4 pages routinely show the same data type in two places: a **preview**
in the Overview tab (top N rows, fewer columns) and a **full list** in
its dedicated tab (sortable, paginated, all columns). The two must
share the same row interaction. Otherwise the user clicks a row in the
preview, expects it to drill, and gets silence.

When you wire a row click somewhere on a page, immediately walk the
rest of the page and grep for `v-for` loops over the same array. Every
one of them needs the same `@click` handler.

If the click target requires the user to be on a specific tab (e.g.
`openMapDrill` depends on a drill ref that's only mounted inside the
Maps tab), provide an `openX Anywhere(…)` helper that switches the tab
first:

```ts
const openMapAnywhere = (mapName: string) => {
  activeTab.value = 'maps'   // mount the drill target
  openMapDrill(mapName)      // useDrillIn nextTick-resolves the ref
}
```

Then both the in-tab handler and any preview elsewhere on the page call
`openMapAnywhere`. The preview no longer needs to know what tab it's
"on"; it just routes the user where they're headed.

Caught in production: Overview "Most played maps" on ServerDetailsV4
had hoverable-looking rows that didn't drill. Made obvious only when a
reviewer compared it side-by-side with the Maps tab where rows were
clickable.

### Recipe: Always paginate list endpoints — never `pageSize=500`

Every list endpoint in this codebase supports `page` + `pageSize`. **Use it.**
Do not set `pageSize` to 500/1000 to avoid implementing pagination — the
page loads slowly, the markup gets huge, the DOM gets sluggish, and you've
quietly broken first paint for any power user with thousands of rows.

Default behaviour for any V4 surface listing something from a paged API:

- Default `pageSize` to **25** (sometimes 50 for very dense single-line
  rows). Never higher unless there's a written reason (e.g. a chart
  needs the whole series — in which case give the chart its own endpoint).
- Render `‹ 1 2 3 4 5 ›` controls when `totalPages > 1`. Reuse the
  pagination CSS from `MmSessionsPage` / `MmPlayerAchievementSummary`
  so the look is consistent.
- Show a range counter: `Showing 26–50 of 1,247`. The user should
  always know how big the real dataset is.
- Reset to page 1 when filters or the parent context change. Don't
  silently stay on page 12 of a different result set.
- On page change, scroll the drill-in / list target back into view —
  don't yank the viewport to the top of the document.

`MmPlayerAchievementSummary` drill-in is the canonical example;
`MmSessionsPage` table is the wide-table example. Copy from those
rather than rolling new pagination.

The reverse is also true: don't paginate **card-grid** surfaces (badge
walls, map tiles) when the natural total is small (< ~60). Pagination
costs UX when there's nothing to page through.

### Recipe: Don't trust the TypeScript interface — check the actual payload

Before writing a V4 component that consumes a backend response, verify
every field you read actually exists in the JSON. The TS interfaces in
this repo are hand-maintained and **frequently lie**:

- Fields declared in TS that no C# property sets → always `undefined`
  in production (`ServerDetails.popularMaps` lived this way for months
  because the legacy never read it).
- Aliased types — `topKDRatios: TopScore[]` looks fine on paper, but
  the actual DTO is `TopKDRatio` with a totally different shape. Any
  template field beyond the four real properties is undefined.
- JSON property names — the backend uses `JsonNamingPolicy.CamelCase`,
  which lowercases only the **first letter**. `KDRatio` becomes
  `kDRatio` (not `kdRatio`). The TS field name needs to match exactly.

How to check, at build time:

1. Find the controller route the V4 page hits.
2. Trace to the service method, then to the C# model class.
3. List the C# properties. Diff against the TS interface fields your
   `.vue` template references.
4. Any TS field not backed by a real C# property is dead — either:
   - Add a backend route that does provide the data (we did this for
     `/servers/:name/maps-insights`), or
   - Derive the value client-side from an adjacent endpoint, or
   - Document the gap and drop the field from the template.

How to check, at runtime:

1. Load the legacy page in devtools.
2. Copy the response payload of the endpoint as JSON.
3. Grep the JSON keys against the field names in your `.vue` template.
4. Missing keys are dead fields.

Default working assumption: **a field is only real once you've seen it
in an actual JSON response or confirmed a C# property writes it**.
TS-declared-but-unverified fields belong on the "to verify" list, not
in production templates.

### Recipe: Navigation must reset scroll position

Without `scrollBehavior` on the router, vue-router preserves whatever
scroll position the browser was at across `router.push()` calls. That's
fine for tab-style navigation inside one page, but **destructive** for
top-level page navigation: clicking from `/v4/players/A` to
`/v4/players/B` while scrolled halfway down lands the user halfway down
B's content with no signal that the page changed at all.

Fix in `ui/src/router/index.ts`:

```ts
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) return savedPosition              // back/forward
    if (_to.hash) return { el: _to.hash, behavior: 'smooth' as ScrollBehavior }
    return { top: 0, behavior: 'auto' as ScrollBehavior }
  },
})
```

Three branches:

- **`savedPosition`** — set by the browser on history nav (back/forward).
  Honor it so back-button feels right.
- **`#hash` in target** — for anchor links inside a page, smooth-scroll
  to the target element.
- **Otherwise** — top of the page. Always.

This works alongside [`useDrillIn`](#recipe-in-page-drill-in-list--detail-swap)
and [`useTabScroll`](#recipe-tabbed-pages-with-content-below-the-fold)
because both of those scroll *within* a page after a route already
landed. The router's scrollBehavior owns the initial landing position;
in-page composables own subsequent micro-scrolls.

Anti-pattern caught in production: clicking a player → player link inside
the same `/v4/players/:name` route silently kept the user's scroll
position because vue-router treats it as the same route component, and
without `scrollBehavior` it never resets. Fixed.

### Recipe: Tabbed pages with content below the fold

V4 pages routinely stack **always-visible sections below the tab content**
(live rosters, proximity orbit, signature builder, comments, etc.). That
means by the time a user scrolls down to read those sections, the tabs bar
is *off-screen above them* — and the action buttons in the hero (which
also flip `activeTab`) are off-screen *below* them. Clicking a tab from
either direction silently swaps content the user can't see.

Every V4 page with `<div class="mm-tabs">` plus content below it must use
`useTabScroll`:

```ts
import { useTabScroll } from '@/composables/useTabScroll'

const activeTab = ref<Tab>('overview')
const tabsBarRef = ref<HTMLElement | null>(null)

useTabScroll(tabsBarRef, activeTab)
```

Template:

```html
<div ref="tabsBarRef" class="mm-tabs" style="scroll-margin-top: 16px">
  <button @click="activeTab = 'overview'">Overview</button>
  …
</div>
```

What this gives you:

- On every `activeTab` change, smooth-scrolls the tabs bar to the top of
  the viewport *only if* the user isn't already looking at it. No janky
  micro-scrolls when the user clicks within the tabs themselves.
- Works whether the click came from the tabs bar, a hero action button,
  a "view all →" link inside an overview row, or a `router.replace`
  driven by a `?tab=` query param.

**Anti-pattern (caught during ServerDetailsV4 migration):**
inlining the scroll-into-view logic per page. We did it in
PlayerDetailsV4 and forgot it on ServerDetailsV4 — leading to broken
tab clicks. Composable enforces consistency.

### Recipe: In-page drill-in (list → detail swap)

When a page has a tab that lets the user click a row and see a detailed
sub-view, **do not** swap content silently at the top of the tab — the user
will miss the change if they were scrolled down, and the "back" button will
dump them at the top of the page instead of returning them where they were.

Use the `useDrillIn` composable in `ui/src/composables/useDrillIn.ts`:

```ts
import { useDrillIn } from '@/composables/useDrillIn'

const selected = ref<string | null>(null)
const drillRef = ref<HTMLElement | null>(null)
const drill = useDrillIn()

const open = (id: string) => { selected.value = id; drill.enter(drillRef) }
const close = () => { selected.value = null; drill.exit() }
```

Template:

```html
<template v-if="!selected">
  <table @click="open(row.id)">…list…</table>
</template>
<div v-else ref="drillRef" style="scroll-margin-top: 16px">
  <button @click="close">← Back to list</button>
  <DetailComponent :id="selected" />
</div>
```

What this gives you, free:
- On `open()`, the parent scroll position is captured and the drill panel
  smooth-scrolls into view so the user actually *sees* the swap.
- On `close()`, the captured scroll position is restored — back to exactly
  where the user clicked from.
- Reusable across any V4 page that has an in-tab drill-in pattern
  (player → map, server → map, tournament → match, etc.).

Pass the **`ref` itself**, not `ref.value`, so the composable can resolve
the just-mounted element on the next tick.

### Recipe: Form input

V4 doesn't define a full form vocabulary yet. Until it does:

- Inputs reuse the `mm-search` pattern: a pill with a 1px border
  (`var(--mm-rule)`), `padding: 7px 12px`, `border-radius: 999px`,
  border darkens to `var(--mm-ink)` on `:focus-within`.
- Labels use `.mm-eyebrow` styling.
- Validation errors: red text in `var(--mm-danger)`, no red borders, no
  red backgrounds.

Add new patterns to `modern-minimal.css` and document them here as you
encounter them.

### Recipe: Timestamps — UTC payloads, user-locale display

**Every timestamp the API returns is UTC** (the C# side stores NodaTime
`Instant` and serialises as ISO 8601). The browser is the only place
that knows the user's locale, so all rendering must:

1. Parse the UTC value defensively. The API doesn't always include the
   trailing `Z`, so a naive `new Date(s)` parses as local time and
   silently drifts by the user's UTC offset. Always normalise:
   ```ts
   const utc = s.endsWith('Z') ? s : s + 'Z'
   const d = new Date(utc)
   ```
2. Format in the user's locale via `Intl.DateTimeFormat('default', …)`
   — never hardcode `en-US` / `en-GB` / a fixed strftime pattern.
3. **Tell the user it's their local time.** Tooltip the rendered value
   with the absolute local time + an explicit "local time" hint, or
   include a small `mm-eyebrow` "Times shown in your local time" line
   above any cluster of dates/times. The viewer should never have to
   guess whether `14:32` is server time, UTC, or their phone's clock.

The helpers in `src/utils/timeUtils.ts` already do (1) and (2)
correctly — **prefer them over rolling your own**:

- `formatRelativeTime(iso)` → "5 minutes ago", "2 days ago"
- `formatAbsoluteTime(iso)` → "Dec 25, 2023 at 3:45 PM" in user locale
- `formatShortAbsoluteTime(iso)` → "12/25 3:45 PM"
- `formatDate(iso)` → "Dec 25, 2023"
- `formatLastSeen(iso)` → "just now" / "3 minutes ago"

If you need a one-off format, copy the UTC-Z normalisation from
those helpers; never feed `new Date(apiString)` directly into rendering.

Round duration / playtime values are **not timestamps** — they're plain
minute counts. Use `formatPlayTime(minutes)` from the same file.

---


## Reference files

When in doubt, copy from these:

- `ui/src/layouts/ModernShell.vue` — the shell, topbar, footer.
- `ui/src/views/v4/LandingPageV4.vue` — hero + stat strip + list pattern.
- `ui/src/views/v4/PlayerDetailsV4.vue` — multi-section player profile,
  uses `MmSparkline` and `MmBars`.
- `ui/src/views/v4/ServerDetailsV4.vue` — server profile layout.
- `ui/src/components/v4/MmSparkline.vue` — tiny SVG primitive,
  pattern for accepting `values: number[]` + sizing props.
- `ui/src/components/v4/MmBars.vue` — horizontal trickle-bar pattern.
- `ui/src/views/v4/mmTokens.ts` — numeric-band color logic.
