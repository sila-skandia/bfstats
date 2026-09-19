# Vehicle collision physics — implementation briefing

Shared by every implementer and reviewer on this feature. Read it in full, then
your own track. The engine behaviour is **already researched and verified**;
your job is to port it, not to re-derive or improve it. The specification is
[`../bf1942-engine-reference/subsystems/collision-response.md`](../bf1942-engine-reference/subsystems/collision-response.md)
(call it **the spec**). Where the spec and a research report disagree, the spec
wins. Section numbers below are the spec's.

## Ground rules

- You work in **your own git worktree**, whose absolute path is in your task
  prompt. Run every git command as `git -C <that path> ...`; never touch
  `/home/dylan/projects/skandia/bfstats` (other sessions work there). Create
  only the files your track names, plus tests. Commit each self-contained piece
  as you finish it (`git -C <path> add <files> && git -C <path> commit -m "..."`),
  no Co-Authored-By line, no emojis anywhere.
- Do not launch sub-agents. Do not run `./scripts/verify.sh` (the lead does).
- The shell is zsh: quote globs. `pytest` is not installed — run Python tests
  with `python3 -m unittest tests.test_<name> -v` from `tools/bf1942-models/`.
- JavaScript modules live in `tools/bf1942-models/viewer/`, are **framework
  free** (no `three`, no DOM, no imports outside the files this briefing
  names), ES modules, no per-tick allocation in hot paths (preallocate
  scratch), and match the comment density and tone of `viewer/armor.js` and
  `viewer/vehicle-damage.js`: a header that says what the engine does and where
  the spec says so, then code.
- Tests follow the existing pattern exactly: `tests/<name>_harness.mjs` imports
  the module(s) copied beside it as `.mjs`, prints one JSON blob;
  `tests/test_<name>.py` copies module + harness to a temp dir, runs `node`,
  asserts on the JSON (see `tests/test_armor.py` + `tests/armor_harness.mjs`).
  Every number asserted must trace to the spec or to a golden file, never to
  the implementation's own output.
- **Bug parity**: port the engine's behaviour including its quirks (spec §12),
  with ONE exception: the low mass-share snap uses `shareB = -1.0`, not the
  binary's `+1.0` (§6.1). Put each quirk behind a named constant or a clearly
  commented line so it can be found.

## Coordinates and math conventions

The viewer's world is the engine's with **Z negated** (`bf42/gltf.py`), so it is
right-handed. Mechanics is mirror-symmetric, so every formula in the spec holds
unchanged provided you use ordinary right-handed vector algebra consistently:
`cross(a, b) = [a1*b2 - a2*b1, a2*b0 - a0*b2, a0*b1 - a1*b0]`, point velocity
`v + cross(w, r)`, torque `cross(r, a)`, and Rodrigues rotation of each body
axis about `w/|w|` by `+|w|*dt` radians (`axis' = axis*cos + cross(n, axis)*sin
+ n*dot(n, axis)*(1 - cos)`). Vectors are plain 3-element arrays or
`Float64Array(3)`; an orientation is **three unit row vectors** `axes[0..2]` =
the body's X, Y, Z axes in world space (this is exactly the reference model's
representation, which is what makes golden tests possible). `dt` is the fixed
tick `1/30`; gravity is `-14.73` on Y.

## Shared interfaces (the contract between tracks)

A **body** (track A's `RigidBody`, or the lead's adapters around the viewer's
existing `GroundVehicle` / `Aircraft`) exposes:

```
mass: number                   isStatic: boolean (mass 1e12, never moves)
pos: [x,y,z]   axes: [[..],[..],[..]]   v: [..]   w: [..]        (world)
sleeping: boolean              wake(): void
tangentSpeed(p, out) -> out    // v + cross(w, p - pos)
translate(dp): void            // immediate positional correction
addAccelerationAt(p, a): void  // acc += a; racc += cross(p - pos - com, a)
addAcceleration(a): void       // acc += a only (the engine's AtRelativePosition(0,0,0))
addFrictionAt(p, f): void      // running mean, arm without com
```

A **response** (one per collidable part; track B owns the class, track D reads
it) has exactly these fields, named after the spec's offsets:

```
posAdjust[3]  speedAdjust[3]  rootPosAdjustCopy[3]
count  avgNormal[3]  avgSpeed[3]  avgRelPos[3]
friction  elasticity  resistance          // 0.5*(mat1 + mat2) of the LAST contact
grip (authored byte)  liveGrip (grip | 0x80 latch)
surfaceSpeed[3]
kind: 'body' | 'spring' | 'soldier' | 'projectile'
```

**Material tables** are the viewer's existing `_shared/damage.json`, passed in
as `tables`: `tables.materials[id] = {attGroup, defGroup, damage, friction,
elasticity?, resistance?}` and `tables.modifiers[attGroup][defGroup] = number`
(string keys). Rules (§9.4): an undefined material id falls back to material
`0`; a missing friction/elasticity/resistance takes 1.0 / 0 / 0.01; a missing
modifier cell is **0.0**; the cell is looked up by the attacker material's
`attGroup` and the defender's `defGroup`.

A **collision shape** (one per part, from the glb or the track-E sidecar):

```
layers[i] = { vertices: Float32Array (xyz...), vertexMaterials: Uint16Array,
              faces: Uint32Array (i0,i1,i2...), faceMaterials: Uint16Array,
              normals: Float32Array (per face, n = normalize((v2-v0) x (v1-v0)) in ENGINE winding;
                       the sidecar stores normals already correct for viewer coordinates),
              min[3], max[3] }
radius: number          // bounding radius of the part
```

## Tracks

| | file(s) | spec |
|---|---|---|
| A | `viewer/rigid-body.js` | §3, §4 |
| B | `viewer/body-contact.js` | §5.2, §5.3, §5.5, §6 |
| C | `viewer/crash-damage.js` | §9 |
| D | `viewer/body-ground.js`, `viewer/body-friction.js` | §7, §8, physics.md §6 (springs) — starts after A and B land |
| E | `bf42/damage.py`, `bf42/stdmesh.py`, new `extract_collision_meshes.py` | §5.4, §9.4 |
| lead | adapters, `map.html` wiring, statics, bullets against moved hulls, respawn | |

Golden data for track A: `features/vehicle-collision-physics/tools/emulator/`
holds a Python model (`r2_node_test_lib.py`, class `Model`) validated against
the game server's own machine code to float32 rounding. Generate golden ticks
from that model (plain Python, no emulator needed) into a JSON fixture and make
the JavaScript match it to 1e-9 in float64, or 1e-5 if you run the model in
float32.

## Report

When done, make your final message: what you built, the public API as it ended
up (exact export names and signatures — the lead integrates against this), how
to run the tests and their result, every place you deviated from this briefing
or the spec and why, and anything you found wrong or ambiguous in the spec.
