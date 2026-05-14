# V4 Mobile Patterns

Distilled from the four iPhone mocks (`/01 _ Server Browser.png`,
`/02 _ Server Detail.png`, `/03 _ Sessions.png`, `/04 _ Player Profile.png`).
This document is the **single source of truth** for unmocked pages so we
don't have to ask for a new mock every time. Every mobile pattern here is
already (or will be) backed by a shared class in `modern-minimal.css` — use
the class names rather than re-rolling local CSS.

If you find yourself styling something for mobile that **doesn't** fit one
of these patterns, ask for a mock before improvising.

---

## Breakpoints

```
≤ 640px   "mobile"   — single column, cards, no global search input
641-880px "tablet"   — tighter desktop, hamburger nav
≥ 881px   "desktop"  — full topbar
```

The shell already collapses the topbar at 880px. Page-level layouts pivot
at **720px** (table → card-row, three-up → stack). Stats cells re-grid at
**720px** (4-up → 2×2). Don't add new breakpoints unless absolutely needed.

---

## Patterns

### 1. Hero stack (every page)

```
‹ {SECTION}          (back link, only on detail pages)
SECTION-EYEBROW      (mm-eyebrow, caps mono, faded; brand of where you are)
Big Display Title    (mm-display, 28-40px; can carry a subtle italic tail
                      like "Serru / Recruit" or "MoonGamers.com / Est. 2004")
small context line   (one line, ink-soft; e.g. "currently on X · battleaxe")
```

Class shape:
```html
<div class="mm-meta-row" v-if="hasBackLink">
  <router-link :to="back" class="mm-meta-row__strong">← {SECTION}</router-link>
</div>
<div class="mm-eyebrow">{SECTION-EYEBROW}</div>
<h1 class="mm-display">{Title} <span class="mm-display__muted">/ {tag}</span></h1>
<p class="mm-card__hint" style="margin-top: 6px">{context}</p>
```

Rules:
- One H1 per page. No "Welcome to" / "Archive of" filler subtitles.
- Eyebrow is what section you're inside (e.g. "MOONGAMERS.COM" on the
  server detail, "PLAYERS" on a player profile).
- The italic / "/" tail is the **identity modifier** (rank, est. year,
  status) — use it sparingly and only when it adds context.

### 2. Status chip row

Single inline row of meta beneath the hero. Each item is `mm-chip` (with
`mm-chip__dot` for the pulsing dot) or plain text with `mm-meta-row__sep`
between items. Caps + mono.

```
● ONLINE · IN COMBAT · #1281 / 13,761
● PEAK · 8 ACTIVE HOSTS · 88 TRACKED · 30S PULSE
● TRACKING · US · BF1942
```

### 3. 2×2 stat grid — `.mm-stats` (already shipped)

Borderless cells with hairline dividers. Each cell:
```
EYEBROW LABEL
big numeric (with optional color: kill red, accent rust, ink)
small fine-print delta
```

On mobile it re-grids to 2×2 automatically. **Don't** create custom card-
based stat blocks. Use this.

### 4. Inverse section bar — `.mm-section-bar` (new)

The "# SERVER PLAYERS LOAD" / "RECENT ROUNDS · TAP FOR DEBRIEF" /
"ONLINE NOW · BATTLEAXE · CONQUEST · 16:02 LEFT" black strips. Full-width,
mm-ink background, mm-bg text, caps mono.

```html
<div class="mm-section-bar">
  <span>{TITLE}</span>
  <span class="mm-section-bar__meta">{META OR HINT}</span>
</div>
```

Use to mark the top of any long scrollable list. **Includes the "TAP FOR
DEBRIEF" affordance** — repeat the same phrasing when every row in the
list navigates somewhere.

### 5. Mobile card-row (long scrollable lists)

Single column, full-width cards. The legacy `.mm-list` table already
collapses to this on mobile via the existing media query — keep using
`<table class="mm-list">` for tabular data. For data that isn't really a
table (sessions feed, achievements by-round, server rows on the landing),
use `.mm-card-list` (new):

```html
<ol class="mm-card-list">
  <li class="mm-card-list__item">
    <div class="mm-card-list__head">
      <span class="mm-card-list__title">Axis 889 – 864 Allied</span>
      <span class="mm-card-list__time">02:53 AM</span>
    </div>
    <div class="mm-card-list__sub">
      BATTLEAXE · <span class="mm-chip"><span class="mm-chip__dot" />LIVE</span>
    </div>
    <ol class="mm-card-list__rows">
      <li class="mm-card-list__row mm-card-list__row--rust">
        <span class="mm-card-list__rank">1.</span>
        <span class="mm-card-list__row-name">{name}</span>
        <span class="mm-card-list__row-kd">{kd}</span>
        <span class="mm-card-list__row-score">{score}</span>
      </li>
      …
    </ol>
  </li>
</ol>
```

Color hooks on `.mm-card-list__row--rust` (1st place — accent) and
`--ink` (default). Don't introduce per-page color tokens.

### 6. Win / loss session row

Compact horizontal row used on the player profile "LATEST SESSIONS" feed
and anywhere we want a single-line session summary. Built from
`.mm-session-row` (new):

```html
<a class="mm-session-row" :class="{ 'mm-session-row--win': won, 'mm-session-row--loss': !won }">
  <span class="mm-session-row__chip">{{ won ? 'WIN' : 'LOSS' }}</span>
  <span class="mm-session-row__map">{{ mapName }}</span>
  <span class="mm-session-row__date">{{ date }}</span>
  <span class="mm-session-row__server">{{ serverName }}</span>
  <span class="mm-session-row__stats">
    {{ kills }} · #{{ rank }} · {{ kd }} · {{ ratio }}
  </span>
</a>
```

Win chip: `mm-success-bg`. Loss chip: pale `mm-kill` bg.

### 7. Achievement strip (player profile)

Three actual badge tiles + a "+N SEE ALL" link. Built from existing
`.mm-ach__badge` (already in `MmPlayerAchievementSummary`). Wrap in
`.mm-ach-strip` (new) that limits to three and tails a "+{count} SEE ALL"
link.

### 8. Primary CTA strip (landing only) — `.mm-cta-strip`

The yellow "Get online ▼" button on the landing. Full-width, highlight
background, single line of mono caps. Reserved for the **primary
discovery action** of a page — use sparingly. Landing = "Get online" /
install guide. Server detail might one day have "Join now". Player
profile shouldn't have one.

### 9. Tabs / sub-tabs

Existing `.mm-tabs` / `.mm-tab` (underline-only on active, no pill
background) is the only tab pattern. Sub-tabs (e.g. "MOST ACTIVE / TOP
K/D / KILL RATE / PLACEMENTS" under Ranks) use the same class but with
`mm-tabs--sub` modifier (smaller, denser).

### 10. Pagination + range counter

See [`CROSSWALK.md` → Recipe: Always paginate list endpoints](CROSSWALK.md).
On mobile the `‹ 1 2 3 ›` row still fits — same component, no override.

---

## What NOT to do

- **No custom hamburger menu yet.** The topbar already wraps nicely
  ≤ 880px. If/when we add a hamburger, do it once in `ModernShell`.
- **No drawers / off-canvas.** The mocks don't use them. If you need
  filters, use the existing collapse-toggle pattern (see `MmSessionsPage`
  filters).
- **No fixed bottom bars.** All four mocks scroll free.
- **No per-page color palettes.** The mm-* tokens are it. Don't
  introduce neons, gradients, or backdrop blurs to "spice up" mobile.
- **No emojis in section labels or CTAs.** The mocks are dead serious.

---

## When you're stuck

If a page doesn't fit any of the above (e.g. a complex chart-heavy
dashboard), **ask for a mock**. Don't improvise — the goal is repeatability
across pages, and improvisation defeats that.

Process:
1. Identify which patterns above the page uses.
2. Map each section to a class name from this doc.
3. Build mobile-first. If a desktop variant needs more density, use a
   `@media (min-width: 881px)` override on top of the mobile baseline.
4. Verify against the closest mock — does the rhythm match?

## Audit child components, not just the page

This is the rule that bites every time it's skipped: **when you "mobilise
a page," you must also open every child component that page renders and
verify it's mobile-fit.** A page-level audit is necessary but not
sufficient.

The trap: child components frequently use `:deep(.mm-list ...) { padding:
8px; font-size: 12px }` to compress shared tables for their own desktop
layout. Those overrides have higher specificity than the global mobile
`.mm-list` rule that collapses tables into card-style grids — so on
mobile the table never collapses, and you see a cramped, unfinished
mini-table inside an otherwise themed page.

**Checklist for every mobile page pass:**

1. Open the page file and **list every `<Mm*>` component** it renders.
2. For each child, search the component for `:deep`, `@media`, and any
   hardcoded `font-size` / `padding` on `.mm-list*`. If those `:deep`
   overrides exist without a `min-width` gate, the component is broken on
   mobile — gate the overrides to `@media (min-width: 721px)` so the
   global mobile transformation can do its job.
3. View the page at ≤ 640px and confirm every child renders cleanly.
   Cramped tables, side-scroll, or no breathing room → that child needs
   its own mobile pass before the page is "done."
4. Add the child to the per-page recipe table at the bottom of this doc
   so the next pass sees it.

Known-good pattern: see `MmPlayersPanel.vue` — its `:deep(.mm-list)`
condense rules sit inside `@media (min-width: 721px)`, and it adds a
small mobile-only `@media (max-width: 720px)` block to trim the
auto-collapsed cards.

---

## Per-page recipe

| Page | Patterns used | Mock |
| --- | --- | --- |
| Landing (Server browser) | 1, 2, 3, 8, 4, 5 | `01 _ Server Browser.png` |
| Server detail | 1, 2, action row, 4, team scoreboard split, ranks table + sub-tabs (9) | `02 _ Server Detail.png` |
| Sessions feed | 1, mini chart, 4, 5 | `03 _ Sessions.png` |
| Player profile | 1, 2, 7, 3, 9, 4, 6 | `04 _ Player Profile.png` |
| Player achievements | 1, 7 + categories grid / by-round 5 | (no mock — derive) |
| Player network | 1, force-graph (custom) | (no mock — derive) |
| System stats | 1, 3 + credits panels | (no mock — derive) |
| Map popularity | 1, period pills, bar chart, heatmap, 4, summary table | (no mock — derive) |
| Community detail | 1, 2, 3, 9, members table | (no mock — derive) |
| Round report | hero, scoreboard, scrubber, console+visualizer toggle, ladder | (no mock — derive) |
