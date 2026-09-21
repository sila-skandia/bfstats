# W4-C. Tank external camera

Branch `w4/camera`, worktree `bfstats-w4c-camera`, port 5323.

## Read this first: the brief and the binaries disagree

The brief says the game's external view follows the turret, and asks for that.
**That is what is built and it is the default.** But `Camera::getTransformation`
was read for this stream in **both** binaries, and in both of them the chase and
front-chase views take their direction from the **vehicle root (the hull)**, not
from the turret. Only the point the camera is anchored to and looks at, the seat
Camera's own position, rides the turret.

So the default shipped here is a **viewer choice made to the brief, not an engine
reading**. `?chase=engine` runs the law exactly as read, so the two can be put
side by side, and the default is one line (`chaseLawFor` in
`viewer/chase-camera.js`). The lead or the owner should rule on which is right;
an OBS clip of a Sherman in the C view with the turret traversed would settle it
in seconds. I did not change the default on my own reading because the brief
was explicit and I could not ask.

The W4-F claim that reached this stream ("every view mode the seat offers is
positioned relative to the Camera's parent frame") follows from the node
hierarchy (GUN-7) and is true of `CVMInside`. It is not what the chase branch of
the function does. The W4-F report text was lost, so I cannot say whether it
read this function.

## What was built

- `viewer/chase-camera.js` (new, three-free, DOM-free): the chase law's
  arithmetic. `boundingRadius`, `chaseTarget`, `chaseStep`, `chaseEye`,
  `chaseLawFor`, and the five constants with their addresses.
- `tests/chase_camera_harness.mjs` + `tests/test_chase_camera.py`: 14 tests.
- `viewer/flight.js`: `VehicleCamera.externalLaw`, one injected hook called at
  the top of `update()`. No new import, so the five node harnesses that copy
  `flight.js` are untouched.
- `viewer/map.html`: the three.js half (`chaseRig`, `mountChaseLaw`,
  `chaseExternalLaw`, `cameraRidesTurret`, `chaseRadiusTree`), one call in
  `setPilot`, the `?chase=` switch, and a `?shots` hook `__chase()`.

Behaviour, for the root seat of a driven vehicle whose Camera node hangs under
one of that seat's mouse-aimed axes (`c_PIMouseLookX/Y`), in the `chase` and
`front` views:

- anchor and look-at point: the seat Camera node's world position;
- offset: `(-/+forward + 0.3 up) * 1.2 R`, `R` the root's bounding radius;
- ease: `rel += (want - rel -/+ 0.6 v) * (1 - exp(-2 dt))`, carried through the
  cockpit as zero, so C out of the cockpit swoops out of the vehicle;
- the eye is kept 1 m above the terrain; up is world up;
- **frame for forward/up: the Camera's parent (turret yaw and gun pitch)** by
  default, the vehicle root under `?chase=engine`.

It is generic from the hierarchy, no per-vehicle table, so any tank whose driver
Camera sits under the gun base should qualify. **Only the Sherman was run.**
Gunner seats (APC, AA, ship turrets, the Sherman's hull MG) are **not** touched:
on this page those seats are `manned()`'s and have one view, with no C cycle to
hang an external view on. That is existing behaviour, not a decision of this
stream.

Unchanged: the C cycle order, `cameraViewModes` gating, the cockpit view, fly-by,
every vehicle with no turret under its root Camera (the hook is not installed
for them, `__chase().active === false`), and the mouse path (a turret seat's
mouse already goes to the rig and never to `view.turn`, so turret yaw is not
applied twice). Poses are read off the scene nodes after `applyVehicleInterp`,
so the view follows the interpolated tower, not the 30 Hz tick pose.

`?chase=` values: absent (above), `engine` (the law as read, hull frame, for
every driven vehicle), `legacy` (the old framing everywhere).

## Evidence

### The node hierarchy (what the viewer has)

`viewer/models/Sherman.glb`, `extras.templateKind` per node:

```
Sherman                       PlayerControlObject
  ShermanComplex              Bundle
    ShermanTower              RotationalBundle   t=(0,-0.8,0)       yaw,   c_PIMouseLookX
      ShermanGunBase          RotationalBundle   t=(0,1.95,-0.77)   pitch, c_PIMouseLookY
        ShermanGunBarrel      FireArms
        ShermanCamera         Camera             t=(-0.304,0,-0.06)
        Coaxial_browning      FireArms
      shermanBrowning_PCO1    PlayerControlObject (hull MG seat, its own Camera2)
```

So the Camera's parent is the pitching gun base, whose parent is the yawing
tower: "the Camera's parent frame" carries turret yaw **and** gun pitch. The
viewer drives both nodes from `TurretRig` (`seats.js`), stepped per world tick
and slerped per frame by `applyVehicleInterp`.

### The camera law (both binaries)

`Camera::getTransformation(float, Mat4&)`: lnxded `0x081aaf90` (decompiled with
`lnxded/decompile.sh`, then re-read in `objdump`), client `0x005659b0`
(`objdump -d -M intel BF1942.exe`, sha256 `60c9452d...`; `this` is the
ICameraObject subobject, full object at `this-0x15c`).

| Claim | lnxded | client |
|---|---|---|
| `root = getRootParent(camera)`; `rootM = root->getAbsoluteTransformation()` kept in `esi` | `0x081aafa2`, `call [eax+0x40]` at `0x081aafae` | `call 0x508de0` at `0x005659c1`, `call [eax+0x3c]` at `0x005659cc` |
| `camM = camera->getAbsoluteTransformation()` | `0x081aafbb` -> `[ebp-0xc0]` | `0x005659d6` -> `[esp+0x14]` |
| `R = root->getBoundingRadius() * 1.2` | `call [eax+0x48]` `0x081aafc9`, `fmul ds:0x86c4f64` (1.2) | `call [eax+0x44]` `0x005659e1`, `fmul ds:0x8fb7d0` (1.2) |
| view mode 3 inside, else gated on `traceValid`, then 12 chase, 13 front | `cmp edx,0x3/0xc/0xd` at `0x081ab014`-`0x081ab03d`; mode at `this+0x14c`, `traceValid` at `this+0x1dc` | `cmp eax,0x3` `0x00565a37`, `cmp eax,0xc` `0x00565bd6`; gate `[ebx+0x98]` |
| chase: `want = -rootM.fwd * R + rootM.up * R * 0.3`, **both rows read through `esi`, the root's matrix** | `0x081abfe9`-`0x081ac09d`: `fld [esi+0x20..0x28]`, `fchs`, `lea eax,[esi+0x10]`, `0x86c030c` = 0.3 | `0x00565be8`-`0x00565c36`: `fmul [esi+0x10..0x18]`, `fld [esi+0x20..0x28]`, `fchs`, `0x8d6434` = 0.3 |
| minus the carried offset `rel` (`this+0x1cc`), minus `0.6 * root[+0x60]->slot 0x38` | `0x081ac0a8`-`0x081ac154`, `0x86c4f68` = 0.6 | `mov edi,[edi+0x60]` `0x00565be3`, `call [edx+0x38]` `0x00565caa`, `0x8eb33c` = 0.6 |
| ease `1 - exp(-2 dt)` | `fmul ds:0x86c4f6c` (-2.0), `call expf` `0x081ac16c`, `fld1; fsubrp` | `fmul ds:0x8ea538` (-2.0), inlined exp, `fsubr ds:0x8c53c8` (1.0) at `0x00565e56` |
| `eye = camM.pos + rel`, `eye.y >= terrain + 1` | `0x081ac1cc`-`0x081ac238` | `0x00565ed2`-`0x00565ed5` |
| `lookAt(eye, camM.pos, (0,1,0))` | `0x081ac250`-`0x081ac26b` -> `calcLookAtMatrix` | same shape, not re-read line by line |
| front-chase is the same with `+fwd` and `+0.6 v` | branch `0x081abd6e` | `0x00565d25` onward |

Supporting reads, lnxded only:

- `getRootParent` `0x0818d4b0` climbs `+0x50` until flag `0x02000000` at `+4`;
  `BCompositeObject::setParent` `0x08166050` sets that flag on a null parent
  (`0x081660eb`) and clears it otherwise (`0x081660a3`). So it is the top of the
  tree, the hull PCO, never the tower.
- `traceValid` (`+0x1dc`) is written only by `Camera::setTraceValid`
  `0x081aace0`, called from `Camera::handleMessage` `0x081aa400`: message 2 with
  a player for whom slots `+0x54` and `+0x5c` both return false sets it, message
  3 clears it. Read as "a human is in the seat"; the two slot names are
  UNVERIFIED.
- `rel` is `(output matrix - camM)` stored at `this+0x19c` for every mode
  (tail of the function), which is why the view starts from zero out of the
  cockpit.
- View-mode numbers and template bytes, from `Camera::setViewMode` `0x081ac7c0`
  and the strings in `CameraTemplate::makeScript` `0x081acd60`: 3 `CVMInside`
  `+0x1bc`, 12 `CVMChase` `+0x1bd`, 13 `CVMFrontChase` `+0x1c1`, 14 `CVMFlyBy`
  `+0x1be`, 16 `CVMTrace` `+0x1bf`, 17 `CVMExternTrace` `+0x1c0`.
- `CameraTemplate::CameraTemplate` `0x081acc20` defaults: Inside, Chase, FlyBy,
  FrontChase = 1; **Trace and ExternTrace = 0** (`0x081acc82`, `0x081acc89`).
- `BCompositeObject::getBoundingRadius` `0x08165630`: max of the own geometry
  radius and `|child relative position| + child radius`, recursive, cached at
  `+0xb4`.

### Yaw only, or yaw and pitch?

The brief asked. In the engine: **neither**, the frame is the hull. In the
default built here it is the Camera's parent, which is the gun base, so both.
Taking the whole parent frame is the smallest reading of "positioned relative to
the Camera's parent frame"; a yaw-only variant would be a second invention.
By arithmetic, not measured: the Sherman's -20..+5 degrees of elevation moves
the eye by at most `8.55 * sin 20` = 2.9 m vertically. Pitch was not exercised
in the captures.

## Viewer choices (not engine-derived)

1. **The default frame is the Camera's parent.** Contradicted by both binaries;
   built because the brief asked for it. See the top of this file.
2. **Scope.** The engine runs one law for every seat. The brief fenced
   turretless vehicles off as "exactly as before", so only a seat whose Camera
   rides an aimed axis gets it. `?chase=engine` lifts the fence.
3. **The geometry radius fed to `boundingRadius`** is each non-collision mesh's
   bounding-sphere reach about its own origin. The engine's is the geometry
   object's slot `+0x20`, unread. Sherman reads 7.125 m on the page; UNVERIFIED
   against the game. It sets the chase distance, so it is the first thing to
   check if the view looks too far or too near.
4. **Mouse orbit is ignored under the law.** The engine's branch has no orbit
   term. Moot by default (a turret seat's mouse goes to the turret); under
   `?chase=engine` a jeep or aircraft loses the old orbit.
5. **Fly-by keeps the viewer's own tripod**; the law only records its offset so
   the next view eases from it.

## Unverified / open

- Which frame the real game shows. Both binaries say hull; nobody has looked at
  the running game for this stream.
- `root+0x60` is taken to be the root's PhysicsNode and slot `+0x38` its
  `getPositionalSpeed` (`vtable for PhysicsNode` `0x0872df00`, vptr `+0x38`).
  The member's type was inferred from the slot's shape, not proven.
- The client's look-at call and its front-chase branch were matched by shape and
  constants, not re-read instruction by instruction.
- Modes 14, 16, 17 and the default branch of the function (fly-by, trace,
  extern-trace; the 20 m look-ahead eased at 0.1 per frame off the **parent's**
  forward, lnxded `0x081ab1ba` onward) were read only far enough to tell them
  apart. They are where the Camera's parent frame does appear.
- Who cycles the view on C was not found in lnxded (no reader of input bit 26);
  it is client-side and the existing cycle was left alone.
- A grey diagonal streak crosses `sherman-chase-default-t0.png`. It looks like
  a scene object near the eye (it is a thin line in the other captures); not
  investigated, and not compared against the old framing.

## Ledger rows for the lead

| Id | Claim | Status | Evidence |
|---|---|---|---|
| CVM-2 | `CVMChase` (mode 12) and `CVMFrontChase` (13) place the eye at `camM.pos + rel`, `rel` eased by `1 - exp(-2 dt)` toward `(-/+rootM.fwd + 0.3 rootM.up) * 1.2 * root.getBoundingRadius()` -/+ `0.6 * velocity`, kept 1 m above the terrain, looking at `camM.pos` with world up. `rootM` is `getRootParent(camera)`'s matrix: **the hull, not the turret** | **confirmed in both binaries; contradicts the W4-C brief; not checked against the running game** | lnxded `Camera::getTransformation` `0x081aaf90` (chase `0x081abfe9`, front `0x081abd6e`); client `0x005659b0` (chase `0x00565bdf`). Constants lnxded `0x86c4f64`/`0x86c030c`/`0x86c4f68`/`0x86c4f6c`, client `0x8fb7d0`/`0x8d6434`/`0x8eb33c`/`0x8ea538` |
| CVM-3 | View-mode numbers: 3 Inside, 12 Chase, 13 FrontChase, 14 FlyBy, 16 Trace, 17 ExternTrace; the chase branches run only while `traceValid` (`Camera+0x1dc`) is set | **confirmed (numbers); the meaning of `traceValid` inferred** | `Camera::setViewMode` `0x081ac7c0`, `CameraTemplate::makeScript` `0x081acd60`, `setTraceValid` `0x081aace0`, `handleMessage` `0x081aa400` |
| CVM-1 (amend) | "omission means on" holds for Inside, Chase, FrontChase and FlyBy only; `CVMTrace` and `CVMExternTrace` default to **0** | **confirmed** | `CameraTemplate::CameraTemplate` `0x081acc20`, bytes at `0x081acc6d`-`0x081acc90` |

## Reproduce

```
cd tools/bf1942-models
bash link_viewer_assets.sh          # once, in a fresh worktree
python3 -m http.server 5323 --directory viewer &
node ../../features/bf1942-parity-round-2026-09-19/w4c-capture.mjs sherman-chase-default Sherman chase
node ../../features/bf1942-parity-round-2026-09-19/w4c-capture.mjs sherman-chase-engine  Sherman chase engine
node ../../features/bf1942-parity-round-2026-09-19/w4c-capture.mjs willy-chase-default   Willy   chase
node ../../features/bf1942-parity-round-2026-09-19/w4c-capture.mjs willy-chase-legacy    Willy   chase legacy
```

Output goes to `$W4C_OUT` (default `/tmp/w4c-camera`): `<tag>-t0.png`,
`<tag>-t90.png` and `<tag>.json`. The script deploys first (`__setOnFoot`,
`__deploy.spawn`): the world only ticks an occupied vehicle for a player it
knows, and without that the turret never moves. The traverse goes through the
real input path (`__mouseLook` counts, one frame at a time, until the yaw axis
reads 90). El Alamein, hardware GL; set `W4C_SOFT=1` for SwiftShader.

Measured (hull position and heading identical in every pair):

| Run | turret | camera heading minus hull heading |
|---|---|---|
| Sherman chase, default | 0 -> 90 | 0 -> -90.04 degrees |
| Sherman front, default | 0 -> 90 | -180 -> 90.04 degrees |
| Sherman chase, `?chase=engine` | 0 -> 90 | 0 -> 0 degrees; the eye moves 1.25 m as the anchor rides the ring |
| Willy chase, default vs `?chase=legacy` | none | law `legacy`, hook not installed in both; eye within 8 mm, the run-to-run noise of the suspension settling |

Suite: 2162 before, 2176 after, all green (`python3 -m unittest discover -s tests`).
