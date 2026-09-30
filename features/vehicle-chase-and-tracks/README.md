# Vehicle chase framing and track belts (2026-09-30)

Status: built, not committed. The chase camera now frames every seat whose
Camera rides a gun the way the engine does, off the hull. Tank belts scroll on
the map page for the player's, the bots', a room's remote and a replay's hulls.
The belts still do not flex over their road wheels, because the exporter does
not ship the skin that would let them.

Three defects reported against Desert Combat and vanilla prompted this:

1. The chase view of an M1A1 or T72 commander MG, a Humvee gunner or a
   Sherman pintle MG hung in front of the gun and looked back at it.
2. Tank track textures never moved on the map page, and the belts are rigid.
3. `window.__vehicles` was defined twice, and the second definition dropped
   `pos` and `tiers`.

## 1. The chase frame

### What the engine does

Ledger CVM-2 and CVM-4 cover this. `Camera::getTransformation` (lnxded
`0x081aaf90`, client `0x005659b0`) reads two matrices. The direction comes
from the rows of `getRootParent(camera)`, and the anchor and look-at point
come from the seat Camera's own translation, `setPivotPosition` included.
`getRootParent` is the vehicle's topmost object for every seat, including a
nested gunner's PCO. The view is a look-at with world up, so the engine never
reads the Camera's `setRotation` or its parent's frame for chase or front.

### What was wrong

W4-C shipped the brief's turret-following view as the default: the frame was
the Camera's parent (`chase-camera.js` `chaseLawFor`). The owner kept that
default on 2026-09-21. Pintle MGs are authored with the mount turned round and
the gun and Camera turned back (`setRotation -179.999`), so on those seats the
parent faces against the gun. There the view hung in front of the gun and
looked back at it: on the M1A1 commander MG the gun pointed (0.2, -0.02, -0.98)
and the view looked (0.09, -0.46, 0.88).

### What was built

| file | change |
|---|---|
| `viewer/chase-camera.js` | `chaseLawFor` returns `{law, frame}`. By default a seat whose Camera rides an aim axis gets the engine law in the `hull` frame. `?chase=turret` keeps a turret-following view framed off the Camera node's own axes, so a flipped mount faces the right way; that option is a viewer choice. `?chase=engine` and `?chase=legacy` are unchanged. `chaseFrameNode` picks the node; the parent frame is gone |
| `viewer/seat-camera.js` | `chaseExternalLaw` takes its frame from `chaseFrameNode(law, root, camera)` |

Seats whose Camera does not ride an aim axis (drivers of turretless vehicles,
passengers, pilots) keep the viewer's own framing as before. The engine runs
the same law for them; `?chase=engine` shows it.

### Sweep: which seats change

The script is in the session scratchpad, `fix-camtracks/sweep_cams.py`. It
walks every glb in `viewer/models` and `viewer/models/mods/*`, and each level
bakes the same templates. It takes each PCO's first Camera and asks two
questions: does the Camera hang under one of its seat's mouse-aimed axes, and
does its parent face against it at rest? The bf1918, fh, gcmod, interstate and
pirates trees hold kits and poses only.

| tree | seats with a Camera | Camera rides an aim axis | parent turned against the Camera |
|---|---|---|---|
| bf1942 | 183 | 78 | 5 |
| xpack1 | 20 | 11 | 1 |
| xpack2 | 37 | 16 | 1 |
| desertcombat | 474 | 161 | 10 |
| dc_final | 573 | 194 | 17 |
| eod | 564 | 214 | 24 |
| fhsw | 7210 | 3560 | 211 |

Every one of the 4,234 aim-riding seats now frames off the hull, so its chase
no longer swings round with the turret or tips with the gun's elevation. The
269 flipped seats were the ones framed backwards:

- **Vanilla:** Sherman, Panzer IV, Chi-ha and T34-85 pintle MGs, and the M3A1
  ring mount.
- **XPack1:** the M3GMC rear gunner.
- **XPack2:** the T95 Browning.
- **Desert Combat:** M1A1 and T72 commander MGs, the Humvee .50 and TOW
  gunners, and the Ural .50, plus the vanilla five.
- **DC Final:** the same, plus the Humvee MK19 and minigun, the LCAC's
  Humvee .50, the Ural ZPU, fuel-drum and recoilless .50s, and the Patriot.
  The Patriot's launcher is flipped under its tube, and its root spells
  `playercontrolobject` in lower case.
- **EoD:** the PBR rear guns, the LCT 20 mm AA guns, the M551 and M109
  Brownings, and the mortar carriers.

The DC Final Shilka is not flipped. Its gun base elevates from 5 to 55
degrees, so the old parent frame tipped its chase down under the gun; the
hull frame does not.

On the Sherman, T72, T34-85, Panzer IV, Chi-ha and Ural the MG rests facing
the rear of the hull. The Sherman's `sherman_Browning_console` sits 0.388 m
behind the ring, with the gun and `ShermanCamera2` turned `-179.999`. The
hull-framed chase therefore looks up the hull at a muzzle pointing back at it
until the gunner swings it. The engine frames it the same way.

## 2. Track belts

### What the engine does

Ledger TANK-18 and TANK-19 cover this. `AnimatedBundle::updateAnimations`
(lnxded `0x08266080`, the tail of `handleVisualUpdate` `0x08265730`; client
`0x0054f580`) moves the belt's texture offset by `animatedTextureSpeed *
getCurrentRatio() * getCurrentDifferentialRPM(x)`, where `x` is the belt
node's own x beside its Engine. It does this once per visual update and only
under an Engine. So each side runs at its own EngineGrip target, and a pivot
turns the two belts against each other. A car-engined half-track runs both at
the rev state. There is no `dt` in the step.

The same function skins the belt to its road wheels. Bone k takes the
translation of the child that `useAsBone` k names, with its rotation
discarded, so the belt rides the springs.

### What was built

`viewer/track-scroll.js`:

| function | job |
|---|---|
| `trackBelts` / `beltsOf` | find the belts under an Engine (every one shipped is) and clone each belt's material and map once, keeping the page's `onBeforeCompile` and `customProgramCacheKey` |
| `engineBeltRate` | the engine's product, through `ground-engine.js` `currentDifferentialRPM` |
| `motionBeltRate` / `bodyMotion` / `motionBetween` | a presented hull's per-side contact speed, `forward + yawRate * lateral`, from recorded motion or from two drawn poses |
| `advanceBelts` | `offset += rate * speed * 60 * dt`, wrapped to [0, 2) |
| `presentBelts` | draws a ticked hull's belts between its last two ticks |

It is wired in five places:

- `tracked-vehicle.js` and `wheeled-vehicle.js` `integrate` step the belts
  from the engine each world tick, for the player's hull and the bots'.
- `presentKinematic` in both files steps them from the recorded motion, for
  replay hulls (`replay-hulls.js` already presents through it).
- `netcode-render.js` steps a room's remote replicas from their drawn poses.
- `local-look.js` `applyVehicleInterp` draws every ticked hull's belts at the
  frame's alpha.

Viewer choices, not engine readings:

- **Pinned rate.** Retail steps the offset once per drawn frame, so its belts
  run faster at a higher frame rate. The page pins that to 60 steps a second,
  the rate the model browser already assumes, so a 144 Hz display and a
  30 fps headless run scroll a belt the same.
- **Motion for presented hulls.** A replay or remote carries no engine state,
  so its belts run at the contact speed its motion shows. That is what the
  engine's target settles to on the ground.
- **Drawn per frame.** An M1A1 at 15 m/s moves its belt 0.18 of the texture
  each 30 Hz tick, and the link pattern repeats every 0.25. Drawn at the tick,
  the belt reads as running backwards. Drawn per frame at 60 Hz the step is
  0.09, which is what retail shows at that rate.

The exporter's sign for `speed` (`assemble.py` negates U) was checked against
the UVs of seven belts (Sherman, Tiger, Panzer IV, T34, M3A1, Chi-ha, M1A1).
With it, driving forward moves each belt's bottom run toward the back of the
hull, as a track on the ground moves.

The model browser (`model-rig.js`) still scrolls by throttle, since it has no
engine. It is unchanged.

### Belt articulation: what the exporter lacks

Gap 4 of `bf1942-3d-models/parity-audit/animation.md` needs three things,
none of them in the viewer:

1. **`con.py` must parse `useAsBone <v>` and `setBoneOriginOffset <v>`.** Each
   `useAsBone` appends a BoneInfo naming the child of the most recent
   `addTemplate`. `setBoneOriginOffset` writes the last BoneInfo. The runtime
   loop reads neither vector; it needs only the child each BoneInfo names, in
   order.
2. **`assemble.py` must export the belt as a skinned mesh.** Each
   `AnimatedMesh` geometry comes with its `setSkin` `.skn`, read by
   `bf42/skin.py`, as JOINTS_0/WEIGHTS_0. There must be one joint per
   BoneInfo, in order, at the bound child's rest translation; the shipped
   `.ske`s, read by `bf42/ske.py`, carry the same bones. The export must also
   name, per joint, the wheel node it follows, for example
   `extras.boneWheels: [nodeName, ...]`.
3. **The viewer must follow the wheels.** Each frame it sets joint k's
   position to its wheel node's current local position, rotation left alone.
   The tank drives already move the springs (`TrackedVehicle.#applyWheels`).

Then both model trees and every level bake need re-baking and publishing:
this is the `scene` layer, `features/level-bake-layers`. There are 27 belts
on 14 vanilla vehicles and more in each mod (dc_final 49, desertcombat 45,
eod 83, fhsw 1,561, xpack1 7, xpack2 10).

## 3. `window.__vehicles`

The hook is now defined once, in `test-hooks-vehicles.js`. It returns every
field of both old hooks: `x/y/z` and `wrecked` for the repair sweep and blast
checks, and `pos`, `tier`, `tiers`, `running`, `critical` and
`criticalDamage`. Where the two differed, it keeps the values callers were
actually getting: the node's name and raw `hp`. It lists owners in the
`damageVisuals` order as before, then any owner that only the damage set
holds.

## Verification

Node tests:

- `tests/test_chase_camera.py`, 19 tests. They pin the default to the hull
  frame. The flipped-mount case hangs the chase behind the gun both by
  default and under `?chase=turret`; the old parent frame's front view is
  kept in the test as the reported defect. A source check confirms
  `chaseExternalLaw` asks `chaseFrameNode`.
- `tests/test_track_scroll.py`, 27 tests. They cover the engine rate per side,
  the car engine, the no-revs case and the clamp; the step and wrap; frame-rate
  independence; body motion; a real `TrackedVehicle` integrated under throttle
  and full lock and presented from a replay's pivot and drive; a remote
  replica; the between-ticks drawing; and the wiring in all five places.
- `tests/test_test_hook_vehicles.py`, 3 tests: one definition across the
  page, every field, and the order.
- `test_ground.py`, `test_room.py` and `test_mouse_look_key.py` list the new
  modules their harnesses copy.

Headless checks ran against `:5273` in one Playwright Chromium on Vulkan,
closed after each run:

| check | result |
|---|---|
| DC M1A1 commander MG, chase | eye 8.54 m behind the hull, looking along the hull and the gun (dot 0.958); law `{engine, hull}` |
| same seat, `?chase=turret` | the same (the gun rests forward) |
| DC T72 commander MG, Humvee TOW gunner | eye 8.98 m and 14.04 m behind the hull, looking forward |
| vanilla Sherman pintle MG and driver | eye 8.65 m and 7.7 m behind the hull, looking forward |
| DC M1A1 driving | the belts move 0.1787 a tick at 14.9 m/s (14.9 × 0.006 × 2) and 0.089 each 60 Hz frame; hard right runs the left belt further than the right |
| vanilla Sherman driving | both belts, all three maps each, move 0.07 a frame |
| M1A1 side view, belt maps moved 0.1 by hand | the belt band changes (1,683 px) while hull and ground stay identical, so the offset reaches the drawn material |

## Open

- The owner's 2026-09-21 ruling kept turret-following as the default. This
  change makes the engine's hull frame the default, as the brief asked. To
  restore turret-following, change one line in `chaseLawFor`; the
  `?chase=turret` form of it is now right on flipped mounts too.
- Turretless seats still use the viewer's own chase framing. The engine runs
  CVM-2's law for them too.
- The Sherman chase on El Alamein shows a grey band across the lower third
  and a dark line at the horizon (W4-C's 2026-09-21 capture has the same
  streak). A raycast from the camera hits only terrain there, so the band is
  something that does not raycast. It was not investigated.
- Belt articulation, above.
