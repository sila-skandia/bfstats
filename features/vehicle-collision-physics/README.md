# Vehicle collision physics — researched 2026-09-19, built 2026-09-20

**The ask.** In the map viewer a jeep that drives into a plane is simply
stopped, as if the plane were a wall. In the game the jeep pushes the plane
and both take damage. Find out, from the binaries, what the engine actually
does — the end state being that engine re-created in the browser. The first
round researched and documented; the second built it ("Implemented", below).

**Reached from** the engine corpus's entry point,
[`features/bf1942-engine-reference/README.md`](../bf1942-engine-reference/README.md)
"Start here", which also carries the queue of what to investigate or build next.
Aim new work at that file, not this one.

**The answer** is one document:
[`features/bf1942-engine-reference/subsystems/collision-response.md`](../bf1942-engine-reference/subsystems/collision-response.md).
This folder holds how it was reached and what to do with it.

---

## What was found, in brief

- **Contacts** are the vertices of a body's coarse collision mesh (`.sm`
  col0) probed against the faces of the other body's col0 or col1, both ways
  round for bodies of similar size.
- **The push** is a split of the closing velocity and the penetration by
  `massB / (massA + massB)`, all-or-nothing beyond 95/5 %, posted as an
  acceleration at the contact point and integrated a tick later — so it spins
  the body as well as shoving it.
- **Rotation has no mass in it.** Inertia is the mesh's bounding box times
  `inertiaModifier`.
- **Friction** is a per-tick velocity-change request clamped to
  `μ · N.y · |g| / 30`, with a 1.5× static latch. It scales with the contact
  normal's Y, so a side-on ram has none.
- **Crashes cost hit points, for vehicles too** — against each other and
  against the ground — by `speedMod × |v|² ×` an angle factor `×` a
  material-pair table, at most once per second per pair. A Willy at 15 m/s
  takes 45 HP off a parked Spitfire and loses 22.5 itself; mass is not in the
  formula. The engine-reference corpus said the opposite until today, and
  `viewer/vehicle-damage.js` still says so in its header comment.
- A parked vehicle is **asleep**; the contact wakes it and it moves two ticks
  after the touch.
- The **client runs the identical code** for every vehicle, local or remote,
  and never computes the damage itself.

## What this overturns

| Where | Said | Is |
|---|---|---|
| `subsystems/hitpoints-and-damage.md` §3, ledger HP-6 | only a falling soldier is damaged by a collision; `*0x15c` is `BFSoldier::handleDamage` | the receiver is the GameServer and the slot is `giveDamage`; every armoured object is damaged (rewritten) |
| `features/viewer-collision-damage/README.md`, behaviour 1 | "a plane that hits the ground … not in the engine" | it is: `cos³ × speedMod × v² × …` (verdict table corrected) |
| `subsystems/physics.md` §3 | a child node hands its force to the root through a `+0xcc` predicate; four sub-steps | `+0xcc` is `isSleeping`; only the root integrates, one step per tick; sub-steps are `PointPhysicsNode` only (corrected) |
| `subsystems/physics.md` §6, ledger PHY-2 | friction magnitudes unread | read (closed) |
| `symbols.json` `responsePhysicsManager` | "slot `+0x1c` called twice per tick", unnamed — easy to take for the collision update | `+0x1c` is `resetCachedCollisionObjects`; `update(dt, obj)` is `+0x14`, called from `Game::updateWorldCollision` and once per occupied vehicle (note extended) |
| community lore, and comments in our readers | `.sm` col0 projectile / col1 vehicle / col2 soldier | two layers only: col0 coarse (vertices; faces for big bodies), col1 fine (faces for projectiles, soldiers, small bodies) |
| `viewer/vehicle-damage.js` header | "Do not add a crash-damage path — the engine has none" | wrong; left in place for the implementation round to replace with the real thing |

---

## How it was done

One discovery changed the economics: `bf1942_lnxded.static` — the Linux server,
54,895 symbols — was already analysed in a Ghidra project
(`~/ghidra/linux-server`, 39,983 functions) that the GUI cannot open because of
a minor language-version bump. A headless Ghidra opens a throwaway copy without
complaint, so **any named server function now decompiles in about 15 seconds**
instead of being hand-read as x87 assembly:

```bash
features/bf1942-engine-reference/lnxded/decompile.sh /tmp/out 'ResponsePhysics::solveImpulse' 0x08253930
features/bf1942-engine-reference/lnxded/vt.py ResponsePhysics      # vtable, offsets from the vptr
features/bf1942-engine-reference/lnxded/vt.py --float 0x86d16cc    # a constant
```

Then the usual shape: a lead reading of the core chain, five parallel research
tracks on one shared [briefing](BRIEFING.md), and a separate adversarial
verifier per track that re-derived every load-bearing claim from `objdump`.

| Report | Track | Verifier | Outcome |
|---|---|---|---|
| [L0](reports/L0-lead-response-and-damage.md) | lead: shares, `impulseOn`, `solveImpulse`, the damage formulas | [V0](reports/V0-verification-of-L0.md) | 7 of 11 confirmed outright, 4 corrected (the soldier run-over branch had attacker and victim swapped; the impulse is gated on a non-zero push-out), none refuted |
| [R1](reports/R1-terrain-friction.md) | terrain contact and the friction solver | [V1](reports/V1-verification-of-R1.md) | every finding re-derived from `objdump` confirmed (Point-body routines not re-read); added: undefined wheel materials fall back to material 0 (resistance 0.02), the friction limit's gravity is hard-coded, the report's JS notes omit the EngineDummyGrip early exit |
| [R2](reports/R2-integrator.md) | integrator, sleeping, tick order | [V2](reports/V2-verification-of-R2.md) | integrator arithmetic validated by running the server's own machine code under Unicorn against a model (the verifier re-ran it and added the one clamp it missed); tick order, children-before-root and sleeping confirmed; **refuted**: "a vehicle whose player sent no input is skipped that tick" - it is simulated with zero input |
| [R3](reports/R3-geometry-broadphase.md) | broadphase, pair filter, mesh selection, narrow phase | [V3](reports/V3-verification-of-R3.md) | confirmed throughout; special-material coverage extended (vehicle and soldier handlers, `isSolidMaterial`) |
| [R4](reports/R4-data-survey.md) | `.con` bindings and the game-data survey | [V4](reports/V4-verification-of-R4.md) | every quoted value confirmed and the worked examples reproduced; corrected: the cell table is keyed by att/def *group*, a lookup never creates a cell, a script-created cell starts at 1.0, counts off by a comment-block parsing bug; added the vertex-material side and the rammer's own damage |
| [R5](reports/R5-client-twins.md) | the client's copies | lead spot-check | every vtable slot re-read from the live binary; one getter mislabelled (`0x00574b60` is `+0x74`, not `+0x7c`) and fixed on import |

Where a report and its verifier disagree, the verifier and the subsystem
document are right; the reports are kept as the record, not as reference.

---

## Implemented, 2026-09-20

Ram a parked plane on Wake and it is shoved, rolled and damaged, and so is the
jeep. Measured in the page with the real drive model: a Willy at 11.7 m/s into
a Corsair's wing loses 13 HP, moves the plane 1.3 m and tips it; the wing is
material 90 and takes nothing, the fuselage would have taken about 27; a
second later the scraping hull costs the plane 32 more against the grass.

| Module (`tools/bf1942-models/viewer/`) | What it ports | Tested by |
|---|---|---|
| `rigid-body.js` | the root integrator, sleep counter and accumulators (spec 3-4) | `test_rigid_body.py`, golden ticks from the binary-validated model (agreement to 1e-17) |
| `body-contact.js` | pair filter, vertex/face direction rule, the probe, shares, `impulseOn`, `setAdjust`, `solveImpulse` (5-6) | `test_body_contact.py` |
| `body-ground.js`, `body-friction.js` | terrain contact, the wheel spring, `addFriction` (7-8) | `test_body_ground.py` |
| `crash-damage.js` | both damage formulas, the soldier branch, the 16-slot one-second limiter, the material rules (9) | `test_crash_damage.py`, the verified worked numbers |
| `body-world.js` | one 30 Hz tick in the engine's order (2) | `test_vehicle_bodies.py` |
| `vehicle-bodies.js` | a placed vehicle's nodes + the sidecar as collision parts; `DrivenBody`, the player's vehicle seen as a body | `test_vehicle_bodies.py` |
| `collision.js` | moved owners: a shoved hull is still hit by rounds and boots, without rebuilding the index; a body's own hull sweep skips other bodies | `test_collision.py` |
| `map.html` | settle at load, enter/leave hand-over, per-frame step, wreck and respawn, crash damage into `VehicleDamageSet` | in the browser, on Wake |

Extractor: `bf42/damage.py` now agrees with the engine (158 materials, 5,153
cells, elasticity and resistance carried), `bf42/stdmesh.py` reads the
per-vertex collision material, and `extract_collision_meshes.py` writes
`_shared/collision-meshes.json` — every collision layer of every vehicle mesh,
in viewer coordinates, with a geometry-template to mesh-file map.

**How it was built.** Four Sonnet implementers in parallel worktrees on one
briefing ([IMPLEMENTATION.md](IMPLEMENTATION.md)) with the interfaces fixed up
front, a Sonnet reviewer per module, the lead on design and integration. What
the reviewers and the integration caught:

- The wheel spring. Its track had no source for how a compressed wheel relaxes
  and invented a rule; the lead decompiled `PhysicsSpring::updatePhysics`
  instead. The wheel snaps back to rest every tick and the force follows the
  ground's normal (now in `physics.md` section 6). With the invented version a
  parked Corsair crept backwards forever and never slept; with the read one it
  settles in four seconds.
- Spawn height. A placed vehicle's authored pose hangs its wheels clear of the
  ground (0.2 m for a Willy); the engine's vehicles are born awake and drop.
  The page now settles every vehicle once at load, before the collision index
  bakes the hulls, so a first touch does not make a parked plane fall.
- Per-tick allocations in the contact solver's hot path (reviewer).
- A collision-mesh normal is not what the flipped glTF winding implies: the
  Z-mirror reverses orientation, so the sidecar ships normals ready-made.

**Deliberate differences from the engine**, all marked in the code:

| | |
|---|---|
| the low mass-share snap uses `-1.0` | the binary's `+1.0` pushes a light body toward a much heavier one (spec 6.1) |
| the driven vehicle keeps its own drive model | `DrivenBody` applies the solver's push to it immediately instead of a tick late; its contact friction is dropped, its own tyres stand |
| pair de-duplication is an `i < j` loop | equivalent to the engine's per-tick stamp |
| ships are not bodies | nothing here models a `FloatingBundle`; a woken destroyer would sink |
| vehicles are settled at load rather than on spawn | same resting pose, no visible drop |
| statics are still met by the swept sphere | a driven vehicle against a building stops as before; only vehicle-vs-vehicle goes through the solver |

The driven vehicle takes the ground's crash damage too (spec 9.5), without
the response: its drive model still owns the contact, so only the damage half
of `checkVsTerrain` runs for it. Measured: a Corsair set down at 30 m/s sinking
1.5 m/s takes nothing; nosed in at 35 m/s and 30 degrees its propeller (material
45) is what touches first and costs 57 of its 100 HP, after which the limiter
and the flight model's own ground clamp spare it a second event.

**Not done yet:** the drive models' *response* to a crash (a plane that noses
in is levelled out by `flight.js`'s ground clamp instead of tumbling, so it
survives what the game would finish off); parked bodies against static
buildings; the soldier is not yet a body, so being run over is still the old
code.

**A vehicle parked on a slope never sleeps, and that is the engine's rule, not
a defect.** The wheel spring pushes along the contact normal, so it cancels
only gravity's normal component; the downhill component, `14.73 x sin(slope)`,
stays in the acceleration accumulator because friction never enters it
(`collision-response.md` 4.3). Sleep needs `acc^2 < 2.5`, so anything steeper
than about 6.2 degrees stays awake for good. Measured on a 10 degree slope
with a realistic 2,500 kg box: parked nose-down it settles within a second and
drifts 2 mm in the next ten; parked broadside it rocks on its narrow track for
minutes. `test_slope_settles_but_never_sleeps` holds both halves. The cost is
a few awake bodies per map stepping their springs each tick.

One wake-up transient is known and left alone: a body that has slept has an
uncompressed wheel and a stale damper history, so its first awake tick gets no
static support and the second a hard damper kick - a visible bounce when a
parked vehicle is first touched. The engine skips a sleeping spring's update
the same way, so it is likely there too; nobody has measured it in the game.

**Assets.** A mod's levels look for `collision-meshes.json` beside that mod's
own `damage.json`, and without one its vehicles stay the fixed hulls they were.
Baked and published 2026-09-20 for vanilla (1.3 MB), The Road to Rome (1.5 MB),
Secret Weapons (1.7 MB) and Eve of Destruction (5.1 MB); a newly extracted mod needs
`extract_collision_meshes.py --mod <Mod> --out viewer/maps/mods/<mod>/_shared`,
which takes seconds. The refreshed `damage.json` (45 cells differ, elasticity
and resistance added) is backward compatible: the old one still works, with
0 / 0.01 standing in for the missing pair.

## For the implementation round (as planned on 2026-09-19)

Nothing here is built. When it is, in the order that pays:

1. **Give vehicles an Armor and wire crash damage** (`collision-response.md`
   §9). It needs only what the viewer already has — a contact, a relative
   velocity, a normal — plus data the extractor does not emit yet:
   `speedMod` / `angleMod` / `damageMod`, the material table and cell table
   (`Game.rfa`, run order matters), and the **per-vertex and per-face collision
   materials** (`stdmesh.py` reads the face byte and discards the vertex's
   u16). Replace the header comment in `viewer/vehicle-damage.js`.
   `bf42/damage.py` already loads the tables but needs three fixes first: it
   reads inside `beginRem`/`endRem` blocks (18 phantom cells) and ignores
   `MaterialManager.setCell` (6 missing), so it reports 5,165 pairs where the
   engine loads 5,153; it keys cells by material id where the engine keys them
   by att/def *group* (differs for 120 and 166); and an effect-only cell must
   start at 1.0, an absent one at 0.
2. **Make the struck vehicle a body.** Today a parked vehicle is part of the
   static collider. The minimum faithful version: every spawned vehicle is a
   root body with `mass`, box inertia × `inertiaModifier`, the §4 step, and the
   sleep counter; the share rule of §6.1; push-out now, velocity next tick.
3. **Replace the sphere sweep with the engine's probe** (§5): col0 vertices
   against col0/col1 faces, both directions at weight 0.5 for similar sizes.
   The BSP is optional at these face counts.
4. **Friction as §8**, which also replaces `ground.js`'s single-μ tyre model
   and is what the power slide is made of.
5. Decide, per quirk in §12, between parity and sanity. The `+1.0` share is a
   bug; the one-tick impulse latency and the `N.y` friction budget are
   behaviour players have felt for twenty years.

The per-track reports each end with JavaScript notes for a fixed 30 Hz tick;
R2's is a complete `updatePhysics`.

## Where the findings were written into existing docs

So that nobody planning viewer work meets the old story first:

| Doc | What changed |
|---|---|
| `features/bf1942-engine-reference/README.md` | the `lnxded/` tooling, a Current-state paragraph, the symbol count |
| `.../ledger.md` | HP-6 rewritten; COL-1 and PHY-2 amended; new section COL-2 to COL-12 |
| `.../subsystems/hitpoints-and-damage.md` §3, `physics.md` §3 and §6, `tank-driving.md` Open | rewritten or corrected in place |
| `features/viewer-collision-damage/README.md` | superseded-in-part note; verdict row 1 and the headline bullet corrected |
| `features/bf1942-3d-models/fall-damage-research-groundwork-2026-09-17.md`, `supply-and-health.md` | the `*0x15c` receiver corrected (GameServer, `giveDamage`) |
| `features/flyable-vehicles/collision-and-crash.md`, `README.md` | every `strong inference` about the executable replaced by what was read: layer use, the speed/angle multiplier, the once-per-second limiter, `damage.py`'s pair count |
| `features/bf1942-3d-models/ground-vehicles.md`, `parity-gaps.md` | "no hull collision" now points at the engine spec; a new parity-gap row for vehicle-vs-vehicle push and crash damage |
| `features/bf1942-parity-round-2026-09-19/README.md` | left to that round's lead session, which has the suggested row |

## Open

Listed at the end of `collision-response.md`. The two that matter most for a
port: the client's own `handleCollision` override was not located (so "the
client computes no damage" is strongly inferred, not read), and the
soldier-vs-soldier push was read in the decompile only.
