# Vehicle collision physics — research round, 2026-09-19

**The ask.** In the map viewer a jeep that drives into a plane is simply
stopped, as if the plane were a wall. In the game the jeep pushes the plane
and both take damage. Find out, from the binaries, what the engine actually
does — the end state being that engine re-created in the browser. This round
researches and documents; it implements nothing.

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

## For the implementation round

Nothing here is built. When it is, in the order that pays:

1. **Give vehicles an Armor and wire crash damage** (`collision-response.md`
   §9). It needs only what the viewer already has — a contact, a relative
   velocity, a normal — plus data the extractor does not emit yet:
   `speedMod` / `angleMod` / `damageMod`, the material table and cell table
   (`Game.rfa`, run order matters), and the **per-vertex and per-face collision
   materials** (`stdmesh.py` reads the face byte and discards the vertex's
   u16). Replace the header comment in `viewer/vehicle-damage.js`.
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

## Open

Listed at the end of `collision-response.md`. The two that matter most for a
port: the client's own `handleCollision` override was not located (so "the
client computes no damage" is strongly inferred, not read), and the
soldier-vs-soldier push was read in the decompile only.
