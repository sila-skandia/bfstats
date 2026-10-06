# Hull collision for ground vehicles: the plan, and what was built

Written by wave-2 stream D (`w2d-drive`) alongside items 15–17 of the
2026-09-19 parity round. Sections 1 to 5 are the plan. W6-C built it on
2026-09-22, and [the Built section](#built--2026-09-22-w6-c) below says what
and where. The 2026-10-06 section is the land drives' own chassis, the sea
and the upside-down clock. Two 2026-10-07 sections follow:
[Handling against the lab's LOD 0 rounds](#handling-against-the-labs-lod-0-rounds-2026-10-07)
checks the drives against retail on retail's own inputs and records what that
changed, and "Terrain contact, 2026-10-07" is a driven hull against the
terrain, the ground under an undrawn patch, a room's land drive and a landed
helicopter, with what is still open. The title used to call this a plan, not a build, and this line used
to say nothing here is implemented. The plan was written so that
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

---

# Own chassis, the sea and the clocks — 2026-10-06 (DC parity round, `ground-chassis`)

Found by the Desert Combat census (`~/.cache/dc-sweep/reports/ground.md`) and an
adversarial sweep after it; built and checked in one package. What each item
was, what changed and how it was checked. Engine claims are ledger rows.

## G1. A wheeled hull drives on its own chassis

**Was:** `GroundVehicle` took mass, drag, drag radius, inertia and wheel radius
from the `WILLYS` table for every wheeled vehicle in every mod. A ten-tonne
SCUD-B turned on a jeep's 5.17 m² of yaw inertia and full lock from top speed
turned it at 35.6 deg/s.

**Now:** the root's own `physics.mass`/`drag` (as `TrackedVehicle` read them),
each wheel's radius off its own mesh (`measureWheelRadius`, plus the page's
`contactDepth` as the tracked drive takes it), and the inertia from
`getGeometryInertia` over the box the engine itself picks. Which box was the
open question, and it is now ledger **COL-14** (air-flight's reading of the
same walk, the same day) with **COL-15** for what a land hull takes from it
(2026-10-07: this round's own reading was COL-13 until the two met): the root has no geometry, so
`findLodGeometry` takes the highest alternative of the root's first child when
that is a `LodObject` (a tank's `ShermanComplex`), else of the first
`LodObject` under a `DistCompareLodSelector` met depth first (a car's cockpit
exterior, `Willy_Hull_M1`). The box is that mesh's `.sm` header bounds. The
glb mesh's vertex box matches it on every vanilla, XPack1 and XPack2 land hull
and not on 17 of Desert Combat's 41, so the page and the runner hand the drive
the level's collision sidecar, whose `bbox` is the header box
(`headerGeometryBox`, added in review). The search is `ship-spec.js`
`inertiaGeometryNode`; the drag radius is the sphere round that box (the sphere
drag law it feeds is itself not the engine's, PHY-4, and is kept as it was).

**Checked:** flat-ground drives of every DC wheeled hull and the vanilla cars
(`~/.cache/dc-sweep/ground-chassis/ground_drive.mjs`). SCUD-B full lock from
top speed 35.6 to 15.6 deg/s; BM-21 16.6 to 12.8; Willy 111.3 to 111.2 km/h,
turn 14.1 unchanged; Kubelwagen 111.2, 16.8 to 16.9. The Willy is not
byte-identical on its real glb: its guessed box was 1.6 x 1.5 x 3.6 and its
own is 1.734 x 1.523 x 3.636. The ground harness's Willy and Kubelwagen, which
carry no meshes and so keep the table, are byte-identical. Tests:
`test_ground.py` `test_a_wheeled_hull_takes_its_inertia_from_its_cockpit_hull_mesh`
and the three after it.

## G2. A land hull in the sea sinks, drags, drowns and is crushed

**Was:** every land vehicle that cannot float stood on `max(terrain, water)`.
A Humvee driven into Operation Bragg's sea rode 6.6 m of water at 31 m/s with
full HP; an M1A1 sat on 27 m of it unharmed.

**Now (PHY-16):** every land drive stands on the bed (`bedGroundHeight`), and
`HullWater` (`amphibious.js`) measures the root part's depth under the sea and
adds the box drag's submerged excess on COL-14's box. When the hull is boarded
`hull-bodies.js` hands it the root part's own col0 (the body-world part the
geometry search finds, `spec.waterPart`; not `part.isRoot`, which is the first
part the tree walk met and on a placed BMP-2 is its gun barrel). The water's
HP-5 tick then reaches the hull because it is in the water. `submarineData`
(PHY-3, corrected) runs in `vehicle-damage.js` `stepSubmarine` on the depth
`world-damage.js` `submersionDepth` reads off the body world.

**Checked** in the headless runner (`ground_sim.mjs wadetrace`, flat deep
spots): Humvee sinks to the bed in 2 s, crawls there at 4.6 m/s and loses 5 HP
a second; M1A1 sinks, drives at 6.8 m/s and is crushed at 5 HP a second below
1.5 m; BMP-2 on Urban Siege still swims, at 5.6 m/s on its own col0 depth (it
did 3.3 on the glb's last collision layer, which is not col0; 5.4 on its
header box's `DY` of 1.156, after review). XPack2's Schwimmwagen swims at
22 km/h instead of 15 in the harness and at 27.6 in the runner, where the drive
has its col0 (Peenemunde); the BRDM-2 goes from 7.1 to 9.3 m/s.
Tests: `test_ground.py` `test_a_land_hull_sinks_to_the_bed` and the two after
it, `test_vehicle_damage.py` `SubmarineDataTests`, `test_world_damage.py`.

## CW2. An upside-down hull loses `hpLostWhileUpSideDown`

**Was:** the tick existed and nothing ever said a hull was upside down.

**Now (HP-18):** `world-damage.js` `upsideDownOwners` runs `Armor::update`'s
own test and `vehicle-damage.js` bills the whole one-second bank (HP-17).
**Checked:** a Humvee rolled onto its roof on Bragg is billed 5.17 HP a second
once it has lain still 3.3 s and is wrecked at 23 s; an AH-64 held on its back
is billed 103 HP at 4.1 s and wrecked at 5.2 s (`ground_sim.mjs flip`).

**Corrected in review (2026-10-07), against retail.** The DC lab's unmanned
Humvee_TOW on its roof lost 5 HP at each whole second for the 2.8 s it lay
there, without sleeping. The engine's contact handlers run before the resolve,
when a resting body still carries gravity's one tick (0.49 m/s, over
`sqrt 0.1`), so it is touching every tick it is awake; the viewer had read the
speed after the resolve. And `Armor+0xe8` is a float, which 30 ticks of 1/30 s
fill, where a double needs 31 (hence the 5.17 every 1.03 s). Now the body
world records its own contacts per step (`BodyWorld.touched`), a driven hull
with its roof in the ground counts as touching, and the bank accumulates as a
float: the runner's unmanned Humvee_TOW goes 100, 95, 90, 85 at 1.0, 2.0,
3.0 s, and the dropped Bragg Humvee loses 5 at each whole second from 1.0 s.
`submarineData`'s 0.5 s bank (`+0x19c`) is a float too and now fills in 15
ticks.

## CW10, G7. Steering direction and `c_PIPitch`

Each steered wheel now turns as its own bundle does (`axisAngle` on its own yaw
axis): the Forklift's rear axle declares `direction -1`, and right stick turned
it left. `world-vehicle-tick.js` feeds `c_PIPitch` to a land drive whose own rig
binds it: the Forklift's lift and forks, the Ural5323's ramp.

## G5. The Desert Patrol Vehicle's spin is the engine's law on DC's data

After G1 the DPV still spins: 186 degrees in 3 s from 15 m/s at full lock,
against the Humvee's 51, both on a 50 degree lock and four driven wheels. The
cause is where its origin sits. The body turns about its origin and every
friction sample's moment is taken from it (collision-response §4.1, §4.2,
COL-8, emulated), and the DPV's origin is 2.57 m behind its front axle and
0.94 m ahead of its rear one: the steered tyres turn it on a long lever and the
rear ones hold it on a short one. Moving its origin to mid-wheelbase stops the
spin (86 degrees in 3 s, accelerating); moving the Humvee's to the DPV's place
starts one (151 degrees, speed collapsing). Half and third lock still spin it.
The only stabiliser in the viewer that the engine lacks is `angularDamping`
0.8, a free constant: at 0 the DPV spins harder (345 degrees), at 3 it would
stop, and raising it to make the DPV look right is exactly the tuning not to
do. So nothing changed; `test_an_origin_near_the_rear_axle_spins_a_full_lock_turn`
pins the cause. Whether the real game spins it is a recorded drive away
(skill `bf1942-server-lab`).

**Contradicted by retail (review, 2026-10-07).** The DC lab, with
`aiSettings.lodEnable 0` so bots drive with physics, measured the DPV at full
lock from 10 to 15 m/s: yaw 25 deg/s median (37 at most), slip 4.3 degrees
median, no spin-out. The branch's DPV on the same input turns at 90 to
97 deg/s median with 12 to 20 degrees of slip and slows to 5 to 7 m/s (the
base's was 125 deg/s). The Humvee (24 to 29 deg/s) and BRDM-2 (25 to 29) are
near the DPV's retail figure, and every steered lock (DPV, Humvee and
Technical 50 degrees, BRDM-2 30, Humvee TOW 35) matches the lab's. So the
origin lever is the viewer's mechanism and something it feeds differs from the
engine; G5 is open again.

**Closed (2026-10-07, below).** Every retail full-lock episode at speed has
the throttle released, and on those inputs the viewer's DPV turns and slips as
retail's does and does not spin. The 99 deg/s spin is a held-throttle input
that no recording covers.

## Open

- ~~**A land hull on the bed is lifted onto the sea where a terrain patch is
  undrawn**~~ and ~~**the multiplayer authority has none of G2**~~: closed,
  [Terrain contact, 2026-10-07](#terrain-contact-2026-10-07).
- **The rotational box drag's submerged scale** (PHY-16: once, not squared) is
  not applied; `HullWater` adds the positional excess only.
- ~~**A land hull driven into a steep face is launched.**~~ Closed,
  [Terrain contact, 2026-10-07](#terrain-contact-2026-10-07).
- **The critical bleed** still bills HP-5's flat whole-second ticks, not HP-17's
  bank, and resets its bank on recovery.
- **The water collision** (`handleCollision` with material 1 every tick a hull
  is wet, COL-4's `c²` arm) is still a no-op in the body world.
- **A suffocated crew** (`damageAllAttachedSoldiers`) is billed and reported
  (`report.suffocation`) but reaches no death path; no vanilla or DC land hull
  authors a non-zero 3rd `submarineData` float.
- **A submerged spring's friction** takes water's 0.1 (`level-terrain.js`) while
  a ship on the bed takes the bed's own material (`hull-bodies.js`
  `seabedFriction`); which the engine hands `impulseOn` is unread.
- ~~**`TrackedVehicle`'s inertia** is still its wheel footprint over a guessed
  1.1 m hull, not COL-14's box.~~ Done 2026-10-07 (below).

## Review, 2026-10-07

Re-read from the binary: COL-14/COL-15's walk and header box, PHY-16's
water arm of `checkVsTerrain` (no impulse; the depth on the part's own node),
PHY-3's corrected gate, and HP-18's three comparisons in `objdump`.
`test_world_damage.py` `test_an_upright_hull_on_a_steep_slope_is_not_billed`
pins the last: an upright hull flush with a slope is billed only past
72.5 degrees of slope, as the engine bills it.

The engine's walk run over the `.con` trees picks the same node as
`inertiaGeometryNode` on every land root of vanilla, XPack1, XPack2, DC and DC
Final. Flat-ground drives of every vanilla, XPack1 and XPack2 land vehicle,
the branch's base against the branch (`~/.cache/dc-sweep/review-ground-chassis/drive_probe.mjs`):
every tracked hull is identical. The wheeled ones that move more than the
Willy, and why:

| Vehicle | Moves | Cause |
|---|---|---|
| Katyusha | full lock at speed 16.6 to 12.8 deg/s | its 3.04 x 2.19 x 7.06 box: 3.8 times the table's yaw inertia |
| Greyhound (XPack2) | 13.3 to 11.4 deg/s | its 2.95 x 1.43 x 5.43 box |
| Krupp (XPack2) | top speed 111 to 95 km/h | its own `drag 15` in the sphere law (PHY-4: the law is not the engine's, the coefficient is) |
| Schwimmwagen (XPack2) | 15.8 to 21.7 deg/s, in a near-rollover turn on both | its drawn wheel radius, 0.34 against 0.364 |
| R75, HD_XA42 (XPack2) | top speed 128 and 169 to 111 km/h | already broken on the base, where full reverse drives them forward at 138 to 163 km/h; the R75 still does, at 92 |

The KettenKrad does not move on either (0.1 and 0.3 km/h). The pre-existing
motorbike and KettenKrad faults belong to another package.


## Handling against the lab's LOD 0 rounds, 2026-10-07

The DC lab recorded bots at AI LOD 0 (`aiSettings.lodEnable 0`), so the
physics drives them ([lab-ground-truth.md](../desert-combat-parity/lab-ground-truth.md),
four DC rounds). Two of its findings looked like drive faults: the DPV and
BRDM-2 turning too fast and spinning at full lock, and the T-72 being 24%
slower than the M1A1 on the same engine. Both came from the inputs, not from
physics. Where the drive was wrong, the cause and the fix are below.

**Full lock is replayed, not re-enacted.** All 266 recorded full-lock
episodes at speed have the bot's throttle released. The car slows from 13 to
2 m/s in about 1.3 s, and its yaw rate rises as the speed falls. The quoted
"99 deg/s and a spin" held full throttle through a 3-4 s lock, an input no
recording covers. The comparison that means something gives the viewer's car
retail's own inputs. The fixture `tests/fixtures/dc_lock_episodes.json.gz`
holds twenty episodes, four per car, the longest locks entered at 8 m/s or
more. Each row has the recorded throttle servo and steered-wheel angle on
every server tick. The car starts at the recorded speed 0.3 s before the lock
and is replayed tick by tick. Both sides go through `lab/dc_truth.py`'s
estimator: velocity over 0.25 s against the heading at the window's start.
That estimator puts about `yaw x 0.125 s` of turn into "slip" on both sides,
which an instantaneous slip on the viewer's side does not, and that was the
whole of an apparent "half retail's slip".

Median over the lock (`tests/test_ground_handling.py`, sand under the tyres):

| car | yaw, viewer / retail (deg/s) | slip, viewer / retail (deg) | fastest yaw, viewer / retail |
|---|---|---|---|
| DPV | 41.5 / 37.8 | 8.2 / 8.9 | 47.7 / 58.9 |
| Humvee | 20.4 / 21.9 | 33.9 / 36.2 | 24.6 / 33.9 |
| Humvee_TOW | 21.1 / 20.2 | 15.1 / 25.9 | 24.9 / 32.5 |
| BRDM-2 | 17.3 / 23.7 | 17.0 / 18.5 | 25.3 / 37.4 |
| Technical_Recoilless | 29.6 / 39.9 | 9.0 / 11.5 | 35.5 / 49.7 |

Across all 266 episodes by speed bin, the DPV runs 35-44 deg/s against
retail's 29-44. The Humvee and Humvee_TOW land within 10% in every bin. The
BRDM-2 and the Technical run 15-25% low. The tyre law is unchanged.

Open:
- The BRDM-2 and the Technical, low by about a quarter in the 2 m/s crawl a
  bot holds once a lock has bled the speed off. A BRDM-2 there turns 11 deg/s
  against retail's 16.
- The Humvee_TOW's crawl slip: retail's is 26 degrees, which is its kinematic
  value (the pivot is the rear axle, 2.5 m behind the origin), and the
  viewer's is 15.
- Whether retail's DPV spins on a held throttle. The owner's real-play list
  carries the protocol, all on flat DC El Alamein: DPV at 12-15 m/s, full
  throttle and full lock for 4 s, three times each way; BRDM-2 the same at
  15-18 m/s; DPV the same from a standstill.
- The car's `angularDamping 0.8` is still a free constant on all three axes.
  At 0, the BRDM-2 and the Technical match retail and the DPV and the Humvee
  turn 15-45% fast, so the data does not decide it either way.

**A tank's "top speed" in the lab is the AI holding its maxSpeed.** AI-45's
law caps the wanted speed at `aiTemplatePlugIn.maxSpeed`: T-72 12, M1A1 15,
BMP-2 17, M2A3 20, and in vanilla the Tiger 10 and the Priest and M10 12. The
recorded engines show a regulated throttle (0.4-1.0 tick to tick), not a
load. A T-72 holds 11.2 m/s in fifth at revs 0.755, or in fourth at 0.875,
the same speed in either gear. The drivetrain's ceiling is 14.89 m/s for all
four DC tanks. The T-72's extra `c_PGFEngineDummyGrip` springs cost nothing:
`addFriction` tests the authored grip for 0x20 and 0x4 together
(`0x0825b750`-`0x0825b75b`, `0x0825c666`-`0x0825c671`) and returns before any
friction, resistance or sample in the mean. TANK-13's ledger text had the
tank load's min and max the wrong way round; it is the frame max for
revs >= 0 (objdump, corrected in place). `EngineState.sample` already had it
right.

Driven by the AI's own law (`tankControl`) at those maxSpeeds, the viewer's
tanks cruise as retail's:

| tank | viewer | lab |
|---|---|---|
| T-72 | 11.30 m/s, g5, revs 0.758 | 11.2, revs 0.755 |
| M1A1 | 14.19, revs 0.953 | 14.1, revs 0.947 |
| BMP-2, M2A3 | 14.90, 14.89 | 14.88, 14.86 |
| Tiger | 9.34, g4, revs 0.84 | 9.1, revs 0.80 |
| Priest | 11.2 | 11.0 |

They did not cruise like that before. `TrackedVehicle` took its inertia from
the road-wheel footprint, half the engine's box: a Sherman's yaw inertia was
7.0 m^2 against the box's 13.1 (COL-15, `inertiaGeometryBox`). It also damped
yaw with a fitted 2.0/s. On the small inertia the AI law's unit-gain steering
loop went period-2: the steer flipped sign every tick, the max-of-wheels load
held the revs near 0.75, and a bot Sherman crawled at 8 m/s. On the fitted
damper every tank turned on the spot at a third to three fifths of retail's
rate.
The lab's 0.5-2 m/s yaw envelope (p99 / max, deg/s) is Sherman 62 / 64,
Panzer IV 60 / 70, Tiger 76 / 77, T-72 78 / 84, M1A1 80 / 84, BMP-2 86 / 95,
M2A3 83 / 85, M163 112 / 120. A `PhysicsNode`'s only rotational loss is the
box drag's arm, about 1e-4/s on a 25 t hull, so `TANK.yawDamping` is now 0.
On full throttle and full lock from rest the tanks now turn at Sherman 63,
Tiger 85, T-72 93, M1A1 81, BMP-2 99, M2A3 98 and M163 155 deg/s. Before:
Sherman 22, Tiger 45, T-72 34, M1A1 33, BMP-2 39 and M2A3 37. Top speed, reverse and roll are unchanged across the
vanilla, XPack1, XPack2 and DC fleets.

**The wheels a `.con` hides.** `createInvisible 1` stops an object being
drawn, not being built (PHY-24: it withholds the object's drawable flag and
nothing else), and the exporter dropped every invisible template. It
now keeps an invisible `Spring` as an undrawn node, with its physics, its
geometry's name and its collision probes (`bf42/assemble.py` `build_node`),
and leaves out anything else hidden. Six vehicles are affected (a census of
every `createInvisible` template in the three packs' object libraries):
- The KettenKrad stands on two hidden RollGrip wheels behind its tracks.
- The R75 and the HD_XA42 each stand on their sidecar's front wheel.
- The LVT4 drives through two hidden EngineGrip wheels and is now a tank with
  its water kit.
- The Elco80 and the Type38 carry their beach wheels (`PT_FrontWheel`,
  `PT_BackWheel`), which a `Ship` does not drive on.

An undrawn spring has no mesh to measure its radius off, only its col0
probe, and `measureWheelRadius` took the probe's own extent for one: 0.002 m
on the bikes' sidecar wheel. It now takes the probe's depth under the axle,
the contact `hull-bodies.js` `wheelContactDepths` already hands the page
(0.317 m on the R75, 0.352 on the KettenKrad's and the PT boats', 0.240 on
the LVT4's). Before that, off the page the bikes leant 9 degrees onto the
sidecar wheel and crept off at 1.3-2.1 m/s with the throttle closed (review,
2026-10-07).

Without them, the KettenKrad stood on its fork and fell onto its back. The
bikes tipped onto their sides and slid off at 30 m/s with the throttle
closed, which is the reported "reverse drives forward". `GroundVehicle` now
skips `c_PGFEngineDummyGrip` rollers as `TrackedVehicle` always has, because
the KettenKrad's twelve track rollers were twelve samples in its mean.
Re-extracted into scratch:

| vehicle | top speed (m/s) | reverse (m/s) |
|---|---|---|
| KettenKrad | 0.08 -> 29.6 | 0.1 -> -7.0 |
| R75 | 30.8 -> 30.9 | +25.4 -> -7.0 |
| HD_XA42 | 30.7 -> 30.1 | -28.2 -> -7.0 |
| LVT4 | 14.9 on land | 6.3 afloat |

All three rest level and still at zero throttle (25 s full throttle, 10 s
reverse, flat analytic ground, with the probe-depth radius).

The Elco80 gains its own two hidden wheels and floats and beaches exactly as
before. The rule also moves the cars that carry dummy rollers, at full lock
at speed: Katyusha and BM-21 12.8 -> 20.1 deg/s, Greyhound 11.4 -> 18.0,
Krupp 16.6 -> 22.1. The vanilla lab round on Kursk (`20261007-013855`)
drove a Katyusha through four full-lock episodes at 5-9 m/s with the throttle
released; replayed on its own throttle servo and wheel angle, through
`dc_truth.py`'s estimator on both sides, retail's yaw is 30.5 / 35.5 deg/s
(p50 / p95) at 2-5 m/s and 36.5 / 41.4 at 5-10 with slip 23.8 / 25.7 and
16.3 / 20.3; skipping the rollers gives 27.9 / 33.3 and 26.8 / 32.4, slip
23.7 / 25.1 and 15.0 / 18.9, where counting them gave 20.0 / 21.0 and
17.6 / 19.9, slip 12.5 / 18.4 and 7.8 / 9.8. The live trees need the affected models and level bakes
re-extracted before the page sees the hidden wheels. Hidden `LandingGear`
templates (XPack2's Goblin, Jetpack and Natter) are still dropped; they
belong to the aircraft.

**Critical damage stops a land drivetrain** (PHY-14). `vehicleTick` sets the
engine's running byte for a land drive as it does for a vectored airframe. A
critical Humvee or T-72 stops dead, does not restart on re-boarding, and
drives again once repaired. A ship's Engines hear the same message (HP-15):
`Ship.advanceEngines` stores its revs as 0 while the byte is clear, so a
critical Elco80 at full ahead loses her screws and coasts (11.1 to 4.2 m/s in
5 s). Open: a crewed critical ship does not start sinking, because
`hull-bodies.js` `stepSinkingHulls` arms the sink only for a hull nobody is
in.

**Drag is the box law** (PHY-4, `ground-contact.js` `addBoxDrag`) over the
same box, in place of the sphere law. XPack2's Krupp (`drag 15` on 2,500 kg)
now tops out at 19.6 m/s, about 70 km/h, where it reached 30.0. Hulls with
the usual drag 1.5-2 move by under 0.2 m/s.

Checked with `tests/test_ground_handling.py` (real DC glbs: lock replay,
cruise, pivot, critical, Krupp), `tests/test_ground.py` (the synthetic
KettenKrad, the box law), `tests/test_assemble.py` (hidden springs) and a
before/after drive of every land vehicle in vanilla, XPack1, XPack2 and DC
(`~/.cache/dc-sweep/ground-handling/fleet/`).

## Terrain contact, 2026-10-07

Package `terrain-contact` of the Desert Combat round: a land hull against the
terrain, the ground under an undrawn patch, the same in a room, and a landed
helicopter's nose.

### A driven hull meets the terrain

**What was wrong.** Any land vehicle driven into a face of about 45 degrees or
more was thrown off it, on every mod. Two causes, both measured in the
headless runner (`body-world.js` and the drive classes unmodified):

- `BodyWorld` ran only the damage half of `checkVsTerrain` for a driven hull,
  so nothing but the drive's springs met the ground.
- `probeAlongAxis` took one Newton step that takes the ground at the vertical
  estimate as level. A spring axis leaning into a steep rise stepped past the
  face and read the ground above its own start: a buried axle, the bump stop
  at its full load, about 100 m/s^2 a wheel. Four of those, eight ticks, and a
  Willy left Gazala at 94 m/s.

**What changed.**

- `BodyWorld.#drivenTerrain`: a drive that declares `hullContacts` (the two
  land drives) has its hull parts' col0 vertices dropped on the heightfield by
  `body-ground.js` `terrainContact`, exactly as a parked hull's are
  (collision-response.md section 7): `impulseOn` on every vertex at or under
  the ground, the push-out along the normal at once, half the closing speed
  back next tick, and the contact handed to the drive's friction mean
  (`noteContact`). The heightfield only: a deck meets a driven hull as a
  static. An aircraft keeps the damage half alone.
- `suspension.js` `probeAlongAxis`: the Newton answer stands where it lands
  within 2 cm of the ground; where it misses, the crossing is bracketed from
  the axle and solved (Illinois regula falsi). A probe that finds no crossing
  in reach reads no contact. This is the probe's numerics, not the spring law
  (ground-handling's), and the hunk is that function alone. It does move
  ordinary driving (review, 2026-10-07): with the axis leaning about 18
  degrees or more the Newton step misses by 2 to 9 cm, and 13 to 56 % of a
  drive's probes took the solve on the review's vanilla runs.

**Vanilla before and after (review, 2026-10-07).** Willy, Sherman and
Kubelwagen on seven vanilla levels (El Alamein, Gazala, Bocage, Kursk,
Battle of the Bulge, Guadalcanal, Market Garden), each driven from its pad
(idle, throttle, both turns, reverse; 15 s) and into the lattice face nearest
6, 12, 18, 24 and 30 degrees, every tick's state compared bit for bit with
main: 25 of 92 traces are identical, 47 differ on the probe alone and 64 on
the hull contact alone. None gains a launch (over 6 m above the ground or
12 m/s upward), a flip or 3 m/s of top speed that main did not have, and 28
that main launched or flipped no longer do: main's Willy left Guadalcanal's
pad drive at 76 m/s, 136 m up, and Market Garden's at 72 m/s, 111 m up, in
ordinary turns. At rest on level ground no vanilla land hull's col0 is in the
ground (`test_sim_vehicles.py`
`test_a_land_hull_at_rest_on_level_ground_meets_it_with_its_springs_alone`;
the Sherman's turret vertex is 4 cm clear). Driven at full throttle on level
ground the Tiger's `TigerWheelR2_1` body part touches it on 3 to 5 ticks.

**Measured** (`tests/sim_vehicles_harness.mjs` `faceWilly`, `faceM1A1`,
`faceHumvee`; the lattice face nearest each angle, two cells, a flat run-up,
nothing static in the way; 1 s settle, 8 s full throttle; main at `e39fc803`
against the branch):

| Hull, level, face | vmax m/s | upward m/s | over the ground m | after |
|---|---|---|---|---|
| Willy, Gazala, 45.0 | 93.9 -> 13.3 | 68.1 -> 7.3 | 174 -> 1.2 | coasts 12 m up, slides back |
| Willy, Gazala, 56.0 | 83.4 -> 13.6 | 73.6 -> 7.9 | 187 -> 1.8 | stops at the toe |
| Willy, Gazala, 69.5 | 34.7 -> 13.3 | 34.6 -> 4.0 | 26.9 -> 1.8 | stops |
| M1A1, Medina Ridge, 46.5 | 16.4 -> 13.7 | 11.8 -> 6.1 | 2.8 -> 2.6 | climbs the 4 m face on its momentum |
| M1A1, Medina Ridge, 51.5 | 19.0 -> 12.5 | 14.3 -> 3.4 | 7.8 -> 3.0 | stops |
| M1A1, Medina Ridge, 64.3 | 40.4 -> 12.8 | 37.4 -> 5.7 | 58.6 -> 2.7 | stops |
| Humvee, Medina Ridge, 46.5 | 85.6 -> 16.3 | 46.9 -> 9.7 | off the map -> 3.1 | climbs; wrecked by the nose-in (COL-4) |
| Humvee, Medina Ridge, 51.5 | 29.6 -> 31.4 | 20.0 -> 6.3 | 29.2 -> 3.8 | climbs the 5 m face, then its own 31 m/s on the flat top |
| Humvee, Medina Ridge, 64.3 | 43.8 -> 15.9 | 18.2 -> 3.8 | 21.7 -> 2.5 | stops |

The engine's friction budget is `mu N.y |g|` a tick (PHY-2): on 45 degrees
about 9.4 m/s^2 against gravity's 10.4 along the face, so no hull climbs one
under power, only on what it brings. That is what the table shows.

The bare drive with no body world (no hull at all; `~/.cache/dc-sweep/terrain-contact/wall_drive.mjs`
on an unbounded analytic wall) went from 453 to 1103 m/s down to 22 to 47 m/s:
its springs still climb a wall that never ends, because the spring pushes along
the hull's up where the engine's wheel is pushed along the contact normal.
That law is ground-handling's; nothing the page, the runner or a room runs is
without the hull.

The vanilla drive, bot and world suites (717 tests: ground, body ground,
vehicle bodies, body statics, sim vehicles, sim match, world, world damage,
ship pitch, vehicle instance, idle vehicle, vehicle damage, bot AI, bot route,
room, level, level mounts, flight, ship, collision, terrain grid) pass before
and after.

### The ground under an undrawn patch

The colliders' lattice was snapped off the drawn tiles, and a patch the bake
does not draw had none (41 levels of the five in-scope trees; Midway 240 of 256 patches). A new bake
layer, `heightmap` (`features/level-bake-layers/README.md`), ships the whole
`Heightmap.raw` as `terrain/heightmap.png` and a `heightmap` key, and
`heightfield.js` `heightfieldFromSamples` builds the lattice from it for the
page (`level-terrain.js`), the headless runner (`sim/level.mjs`) and the room
server (`server/level-load.mjs`); a tree baked before falls back to the tile
snap. Census, the layer patched into scratch copies of the five in-scope
trees (167 levels: vanilla 23, XPack1 29, XPack2 32, Desert Combat 35, DC
Final 48; `~/.cache/dc-sweep/terrain-contact/census.sh`): where a tile is
drawn the two agree to the bit on every level, no level has a hole, 41 levels
gain ground under undrawn patches, and Sea Rigs (both DC trees), which draws
no tile at all, gains a heightfield where it had none. 37 MB of PNG in all,
under a second a level to write.

**Sea Rigs had no heightfield at all**, so no body world, and its hulls stood
where placed. With one, the load settle (`hull-bodies.js` `settleSome`,
`server/level-bodies.mjs` `settle`), which meets the terrain alone, dropped
its two Forklifts 115 m off the rigs onto the sea bed, where they drowned. In
the engine they rest on the rig by an object contact that a parked body here
does not have (a parked body meeting statics is this README's own open next
step). `vehicle-bodies.js` `standsOverTheSea` (every col0 vertex above the
water, more than 1.5 m clear of the ground, and that ground under the water)
now leaves such a hull where the level put it, asleep. A hull merely spawned
high over dry ground still drops (DC El Alamein's M1A1, Humvees and M163,
2.1 to 2.9 m, as before). Over the five trees it holds, besides the carriers'
aircraft (held already), Sea Rigs' Forklifts, DC Final Al Nas's Stryker (12 m
over the water, which the settle used to drop it into) and Medina Ridge's
inherited hulls off the edge of its 1024 m grid (which used to free-fall).

**Review (2026-10-07): `standsOverTheSea` is not the engine's.** A spawned
hull is awake from its construction (COL-10's addendum: both `PhysicsNode`
ctors end in `setIsAwake`, and `ObjectSpawner::spawnObject` puts nothing to
sleep), so in the engine every placed hull falls onto whatever holds it,
terrain or a static. The rule is a stand-in for that object contact, and it
is not stable across a level's twins: it holds DC Final Al Nas's Stryker
12 m over the water, while Al Nas Day 2's Stryker, on the same structure
2 m away, has one vertex over ground above the water and is still dropped
17 m into it (the settle census over the five trees: only those three hulls
change, Sea Rigs' two Forklifts and Al Nas's Stryker). The engine's answer is
the load settle meeting the statics (or at least the drivable decks, which it
does not see either), this README's own next step; Sea Rigs'
`rig_topside_platform1_m1` is not in the drivable set.

Sea Rigs' bots change with the heightfield: its search maps are painted from
the collider (the level ships no AI), and with a sea floor instead of a flat
water surface a 60 s match's route failures drop from 6,283 to 3,888 and the
bots no longer take the two LCVPs they took before (every seed alike). The
bots package should look at it. The cause (review, 2026-10-07): with no
heightfield the painter's `terrainSampler` fell back to `surfaceHeight`,
the water plane, so every sea cell read 0 m deep and walkable; with the sea
floor every cell off the rigs is deeper than the infantry map's 1.5 m
(`CELL_WATER`). The infantry map's free cells drop from 10,623 to 1,840 (the
rig decks), and the cells around the LCVPs at the waterline go from free to
unreachable, so no foot route ends at a boat. The level ships no search map
for its boats either (`waterNav` returns null without one).

A Sherman driven off Guadalcanal's beach (the review's spot, 2528, -1060)
used to meet the undrawn patch 40 m out, rise 11.8 m in a tick and drive
800 m across the sea at 14.9 m/s. On the heightmap it follows the bed down
the shelf to 65 m and crawls along it at 6.7 m/s, crushed at 10 HP/s
(PHY-3's `submarineData`) and wrecked at 13 s.

### A room's land drive

`server/level-instance.mjs` built a drive with no collider, water level or
collision meshes, and `bodySpecFor` tagged no `waterPart`. Worse, the room's
scene decoded no render geometry, so `measureWheelRadius` read -Infinity off
every wheel: no wheel of any room's tank or jeep ever touched the ground, and
the hull sat on its failsafe 5 cm over the terrain at full throttle. Now the
drive gets what `map.html` `buildHullDrive` hands it (a body-aware collider,
the sea, the collision meshes, the deck normal), boarding runs
`wheelContactDepths` (moved to `vehicle-bodies.js`) and the `waterPart`, the
room's body world gets the static probe, and `glb-scene.mjs` decodes a
Spring's meshes. In a room on Guadalcanal the Sherman off the beach gives the
runner's trace sample for sample, a DC BMP-2 swims at 5.44 m/s, and a Wake
Willy drives 10.7 m in 2 s (`test_room.py`).

### A landed helicopter's nose

`aircraft.js` `settle` leaves pitch-up alone so a plane can rotate, and
nothing else answered it: an AH-64, Mi-24 or AH-6 set down turning nose-up at
10 deg/s stood itself on its tail in 9 s. In the engine the wheel it turns
onto stops it (`checkVsTerrain` on the spring's col0 vertex, `solveImpulse`).
`settle` now takes, at each aft wheel contact pushed under the clamp's floor,
the nose-down turn about the origin that puts it back on the ground, and half
its closing speed per 30 Hz tick. The AH-64 stops at 5.5 degrees (its tail
wheel's), the Mi-24 at 5.3, the AH-6 and Mi-8 level; nose-down stays the dig
rule's. A taildragger's ground pitch is now capped at its three-point angle
(Spitfire 15.5 degrees); the Spitfire's, B-17's and Zero's takeoffs lift off at
the same time, speed and pitch as before.

**Review (2026-10-07): those stops are not the airframes' ground attitudes.**
The contacts' floor is lowered by `groundClearance + lowest contact` (the
parked springs' sag, 0.34 m on the AH-64, 0.22 m on the Mi-24, 0.37 m on
the Spitfire) and the turn is about the origin, not the main gear. On the
real glbs (DC El Alamein, vanilla El Alamein) the engine-law parked settle
stands the AH-64 at 3.3 degrees, the Mi-24 at 2.7 and the Spitfire at 11.9
(the drawn wheels' three-point geometry: 3.6, 2.9 and 13.0); the stops are
5.5, 5.3 and 15.5, with the aft wheel 0.2 to 0.4 m under the real ground.
After the stop the AH-64 levels to 0 degrees over 4 s with its tail wheel
0.33 m in the air, as it does on main from rest; the Mi-24 holds about 4.6
with its rear wheels 0.16 m in the ground. Main stood both on their tails
(53 and 43 degrees), so this is far better, but it is not yet the attitude
the springs give.

### Still open

- **The terrain's own height law.** `PatchTerrain::getHeightAndNormal`
  (`0x083d6f10`) answers off alternating-diagonal triangles with a unit face
  normal (R1); the viewer's heightfield is bilinear with a central-difference
  normal. Unported.
- **The engine's spring reads the hull's own push.** `solveImpulse`'s spring
  branch takes `posAdjust . n - rootPosAdjustCopy . n`, so a hull pushed out
  of the ground loads its springs less. The drive's springs run before the
  body world and never see it. No measured case needs it.
- `checkVsTerrain`'s `n > 10` bounding-box early-out is not ported (it changes
  no contact).
- An aircraft's hull col0 still meets the ground through its drive's clamp and
  `settle`, not `terrainContact` (damage only).
- A room's collider has no drivable mask, so a room's hulls meet no decks.
