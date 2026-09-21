# Hull collision for ground vehicles: a plan, not a build

Written by wave-2 stream D (`w2d-drive`) alongside items 15–17 of the
2026-09-19 parity round. **Nothing here is implemented.** It exists so that
whoever picks the work up starts from what `viewer/ground.js` already has
rather than from `collision-response.md` cold.

Sources: [`subsystems/collision-response.md`](../bf1942-engine-reference/subsystems/collision-response.md)
(sections 3–8 and 12) and [`vehicle-collision-physics/README.md`](../vehicle-collision-physics/README.md).
That round's own ordering — crash damage first, then bodies, then the probe —
is the right one for the *whole* feature; this document is only the
ground-vehicle half of its step 2 and step 3, which is the part
`GroundVehicle` and `TrackedVehicle` own.

---

## 1. What the viewer already has

**A swept sphere against the static index.** `WorldCollider.sweepSphere(ox,
oy, oz, dx, dy, dz, maxDist, radius, skipOwner)` (`viewer/collision.js:804`,
over `StaticIndex.sweepSphere` at `:396`) returns `{t, nx, ny, nz, material,
owner, triangle}` for the first triangle a sphere of `radius` touches along a
ray. Both vehicle classes call it once per sub-step on the hull's own
displacement, back off to `t - 0.02`, and cancel the inbound normal component
of velocity (`ground.js`, the `if (this.collider && this._hullRadius > 0)`
block in each `#step`).

**A real triangle index with per-triangle materials and owners.** The scene
glb's `extras.collision` nodes are packed into a uniform XZ grid
(`buildStatics`, `viewer/collision.js:621`) carrying `materials`
(`Uint16Array`, one per triangle, from `geometry.userData.defenseMaterial`)
and `owners` (which node each triangle came from, with
`statics.ownerOf(node)` giving a vehicle its own id so it can skip itself).
Wake is 20,911 triangles, Bocage 21,661.

**A heightfield with per-sample terrain materials**, and as of this round a
`surfaceFriction(x, z)` join from those ids to `materialFriction`
(`map.html`). The per-*triangle* material is already on the sweep hit and is
already used for projectile impact effects.

**What it does not have.** Every parked vehicle is *in* the static index, so
it is a wall: infinite mass, no velocity, no damage, and the hit normal is
the triangle's rather than a contact between two bodies. There is no second
body to push.

## 2. What the engine does, in the four facts that matter here

From `collision-response.md`:

- **Contacts are vertices against faces** (§5.3–5.5). The *smaller* body
  supplies col0 **vertices**; the larger supplies col0 or col1 **faces**. For
  bodies of similar size both directions run, each at weight 0.5. A body with
  three or fewer col0 vertices contributes one; a soldier five; more than ten
  take a bounding-box early-out first. There is no sphere anywhere in it.
- **The push is a mass split, applied as an acceleration at the contact
  point** (§6.1, §6.4). `s = massB / (massA + massB)`, snapped all-or-nothing
  past 95/5 %, a static object reporting mass 1e12. The positional correction
  (`posAdjust`) is applied immediately; the velocity change is
  `speedAdjust * 30 * (1 + e) / 2` posted through
  `addAccelerationAtAbsolutePosition` and integrated **a tick later**. Every
  vehicle and terrain material has elasticity 0, so a contact removes half a
  body's share of the closing velocity per tick and nothing bounces.
- **Because it is applied at the contact point, it spins the body**, scaled
  by the box inertia of §4.2 and `inertiaModifier`, not by mass.
- **Accumulation is `setAdjust`, not addition** (§6.3): per axis, an empty
  slot takes the value, opposite signs add, same signs keep the larger
  magnitude. Many vertices on one face therefore do not stack, and opposing
  contacts cancel.

## 3. The smallest faithful first step

Not "port §5". The first step that changes what a player sees, and that
`ground.js` can carry without a second physics engine:

**Make the sweep's owner mean something.**

`sweepSphere` already returns `owner`, and `statics.ownerOf(node)` already
maps a vehicle root to its own id. Today the owner is used only to skip
self-collision. The step is:

1. Keep a registry of *live* vehicles by owner id — the page already builds
   one per drivable root (`vehicleDamage.byOwner`, which `window.__vehicles()`
   reads). Give it the driving vehicle's own object when one is seated.
2. On a hit whose `owner` resolves to a live vehicle rather than to scenery,
   stop treating the hit as a wall. Compute
   `s = otherMass / (thisMass + otherMass)` with the §6.1 snap, apply
   `s * closingSpeedAlongNormal` to this hull and `-(1 - s) *` the same to the
   other, at the contact point rather than at the centre of mass, and post
   both as accelerations consumed on the next sub-step.
3. Anything whose owner is not a live vehicle keeps today's behaviour —
   mass 1e12, `s = 1`, the hull takes the whole correction. That is exactly
   what §6.1 says a static object does, so the existing path becomes a
   special case of the new one rather than a branch beside it.

That is a dozen lines in each `#step` plus a registry lookup, it uses only
values already on the hit, and it turns "the jeep is stopped by the parked
plane" into "the jeep pushes the plane and slows down" — the ask that started
the collision round.

**What it deliberately does not do**, and why each is a later step:

| deferred | why |
|---|---|
| vertex-versus-face contacts (§5) | the sphere's contact point and normal are close enough to drive the mass split; replacing the probe changes *where* contacts are found, which is a separate, much larger change and needs the col0 vertex data plumbed through the glb |
| the one-tick velocity latency | today's sweep is resolved inside the sub-step; posting the velocity change a tick later is behaviour players have felt for twenty years (§12) and worth matching, but only once there are two bodies to be late about |
| `setAdjust`'s keep-the-larger accumulation | only matters with multiple contacts per tick, which the single sphere sweep cannot produce |
| the sleep counter (§4.3) | a parked vehicle that is in the static index is already, in effect, asleep; it becomes necessary at the same moment step 2 above does |
| crash damage (§9) | owned by `w2b`/`vehicle-damage.js` and by the collision round's own step 1. It needs `speedMod`, `angleMod` and the per-vertex collision material, none of which the extractor emits yet |

## 4. Two things to get right that are easy to get wrong

- **The `+1.0` share is an engine bug** (§6.1): below the 5 % snap the engine
  writes `+1.0` where the sign convention wants `-1.0`, pushing a much
  lighter body *toward* the heavier one. Port `-1.0`. It shows almost never,
  because a body that light is normally the vertex side and takes
  `shareA = 1` with the right sign.
- **Friction between two hulls barely exists** (§8). The Coulomb budget
  scales with the averaged contact normal's **y**, so a side-on ram
  contributes no friction at all — and, being a zero sample in the mean, it
  *dilutes* the wheels' friction for that tick. A vehicle-versus-vehicle
  contact should feed `ground.js`'s per-wheel friction the same way: as a
  sample with `N.y ≈ 0`, not as extra grip. `ground.js` already reads its
  coefficient per contact (PHY-2, item 16), so the hook exists.

## 5. What the extractor would need

Only for the later steps, listed so nobody plans around data that is not
there:

- **Per-vertex collision materials.** `stdmesh.py` reads the face material
  byte and discards the vertex `u16`. The vertex side of a contact pair needs
  it, and so does crash damage.
- **`inertiaModifier`**, for §4.2's box inertia. `ground.js` currently
  estimates a box from the wheel layout and a guessed hull height.
- **`speedMod` / `angleMod`** on the PCO, for §9.

`mass` is already carried (`extras.physics.mass`, read by both vehicle
classes), and so is `drag`.

---

# Built — 2026-09-22 (W6-C)

§3's step, taken from the other end: not "make the sweep's owner mean
something" (wave 3 did that for vehicle-vs-vehicle on 2026-09-20) but §3 point
**3** — the static that was "keeps today's behaviour" is now the same contact as
everything else, and today's behaviour is gone.

A driven vehicle no longer meets a building through `WorldCollider.sweepSphere`
at all. It probes its own **col0 vertices** along the engine's §5.5 ray and the
hits go through `body-contact.js`'s `Response`, `impulseOn` and `solveImpulse` —
the same objects a ram against a parked plane goes through. §3's reason for
deferring the probe ("needs the col0 vertex data plumbed through the glb") no
longer held: the 2026-09-20 round plumbed it, and `collisionPartsFor(spec,
driven, {hullOnly: true})` was already building the parts.

## What was built, and where

| file | what |
|---|---|
| `viewer/body-statics.js` (new) | the one arm `body-contact.js` could not run: §5.5's probe against `collision.js`'s triangle grid instead of against a `CollisionPart`. `collideWithStatics(parts, statics, dt, handlers)` at :132, the per-part vertex loop at :191. A static is §6.1's mass 1e12 through the shared `shares()` (`staticShare`, :106) and §5.3's face side at weight 1.0 |
| `viewer/collision.js` | `CollisionIndex.collectInBox` :745 and `castAmong` :800 — the engine's broadphase/narrowphase split, one grid walk per body per tick instead of one per vertex. `#deckDrops` :718 is the deck gate `sweepSphere` had inline, now shared with `cast`, which also gained `skipBodies` and the gate. `WorldCollider.staticProbe()` :1418 is the adapter |
| `viewer/body-world.js` | the detect pass, `tick()` :181-196, between object-vs-object and the ground, exactly where `rpm.update` runs it. `staticContacts` counts what it found |
| `viewer/vehicle-bodies.js` | `DrivenBody.noteContact` :345 — the resolved contact handed to the drive model's own friction solver, before `clearContacts()` takes the averages away. `sync()` empties the list at the top of every tick |
| `viewer/ground.js` | `hullContactFriction` :462 folds those contacts into the tyres' running mean; `hullSolved` (:964, :2570) turns the old sweep off (:1486, :3080) when the solver owns the hull |
| `viewer/world.js` | `setupBodies({statics})`, and `adoptDriven`/`releaseDriven` raise and lower `hullSolved` |
| `viewer/map.html` | `staticProbe()` into `setupBodies`; debug hooks `__stepSim`, `__hullSolver`, `__staticContacts`, and `hullSolved`/`hullContacts` on `__drive().state()` |
| tests | `tests/test_body_statics.py` + `body_statics_harness.mjs` (17), six more in `test_vehicle_bodies.py` for the hand-over. Suite 2,369 -> **2,392, green** |

`flight.js` needed no change: it had no static collision at all ("Real collision
against buildings is a separate problem", `step`'s ground comment), and
`DrivenBody` already applies the solver's push and spin to it.

## Measured

Bocage, vanilla. The same page, the same level, the same placement, with
`__hullSolver(true)` and `__hullSolver(false)` — which takes the statics out of
the solver *and* puts the drive model back on its swept sphere, i.e. `main`'s
behaviour. Driven through `__stepSim` at a fixed 30 Hz.

### A Willy into `barack_m1`'s north wall (approach along -Z at x = 1192)

| | solver (now) | swept sphere (`main`) |
|---|---|---|
| speed into the wall | **15.85 m/s** | not reported — the path has no contact record |
| speed leaving the contact tick | **8.05 m/s** | — |
| rest | (1191.991, 21.005, **-559.015**) | (1192.0, 21.003, **-558.477**) |
| rest attitude | pitch **-0.43 deg**, roll **0.06 deg** | pitch -0.33, roll 0.03 |
| residual speed at rest | **0.198 m/s** | **1.359 m/s** |

15.85 -> 8.05 m/s in one tick is §6.4's "a contact removes half of the body's
share of the closing velocity per tick" with `shareA = 1` and `e = 0`. The real
hull rests 0.54 m deeper into the building's footprint than a 2.9 m bounding
sphere let it. And the old path leaves **1.36 m/s of velocity on a hull that is
not moving** — the sweep pins the position and cancels only the normal
component, so what the drivetrain keeps adding never becomes motion and never
goes away.

### The same Willy from the east at 22 m/s, past a supply depot into the barracks

Three contact events, from the trace:

| tick | struck | speed in -> out | N.y | vertices | peak attitude in the second after |
|---|---|---|---|---|---|
| 0 | `Supplyde_m1` | 22.000 -> 22.000 | 0.022 | 8 | pitch 0.00, roll 0.07 |
| 3 | `Supplyde_m1` | 21.999 -> 21.446 | 0.021 | 2 | pitch -3.04, roll 3.38 |
| 14 | `barack_m1` | **19.162 -> 9.249** | -0.001 | 2 | pitch **-2.28**, roll **3.46** |

Rest: (1201.945, 21.006, -570.274), pitch -0.50 deg, roll 0.03 deg — the hull
origin 1.27 m off the barracks' east wall plane (x = 1200.68). A grazing contact
along a wall (`N.y` ~ 0.02, eight vertices touching) costs the jeep **nothing**,
which is the friction rule working: the Coulomb budget is `mu * N.y * |g|` and
there is none to spend sideways.

On `main`'s path the same run **never moves at all**: placed 0.5 m from the
supply depot its bounding sphere is already inside it, so every sub-step's sweep
reports a contact at `t = 0` and backs the position off to where it started. It
sits at x = 1211.965 with `grounded: false`, pitch and roll exactly 0.00, while
the drivetrain saws its velocity between 22 and 36.9 m/s forever. It never
reaches the barracks.

### A BF109 into `eu_church_M1`, level at 42 m, 60 m/s along +X

| | solver (now) | before |
|---|---|---|
| contacts at the west wall (x = 709.89) | **2 vertices at t = 9** | **none** |
| speed across the wall | 52.5 -> **24.1** (one tick) -> 6.7 (three) | 42.5 -> 40.7 -> 39.2, unchanged |
| where it ends up | stopped at x = 708.2, still tumbling: abs(w) 1.86 -> **2.23 rad/s** | through the church and out the far side |

This is the "responds like a body rather than being levelled out" half.
`flight.js`'s `settle` only fires on the heightfield; a building was simply not
there. Now the church stops the aircraft and spins it about the contact point.

### Cost

Berlin, a Hanomag driven through the city, 120 ticks, per tick:

| | ms/tick | grid cells walked | candidates | narrowphase tests |
|---|---|---|---|---|
| vertex probe, first cut | 4.572 | 28.5 | 54,754 | 49,396 |
| + per-triangle box reject in `cast` | 2.928 | 28.5 | 54,754 | 36 |
| + collect once per body (`collectInBox`/`castAmong`) | **0.407** | **1.2** | **2,043** | 3,612 |
| the swept sphere it replaces | 0.463 | 4 | 8,244 | 73 |

The finished path is **cheaper than the sweep it replaces** (0.41 against 0.46
ms/tick), because the sweep runs per drive sub-step and a swept-triangle test
costs a plane crossing plus six quadratics. The box reject added to `cast` is a
gift to every other caller: a round crossing Berlin used to pay Moller-Trumbore
on every triangle in its cell.

### The M3A1's lean is untouched

The owner has ruled the 32-38 degree lean to be real-game behaviour, so this was
measured as a regression check, not as something to fix. A full-lock
full-throttle turn from 14 m/s on Bocage, 300 ticks:

| | peak roll | peak pitch | final roll | hull contacts |
|---|---|---|---|---|
| solver on | -7.0610 deg | 17.4717 deg | -4.9719 deg | **0** |
| solver off | -7.0613 deg | 17.4716 deg | -4.9719 deg | 0 |

2.4e-4 degrees apart, which is run-ordering float noise, and **zero hull
contacts in either run**: on open ground this path is not in the loop at all, so
the lateral friction law cannot be affected by it. Nothing in
`hullContactFriction` touches `coulombCaps`, the tyre demand, `staticBudget` or
`allLatched`.

## Divergences from the engine spec

1. **`-1.0` for the low mass-share snap** (§6.1) — inherited from
   `body-contact.js`'s `shares()`, which this calls rather than reimplementing.
   It cannot fire against a static anyway: `s = 1e12/(m + 1e12)` always snaps
   high.
2. **Faces are two-sided, with the normal oriented toward the probe's start.**
   §5.5 culls back faces by the stored face normal; a level's baked triangles
   have no winding worth trusting (`collision.js`'s own narrowphase says so, and
   the assembler's Z-mirror reverses orientation). Where the two rules differ is
   *inside* a closed building: the engine finds no face at all — which is why
   those interiors carry the kill material 99 — while this pushes the hull back
   off the wall it crossed.
3. **No `handleCollision`, so no crash damage against a building.** §3's
   deferral, kept. The hook exists (`handlers.onStatic`, with §6.2's veto
   semantics) and `BodyWorld` passes none. Switching it on is not a one-liner
   *because* of material 99: 275 vanilla faces mean `giveDamage(1e10)`, so a hull
   that clips the inside of a building would die instantly. A crash-damage stream
   needs to decide what 99 means to a vehicle first.
4. **Springs are not probed.** A wheel's static contact would be §6.4's
   suspension branch; here a wheel reads the ground through `groundHeight`, which
   already includes drivable decks, so probing it would double the deck up. Hull
   parts only.
5. **The drivable-deck gate** (`KERB_STEP`, `deckFloorCos`) has no engine
   counterpart — the engine's wheels are bodies that mount a kerb on their own.
   It is `ground.js`'s existing sweep gate, moved so that one rule decides what a
   deck is for both queries. Without it a hull vertex finds a bridge's leading
   lip and stops on it.
6. **Hull friction reaches the tyres one tick late.** The engine's `addFriction`
   consumes the averages `impulseOn` left in the same tick; here the contact is
   resolved after the drive model has already run its own friction pass, so the
   sample lands on the next tick's. 33 ms.
7. **The contact still resolves inside the tick** (`DrivenBody`'s existing
   divergence), not one tick late as §12 has it.

## §3's deferred list, after this

| deferred | now |
|---|---|
| vertex-versus-face contacts (§5) | **done for statics** — col0 vertices against the level's triangles, §5.5's ray, §5.5's `f2` as the penetration |
| the one-tick velocity latency (§12) | still open, and now the only thing separating this from the engine's timing |
| `setAdjust`'s keep-the-larger accumulation (§6.3) | **live and load-bearing**: a hull scraping a wall reports up to 8 vertices on one face per tick and they do not stack. It is `Response`'s, unchanged |
| the sleep counter (§4.3) | untouched. A driven body never sleeps, and parked bodies are not probed against statics yet |
| crash damage (§9) | still deferred; see divergence 3 |

## Still open

- **Parked bodies against buildings.** The same call, one line in
  `BodyWorld.tick`. Not switched on because a level places vehicles inside
  hangars and lean-tos that its coarse col0 hull overlaps, and a sleeping body
  woken by a push-out it can never satisfy would never sleep again. The right
  place is the load-time settle pass (`settlePlacedVehicles`), where a vehicle
  that starts inside geometry can be pushed out once and then left alone.
- **The residual 0.18-0.20 m/s at rest against a wall** in the traces above. It
  is the known parking-hold residual, not something this added — the hull contact
  deliberately feeds neither `staticBudget` nor `allLatched` — but a contact does
  keep the vehicle awake, so it is more visible now.
- **Sample the contact velocity where the tyre force is applied.** Still owed;
  `u` is still taken at `wheel.rest`. This change did not touch it.
- **Ships.** `map.html`'s `if (vehicleCategory === 'VCSea') return null;` was
  left exactly as it is. Nothing here makes a ship a body — but it does make one
  thing easier for whoever does: a hull against the static world no longer needs
  a bounding-sphere radius or a deck gate tuned per vehicle class, so a ship's
  hull would meet a pier through the same `collideWithStatics` as everything
  else. The reason not to is still buoyancy, not collision.
