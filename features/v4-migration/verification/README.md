# V4 Migration Verification Protocol

A page is **not done** until we've run it through this verification protocol
and produced a corresponding doc in this folder. The point: we already have a
working reference (the legacy page) for every page we're migrating. There's
no excuse for V4 to silently drop a filter, hit the wrong endpoint, or
return data that doesn't match.

This protocol is deliberately manual and lightweight. It is a **checklist
plus a written diff**, not an automated test suite. We can add automation
later if patterns emerge; for now the goal is to catch regressions like
"`PlayerSessionsV4` returns every round instead of just the player's
rounds" before they ship.

## When to run

For every page-level cycle in the depth-first plan:

1. Build / wire the V4 page and its `Mm*` deps.
2. **Run this protocol.** Produce
   `features/v4-migration/verification/<page-slug>.md`.
3. Only after the verification doc shows ✅ on every checklist item (or
   explicit, documented divergences) do we mark the page task complete in
   the task list.

## The protocol — six passes

For each page, walk through both the legacy and V4 versions in a browser
with devtools open, comparing them on these five axes:

### 1. Routes & entry points
- Legacy URL + V4 URL.
- Where does the user click *to get here*? List every link in the app
  that should reach this page. The V4 entry points must exist somewhere
  in V4 — a page that's routed but unreachable is broken.

### 2. Network parity
- Open devtools network tab. Reload each page with the **same player /
  server / map context**.
- Record every request made — URL, query params, request method.
- The V4 page should be hitting the **same endpoints with the same
  filter parameters** unless the divergence is documented and
  intentional (e.g. "we don't fetch the legacy hourly poll because
  V4 uses a different approach").
- A missing query parameter is the most common bug — that's exactly
  how `PlayerSessionsV4` ended up returning every round.

### 2a. Type-vs-payload parity (sub-pass within Network)

The frontend TypeScript interface is **not authoritative**. It's just
what someone hand-wrote at some point, and it may declare fields the
backend never sets, or omit fields the backend does send. Three real
regressions caught only after shipping:

1. **`ServerDetails.popularMaps`** — TS said `PopularMap[]`. The C#
   `ServerStatistics` model has **no `PopularMaps` property at all**.
   Field was always `undefined`. V4 Maps tab rendered empty.
2. **`TopKDRatio` / `TopKillRate`** — TS aliased them as `TopScore[]`
   so V4 templates read `s.mapName`, `s.timestamp`, `s.score`. The
   actual C# DTOs carry only `PlayerName / Kills / Deaths / KDRatio`.
   `friendlyRelative(undefined)` threw a `RangeError` and aborted the
   render of the entire Top K/D / Top kill rate sub-tabs.
3. **`KDRatio` JSON casing** — backend serialises with
   `JsonNamingPolicy.CamelCase` which lowercases only the first letter,
   producing `kDRatio` (not `kdRatio`). The TS interface reads
   `s.kdRatio` → undefined; fallback math kicks in but with a subtle
   numerical drift.

**How to run this pass:** for every field your V4 template reads from
the API response, verify it actually appears in the payload. Two ways:

- **Browser:** open devtools, copy one response as JSON, grep the keys
  against the fields your `.vue` template references. Anything in the
  template but not in the JSON is a dead field.
- **Code:** open the C# model class (`api/.../Models/*.cs`), list its
  properties, diff against the TS interface (`ui/src/types/` or
  `services/*.ts`). Any TS field with no matching C# property is dead.

Don't trust:

- Field names alone (`popularMaps` ↔ `MostPlayedMaps` ↔ `Maps` can all
  refer to the same thing in different layers).
- Aliased interfaces (e.g. `topKDRatios: TopScore[]`). Aliasing was a
  shortcut, not a contract.
- The legacy frontend's silence — legacy may simply never read the dead
  field, so the bug stayed dormant until V4 was the first consumer.

If the data really should exist but no HTTP route exposes it, the fix
is either to add the route (we did this for `maps-insights`) or to
re-derive the data on the frontend from an adjacent endpoint.

**Sub-trap: silently time-boxed "lifetime" data.** Even when a payload
field *does* exist and *does* populate, it can still be wrong if the
producing service has a misleading default. Three real cases:

1. `PlayerLifetimeStats.TotalKills` — the variable is named
   `lifetimeStats`, the UI labels the cell "Lifetime kills", but
   `GetPlayerStatsAsync` defaults to `lookBackDays = 30`. Any player
   inactive for 30+ days reports zero across the board.
2. The PlayerDetailsV4 Servers tab — same trap: default
   `lookBackDays = 30` plus a hard floor of 10 hours on one server
   inside that window. Most players see an empty Servers tab.
3. The PlayerDetailsV4 Maps tab — dead-field variant of (1), but even
   *if* `favoriteMaps` had existed in the payload, the producing
   service would have been similarly time-boxed.

For any field the UI labels "Lifetime" / "All time" / "Career" or
shows in a context that implies aggregate-since-forever, trace the
call into the service method and **check the default `lookBackDays`
or period argument**. If it's anything other than "no filter" / "0" /
"all time", the field is silently time-boxed. Fix at the controller
by passing `lookBackDays: 0` explicitly, or change the default at
the service.

### 3. Feature parity
- Walk through every visible widget, panel, button, tab, filter,
  modal, drill-in on the legacy page. Check the same exists on V4 (or
  is explicitly listed as dropped).
- Hover/click each interactive element — does it do the same thing?
  Filters apply? Drill-ins navigate? Modals open and close?
- Empty / loading / error states: trigger each and compare.

### 4. Data parity
- For at least one well-known player/server, eyeball the numbers.
- Lifetime kills should match across legacy and V4. K/D should match.
  Recent sessions list should have the same top entries.
- If the numbers disagree, either the network request differs (caught
  in pass 2) or one of the views is filtering client-side differently.

### 5. Navigation parity
- From this page, every outbound link should land somewhere sensible.
  Legacy paths like `/players/...` accidentally surviving in V4 break
  the V4 navigation loop — that's exactly what happened with
  `goRoundReport` until we caught it.
- Particularly watch for `router.push('/players/...')` instead of
  `router.push('/v4/players/...')`.

### 6. Interaction consistency

When the same data type appears in more than one section of a page, it
must support the **same interactions everywhere it appears**. Otherwise
the user clicks one instance, sees it drill in, then clicks an
identical-looking row elsewhere and nothing happens — confusing and
sloppy.

Common shapes on V4 pages:

- A piece of data appears once as a **preview** (Overview tab — first
  3–8 rows) and once as a **full list** (a dedicated tab — sortable,
  paginated, full column set). Both must accept the same row click.
- A piece of data appears in a tab AND as an inline strip elsewhere on
  the page. Both must drill the same way.

The "consistency" pass is a small matrix per page:

| Data type | Preview locations | Full-list location | Interaction wired everywhere? |
| --- | --- | --- | --- |
| Maps on a server | Overview "Most played maps" | Maps tab | ✅ both rows call `openMapAnywhere(m.mapName)` |
| Players on a server | Overview "Most active" + "Top podium" | Ranks tab (4 sub-views) | ✅ all rows call `goPlayer(p.playerName)` |
| Player's own maps | Overview "Favourite maps" | Maps tab on PlayerDetailsV4 | ✅ both call `openMapRankings` |

What to look for:

- `<tr v-for=...>` rows that lack an `@click` handler. If similar rows
  elsewhere on the page have one, the inconsistency is the bug.
- Two sections fed by the same data array. If section A drills, section
  B must too.
- Click handlers that scope to the wrong tab — e.g. `openMapDrill` only
  works inside the Maps tab because the drill target ref isn't mounted
  on other tabs. Provide an `openX Anywhere(…)` helper that switches the
  tab first (see `openMapAnywhere` on ServerDetailsV4).

Caught in production: Overview "Most played maps" on ServerDetailsV4
showed clickable-looking rows for weeks but didn't actually drill —
the user had to scroll, click Maps tab, find the map again, then
click. Two clicks too many.

## Writing the doc

Copy [`_TEMPLATE.md`](./_TEMPLATE.md) and fill it in. Keep each section
tight — checklists, not essays. Status legend:

- **✅ Match** — V4 behavior matches legacy
- **⚠️ Divergence (intentional)** — V4 differs on purpose; explain why
- **❌ Bug** — V4 differs accidentally; needs a fix
- **➖ N/A** — feature doesn't exist on legacy or doesn't apply

A page can ship with ⚠️ items (intentional divergence) but **never with ❌
items unresolved**.

## The matrix

[`MATRIX.md`](./MATRIX.md) is the at-a-glance index of every in-scope page
and its verification status. Update it whenever you finish a verification
doc.
