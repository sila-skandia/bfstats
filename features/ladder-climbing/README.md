# Gap 16 — ladders

The parity audit's Gap 16 (`features/bf1942-3d-models/parity-audit/level-content.md`)
counted 18 vanilla `c_CGLadders` templates and 83 placements across 14 of 23
levels: 13 placed straight into a level's `StaticObjects.con`, 70 nested as
children of a bundle (the guard tower's `Ladder_10m`, the bunker's, the dock
repair's, the ships' `ClimbingNet`s). None of it reached the viewer — a
placement node carried no word that said "climbable", so the ladders drew as
decoration and the soldier walked into them.

This feature closes the loop in three layers: the exporter reads the collision
group and measures the mesh; the viewer indexes what the exporter stamped; the
soldier's climb state climbs it.

## The engine's own subsystem

From `bf1942_lnxded.static` (addresses recorded in the audit):

| word | address | what it does |
|---|---|---|
| `BFSoldier::startClimbing` | `0x08281b20` | joins collision group 4 (`IResponsePhysics` vt+0x30), snaps onto the ladder plane, plays `Ub_ClimbLadder1` |
| `getLadderClosestPosition` | `0x08280b40` | a fixed **-0.48 m** perpendicular standoff off the ladder plane |
| `handleClimbAction` | `0x08281080` | reads the forward/back throttle axis each tick; ladder-top and ladder-bottom exit tests |
| `stopClimbing` | `0x08281ca0` | leaves the group, restores the default animation state |
| `updateClimbing` | `0x08280f10` | a literal no-op — climbing has no coded speed constant; motion is animation root-motion |

Two consequences drive the design:

* **The climb speed is a placeholder, and says so in one place.** The engine
  gives no number to copy (`updateClimbing` is `return;`). `LADDER_CLIMB_SPEED
  = 2.5` m/s in `viewer/ladder-climb.js` is chosen to read as a brisk climb and
  is the only place the number lives.
* **The -0.48 m standoff is the engine's own.** `LADDER_STANDOFF = 0.48`,
  same module, one place.

## What the data carries

`bf42/con.py` parses `ObjectTemplate.addToCollisionGroup` on any
ObjectTemplate and sets a `is_ladder` flag when any call names
`c_CGLadders` — "any call", because a ladder joins two groups
(`c_CGLadders` and `c_CGProjectiles`) in two separate lines, and the words
may sit either side of `setHasCollisionPhysics` (both shapes are verbatim in
`tests/test_con.py`, from vanilla's `ladder_10m_m1` and `Woodladder_4m_m1`).

`bf42/assemble.py` stamps `extras.isLadder` on the node the ladder is
**placed at** — top-level for the direct placements, a bundle child for the
nested ones — in that node's own glTF frame:

```json
{
  "axis":   [0, 1, 0],      // unit up axis, glTF space
  "length": 9.7563,          // metres along the axis
  "bottom": [-0.0001, -4.8924, 0.0014],   // box centre lines at the axis extremes
  "top":    [-0.0001,  4.8639, 0.0014],
  "width":  0.6301,          // extent across the rungs (longer of the two non-axis extents)
  "face":   [0, 0, -1]       // unit normal of the ladder plane (shorter non-axis extent)
}
```

The `.con` carries no ladder words beyond the collision group, so the geometry
is read off the mesh itself (`ladder_spec_from_positions`): the longest
bounding-box axis is the climb axis, the longer of the two remaining extents
is the across-rungs width, the shorter is the face — the direction the
engine's -0.48 m standoff points in. Bottom/top go through the same Z mirror
as every vertex, so the spec is plain glTF space. The reading is cached per
geometry, so a bundle of fifty guard towers parses `Ladder_10m.sm` once. A
ladder whose mesh cannot be measured (missing `.sm`, degenerate box) exports
silently clean — no block, no crash. `Report.ladders` records one line per
stamped node.

Because the spec rides the ladder's own node and is resolved to world space
through that node's world matrix, a bundle's transform composes itself at
read time — nothing is recomposed in Python. The flag also coexists with the
Gap 11 LOD splice: `extras.lod` rungs hang **under** the part node,
`extras.isLadder` sits **on** it, and `liftLods` takes the rungs, not the
part.

## The viewer

`viewer/ladder-climb.js` imports nothing browser-specific. Its two halves:

* **The index.** `collectLadders(root)` runs once per level inside
  `level-terrain.js`'s `buildCollider`, after `indexScene` has composed every
  matrix: one plain-number record per `extras.isLadder` node — world bottom,
  world top, world face, length, width. The records ride the collider
  (`collider.ladders`), which the soldier reads duck-typed the way it reads
  `collider.statics`; a collider without the field simply has nothing to
  climb.
* **The climb state.** A `ClimbState` per soldier, created in `Soldier`'s
  constructor, reset on spawn/bail-out, stepped from the tick loop
  (`Soldier#stepLadder`) ahead of the ordinary body step — the engine's
  collision-group swap standing in for skipping `body.step`:

  * **Grab.** Forward held, on the ground, not swimming, not under canopy,
    within 1.0 m of the ladder's axis (`LADDER_REACH`) — walking into the
    ladder, the engine's own start. Backward held grabs only beside the TOP
    rungs — stepping backwards off a deck onto the ladder to climb down.
    On a grab the body snaps onto the axis at his own height (his feet's
    place on the line; until 2026-09-27 his mid-body's, see below), offset
    perpendicular by 0.48 m on the side he approached from (the exporter's
    `face` sign is arbitrary; the grab orients it toward the soldier), and
    he turns to face the ladder.
  * **Move.** The clamped throttle axis: positive climbs up, negative down,
    zero hangs on — at `LADDER_CLIMB_SPEED`, a constant rate. Every rung is a
    contact: `lastCollisionHeight` tracks the climb, so a leap off
    mid-ladder is billed from where he let go and the top exit lands with
    nothing owed.
  * **Exit.** At the top (`t = 1`), the climb ends and the body is stepped
    `LADDER_TOP_STEP = 0.4` m *through* the ladder — a guard tower's deck is
    on the far side of its ladder from the man who just climbed it — and the
    ordinary physics settles his feet on whatever is there. At the bottom
    (`t = 0`) the climb ends on the ground under the ladder. A jump press
    tears the climb off at the jump-queue site and the queued impulse fires
    the next tick — the leap off. A dead body falls out of the climb the
    ordinary way.

While climbing the gait hangs at `stand` (no run bob), `body.step` does not
run for that tick, and the swim/drown/parachute seams are untouched.

## Verification

* `tests/test_con.py` (`LadderCollisionGroupParseTests`, 5 tests): the flag
  takes regardless of word order, other groups leave it false, and the
  verbatim guard-tower bundle keeps the flag on its child alone.
* `tests/test_assemble.py` (`LadderSpecTests`, `LadderBakeTests`, 10 tests):
  the mesh-bounds reading (axis, length, width, face, the Z mirror), the
  direct and nested emissions, the non-ladder and unmeasurable cases, the
  per-geometry cache.
* `tests/test_ladder.py` + `tests/ladder_harness.mjs` (12 tests): the whole
  climb law through the real `Soldier` against a fake collider — grab, the
  0.48 m snap, the 2.5 m/s rate, the hang, the top exit (through the ladder,
  onto the deck side), the bottom exit, the leap, the dead drop, the reach
  refusal, the ladder-less world, the backward grab.
* `node --check` every touched viewer file.
* `python3 -m unittest discover -s tests` from `tools/bf1942-models` — green
  apart from the one pre-existing `test_meme` clean-page-count failure.

## Live pass (Stalingrad), and the one caveat

The shipped `viewer/maps/bf1942/stalingrad/scene.glb` predates
`extras.isLadder` — the scene re-bake is sequenced after this exporter lands
(one pass covers LOD + ladders), so a fresh page reports
`__ladders().count === 0`. The live pass therefore stands the ladders in
through the hooks, with records that are exactly what the re-bake will bake:

1. Serve `tools/bf1942-models/viewer` (`python3 -m http.server PORT`), open
   `map.html?mod=bf1942&map=stalingrad&shots`.
2. Measure `ladder_10m_m1` once through the new exporter code
   (`_ladder_spec_for`) — 9.7563 m, 0.63 m across, face on the thin axis.
3. Find the live `ladder_10m_m1` nodes with `window.__scene`, transform the
   spec's bottom/top/face through each node's `matrixWorld`, and
   `window.__ladderInject(record)` the result — the same record
   `collectLadders` will produce from the re-baked extras.
4. Spawn on foot, stand 0.8 m off a ladder's axis facing it, hold W, step
   frames. Observed, live, on the ladder at (557.2, 38.2, -244.79):
   * grab on the first frame, `t = 0.135`;
   * snap at exactly **0.480000** m off the axis (z = -244.3086);
   * climb at exactly **+2.500 m/s** (y 39.494, 41.994, 44.494, 46.994 at
     one-second samples), holding the standoff the whole way;
   * top exit at `t = 1`: stepped 0.4 m through the ladder onto the ruin
     wall, feet settled and grounded at y = 48.37;
   * backward grab at the top (`t = 0.996`, standoff 0.48), the full 9.76 m
     back down at the same rate;
   * bottom exit at the base (y = 38.49), grounded, standing beside the
     ladder.
   `window.__climb()` reads the state, `window.__ladders()` the index.

Hooks: `viewer/test-hooks-ladder.js`, a NEW file rather than an edit of the
sibling-owned `test-hooks-world.js`, installed from `test-hooks.js` (the file
the other hooks load through), not from `map.html`.

A note on the first Stalingrad ladder the pass tried (541.6, -393.9): its top
exit is honest about unsupported geometry — the climb ends at the ladder top
and, with nothing to stand on there, the ordinary physics brings him back
down. The climb law does not invent a deck the level did not bake.

## 2026-09-27: the grab keeps his height

`climbStart` measured the reach from the soldier's mid-body (his feet plus half
his 1.8 m) and then reused that point's parameter on the line to place him, so
every grab lifted him 0.9 m: the live pass above grabbed at `t = 0.135`, and
`tests/ladder_harness.mjs` had learned to step the bottom exit frame by frame
because "the grab's own parameter offset" left an equal up and down short of
the ground. Nothing asked for the lift. The mid-body arrived with the climb
itself (`fffbd1e7`, the only commit on the file), there for the reach test and
its `-0.2 .. 1.2` range, which the top grab needs. The reach test keeps it.

The engine (ledger LADDER-1) keeps his height. `BFSoldier::handleClimbAction`
takes the ladder when forward is held, his origin is under less than 0.48 m of
water, and either the ladder's origin is above his and he moves along its +z
(`dot > 0.8`) or it is below his and he moves against it (`dot < -0.8`). The
first writes no position at all. The second drops him 2.0 m before
`getLadderClosestPosition` snaps him. That snap, repeated every climbing tick,
clamps only across the rungs and sets the -0.48 m standoff: his coordinate up
the ladder is his own. So the placement parameter is now where his feet
project onto the line (clamped to the line's ends), and the soldier stays at
his height on the grab: from the ground, and from a platform 4 m up
(`test_ladder.py` `test_the_grab_keeps_his_height`, which fails on the old
module with the 0.9 m lift).

Still the viewer's, and noted: the climb rate (animation-driven in the engine),
the page's exits at the line's ends (the engine's tests are against his origin
and the ladder mesh's bounding box, read but not verified), and the top grab,
which the page takes on a backward press near the top without the engine's
2.0 m drop.
