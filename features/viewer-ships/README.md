# Ships in the viewer

Stream **W7-A** of the parity round. The owner asked for full parity on ships:
spawn on them, drive them, fire their main guns, cycle the positions with the
number pad. This is what was built, what it was measured against, and what is
still open.

The spec is [`features/bf1942-ships-research-2026-09-22/README.md`](../bf1942-ships-research-2026-09-22/README.md)
as corrected by that folder's [`VERDICT.md`](../bf1942-ships-research-2026-09-22/VERDICT.md);
the verdict's wording is the binding one wherever the two differ, and where this
stream found the code contradicting either, it says so below.

Two things were already fixed before this stream began and are not claimed here:
`teamOnVehicle` read as a team index (`49c5235f`, merged `0934813`), and the
extractor's double-mirrored deck-spawn offset (`d30dbbaa`).

---

## 1. What is now true

| | |
|---|---|
| **Every floating hull sits at its own draft.** | Placed from the closed form, not from the level's pad. Ten hulls on Midway, all exact against the research's predicted values. [§2](#2-buoyancy) |
| **Ships are driveable.** | `c_ETShip` is a `'ship'` seat kind with a real drive model: the aircraft thrust law, the bit-3 water rule, two rudders, and buoyancy under way. A Fletcher makes 12.2 m/s and turns 53 degrees in ten seconds of full rudder. [§4](#4-propulsion) |
| **Deck spawns land on decks.** | All 30 of Midway's, and all 43 across Wake, Coral Sea, Iwo Jima and Guadalcanal. Six of Midway's eight ship flags used to put the soldier on the sea at y = 20. [§3](#3-deck-spawns) |
| **Main guns and seat cycling already worked**, and this stream changed nothing about them — measured before touching anything. [§5](#5-guns-and-seat-cycling-what-was-already-there) |
| **A critically damaged ship goes down by the bow**, and stops being a spawn point while she does. [§6](#6-sinking) |

### Files

| file | what |
|---|---|
| `viewer/body-float.js` (new) | `PhysicsFloatingBundle::updatePhysics` `0x0824d640`, its closed-form equilibrium, `FloatingBundle::handleMessage`'s sink rate, and `FloatingHull` — a `RigidBody` with the law posted at each node |
| `viewer/ship.js` (new) | `Ship extends Aircraft`: the spec read off the hull's own nodes, the bit-3 water gate, buoyancy as a body force, and `PhysicsNode`'s box drag |
| `viewer/flight.js` | three hooks (`waterGate`, `bodyForces`, `applyDrag`), `engineType` carried into the engine table, `throttleMin`, `mountQuaternion` |
| `viewer/seats.js` | `c_ETShip` -> `'ship'`; `DRIVE_KINDS`; `ensureDrive` builds a `Ship` |
| `viewer/soldier.js` | `settle()`'s upward escape |
| `viewer/map.html` | `floatPlacedVehicles`, `rebaseDeckSpawns`, `stepSinkingHulls`, `armSinkingHull`, `shipFlagInactive`, the `Ship` wiring in `setPilot`, and the `__ships` / `__deckSpawns` / `__seatTable` readouts |
| `tests/` | `test_body_float.py` + harness (24), `test_ship.py` + harness (13), 4 new cases in `test_soldier.py`, 1 in `test_seats.py` |

---

## 2. Buoyancy

### 2.1 The law

`viewer/body-float.js`, ported as the research reads it and the verdict
corrects it. The three corrections are each a test:

- **`t` is computed from the unclamped `f`.** `0x0824d718` is `fst`, not
  `fstp`; the `max(f, -1)` store is at `0x0824d778`. This is what makes a
  submarine's trim angle a **dive-depth setpoint in metres** rather than a
  one-way sink — the boat settles at `depth = angle_Y + 0.5`, where `t = 0.5`,
  `lift = 1.2275` and `8 x 1.5 x 1.2275 = 14.73 = |g|` exactly.
- **`g / -9.82` is exactly 1.5**, which is what makes that arithmetic land on
  the nose and shows the lift pair was centred on `|g| / (N x 1.5)` on purpose.
- **`1 + 24f` really does reverse sign** in `f ∈ (-1/24, 0)`. Ported as
  written; the sliver is never an equilibrium.

### 2.2 Placement is closed-form, not a settle

`equilibriumRootY` solves `Σ (-f_i) · lift_i = 9.82` by bisection rather than
by the uniform closed form, so it also covers a `Gato` (whose `t` is not
saturated and whose angle may be a dive setpoint) and the `Elco80`/`Type38`
hulls that mix floater templates. `map.html:floatPlacedVehicles` calls it for
every `VCSea` root before `buildCollisionIndex`, so the index bakes each hull
where it rests.

The verdict's case against iterating reproduces exactly. Simulating the law at
1/30 s from Midway's own pads, with the destroyer hull's measured footprint
(18.73 x 133.86 m):

| ship | pad y | equilibrium | y after 300 ticks | out by |
|---|---|---|---|---|
| Fletcher | 20.4371 | 20.2250 | 20.3716 | **0.147 m** |
| Hatsuzuki | 20.4371 | 14.3625 | 14.5425 | **0.180 m** |

`SETTLE_TICKS` is 300. Raising it to the ~2,510 a Fletcher needs would cost
ten times the load-time settle budget for a number the closed form gives free
and exact.

### 2.3 The eight equilibrium values, measured

`map.html?mod=bf1942&map=midway&shots`, served on :5281 from this worktree,
read through `window.__ships()`. `target` is `equilibriumRootY` evaluated live;
`predicted` is the research's §1.5 table. Water level 20.

| hull | authored pad y | **measured y** | predicted | error |
|---|---|---|---|---|
| Fletcher | 20.4371 | **20.2250** | 20.225 | 0.0000 |
| Fletcher2 | 20.4372 | **20.2250** | 20.225 | 0.0000 |
| Hatsuzuki | 20.4730 | **14.3625** | 14.362 | +0.0005 |
| Hatsuzuki2 | 20.4510 | **14.3625** | 14.362 | +0.0005 |
| Enterprise | 19.8651 | **19.2189** | 19.219 | -0.0001 |
| Shokaku | 19.5996 | **20.3175** | 20.317 | +0.0005 |
| PrinceOW | 12.7351 | **12.5662** | 12.566 | +0.0002 |
| Yamato | 12.6481 | **17.4542** | 17.454 | +0.0002 |
| Gato | 12.7078 | **18.8111** | 18.811 | +0.0001 |
| Sub7C | 12.6481 | **19.0568** | 19.057 | -0.0002 |

Every residual is the research table's own rounding to 3 dp. The engine lifts a
Yamato 4.81 m and drops a Hatsuzuki 6.11 m from their own pads, and surfaces
both submarines by 6.1-6.4 m, exactly as predicted.

Beyond the eight: `Fletcher2` and `Hatsuzuki2` are the same hulls and land on
the same numbers, which is the cheap consistency check.

**Frame.** ![the fleet at anchor](shots/fleet-at-draft.webp)

The Prince of Wales and a Gato at anchor, with the sea cutting their hulls at
the waterline.

### 2.4 The submarine reverses, as the verdict says

`equilibriumRootY(gato, 20, { angle: -angle_Y })`, where the node's stored angle
is `-angle_Y`:

| `angle_Y` | solved depth |
|---|---|
| 0 | 2.4889 (the surfaced draft, `9.82·H/(N·maxLift)`) |
| 5 | **5.500** |
| 10 | **10.500** |
| 20 | **20.500** |
| 50 | **50.500** |

`depth = angle_Y + 0.5`, stable, independent of `hullHeight`. The research's
"sinks without limit" does not survive, and the dive law is in the module but
is **not wired to a control input** — see §7.

---

## 3. Deck spawns

### 3.1 What was wrong, and what this stream added

The extractor's double mirror was fixed before this stream (`d30dbbaa`). What
remained is that a baked world position is stale the moment the hull moves —
and §2 moves every hull by up to 6.1 m.

`map.html:rebaseDeckSpawns` carries each baked point through
`hull.matrixWorld · authoredInverse`. That is the ship-local offset the engine
resolves live (`BFSpawnPoint::spawn` `0x08163d70` is
`soldier->setAbsolutePosition(this->getAbsolutePosition())` and nothing else),
recovered from the bake rather than from a re-extract: the inverse of the pose
the point was baked against turns the world point back into the hull-local
offset, and the hull's current matrix puts it back. It is right for pitch and
roll as well as heave, which is what makes §6 work for free.

**This is why no re-extraction is owed for deck spawns.** The research's §8
asks the extractor to emit the ship-local offset alongside the world position;
with the rebase, that is redundant — the offset is recoverable from what is
already in `scene.json`. Emitting it would be tidier and is not necessary.

### 3.2 Measured: every ship flag, both teams

Spawn on each ship flag, read the soldier's `y`, then probe with
`__colliderRef().statics.cast` from `y + 0.5`. Before this stream, the verdict
measured six of eight standing on the sea at y = 20.000 and one five metres
under it.

| flag | soldier y | surface under him | owner | sea |
|---|---|---|---|---|
| Fletcher | 24.600 | 24.600 | 261 | 20 |
| Gato | 21.370 | 21.370 | 262 | 20 |
| Enterprise | 37.843 | 37.843 | 264 | 20 |
| Princeow | 26.567 | 26.567 | 265 | 20 |
| Shokaku | 32.121 | 32.121 | 266 | 20 |
| Sub7c | 21.191 | 21.191 | 267 | 20 |
| Yamato | 28.854 | 28.854 | 268 | 20 |
| Hatsuzuki | 25.630 | 25.630 | 269 | 20 |

Eight of eight on their own hull, on both teams, with the static hit at exactly
the soldier's feet and the owner id the ship's own.

Per spawn point rather than per flag, over all 30 of Midway's: the drop from
the authored point to the deck under it is 0.09-1.85 m, and it is **identical
per template across both pads at two different yaws** — Hatsuzuki 0.73 / 0.17 /
0.17, Shokaku 1.20 / 1.84 / 1.73 — which is the verdict's own decisive check,
now measured on the corrected tree.

The same probe over the other sea levels: **Wake 12, Coral Sea 10, Iwo Jima 7,
Guadalcanal 14 — 43 more, every one on a hull surface.**

**Frames.**

![the Hatsuzuki from outside](shots/soldier-on-deck-wide.webp)

The Hatsuzuki from outside, deck clear of the water, the spawn point on it.

![the deck from where he stands](shots/soldier-on-deck-close.webp)

The deck and its rail from the soldier's own position, sea below the rail. He
also walks: 1.14 m forward in one second, `grounded` throughout, y 25.630 ->
25.654. (The local player draws first-person only -- `footView3p.modes` is
`['inside']` -- so his own body is not in the frame.)

### 3.3 `settle()`'s upward escape, and why it fires nowhere

`viewer/soldier.js:settle` probed from `y + 0.5` **downward only**, so a spawn
authored inside a hull had no way up. The escape is now there
(`Soldier.#escapeUp`): when the surface the soldier would stand on leaves him
no room to stand up, climb onto whatever is pressing on his head, at most four
decks, and only across a slab thin enough to be a deck.

**The gate that makes it safe is that the floor has to be a hull's, not the
world's**, and that is not a detail. The engine's push-out goes along the
contact normal — the shortest way out — and for a man on open ground under a
low beam the shortest way out is downward: the engine does not lift him onto
the beam, it refuses to let him stand up. `tests/test_soldier.py` has both
cases, and the existing head-clearance test is the one that would have caught
this.

**On vanilla it fires nowhere.** Across all 73 ship deck spawns on the five sea
levels, the minimum headroom is **3.01 m** (the Shokaku's and Hiryu's boat-bay
spawns, under the flight deck). The verdict's "3 of Midway's 26 are authored
genuinely inside the hull" was measured against the *pre-fix* tree; with the
double mirror fixed and the hull at its draft, none of them is. The predicted
fourth case — the Fletcher's own `relY 5` spawn — is on the deck: see §7 for
the one point that is worth a second look.

---

## 4. Propulsion

### 4.1 There is no ship propulsion code in the engine

`c_ETShip = 9` — proved from `operator<<(std::ostream&, EngineType)`
`0x0823ef60`, whose table is 1 `c_ETPlane`, 2 `c_ETCar`, 6 `c_ETTank`, **9
`c_ETShip`**, 0x11 `c_ETRocket`, 0x19 `c_ETTorpedo` — has bit 0 set, so
`PhysicsEngine::updatePhysics` `0x0824cbb0` runs the same `rho` /
signed-square-`K` / `getCurrentRatio()` thrust body a Corsair's propeller does.
A car and a tank have bit 0 clear and return at the `& 1` gate, which is why
they need `ground.js` and a ship does not.

So `viewer/ship.js` is `Aircraft` with a spec read off the hull's nodes, one
extra force, and the opposite water gate. `flight.js` grew three hooks
(`waterGate`, `bodyForces`, `applyDrag`), each defaulting to exactly what an
aircraft already did, rather than a copy of `step()`.

### 4.2 The bit-3 water rule, and the bug it exposed

Screw **below** the waterline: thrust runs. Screw **above** it with
`|throttle| > 0.02`: thrust is skipped and the stored throttle is pinned to 1.0
(`0x0824cc89` / `0x0824d047`). A plane gets the mirror — an engine below the
waterline has its throttle **zeroed**.

`Aircraft`'s engine table did not carry `engineType`, so a ship's screw — which
is authored *under* water (`Fletcher_Engine` at `0/-4/40`, absolute y 16.2
against a water level of 20) — took the aircraft rule and had its throttle
zeroed every step. The first driving test produced a destroyer with the
throttle at full and a speed of exactly 0.000 for 1,860 ticks. One field.

### 4.3 Steering is two ordinary `Wing`s

`Fletcher_rudder` and `Fletcher_HullWing`, `setWingLift 0 / setFlapLift 2` on
`c_PIYaw`, 55 m fore and aft, with opposite `setAcceleration` signs so they
deflect against each other. They make lift at all only because
`PhysicsWing::updatePhysics` gives a surface below the water surface a flat
medium of **10** instead of the `1 - y/1000` air density — which is why
`Ship` must be told where the sea is. No new code: `flight.js`'s existing
surface path, with the mount taken from the node's own glb quaternion
(`mountQuaternion`).

### 4.4 Measured on the page

`__enterOwner(owner)`, then `__plane().setInput` and `__stepSim(n, 1/30)`.
Phases are cumulative; heading is read off the hull node's own world matrix.

| ship | rootKind | drive | full ahead | 10 s full rudder | full astern |
|---|---|---|---|---|---|
| Fletcher | `ship` | `Ship` | **12.19 m/s**, y 20.226 | **53.5 deg** | decelerates, reverses |
| Yamato | `ship` | `Ship` | **15.04 m/s**, y 17.457 | **39.9 deg** | " |
| Enterprise | `ship` | `Ship` | **13.95 m/s**, y 19.220 | **30.3 deg** | " |

All three hold their draft to within a centimetre while under way. Under the
node harness, the same Fletcher turns the same number of degrees each way round
and turns through nothing at all with the rudder centred.

**Frame.** ![the Fletcher under way](shots/fletcher-under-way-external.webp)

Hull 445 at sea, at her waterline, 150 m from her pad under her own power. (The
pale wedge is a capture artefact: the frame is rendered straight through
`renderer.render` with the camera moved by hand, so the page's own per-frame
sky and flare update does not run.)

### 4.5 A ship's drag is NOT `flight.js`'s

`Ship.applyDrag` runs `PhysicsNode`'s box law (physics.md §3) with the
submerged multiplier `1 + 24·min(depth/DY, 1)`. The linear `-drag·v` the
aircraft model carries is a fitted stand-in, and for a hull it is not even the
right order of magnitude — with `scale` entering twice, a submerged body feels
625 times its dry drag, and that factor is the entire difference between a
destroyer that settles near 12 m/s and one that settles near 200.

---

## 5. Guns and seat cycling: what was already there

**Measured before anything was changed**, on the tree as it stood at
`a60b2608`, with `__enterOwner` + `__switchSeat` + `__gunGroups`:

| ship | entering | seat 0 (helm) | seats 1+ |
|---|---|---|---|
| Fletcher | occupancy built; `drove` false | 4 gun groups | 2 |
| Yamato | " | 3 | 2, then 5 |
| Hatsuzuki | " | 3 | 2 |
| Enterprise | " | 0 | 1 |
| Shokaku | " | 0 | 1 |

So: **boarding a ship already worked, the main guns already collected, and the
number row already moved between positions and rebuilt the gun set.**
`TurretAxis` and `VehicleOccupancy` never cared that the root had no drive
model — `switchSeat` is gated on `optPilot.checked && occupancy`, and
`occupancy` is built for every `PlayerControlObject` root whatever
`classifySeat` calls it. Nothing was broken and nothing was changed.

The one thing that was missing is the one the owner named: `__enterOwner`
returned `false` because there was no `car` and no `aircraft`. It returns true
now, and `__seatTable()` reports the whole row:

```
Fletcher    rootKind ship  drive Ship  seats [(0,'ship','c_ETShip'), (1,'gun'), (2,'gun')]
Yamato      rootKind ship  drive Ship  seats [(0,'ship','c_ETShip'), (1,'gun'), (2,'gun'), (3,'gun')]
Enterprise  rootKind ship  drive Ship  seats [(0,'ship','c_ETShip'), (1,'gun'), (2,'gun'), (3,'gun'), (4,'gun')]
```

A carrier's helm has no gun of its own, which is why its seat 0 reported 0
groups and always did.

---

## 6. Sinking

`FloatingBundle::handleMessage` `0x082402b0` arms the per-node sink rate on
TemplateMessage **`0x14`** — `criticalDamage`, not death. For a Fletcher that
is 50 of 300 hit points. `0x15` (destroyed) sets the wreck byte and leaves the
rate alone.

The body world does not carry ships (§8), so a hull that starts sinking gets
its own `FloatingHull`: a `RigidBody` — which *is* the engine's `PhysicsNode` —
with the float law posted at each node. `map.html:stepSinkingHulls` runs it,
and `rebaseDeckSpawns` carries the deck points down with her.

`sinkRate` per node is `(q + 0.1) · 0.05 · sinkingSpeedMod` with
`q = clamp((2R + Δz + Δx)/(4R), 0, 1)`. On the harness Fletcher (R = 70, nodes
at `Δz = ±50`, `Δx = ±5`) the eight rates run 0.0207 to 0.0393 — a spread of
**1.90:1**, which is the verdict's ~2:1 and not the research's 11:1 — and they
are monotone along the hull, so she trims by the bow.

Sixty seconds from `0x14`, node harness:

| t | root y | forward axis y (trim) |
|---|---|---|
| 10 s | 17.672 | -0.023 |
| 20 s | 9.865 | -0.088 |
| 30 s | 1.004 | -0.143 |
| 60 s | -25.711 | -0.300 |

Monotone down, monotone bow-down, and awake throughout — the accumulator wakes
her every tick, which is why a sinking ship never sleeps.

Two other things fell out of it and are tested:

- **`sinkingSpeedMod 0` is "never".** Both vanilla rafts set it on all four
  floaters, so a shot-up raft does not go down and does not roll; the hull that
  actually rolls as she goes is the LCVP (three `Lcvp_Floater` at mod 1, one
  `Lcvp_Floater2` at mod 7).
- **A sleeping hull makes no lift.** `updatePhysics` copies the root's
  sleepiness and returns before it touches the water, and that early return is
  load-bearing rather than an optimisation: a `RigidBody` wakes with an empty
  accumulator and takes its first tick as pure buoyancy — half a metre a second
  upward — so posting lift into a sleeping hull walks it up out of the water a
  centimetre per sleep cycle. It measured 20.33 against a draft of 20.225 after
  a minute before the return was honoured, and 20.22500 exactly after.

`BFSpawnPoint::getActive`'s Armor gate (`0x08163dd0` step 2, Armor vtable
`+0xcc`) is `map.html:shipFlagInactive`: a critically damaged ship's flag
reports `inactive` and `spawnAtFlag` refuses it. Same threshold that arms the
sink, so a burning destroyer stops offering her decks at the moment she starts
going down.

### On the page

Midway's Fletcher, `__damageVehicle(261, 83)` — 128 hit points down to 45
against a `criticalDamage` of 50, so **critical but not destroyed**, which is
the case the whole mechanism is about:

| | |
|---|---|
| hull | 20.225 -> 18.811 -> 16.731 over 24 rendered frames, then steadily under |
| deck spawn | rides her down, 25.23 -> 8.54 -> -30.08, from `__deckSpawns()` |
| flag | `inactive: true` from the moment she goes critical |
| `__deploy.spawn()` | returns **false** — you cannot deploy onto a sinking ship |
| rate | constant, not accelerating: equal distance per frame-step at 10 s, 20 s and 40 s of stepping |

**Frames.**

![at her draft](shots/fletcher-sinking-a.webp)

![three and a half metres lower](shots/fletcher-sinking-d.webp)

At her draft, and 3.5 m lower with the sea over her main deck line.

---

## 7. Divergences from the engine, and why

| | |
|---|---|
| **`underWater` is not read.** | The box drag law's multiplier is `1 + 24·min(underWater/DY, 1)` with `underWater` at `PhysicsNode+0x8c`, written by `setUnderWater` `0x0824d430` — and **who calls that setter for a ship's root, and with what, is UNVERIFIED**. `ship.js` uses the depth of the hull bounding box's bottom below the sea, clamped to `[0, DY]`, because that is what "submersion depth in metres" has to mean for a box. It is the single biggest lever on a ship's top speed, so the speeds in §4.4 are **not calibrated**, and the research declines to offer one for the same reason. |
| **`getCurrentRatio()` is sampled at max rev.** | It is rev-dependent (`0x0824ca70`), and `flight.js` samples the gear curve at its last entry, 0.94. So a Fletcher gets 7.447 at every rev instead of only at full. Correcting it needs TANK-12's rev filter, which is another stream's. |
| **The geometry box is the drawn glb's.** | Masts and davits included. The engine asks the object for its own geometry box, which for a ship may be the LOD hull without them. It sets both `DX·DZ` in the buoyancy damping and all three faces in the drag. |
| **A parked ship is not in the body world.** | `bodySpecFor` still excludes `VCSea`, so a moored hull is correct *scenery* — solid, walkable, at the right waterline — and cannot be rammed or rocked. The parked path is gravity plus wheel springs against the heightfield; a destroyer woken into that would sink. |
| **A ship's own Wings have no angular drag.** | `Ship.applyDrag` implements the linear half of the box law only. The angular half would be a second unmeasured damper on top of the rudders, which is tuning rather than porting. |
| **The `1 + 24f` anti-damping sliver is ported as written.** | It is the bytes. That it "reads like an intended `lerp(1, 25, |f|)` with a sign slip" is the research author's inference, not a read. |
| **`settle()`'s escape is a ray, not a push-out.** | The engine ejects a soldier by resolving a penetrating capsule against the hull's col1 faces. A downward ray cannot ask that question, so the escape is gated on "the floor is a hull's" (§3.3). The exact version is a capsule push-out. |
| **A ship's mouse profile and HUD line are an aircraft's.** | `Ship extends Aircraft` and lands in the page's `aircraft` slot, so `profileFor('air')` and `HUD_PILOT` follow. Cosmetic; the input mapping is keyed on `player.kind` in `world.js` and is correctly a ground vehicle's signed W/S. |

---

## 8. Still open

1. **Runtime buoyancy for an unoccupied hull.** Ram a moored Fletcher and she
   does not rock: ships stay out of the parked body world. `FloatingHull` is
   the piece that would do it — it already is a `RigidBody` with the law —
   so the work is wiring it in for every floating hull rather than only for a
   sinking one, and giving `body-ground.js`'s parked path a way to leave a
   ship's heave to the float term.
2. **The submarine dive is in the module and not on a control.** The law is
   implemented and tested (`depth = angle_Y + 0.5`, capped at 50.5 m by
   `setMaxRotation 0/50/0`); what is missing is the `RotationalBundle` on the
   float node driven by `c_PIPitch` at `setMaxSpeed 0/2/0` /
   `setAcceleration 0/1/0`, plus `submarineData`'s crush depth and oxygen
   drain (PHY-3). A Gato drives and floats; she does not dive.
3. **Top speed is uncalibrated.** See §7. Settling it needs either a read of
   `setUnderWater`'s callers or a measurement against the game.
4. **The Fletcher's own driver spawn is worth a second look.** On Midway she
   puts the soldier at relY 4.375 with the next surface 4.71 m above him, and
   from directly overhead the first surface at that x/z is relY 9.23 — so he is
   under a deck rather than on the open one. He has standing room and can walk
   out, and the two other `FletcherSoldierSpawn` points at the same authored
   relY land on an open deck with nothing above them, so this is a sheltered
   position rather than a defect. Separating "under the bridge wing" from
   "inside the hull" needs the surface's facing, and `collision.js:851` flips
   every hit normal to oppose the ray, so the ray API cannot answer it.
5. **A wreck's sink is not visually finished.** The hull goes down and keeps
   going; there is no sea-bed stop, no bubble/wash effect, and the wreck fade
   `stepWrecks` owns is unaware of it.
6. **Torpedoes.** `viewer/torpedo-run.js:floaterLift` uses `t = clamp(depth/H)`
   where the engine uses `t = clamp(angle - f·H)` — depth in **metres**, not
   normalised. It is behaviourally moot today because every torpedo floater
   authors `floatMinLift == floatMaxLift`, so the lerp cannot be seen; it is
   wrong if anything ever authors a pair. Also, per the verdict, `c_ETTorpedo`
   carries bit 3, so a torpedo's engine follows the ship water rule —
   `ship.js`'s `WATER_ENGINE_TYPES` includes it, but nothing routes a torpedo
   through `Ship`.

---

## 9. Re-extraction owed

**None for this stream.** The deck-spawn rebase (§3.1) makes the ship-local
offset recoverable from what `scene.json` already carries, and the buoyancy
placement is a load-time computation from data the glbs already hold
(`FloatingBundle` nodes carry `hullHeight` / `floatMaxLift` / `floatMinLift` /
`sinkingSpeedMod`, and `bf42/con.py` has emitted them since before this round).

The vanilla levels were already re-extracted for `teamOnVehicle` and the
deck-spawn sign fix, and this stream read that tree rather than writing to it.
Nothing was extracted, published or uploaded.

Two optional tidies, neither blocking:

- `extract_map.py:_vehicle_soldier_spawn_report` could emit the ship-local
  `offset` alongside `position`, which would let the viewer drop the
  `authoredInverse` recovery. Cosmetic.
- `bf42/con.py:1371` could carry a comment saying `dragModifier` and
  `waterHeight` are **dead in the engine** (no reader anywhere in the image,
  `FloatingBundleTemplate+0x1c0` and `+0x1b0`) so nobody wires them.

---

## 10. How to reproduce

```bash
# tests (from tools/bf1942-models)
python3 -m unittest tests.test_body_float tests.test_ship tests.test_soldier tests.test_seats tests.test_flight

# the page
python3 -m http.server 5281 --directory tools/bf1942-models/viewer
# then, headless:
#   window.__ships()        hull y beside the y the closed form asks for
#   window.__deckSpawns()   each deck point beside the extractor's own bake
#   window.__seatTable()    every seat of an occupied vehicle, not just the active one
#   window.__enterOwner(o) + window.__plane().setInput + window.__stepSim(n, 1/30)
#   window.__damageVehicle(o, 260)   past criticalDamage, and she starts going down
```

Scratch — probes, traces and the frames — is in this session's scratch
directory under `W7-A/` (`ships.mjs`, `decks.mjs`, `drive.mjs`, `frames*.mjs`,
`sink.mjs`, `shots/`). Session-scoped; every number above carries the hook that
regenerates it.
