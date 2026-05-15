# V4 Crosswalk — Legacy → Modern-Minimal Token, Class, and Pattern Map

A reference for the actual translation work. When migrating a file, search
for any of the legacy tokens/classes below and replace with the listed
modern-minimal equivalent.

The full V4 token surface is defined in
`ui/src/styles/modern-minimal.css` and scoped under `.mm`. Helpers for
numeric-band coloring live in `ui/src/views/v4/mmTokens.ts`.

**Mobile layout patterns** (page hero, stat grid, inverse section bar,
mobile card list, CTA strip, win/loss row, achievement strip) are
documented separately in [`MOBILE_PATTERNS.md`](./MOBILE_PATTERNS.md).
That file is the source of truth for unmocked mobile pages — read it
before improvising mobile-specific markup.

**Dark mode is the default** as of the Neutral Depth migration. The full
palette lives in `ui/src/styles/modern-minimal.css` at the top of the
`.mm` block. Chart series use the centralised palette from
`ui/src/views/v4/mmTokens.ts` (`MM_CHART.*`, `teamColor()`, `teamFill()`).
Headline values:

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

## 1. CSS variable tokens

### Background / surface

| Legacy | Modern-minimal | Notes |
| --- | --- | --- |
| `var(--color-background)` | `var(--mm-bg)` | `#f5f1e8` cream |
| `var(--color-background-soft)` | `var(--mm-bg-soft)` | `#efeadd` |
| `var(--color-background-mute)` | `var(--mm-bg-mute)` | `#e7e1d1` — also used for skeleton/list-bar tracks |
| `var(--color-card-bg)` | `var(--mm-bg)` or no surface | Modern-minimal usually doesn't use card surfaces — the layout relies on whitespace + hairlines instead of card chrome. Drop the surface unless absolutely needed. |
| `var(--color-card-bg-hover)` | `var(--mm-bg-soft)` | only when hover surface is justified |
| `var(--sidebar-bg)`, `var(--sidebar-*)` | n/a — DROP | `ModernShell` replaces `Sidebar`; sidebar tokens delete |

### Ink / text

| Legacy | Modern-minimal | Notes |
| --- | --- | --- |
| `var(--color-text)` | `var(--mm-ink)` | `#1a1a1a` |
| `var(--color-text-muted)` | `var(--mm-ink-muted)` | `#8a8579` |
| `var(--color-text-secondary)` | `var(--mm-ink-soft)` | `#4d4a42` — between ink and muted |
| `var(--color-heading)` | `var(--mm-ink)` | headings inherit ink color |
| (deep faint text — date stamps, separators) | `var(--mm-ink-faint)` | `#b6b1a3` |

### Hairlines / borders

| Legacy | Modern-minimal | Notes |
| --- | --- | --- |
| `var(--color-border)` | `var(--mm-rule)` | `#d8d2c0` |
| `var(--color-border-rgb)` | (drop) | rgba shadows weren't part of the v4 vocabulary |
| (strong borders) | `var(--mm-rule-strong)` | `#b8b1a0` — used on `mm-chip`, `mm-subtabs` |

### Accent / brand

| Legacy | Modern-minimal | Notes |
| --- | --- | --- |
| `var(--color-primary)` (cyan `#3498db`) | `var(--mm-accent)` | `#c8772b` rust |
| `var(--color-primary-hover)` | `var(--mm-accent)` darken via CSS or `var(--mm-ink)` | hover state usually = ink, not primary darken |
| `var(--color-accent)` (orange `#e67e22`) | `var(--mm-accent)` | same; legacy "accent" collapses into `mm-accent` |
| `var(--color-accent-hover)` | (drop or use `mm-ink`) | |
| `var(--color-accent-rgb)` | (drop) | inline RGBA was for legacy glow/shadow effects; remove the effect, not just the var |
| (highlight) | `var(--mm-highlight)` | `#f1de75` butter-yellow for promoted chips |

### Semantic state

| Legacy (often Tailwind) | Modern-minimal | Notes |
| --- | --- | --- |
| `bg-emerald-*`, `text-green-*`, `text-emerald-*` | `var(--mm-success)` `#5a7d3a` / `var(--mm-success-bg)` `#dbe2c4` | success / online / win |
| `bg-red-*`, `text-red-*` | `var(--mm-danger)` `#b3441a` | loss / error |
| (no legacy equivalent — most legacy "load" indicators used neutral colors) | `var(--mm-load-busy)` / `--mm-load-full` / `--mm-load-idle` | server population emphasis — see `loadClass()` in `mmTokens.ts` |
| (kill counts — legacy used `--color-text` or red Tailwind) | `var(--mm-kill)` `#a83838` / `--mm-kill-soft` | apply via `.mm-num--kill` class |

### Dark mode — DROP

Modern-minimal does not support dark mode. At cutover:

- Delete the `.dark-mode { … }` block from `App.vue` (lines ~127–152).
- Delete the `.light-mode { … }` block (lines ~155–180).
- Delete `isDarkMode` / `toggleDarkMode` from `App.vue`.
- Delete `provide('isDarkMode', …)` and `provide('toggleDarkMode', …)`.
- Audit every `inject('isDarkMode')` site and remove the conditional.
- Drop the `prefers-color-scheme` listener.
- Drop the `body.mm-body` shim from `App.vue` (the body lives on cream
  unconditionally).

During the migration (before cutover), V4 pages should simply ignore the
dark-mode injection. Don't read `isDarkMode` in any new V4 file.

---

## 2. Class mapping

### Layout shell

| Legacy | Modern-minimal |
| --- | --- |
| `.dashboard-layout` | `.mm-shell` (in `ModernShell.vue`) |
| `.dashboard-root` | `.mm-shell` |
| `.dashboard-container` | `.mm-container` |
| `.dashboard-content` | `.mm-section` (or `.mm-section--tight`) |
| `.dashboard-grid` | use modern-minimal's own grids (`.mm-overview__row--split`, `.mm-overview__row--triple`, or hand-rolled CSS grid with `var(--mm-rule)` dividers) |
| `.dashboard-sidemenu` | DROP — `ModernShell` has no sidebar; navigation lives in the topbar |
| `.dashboard-header` | DROP — page headers become `<h1 class="mm-display">…</h1>` + `<div class="mm-meta-row">…</div>` |

### Cards / surfaces

The modern-minimal aesthetic is **hairlines, not cards**. Resist the urge
to re-skin every legacy "card" as a v4 card. Most of the time, the
correct translation is: top + bottom hairline (`<hr class="mm-rule" />`),
typographic hierarchy, and whitespace.

| Legacy "card" pattern | Modern-minimal |
| --- | --- |
| `<div class="card">` with bg + border + shadow | `<section class="mm-card">` (a vertical flex with `gap: 4px`, no surface) |
| `.card-header` / `.card-title` | `<div class="mm-eyebrow">…</div>` + `<h2 class="mm-h2">…</h2>` |
| `.card-body` | bare children |
| `.card-empty-state` | `<div class="mm-card__empty">…</div>` |
| `.card-footer` | `<div class="mm-card__foot">…</div>` |

### Chips / badges / pills

| Legacy | Modern-minimal |
| --- | --- |
| `.badge`, `.pill`, `.tag` | `<span class="mm-chip">…</span>` |
| Filled badge (`bg-cyan-500 text-white`) | `<span class="mm-chip mm-chip--filled">…</span>` |
| Highlight badge (yellow CTA) | `<span class="mm-chip mm-chip--accent">…</span>` |
| Live/online indicator (pulsing dot) | `<span class="mm-chip"><span class="mm-chip__dot" /> Live</span>` |
| Offline state | add `mm-chip--off` modifier |
| Win indicator | `<span class="mm-chip mm-chip--win">W</span>` |
| Loss indicator | `<span class="mm-chip mm-chip--loss">L</span>` |

### Tables / lists

| Legacy | Modern-minimal |
| --- | --- |
| `<table class="leaderboard-table">` etc. | `<table class="mm-list">` |
| `<thead>` cells | already styled by `.mm-list thead th`; add `is-num` for right-aligned numeric headers |
| `<tbody> <tr>` rows | already styled; rows are clickable by default — wire `@click`/`router-link` cleanly |
| Numeric `<td>` | add `class="is-num"` |
| Muted secondary cell | add `class="is-muted"` |
| Rank prefix cell | use `class="mm-list__rank"` |
| Name with secondary line below | `<div class="mm-list__name"><span class="mm-list__name-primary">…</span><span class="mm-list__name-sub">…</span></div>` |
| Inline horizontal bar (capacity meter, etc.) | `<div class="mm-list__bar"><div class="mm-list__bar-fill" :style="{ width }" /></div>` (variants: `--accent`, `--idle`) |
| Mobile responsive rows | the `@media (max-width: 720px)` block in `modern-minimal.css` already converts `mm-list` rows to a `grid` layout — set `data-cell-label` on each `<td>` to make labels appear on mobile |

### Tabs / subtabs

| Legacy | Modern-minimal |
| --- | --- |
| `<div class="tabs">` | `<div class="mm-tabs">` (underline + accent active rail) |
| Active tab class | `class="mm-tab mm-tab--active"` |
| Pill/segmented control | `<div class="mm-subtabs">` with `<button class="mm-subtab">` (filled ink active) |
| Active subtab | `class="mm-subtab mm-subtab--active"` |

### Buttons

| Legacy | Modern-minimal |
| --- | --- |
| Primary button (`.btn-primary`, `bg-cyan-500`) | `<button class="mm-btn mm-btn--accent">Save</button>` (butter-yellow) |
| Default button | `<button class="mm-btn">Cancel</button>` (text-only, hover → ink) |
| Strong default | `<button class="mm-btn mm-btn--strong">Open</button>` |
| Button row | wrap in `<div class="mm-btn-row">` for spacing |
| Icon-only square button | not standard in V4; either inline as text or design a new pattern and add it to `modern-minimal.css` |

### Typography

| Legacy | Modern-minimal |
| --- | --- |
| `<h1>` with no class / `.page-title` | `<h1 class="mm-display">{{ value }} <span class="mm-display__muted">label</span></h1>` |
| `<h2>` / section title | `<h2 class="mm-h2">…</h2>` |
| Section eyebrow / kicker | `<div class="mm-eyebrow">SECTION NAME</div>` |
| Section eyebrow (emphasized) | `class="mm-eyebrow mm-eyebrow--strong"` |
| Stat block label | `<div class="mm-stats__label">Players online</div>` |
| Stat block value | `<div class="mm-stat__value">{{ number }}</div>` |
| Stat block delta | `<div class="mm-stat__delta">+12 since yesterday</div>` (variants: `--up`, `--down`) |
| Numeric suffix (e.g. "/255") | `<span class="mm-stat__suffix">/255</span>` |

### Stat strip (page hero metrics)

The four-up stat strip is a V4 signature. Use it instead of legacy "kpi
card" rows.

```html
<div class="mm-stats">
  <div class="mm-stats__cell">
    <div class="mm-stats__label">Players online</div>
    <div class="mm-stat__value" :class="loadClass(load)">{{ players }}</div>
    <div class="mm-stat__delta">of {{ capacity }} capacity</div>
  </div>
  <!-- repeat 3 more cells -->
</div>
```

Mobile collapses to 2×2 automatically.

### Hairlines

Use `<hr class="mm-rule" />` instead of `border-bottom: 1px solid #eee` on
ad-hoc divs. Stronger horizontal break: `<hr class="mm-rule mm-rule--strong" />`.

### Timeline (kill milestones, achievements over time)

```html
<ul class="mm-timeline">
  <li>
    <span class="mm-timeline__dot" />
    <div>
      <div class="mm-timeline__primary">Reached 1,000 kills</div>
      <div class="mm-timeline__sub">2024-03-12 · Stalingrad</div>
    </div>
  </li>
</ul>
```

### Best-scores block (top-3 type list)

```html
<div class="mm-bestscores">
  <ol class="mm-bestscores__list">
    <li>
      <span class="mm-bestscores__rank">01</span>
      <span class="mm-bestscores__score">2,847</span>
      <span class="mm-bestscores__detail">Berlin · Allied</span>
    </li>
  </ol>
</div>
```

### Empty / loading

| Legacy | Modern-minimal |
| --- | --- |
| Empty state with icon | `<div class="mm-empty">No sessions in the last 24h</div>` |
| Skeleton bar | `<div class="mm-skeleton" />` or `mm-skeleton--lg` |

---

## 3. Tailwind utility class translation

These are the patterns that show up in the most Tailwind-heavy files
(`Sidebar.vue`, `PlayerAllAchievements.vue`, `ServerPlayerActivityChart.vue`,
`MatchDetailsModal.vue`, etc.). Most translations are "delete the utility,
let the page flow." A few have direct mappings.

| Tailwind pattern | Modern-minimal |
| --- | --- |
| `bg-gradient-to-b from-neutral-900/95 to-neutral-950` | drop entirely; cream background is just `var(--mm-bg)` |
| `backdrop-blur-xl`, `backdrop-blur-lg` | drop entirely |
| `bg-cyan-500/3`, `bg-purple-500/10`, `bg-pink-500/3` (animated background blurs) | drop entirely |
| `animate-pulse` on background blobs | drop entirely |
| `border-neutral-700/50` | `border: 1px solid var(--mm-rule)` |
| `border-cyan-500/50` (hover) | `border-color: var(--mm-ink)` |
| `rounded-xl`, `rounded-2xl` (chunky radii) | use `border-radius: 2px` or 0 — V4 is hard-edged, not pillowy |
| `shadow-2xl`, `shadow-lg` (atmospheric shadows) | drop entirely; V4 uses hairlines and whitespace |
| `hover:scale-105`, `hover:translate-y-*` (interactive lifts) | drop; the hover state is a background tint (`mm-bg-soft`) or a color shift |
| `text-cyan-400`, `text-emerald-400` (status text) | `color: var(--mm-accent)` for accent, `var(--mm-success)` for success |
| `bg-clip-text bg-gradient-to-r` (gradient text) | drop; V4 uses solid ink |
| `text-transparent` (gradient text combo) | drop |
| `min-h-screen` | move to `.mm-shell` (already `min-height: 100vh`) |
| `flex flex-col`, `grid grid-cols-3` etc. | keep — these are layout utilities and don't conflict with V4 |
| `gap-2`, `gap-4` etc. | keep as utility values OR convert to V4 spacing tokens (16px / 24px / 32px) |
| `p-4`, `px-6`, `mt-8` (spacing) | keep, but audit against V4 spacing rhythm (V4 leans on 16/24/32 px and avoids the dense Tailwind 4px-grid) |
| `text-sm`, `text-lg`, `font-bold` | replace with V4 typography classes (`mm-eyebrow`, `mm-h2`, `mm-stat__value`, etc.) or with the V4 font scale |

**Rule of thumb**: when a Tailwind utility is doing layout (flex, grid,
gap, padding, margin), keep it. When it's doing visual design (colors,
gradients, shadows, blurs, radii, scale animations), delete it. V4
visual design comes from `modern-minimal.css`, not utility classes.

---

## 4. Pattern recipes

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

---

## 5. Things to delete entirely

These appear in legacy and have no V4 equivalent. Remove rather than
translate.

- **Glassmorphism**: `backdrop-filter: blur(…)`, `bg-*/[0-9]+` Tailwind
  opacity utilities used as glass.
- **Animated background blobs**: any `animate-pulse` on absolutely
  positioned gradient circles. V4 backgrounds are flat cream.
- **Drop shadows on cards / panels / modals**: V4 uses hairlines.
  `box-shadow` is reserved for the `mm-search` focus state (subtle)
  and nothing else.
- **Gradient text**: `bg-clip-text bg-gradient-to-r` patterns. V4 is
  ink-on-paper.
- **Hover lifts**: `hover:scale-*`, `hover:-translate-y-*`. V4 hover is
  a background tint (`mm-bg-soft`) and/or an underline.
- **Loading spinners with neon colors**: replace with `mm-skeleton`
  (rectangular pulsing block) or `mm-empty` (text-only).
- **Tab content with rounded gradient pill backgrounds**: V4 uses
  underline-and-accent (`.mm-tab--active::after { background: var(--mm-accent); }`).

---

## 6. Files that already follow V4 patterns

Reference these when in doubt:

- `ui/src/layouts/ModernShell.vue` — the shell, topbar, footer.
- `ui/src/views/v4/LandingPageV4.vue` — hero + stat strip + list pattern.
- `ui/src/views/v4/PlayerDetailsV4.vue` — multi-section player profile,
  uses `MmSparkline` and `MmBars`.
- `ui/src/views/v4/ServerDetailsV4.vue` — server profile layout.
- `ui/src/components/v4/MmSparkline.vue` — tiny SVG primitive,
  pattern for accepting `values: number[]` + sizing props.
- `ui/src/components/v4/MmBars.vue` — horizontal trickle-bar pattern.
- `ui/src/views/v4/mmTokens.ts` — numeric-band color logic.
