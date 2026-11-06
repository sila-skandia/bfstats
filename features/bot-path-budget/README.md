# The bots' path search under a per-tick budget

On FHSW Operation Varsity (2048 m, the heaviest FHSW export) twelve bots put
the browser game's frame at a mean of 20 ms with a p95 of 58 ms and a p99 of
108 ms; with every bot's AI emptied the same scene ran at 13.7 ms with a p95
of 18 ms ([mod-level-frame-cost](../mod-level-frame-cost/README.md)). The
difference was `nav-search.js`: `findLocalPath` 3.4 ms a frame, its heap
`pop` 0.8, `findStrategicPath` 0.7. The draw was the floor; the path search
was the spikes. This pass (2026-11-05) gives the search the engine's shape,
a budget, and takes the spikes out.

## What the engine does

Ledger AI-6: the AI is time-budgeted, not per-bot-per-tick. `AIMain::action`
takes `getTimeIncrease() * aiSystemQuotient` and `BotManager::action` splits
0.95 of it into plan execution (0.40), decisions, pathfinding
(`0.60 * q_path`) and sensing. AI-135: the searches are tasks the AI's
scheduler runs while the slice lasts, and a search the slice does not finish
goes on in the next frame's. So more bots means each searches less often,
and the budget, not the bot count or the level's size, bounds the cost.

Ours ran every bot's full pass every tick: `bot-route.js` `extendRoute`
refined up to four legs a tick per bot, each a `findLocalPath` of up to 8,192
node expansions (`LOCAL_SEARCH_MAX_NODES`, the engine's `0x400` cap x 8 for
the metre grid), with a leg's widenings up to 20,000 x w. On a 512 x 512 nav
grid twelve bots could expand several hundred thousand cells in one 30 Hz
tick.

## What changed

1. **The local search is begun and stepped** (`nav-search.js`
   `beginLocalSearch` / `stepLocalSearch`). The A* keeps its open list, its
   `g`/`f`/`came`/`closed` arrays and its box on a search object; a step
   expands up to `nodes` more cells and answers `{ done, path, expanded }`.
   The cells are visited in the one-shot search's exact order, so a search
   stepped in any slices answers as `findLocalPath` (now a wrapper that steps
   once with no limit) does. `test_bot_route.py` `PathBudgetTests` pins it:
   stepped 37 cells at a time round a wall's end, the same waypoints and the
   same expansion count as the one-shot search.
2. **A per-tick budget shared by all bots** (`bot-route.js` `newPathBudget`,
   `PATH_BUDGET_NODES = 8192`: one capped local search a tick, INVENTION of
   the value). The referee begins it every tick and hands it to each bot
   (`bot.pathBudget`). Every search pending in a tick gets an equal share of
   the budget, sized from how many searches were pending last tick, within
   what is left; a search the share does not finish stands on the route
   (`route.search`, `route.deferred`) and resumes next tick, and a route
   standing deferred is not failed (`execInfantryMoveTo` keeps the hull's
   throttle at 0 as it does while a leg widens). A bot with no budget (a
   harness, a test) searches unbudgeted, as before. The budget counts node
   expansions, not time, because a seeded match must replay byte for byte
   (AI-135 is why the engine's own bots cannot be). The strategic search's
   region expansions are counted against the tick (`stats.strategic`,
   `stats.expanded`) but not sliced: it is regions, not cells, and cheap per
   call.
3. **A goal the strategic map cannot reach is not asked again every tick**
   (`ensureRoute`). The coarse search's failure counted a path failure and
   returned null, and with no route standing the next tick searched again.
   On Varsity twelve bots ran 3,210 strategic searches in 1,499 ticks, two
   a tick, nearly all this retry. A failed coarse search now leaves a failed
   route standing and waits out `ROUTE_RETRY_AFTER` (1.5 s), the pause a
   failed local leg already took: 210 strategic searches in the same 1,499
   ticks.

4. **A search that has stood too long is served whole**
   (`PATH_SEARCH_OVERDUE_TICKS`, 15 ticks, INVENTION: half a second).
   Skandia's first round after the budget, on an EoD level, had the bots run
   out, all come back to base and stand (2026-11-06). The failure the
   budget can produce: with every bot searching at once each share is a
   few hundred cells a tick, so a wide box's search crawls for many seconds
   while its hull holds its throttle or its soldier walks blind into the
   jungle, stalls, escapes, and is redeployed home. So the budget is a cap
   on the common tick only: a search that has waited half a second is run
   to its end that tick, the cap notwithstanding, which under a queue that
   deep is the pre-budget tick (one expensive search, a hitch) rather than
   a stall. `test_bot_route.py` pins both halves: the cap holds on every
   tick that served no overdue search, and under a budget no search can
   finish in every hull's search still concludes within a few ticks of the
   cap with no route failed for want of a turn. `?nopathbudget` turns the
   budget off for an A/B in the page.

`simphase.mjs` prints the budget's counters per run (`path budget ...`),
and `?shots` pages offer `window.__pathBudget()`.

## Measured

Browser (the `botfight.cjs` harness, Chrome 157 on the M5 Max, 12 bots in a
natural match, the camera following the bots, 20 s, 1700x1000):

| Varsity, 12 bots | frames | mean | p50 | p95 | p99 | max | >16.7 | >33 | `nav-search.js` |
|---|---|---|---|---|---|---|---|---|---|
| before | 986 | 20.31 | 16.6 | **58.3** | **108.3** | 116.7 | 450 | 88 | 23.4 % |
| the budget | 1216 | **16.47** | 16.6 | **25.4** | **26.6** | 49.9 | 529 | 3 | 13.6 % |
| the budget and the strategic pause | 1197 | 16.72 | 16.6 | 32.4 | 34.3 | 35.1 | 487 | 38 | 7.2 % |
| (every bot's AI emptied, for the floor) | 1460 | 13.71 | 15.8 | 18.1 | 18.5 | 50 | 383 | 2 | |
| **shipped: the served-whole budget, with the statics batched** | 2290 | 8.74 | 8.3 | 10.3 | 18.1 | 34.6 | 48 | 1 | 8.2 % |

The last row is the budget as it ships, overdue searches served whole,
measured after [batched-level-statics](../batched-level-statics/README.md)
took the draw floor away: the yielding does not bring the spikes back
(p99 18 ms, one frame over 33 ms in 20 s).

The spikes are gone: the worst frame fell from 117 ms to 35-50 ms and the
p99 from 108 ms to 27-34 ms. The two "after" runs differ in the draw, not
the AI (`three.module.js` 61 % of one, 69 % of the other; the second run's
heap sat at 2.1 GB against 1.3 GB), and both p50s are the 60 Hz line, which
is the floor the draw sets on this level and
[batched-level-statics](../batched-level-statics/README.md) is for.

Headless (`simphase.mjs`, the viewer's own sim with no renderer, 12 bots,
50 s measured after 10 s of warm-up; "before" is a copy of the viewer from
`HEAD` served to the same runner):

| | ms/tick mean | p95 | max | `referee.tick` | local searches | strategic | expanded/tick mean, p95, max |
|---|---|---|---|---|---|---|---|
| Varsity, before | 1.01 | 1.52 | 17.9 | 0.628 | | | |
| Varsity, the budget | 1.01 | 1.55 | 18.2 | 0.626 | 1,072 | 3,210 | 239, 1,854, 14,166 |
| Varsity, both fixes | 0.97 | 1.45 | 17.9 | 0.580 | 874 | 210 | 137, 440, 14,125 |
| El Alamein, before | 1.18 | 1.51 | 4.3 | 0.742 | | | |
| El Alamein, both fixes | 1.19 | 1.55 | 4.2 | 0.753 | 177 | 36 | 139, 0, 8,192 |

On El Alamein the budget is reached once in 1,499 ticks and nine searches
are ever left open: the vanilla match is unchanged in cost and nearly so in
trace. A tick's expansions can pass the budget by one strategic search's
regions (the 14,125), by design.

The runner's referee costs 0.6 ms a tick on Varsity, where the page's cost
the frame 5 ms with the same bots; the page and the runner build the same
nav maps from the same baked search maps, so the difference is open (the
page's bots fight near the player's camera, where the referee's hit tests
and the audio's foley are; the runner has neither).

## The EoD round that stood still (2026-11-06)

Skandia's first round after the budget, on an EoD level he did not name: the
bots ran out, all came back to base, then stood. Probed in the page with
`botprobe.cjs` (a scratch Playwright script: every bot's behaviour,
position and route state every 5 s, the budget's counters beside them),
twelve bots, against a pristine `HEAD` worktree served on another port:

| level | build | rounds | bots still in the last minute (of 12) | what they were doing |
|---|---|---|---|---|
| Khe Sanh, 120 s | budget as shipped | 1 | 2 | MoveTo, Fire, TakeCover |
| Khe Sanh | `?nopathbudget` | 1 | 1 | the same |
| Khe Sanh | the served-whole budget | 1 | 4 | a firefight |
| Operation Linebacker, 240 s | current | 1 | 12 | Scout and Idle from the first tick |
| Operation Linebacker | `?nopathbudget` | 1 | 12 | the same |
| Operation Linebacker | pristine | 1 | 12 | the same |
| Hamburger Hill, 240 s | pristine | 3 | 2.5, 4.6, 9.7 | MoveTo early; one round settled into a standing firefight (Fire 8 of 12) |
| Hamburger Hill | current | 3 | 9.8, 9.2, 8.4 | MoveTo early; every round settled into the standing firefight |

Linebacker is the level: its three control points are all
`unableToChangeTeam` (a carrier air map), so the strategic AI has no
objective for infantry, nobody ever searches (the budget's counters stay
0), and the bots stand on deck scouting for planes in every build.

Hamburger Hill's freeze is a standing firefight, Fire winning over MoveTo
once the sides meet across the hill, and it happens in the pristine build
too. The current build settled into it in three rounds of three against
one of three; with the budget's counters showing at most two searches
pending and none overdue in those rounds, the budget is not what holds
them, and three rounds a side do not separate a tendency from a run of
luck. It is the thing to watch: `?nopathbudget` is the switch, and the
standing bots' `__bots()` rows (`behaviour`, `routePoints`,
`pathFailures`) say whether a route or a target holds them.

What the budget *can* do, and now cannot: with every bot searching at
once each share was a few hundred cells a tick, and a wide box's search
could crawl for seconds. That is the served-whole rule (4, above), which
the probes on Khe Sanh and Hamburger Hill ran under.

## Tests

- `tests/test_bot_route.py` `PathBudgetTests`: the sliced search answers as
  the one-shot search; three hulls on a walled-in map under a 600-node
  budget never expand more than 600 cells on a tick that served no overdue
  search, stand deferred rather than failed, and every one's first search
  concludes within 30 ticks; under a 60-node budget no search can finish
  in, every search is still served whole within a few ticks of the overdue
  cap and no route fails for want of a turn; the default budget is
  `0x400 * 8`. The existing `LegWideningTests` run with no budget and are
  unchanged.
- `test_bot_ai.py`, `test_nav_grid.py`, `test_nav_baked.py`,
  `test_sim_match.py` (a seeded match still reproduces byte for byte) and
  `test_sim_vehicles.py` pass.

## Open

- The strategic search is counted, not sliced. If a level's region graph is
  large enough that one coarse search is a spike of its own, it wants the
  same begin/step shape.
- `PATH_BUDGET_NODES` is one value for every level and bot count. The
  engine's slice scales with the frame; ours could scale with the tick's
  measured cost.
- The page/runner referee cost gap above.
