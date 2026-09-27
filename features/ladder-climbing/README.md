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

From `bf1942_lnxded.static`; the addresses, and the evidence for every number
below, are ledger LADDER-1..5 (`features/bf1942-engine-reference/ledger.md`).

| word | address | what it does |
|---|---|---|
| `BFSoldier::handleCollision` | `0x0827d3b0` | a contact with a ladder material (192..195) on an object in the ladder collision group records the ladder, `+0x3c8`/`+0x3c4` |
| `BFSoldier::handleClimbAction` | `0x08281080` | the grab; every climbing tick the snap, the direction, the ends |
| `getLadderClosestPosition` | `0x08280b40` | the snap: in the ladder's own frame, across the rungs clamped, up the ladder kept, **-0.48** on its z |
| `BFSoldier::stopClimbing` | `0x08281ca0` | every way off; at the top the 2.0 m lift a metre through the ladder; the `(0, -100, 0)` push |
| `BFSoldier::handlePlayerInput` | `0x08273c70` | gravity off and the velocity set along the ladder's up axis while a ladder is held |
| `BFSoldier::updateClimbing` | `0x08280f10` | a literal no-op; the rate is `handlePlayerInput`'s, not an animation's |

Everything is measured in the LADDER'S frame (the placed object's rows: x
across the rungs, y up, z its face normal) against the `.sm` header's bounding
box, and against the soldier's ORIGIN, a metre over his feet. The climber
always hangs on the ladder's -z face looking along +z; the +z side is the deck
side.

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
engine's -0.48 m standoff points in. For all 17 vanilla ladder geometries the
face is the mesh's z, so `face` (glTF -z) is the ladder's own +z, and the box
is the `.sm` header's (the header bounds equal the LOD-0 vertex box for all 15
meshes they draw). The viewer reads the ladder's frame off the node's world
matrix rather than off `face`. Bottom/top go through the same Z mirror
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
  world top, world face, length, width, and the ladder's own frame (origin,
  rows, the box's extents in it). The records ride the collider
  (`collider.ladders`), which the soldier reads duck-typed the way it reads
  `collider.statics`; a collider without the field simply has nothing to
  climb.
* **The climb state.** A `ClimbState` per soldier, created in `Soldier`'s
  constructor, reset on spawn/bail-out, stepped from the tick loop
  (`Soldier#stepLadder`) ahead of the ordinary body step — the engine's
  collision-group swap standing in for skipping `body.step`:

  * **Grab** (`climbStart`). Forward held and touching a ladder (the page's
    stand-in for the contact: within `LADDER_REACH`, 1.0 m, of its face
    rectangle, his body overlapping its height to `LADDER_TOUCH_ABOVE`, 1.1 m,
    past the top, on the side he faces it from), his origin under less than 0.48 m of water, and one of
    the engine's two arms: below the ladder's origin facing its +z (`> 0.8`),
    or above it facing its -z (`< -0.8`) — walking forward off the deck out
    over it, which drops him 2.0 m. No backward grab, no ground test; the
    canopy refusal is the page's. A swimmer (his origin pinned 0.4 m under
    the surface) takes a net, and the climb ends his swim. He is snapped to the -z face at his
    origin's height in the ladder's frame, across the rungs where the
    engine's clamp puts him, and turned to face +z. The grab's tick is
    already a climbing tick.
  * **Move** (`climbTick`). A held throttle, either key, climbs the way he
    looks (the sign of his pitch; a level look keeps the key's sign), at the
    engine's rate: the standing row of `directionalSpeed` times the climb
    states' `setSpeed 0.7` through the ordinary ramp — 4.2 m/s up, 2.8 down,
    a third with the walk key. Nothing held hangs, once the ramp has run
    down. The velocity is the climb's, so it carries into a let-go. Every
    rung is a contact: `lastCollisionHeight` tracks the climb.
  * **Ends** (`climbStop`). Moving down with his origin under the box's
    bottom plus 1.6 (feet 0.6 m over it) lets go; moving up with it over the
    box's top less 0.8 lets go, and there he is lifted 2.0 m and a metre
    along +z, through the ladder onto the deck side; moving down with it more
    than 0.5 m under water lets go. A jump press lets go without a jump; so
    does death. Every let-go adds the engine's `(0, -100, 0)` for one tick.

While climbing the stance and gait hang at `stand`, `body.step` does not run
for that tick, and the swim/drown/parachute seams are untouched.

## Verification

* `tests/test_con.py` (`LadderCollisionGroupParseTests`, 5 tests): the flag
  takes regardless of word order, other groups leave it false, and the
  verbatim guard-tower bundle keeps the flag on its child alone.
* `tests/test_assemble.py` (`LadderSpecTests`, `LadderBakeTests`, 10 tests):
  the mesh-bounds reading (axis, length, width, face, the Z mirror), the
  direct and nested emissions, the non-ladder and unmeasurable cases, the
  per-geometry cache.
* `tests/test_ladder.py` + `tests/ladder_harness.mjs` (22 tests): the whole
  climb law through the real `Soldier` against a fake collider and a ladder
  built through `ladderRecord` — both grab arms, the facing and height
  refusals, no backward grab, no grab walking away from it, the snap, the rates and the look's direction,
  the hang, the top's lift onto a deck, the bottom, the water, a swimmer's
  grab, the jump's let-go, the dead drop, the reach refusal, the ladder-less
  world.
* `node --check` every touched viewer file.
* `python3 -m unittest discover -s tests` from `tools/bf1942-models` — green
  apart from the one pre-existing `test_meme` clean-page-count failure.

## Live pass (Stalingrad), and the one caveat

(The first pass, with the original climb law, before the scenes carried
`extras.isLadder`. The 2026-09-27 pass at the end of this file replaces its
numbers.)

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
2.0 m drop. (All three were settled the same day; see below.)

## 2026-09-27: the engine's grab, climb and ends

Ledger LADDER-2..5; `viewer/ladder-climb.js`, `viewer/soldier.js`
`#stepLadder`, `tests/test_ladder.py`.

**The top grab.** The dot `handleClimbAction` tests is his FACING — his own
row 2, which `handlePlayerInput` hands it — against the ladder object's row 2,
its +z; his velocity is not read. Below the ladder's origin he takes it facing
+z; above it, facing -z, which is walking forward off the deck out over the
ladder: dropped 2.0 m, put on the -z face, turned round to face +z. Only
forward grabs, so the page's backward-press grab is gone, and so is its ground
test (the engine has none). A man level with or above the ladder's origin on
its -z side, facing it, takes neither arm; a short ladder whose origin sits
under a standing man's cannot be taken from its foot. The page also refused
any swimmer; the engine's water test lets one whose origin is under 0.48 m
take a ship's net, which the swim's own pin (0.4 m) always is.

**The exits.** Verified: the box the tests read is the ladder object's
geometry's `getBoundingBox` (`IGeometry` vt+0x1c), the `BStandardMesh`'s copy
of the `.sm` header bounds that `loadHeader` reads — and for all 15 vanilla
ladder meshes those are the LOD-0 vertex box, so the exporter's bottom and top
are the engine's box. The tests are against his origin in the ladder's frame:
down under `min.y + 1.6` (feet 0.6 m over the box), up over `max.y - 0.8`,
down more than 0.5 m under water. `stopClimbing` at the top lifts him 2.0 m
and a metre along +z (feet 0.2 m over the box's top, 0.52 m beyond the
ladder's plane); every let-go gets a one-tick `(0, -100, 0)` acceleration.
The page's exits now do exactly that. A jump press lets go without a jump (the
engine zeroes the action). The top's `Lb_ClimbLadderEnd1`/`Exit`/
`StopClimbing` arms are dormant in vanilla — nothing enters those states —
and are not built; nor is the one-second `+0x55c` timer, which only stops
`handleCollision` looking for a moving object to ride.

**The climb rate**, measured where it could be:

* The engine: while a ladder is held `handlePlayerInput` turns gravity off
  and sets the velocity to the ladder's up axis times the ordinary forward
  command, the climb states' `setSpeed 0.7` included: **4.2 m/s up, 2.8 down**
  at the full ramp, 1.4 and 0.93 with the walk key. `LADDER_CLIMB_SPEED` is
  now that product, not a placeholder.
* The clips: `3PClimbLadder1Lower`/`2Lower.baf` are six frames; the root's
  height channel moves 1 cm over a clip and the rest bob and return. No root
  motion to measure, and the engine reads none for the motion.
* The recordings: the only two with a state table (Wake v4, Kursk v5) hold
  4,416 soldier-state records and none in any of the 20 climb states; a
  motion scan of all 55 recordings finds no climb. Nothing recorded to hold
  4.2 against.

**The direction**, found on the way: a held throttle, W or S, climbs the way
he looks — the sign of his aim pitch replaces it. The recordings settle which
sign is up: in all 33 of the fired rounds with pitch and elevation both past
5 degrees, the two agree.

**Live, Stalingrad** (one headless Chromium, the baked `extras.isLadder`, all
twelve ladders): walking into each -z face with W, the grab within two ticks,
4.200 m/s over the last full second of every tower climb, the top let go with
his feet 0.20-0.27 m over the box and 0.52 m through, and he settled on the
deck — 42.83 m on the bunkers, 47.39-48.43 m on the towers. Then, on five of
them (four towers, one bunker), from where he stood: turned out over the
ladder, looking down, W — taken on the first tick (63 ticks when he had first
to walk 2.9 m to the edge), dropped 2.004 m onto the -z face, down at 2.8 m/s,
let go with his feet 0.49-0.60 m over the box's bottom, standing on the
ground, no damage. The tower ladder at (541.6, -393.9) that the first pass
found unsupported now leaves him on the ruin at 48.43 m.

Left open, and the page's: the touch (`LADDER_REACH`, `LADDER_TOUCH_ABOVE`,
and the side he faces it from) stands in for a contact with the ladder's
collision mesh; the page turns him
to face the ladder once, at the grab, where the engine hands him its rows
every tick; and the `(0, -100, 0)` push is a per-tick acceleration, so it
takes 1.7 m/s at the page's 60 Hz where it takes 3.3 at 30.
