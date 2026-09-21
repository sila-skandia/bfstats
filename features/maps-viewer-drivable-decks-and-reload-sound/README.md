# Maps viewer: drivable bridge decks / reload bays, and the ammo-box reload sound

Two gameplay fixes for the maps viewer (`tools/bf1942-models/viewer/`), both
diagnosed against the running page with the headless `?shots` hooks and fixed
so the driving model and the on-foot weapon state match the engine.

- **Faithful to the engine.** In BF1942, `checkVsTerrain` drops a vehicle's
  vertices onto a heightfield that *includes* drivable bridges and reload/repair
  bays, so a tank rises up over a bridge and back down instead of stopping at
  it. The viewer's heightfield (`terrain/`) is only the ground under those
  decks, and the static collision mesh did the rest of the work — the tank hit
  the deck mesh like a wall. The fix puts the deck tops back into the surface a
  driven vehicle rides.
- **Faithful to the arm socket.** A reload keeps its clip action for exactly
  the reload timer; when the reload ends — a normal magazine change or an ammo
  box's top-up cancelling the timer mid-pass — the arms return to the gait clip
  and the reload sound stops.

---

## 1. The reload sound: stop replaying / stop when the reload finishes

**Symptom.** Near an ammo box (a `SupplyDepot` with `workOnSoldiers` and an
`ammoTypes` row), an in-progress weapon reload was cancelled by the box's
`refillAmmo` — which is correct, the box restores the magazine instantly — but
the arms clip stayed frozen in the `reload` pose. Because the reload clip was
`LoopOnce` + `clampWhenFinished` and the arms keep-alive was not tied to the
reload timer, it kept owning the sockets (and, where the authored clip carries
an audio channel, replaying the reload sound) on every further frame.

**Why it happened.** `wantViewmodelClip` (`viewer/viewmodel-anim.js`) had an
un-gated keep-alive:

```js
if (s.active === 'reload' && s.reloadRunning) return { want: 'reload' };
```

`refillAmmo` (`map.html`) sets `hw.reload = 0` when it restores ammo. The reload
timer being zero, the `s.reload > 0` branch no longer fires, but this un-gated
line kept answering `reload` while the `LoopOnce` clip was still mid-pass
(weapon reload clips are *long* — the Thompson's is a 4.76 s pass against a
4.8 s `reloadTime`), so the arms froze on reload for the rest of the session.

The second fault was in the *active-reload* branch. When the `LoopOnce` pass
ended (`!s.reloadRunning`) while `s.reload` was still counting, selection
restarted the clip — `startReload: true` — replaying the clip's sound even
though it had already played for this magazine:

```js
return { want: 'reload', startReload: s.active !== 'reload' || !s.reloadRunning };
```

**The fix** (both in `wantViewmodelClip`):

1. Gate the reload keep-alive on the timer actually running — a reload owns the
   arms only while `reload > 0`:
   ```js
   if (s.reload > 0 && s.active === 'reload' && s.reloadRunning) return { want: 'reload' };
   ```
2. Do not restart a finished reload pass for the same magazine: re-own the clip
   only when the arms were taken by something else:
   ```js
   return { want: 'reload', startReload: s.active !== 'reload' };
   ```

Now an ammo-box top-up that sets `reload = 0` drops the arms straight back to
the gait clip (the reload sound stops with the reload), and a normal reload
plays its clip/sound exactly once and holds the seated pose until the timer
completes.

**Verified.** Headless on Wake, standing on an `AmmoboxSupplyDepot`, weapon
emptied (`__setAmmo(0, 1)`): before the fix the `clip` stayed `reload` for all
400 stepped frames while `rounds=30, mags=4` (full) and `reloading=false`; after
it the clip returns to `idle` after the box's first refill tick, and the reload
action's `play()` fired exactly once (`TOTAL_RELOAD_PLAYS 1`). The pure
selection matrix is asserted in `tests/viewmodel_anim_harness.mjs` (three new
cases: finished-pass-no-restart, timer-done-return-to-loco, ammo-top-up).

---

## 2. Drivable bridge decks and reload bays

**Symptoms, in the order they were reported.**

1. A tank driving at a bridge (or a reload/repair bay) stops dead on arrival —
   "it just hits it and stops."
2. Then, with the first fix in (`333ddfe`, `525ed74`): a tank crosses the bridge
   but "jumps around in the air, sinks below the bridge"; and at a repair pad it
   "just drives through it, so the model is submerged in the repair pad" instead
   of driving up the little incline and onto the pad.

Walking over the same bridge has always been right. That is the clue the final
design is built on: a soldier collides with the **real static collision
triangles**, so a deck is exactly where the deck is. A driven vehicle now gets
the same geometry.

**Root cause of (1).** `WorldCollider.surfaceHeight` and the page's
`groundHeight` consult only the terrain heightfield plus the water level. A
bridge deck and a reload bay's raised apron are static collision meshes, not part
of `terrain/`. So the wheels raced toward the riverbed while the **hull sweep**
met the deck mesh and cancelled the velocity into its normal.

**Root cause of (2) — the height raster.** The first fix answered "how high is
the deck at (x, z)" from a raster built at load: per cell, the mean Y of the
triangle with the largest XZ footprint touching that cell. Four things were
wrong with that, and each one maps onto a symptom:

- **A sloped triangle became a flat plateau at its mean height, smeared across
  its whole XZ bounding box** — the box, not the cells it actually covers. An
  approach incline or a humped span is one or two such triangles, so what the
  wheels got was a step at the average of the triangle's two ends: too high at
  the bottom and too low at the top.
- **The underside of a deck has exactly the footprint of its road**, so the
  largest-face rule cannot tell them apart and which one a cell stored came down
  to mesh order. Measured, and it lost: standing on the crown of Bocage's stone
  bridge the raster answered **42.53 for a road at 46.41** — 3.9 m of "sinks
  below the bridge", from one cell.
- **Nearest-cell lookup, no interpolation.** The surface stepped at every cell
  edge, and the wheel probes (`probeAlongAxis`, plus `groundNormal`'s central
  differences at 0.5 m) read those steps as cliffs in the height AND in the
  normal — "jumps around in the air". A Tiger crossing the span spent 118 of its
  ticks airborne and moved up to 1.90 m in a single tick.
- **The query had no notion of the asker's height**, so *anything* at an (x, z)
  under a bridge was lifted onto the span. And `surfaceHeight` is shared: the
  README used to claim soldiers were untouched and that was simply false —
  `PlayerBody#settle` and `#tooSteep` in `physics.js` read it, as do the aircraft
  and boat floors, the cameras, spawn placement and the drowning check. A soldier
  put down under Bocage's bridge crown ended up 30 m higher, on the span.
- **And the fifth, which is why the repair pad behaved differently from the
  bridge: the pad was not in the drivable name set at all.** `landrep1_supply` is
  the vanilla land repair/reload station and nothing in `DRIVABLE_TOP_RE` matched
  it, so the raster had no entry for it, the wheels read the terrain flat all the
  way across, and the hull simply ploughed through the apron with two thirds of a
  metre of itself inside the slab — "drives through it, submerged in the repair
  pad", exactly as described.

On top of the raster, the hull sweep carried a `CLIMB_STEP` hack: when the sweep
hit a drivable owner it nudged `position.y` up by 0.2 m a tick, and when the
raster had nothing to say it ignored the contact altogether — which is literally
how the hull passed **through** the pad mesh.

**The design now.**

- **The ride surface is an exact ray, not a raster.**
  `WorldCollider.deckHeight(x, z, fromY)` casts straight down from `fromY`
  against the real collision triangles, restricted to the drivable ones. Inclines
  and arches come out exact and continuous, and two properties fall out of the
  construction rather than out of a heuristic:
  - **Height awareness.** The ray starts at the caller's reference and goes down,
    so a vehicle under a bridge is never offered the deck above it. The caller's
    reference is the policy: a wheel passes its axle plus `DECK_STEP_UP`, so a
    deck within a step is mounted and one above it is not.
  - **The road always beats its own soffit and its parapets.** `cast` returns the
    NEAREST hit, and from above a deck that is its road surface.
- **The raster is now only a broadphase.** `buildDrivableMask` keeps, per 4 m
  cell, the min and max Y of the drivable triangles over it — two floats, no
  height. No drivable triangle over the cell, or the asker below every deck
  triangle in it, and there is **no ray at all**; otherwise the ray is clamped to
  that Y band, so it is a couple of metres long inside one 32 m index cell. Open
  terrain, and every level with no bridge, costs exactly what it cost before.
- **Drivable is a per-triangle mask on the collision index**
  (`CollisionIndex.drivable`, built in `buildCollisionIndex` from
  `isDrivableCollisionMesh`, which walks the placement's ancestors). Per triangle
  rather than per owner because both readers need that resolution: the deck ray
  must ignore the terrain and the buildings, and the hull sweep must keep the
  bridge's parapets while ignoring its road.
- **The hull sweep treats a deck as a floor.** A vehicle's hull sphere is its
  whole bounding radius centred barely a metre off the ground, so it is
  permanently buried in any horizontal surface it stands on — terrain only gets
  away with that by not being in the sweep at all. `sweepSphere` therefore takes
  two gate numbers, and they only ever drop triangles of a drivable object:
  `deckFloorCos` (0.5, i.e. 60 degrees) drops a road, a soffit, an approach ramp
  and an arch; `deckStepTop` (the surface the wheels are on plus
  `DECK_WALL_STEP`) drops a lip low enough for the suspension to mount. A
  parapet, a bridge pillar and a hut on the bay are vertical and stand above the
  step, so they still stop the hull dead. **`CLIMB_STEP` and its 0.2 m/tick
  nudge are gone** — nothing writes `position.y` outside the integrator any more,
  so nothing can tunnel or launch.
- **The contact normal comes off the deck triangle.** `deckNormal` hands
  `ground.js` the hit triangle's own normal where a wheel is on a deck, and the
  heightfield gradient everywhere else (`surfaceNormalAt`). A finite difference
  is right for terrain, which *is* a height function on a 4 m lattice, and wrong
  for a deck: half a metre either side of a wheel near the lip straddles a drop
  of metres, and the near-horizontal normal that comes out of it turns the spring
  off through `nAxis` on exactly the tick the tank is mounting the thing.
- **Friction is the deck's material.** `surfaceFriction(x, z, fromY)` reads the
  hit triangle's `defenseMaterial` when a deck is the surface. Without it a tank
  crossing a bridge over water was gripping at water's 0.1, because the surface
  it was standing on read as being at the sea line.
- **`surfaceHeight` is back to terrain and sea for everybody else.** The deck is
  opt-in through the third argument, and only vehicles pass it: the soldier, the
  aircraft and boat floors, the cameras, spawn placement and `__placeCar` call it
  with two. A soldier meets a bridge the way it always did, through `cast`
  against a real triangle. The one non-wheel caller that *does* pass a reference
  is `World.#inWaterOwners` (`world.js`) — it passes the body's own Y, so a tank
  on a span over a river is not drowned and a tank in the river under the same
  span is, which the shared raster could not tell apart.

**Cost.** Off a deck: one broadphase cell lookup per ground query, no ray. On a
deck: about four short rays per wheel per sub-step (two for the probe, one for
the normal, one for friction), each over the drivable triangles of one 32 m cell,
with `cast` walking a single cell for a vertical ray. Nothing allocates per frame
(`features/mesh-viewer-performance` rule 5). Note that deck rays go through
`CollisionIndex.cast` directly, so they land in `statics.stats.queries` but not in
`WorldCollider.drainCost()`'s `microsPerCast`.

## Files changed

| File | Change |
|---|---|
| `viewer/viewmodel-anim.js` | reload keep-alive gated on `reload > 0`; no restart of a finished reload pass |
| `viewer/collision.js` | `DRIVABLE_TOP_RE` + `isDrivableCollisionMesh`; the per-triangle `CollisionIndex.drivable` mask; `buildDrivableMask` (the broadphase that replaced the height raster); `WorldCollider.deckHeight` / `deckSurface` / `deckNormal`; `surfaceHeight(x, z, fromY)`; `onlyDrivable` on `cast` and the `deckStepTop`/`deckFloorCos` gate on `sweepSphere` |
| `viewer/ground.js` | `DECK_STEP_UP` / `DECK_WALL_STEP` / `DECK_FLOOR_COS` replace `CLIMB_STEP`; the deck reference threaded through `probeAlongAxis`, `groundNormal`, `surfaceFriction` and the ground failsafe; `surfaceNormalAt`; the hull sweep back to a plain wall stop with the gate passed, in both `GroundVehicle` and `TrackedVehicle` |
| `viewer/map.html` | `buildDrivableMask`; `groundHeight(x, z, fromY)` and `surfaceFriction(x, z, fromY)`; the `deckNormal` hook injected into the drive; `bodyAwareCollider` forwards the gate instead of swallowing it; `__drive().state()` gains pitch/roll and `__drive()` gains `ground(x, z, fromY)` and `sweep(...)` |
| `viewer/world.js` | the drowning check passes the body's own height, so a vehicle on a span over water is not in the water and one under it is |
| `tests/viewmodel_anim_harness.mjs`, `tests/test_viewmodel_anim.py` | reload-selection regression cases |
| `tests/collision_harness.mjs`, `tests/test_collision.py` | the ramp/pad/arched-span fixture: ramp continuity, the arch against its own soffit and parapets, height awareness under a span, a roof, the opt-in, the deck normals, and the hull gate |
| `tests/ground_harness.mjs`, `tests/test_ground.py` | a jeep and a tank driven up an incline onto a pad, a vehicle driven under a span, and the gate the hull sweep hands the collider |
| `tests/perf/decktrace.cjs` | new: traces a driven vehicle across a level's real decks in headless Chromium, and reads a pre-fix build too so before/after come from one tool |

## Verified

**Unit.** `uv run --with pytest --with pillow --with numpy pytest tools/bf1942-models/tests -q`
-> `2066 passed, 134 subtests passed`.

**Headless, Bocage, the stone bridge** (`stonebridge_sml_M1`, a diagonal arched
span over a river at y = 10; crossed on the real key path from
`(545.8, -1676.3)` heading -0.740 rad). `before` is `525ed74`, served from a
pristine checkout; both runs are the same line, same vehicle, same tick count.

| | Tiger before | Tiger after | Willys before | Willys after |
|---|---|---|---|---|
| ride height over the deck, mean | 4.95 m | **1.18 m** | 8.66 m | **0.42 m** |
| ride height on open ground | 1.19 m | 1.19 m | 0.42 m | 0.42 m |
| lowest ride height on the deck | 0.08 m | **1.09 m** | 0.05 m | **0.27 m** |
| airborne ticks on the deck | 118 | **0** | 145 | **0** |
| biggest tick-to-tick y jump | 1.90 m | **0.26 m** | 3.60 m | **0.76 m** |
| pitch range | -32.6 to +36.0 deg | **-15.1 to +14.0 deg** | -81.9 to +27.1 deg | **-14.2 to +14.2 deg** |
| deck height the wheels read | 10.0 to 45.97 | **42.51 to 46.44** | 10.0 to 46.03 | **42.48 to 46.43** |

The last row is the whole of it: before, the wheels read anything from the
riverbed to the span, tick to tick. After, they read the span, which rises 42.5
-> 46.4 and back, while the terrain under it drops to 10. Against the *true*
deck profile, the Tiger's old run spent 30 of 107 ticks below the span, worst
case **3.32 m under it** (hull at 42.95 where the deck is 46.27) — "sinks below
the bridge". The new run: 0 ticks below, worst 0.00 m. The jeep's old run never
came within 2 m of the crossing line at all, so it has no comparable sample: at
-81.9 degrees of pitch and a mean 8.7 m off the surface it was not crossing a
bridge, it was being thrown off one.

Ride height holding to +/-3 cm of its flat-ground value across a span whose
terrain drops 32 m, with the pitch going +14 deg up the ramp, 0.2 deg at the
crown and -15 deg down the far side, is the "just drive over it" the report
asked for.

**Headless, Bocage, the Axis repair/reload station** (`landrep1_supply`). This
one also needed a name: nothing in `DRIVABLE_TOP_RE` matched `landrep1`, so the
pad was not a drivable surface at all. Its gentle approach is from the north —
the apron meets the terrain at z = -1078 and rises 0 -> 0.5 -> 0.6 m over the
next four metres, which is the "little incline" of the report. A Tiger driven
down it from `(610, -1066)`:

| | before | after |
|---|---|---|
| deck height the wheels read | 33.98 to 33.99 (the terrain) | **34.00 to 34.64 (the incline and the slab)** |
| ride height above the TRUE pad top | 0.51 m (should be 1.16) | **1.09 m** |
| so the hull was inside the slab by | **0.65 m** | **0.00 m** |
| pitch range | -0.1 to +2.7 deg (it never noticed) | **-2.1 to +9.5 deg (up the incline)** |
| airborne ticks | 0 | 0 |
| biggest tick-to-tick y jump | 0.001 m | 0.237 m |

The before column is the bug in one row: the wheels read the terrain, flat, the
whole way across, so the tank drove through the apron with two thirds of a metre
of hull inside it. The 0.001 m "smoothness" before is not a virtue — it is the
smoothness of a surface that is not there.

The station's west edge is a 0.93 m kerb rather than a ramp; a tank now mounts it
with a hop (25 airborne ticks, 0.53 m jump) instead of stopping at it.

**A second map with a different bridge.** Market Garden's `stonebridge_big_M1`,
a 140 m span over a river at y = 24, crossed by a PanzerIV: 470 ticks on the
deck, ride height **0.734 m against 0.730 m on open ground**, lowest 0.686,
**0 ticks below the deck, 0 airborne**, biggest jump 0.443 m (a ramp), deck 36.81
-> 40.75, pitch -13.4 to +9.1 deg.

**The soldier, whose behaviour the old README wrongly called untouched.**
Teleported to y = 12 UNDER the crown of the Bocage bridge (deck 46.41, river 10)
and stepped 90 frames:

| | before | after |
|---|---|---|
| where the soldier ends up | y = **42.53** — lifted 30 m onto the span | y = **10.0**, on the river |
| standing ON the crown | y = 46.41, but its ground query read 42.53 | y = 46.41, ground query 10.0 |

Both builds hold the soldier up on the crown, because that has always come from
`cast` against the real triangle. Only the shared height query was wrong, and it
was wrong in both directions: 30 m too high under the span, 3.9 m too low on it.

**Carrier deck / dock names, and the clearest table of the lot.** Invasion of
the Philippines ships `Bridge_Big_M1`, `Bridge_Small_M1` and three
`dockrepair_supply` stations, all over water at y = 45. The two queries at each
one's centre — two-argument (the soldier, the boats, the planes, the cameras) and
three-argument (a driven vehicle's wheels, from a reference just above the deck):

| object | box top | before, 2-arg | before, 3-arg | after, 2-arg | after, 3-arg |
|---|---|---|---|---|---|
| `Bridge_Big_M1` | 54.5 | 52.44 | 52.44 | **45.0** | **52.44** |
| `Bridge_Big_M1_1` | 67.1 | 48.73 | 48.73 | **48.73** | **64.73** |
| `dockrepair_supply_1` | 49.2 | 46.34 | 46.34 | **45.0** | **48.88** |
| `dockrepair_supply_2` | 49.5 | 46.47 | 46.47 | **45.0** | **49.27** |
| `Bridge_Small_M1` | 46.5 | 46.20 | 46.20 | **45.0** | **46.20** |

Before, one number served both readers and it was the raster's guess — so a boat
motoring under `Bridge_Big_M1_1` was standing on a surface 3.7 m above the sea,
and a vehicle on the same span was offered 48.73 for a deck at 64.73, sixteen
metres out. After, the two have separated exactly as intended: the sea for
everyone who is not driving, the real span for the wheels that are.

Wake and Midway load with no page errors on either build and every placed
vehicle's height is identical between them.

## Open

- The vanilla `landrep1` station carries a **workshop building standing on its
  own pad**, and a `repaircist_m1` canister sits just off its west edge. Both are
  correctly walls, so a run that crosses the pad stops against one of them; that
  is the level, not the model.
- `DRIVABLE_TOP_RE` still matches two things that are vehicle parts rather than
  level furniture (`B17_Bay_*`, `Katyusha_Ramp`). With the per-triangle mask and
  the slope gate the only consequence is a hull clipping slightly into those
  near-horizontal faces of a parked one; documented at the pattern.
- `groundNormal`'s finite differences are still the fallback where a wheel is
  NOT on a deck but a neighbouring sample is (a wheel just off a deck edge), and
  there the 0.5 m samples can straddle the drop. The primary paths — on the deck,
  on the ramp — take the triangle's own normal and are exact.
- Deck rays go through `CollisionIndex.cast` directly, so they are counted in
  `statics.stats.queries` but not in `WorldCollider.drainCost()`'s
  `microsPerCast`. A perf pass that wants them in the per-cast average has to
  route them through `WorldCollider.cast`.
- `map.html` at `525ed74` imports `./netcode-client.js` and `./netcode-render.js`,
  which are **not committed**, so the page does not load at all in a fresh
  worktree (every module after the failed import is dead). Unrelated to this
  work and not fixed here; the headless runs above copied those files in from the
  main checkout. Whoever owns `features/netcode-play-multiplayer` should commit
  them.
