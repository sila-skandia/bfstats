# Vehicle Occupant Pose — Implementation Plan

Goal: game-parity seated soldiers in vehicles — driver with hands on wheel,
passengers in seats, gunners at manned positions, C-key view cycle toggling
occupant visibility.

## What exists today

- **Passenger seats**: `extract_pose.py --seat-poses` generates pose glb files,
  `map.html` `loadSeatPose()` parents them on the seat node and plays
  `seat.lower`/`seat.upper` clips via AnimationMixer. Visibility follows C cycle.
  **Working end-to-end for passengers.**
- **Driver seats / manned guns**: `loadSeatPose()` bails at line 6409:
  `if (!seat?.poseAnimation?.upperBody) return;` — no soldier rendered.
- **`addSkeletonIK`**: parsed and exported as of 2026-09-19 (steps 1 and 2
  below are done; 3 to 6 are not started). The 62 IK declarations in vanilla
  `.con` files (36 non-commented) pin `Bip01_R_Hand` / `Bip01_L_Hand` to vehicle
  control points with position + rotation offsets.
- **Driver pose states**: `Ub_SitInVehicle` / `Lb_SitInVehicle` in
  `AnimationStatesVehicle.con`, using `3PWillySitUpper.baf` / `3PWillySitLower.baf`.

## Work items

### 1. Parse `addSkeletonIK` in `con.py`

The `.con` syntax is:
```
ObjectTemplate.addSkeletonIK <boneName> <pos_x/pos_y/pos_z> <rot_x/rot_y/rot_z>
```

Add to `ObjectTemplate`:
```python
skeleton_ik: list[dict] = field(default_factory=list)
# Each entry: {"bone": "Bip01_R_Hand", "position": (x,y,z), "rotation": (x,y,z)}
```

Parse command `addskeletonik` (line ~1359 area, alongside existing `setbonename`).
Append to `obj.skeleton_ik`.

### 2. Emit `skeletonIK` in glb extras — done, on the declaring node

`bf42/assemble.py` writes `extras["skeletonIK"]` on **the node that declares
it**, not on the vehicle root. The Willys declares both hands on
`AnimatedBundle WillySteeringDummy`, the part that turns with the wheel, so the
viewer finds the IK by walking the vehicle for `userData.skeletonIK` and reads
that node's live world pose. A first pass gathered the entries onto the root,
which lost the frame they are relative to, and gathered them once per child of
the declaring part (`SkeletonIkExportTests` pins both).

Still to settle against `AnimatedBundle::updateIk` (lnxded `0x08265880`) before
step 4 is written: that the two triples really are a position and an Euler
rotation in the declaring part's frame, the rotation order, and whether the
solver is a two-bone reach or a plain hand override.

Only a re-extracted vehicle carries the block. As of this note that is the one
Willys the first pass re-exported; the full catalogue re-extract picks up the
rest.

### 3. Extend `loadSeatPose()` for driver seats

When `seat.poseAnimation` is absent (driver/gunner case):
- Walk the vehicle for nodes carrying `userData.skeletonIK`
- Determine the driver pose: resolve `Ub_SitInVehicle` / `Lb_SitInVehicle`
  clips from the animation state machine
- Load a **generic driver pose glb** (one per soldier, not per-vehicle — the
  sit clip is the same across all vehicles)
- Parent it on the seat node
- Apply IK: each frame, read the steering wheel (or turret) node's live
  world pose, compute the IK target from the declared position/rotation offset,
  and override the soldier's hand bone world transforms to match

### 4. Live IK per frame

The `AnimatedBundle::updateIk` (lnxded `0x08265880`) is gated on
`IID_IPlayerControlObject + CID_BFSoldierTemplate` — it only runs for a
seated soldier. The IK binds specific bones to the vehicle's driven parts.

For the viewer implementation:
- After the AnimationMixer updates the skeleton each frame, iterate the IK
  entries on each declaring node
- For each IK entry, find the target vehicle node (by bone name — e.g.
  `Bip01_R_Hand` → the steering wheel node)
- Read the vehicle node's current world pose (including RotationalBundle
  driven rotation)
- Apply the IK offset (position + rotation) to compute the hand's target
  world transform
- Override the hand bone's world matrix in the soldier's skeleton

### 5. Steering wheel hands follow rotation

The `addSkeletonIK` offsets are in the **vehicle's local frame**. The steering
wheel (`WillySteering`) rotates via `c_PIYaw`. Each frame:
1. Read `WillySteering`'s current rotation (already stepped by `seats.js`'s
   turret/rig system)
2. The hand's target = vehicle_root_world * steering_rotation * ik_offset
3. Override the soldier skeleton's `Bip01_R_Hand` / `Bip01_L_Hand` world
   transforms

### 6. Visibility per camera mode

Already handled by `updateSeatPoseVisibility()` — `seatSoldier.visible = !view?.firstPerson`.
The C-key cycle already works for external views (per §7 of seats doc).
No changes needed here.

## File changes

| File | Change |
|---|---|
| `bf42/con.py` | Parse `addskeletonik` → `skeleton_ik` list |
| `bf42/assemble.py` | Emit `extras.skeletonIK` on vehicle root |
| `viewer/map.html` | Extend `loadSeatPose()` for driver seats |
| `tools/bf1942-models/tests/test_con.py` | Test IK parsing |
| `tools/bf1942-models/tests/test_seats.py` | Test IK viewer integration |

## Verification

```bash
python3 -m unittest discover -s tools/bf1942-models/tests -v
./scripts/verify.sh --skip-e2e
```

Visual: load Willys on Wake, enter driver seat → soldier visible with hands
following steering wheel rotation. Load Sherman → driver hidden, hull gunner
visible.
