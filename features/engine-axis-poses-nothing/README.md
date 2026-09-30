# An Engine's axis poses nothing: Desert Combat's wheels orbiting the hull

Status: fixed in the viewer, 2026-09-30. No asset changed, so nothing needs
re-extracting or re-baking.

## What the owner saw

On play.bfstats.io, driving Desert Combat's Humvee made the wheels rotate
around the chassis instead of rolling. Two tyres lay flat on the bonnet and
rear deck, and two lay flat under the sill. The Pickup, Technical, Lada, DPV
and EE-9 did the same.

## Why

Every wheel of a Refractor car hangs under its `Engine`. The front wheels sit
inside `c_PIYaw` `RotationalBundle`s. `HumveeEngine` declares its throttle as

```
ObjectTemplate.setMinRotation 0/0/-100
ObjectTemplate.setMaxRotation 0/0/100
ObjectTemplate.setInputToRoll c_PIThrottle
```

`con.py` classes an axis as a rate when its span is over 360
(`ACCUMULATOR_SPAN`). That is how the Willy's +-5000 and every propeller are
spun and never posed. A span of 200 is a `position` axis, and
`vehicle-base.js` `applyRig` posed position axes on whatever node carried
them, including an Engine. At full throttle the Engine rolled 100 degrees
about its own origin, and all four wheels went with it. Measured headless on
DC_Basrahs_Edge: `HumveeEngine` at roll 100, each wheel 1.47 to 1.49 m off its
spring, each axle pointing nearly straight up. The model browser's rig
(`model-rig.js`, which the OPTIONS > CONTROLS preview shares) did the same.

## The engine rule

An Engine's angles are gearbox inputs. They never pose anything, on any axis,
at any span, on the host or a client. Ledger PHY-15 (with PHY-13 and TANK-12)
has the addresses, and `subsystems/physics.md` section 7 has the narrative.
The Engine vtable replaces `RotationalBundle::handleUpdate` with
`Engine::handleUpdate`, which clips the three angles and never builds a
transform. Its networkable is `EngineNetworkable`, which copies the angles
into registers and nothing more.

## The vanilla precedent

The same symptom came up during vanilla extraction. First it was a Corsair's
gear orbiting its propeller (`9bbe4079`, `6a0d0ccb`, `7ada7653`). Then it was a
tank's running gear orbiting the hull, back when every Engine axis was read as
a spin (the `ACCUMULATOR_SPAN` comment in `con.py`). Those fixes covered rate
axes only. They made the rate spin reach the propeller alone, and they turned
the tanks' +-1 degree lean into a position axis. Posing that lean moved a road
wheel by a few centimetres at most, which nobody saw. Desert Combat's -100..100
throttle falls between the two vanilla populations, and it exposed the part
of the rule that had never been built.

## The fix

- `viewer/vehicle-base.js`: `RiggedPart.posesNode` is false on an Engine, and
  `applyRig` skips the node's pose for such a part. The servo still runs. The
  surfaces are keyed per control, input and axis, and the steering bundles
  share them. The drivetrains read the Engine's own numbers, so nothing else
  changes. This covers the driven hull, bots, netcode ghosts and replays,
  because all of them present through `applyRig`.
- `viewer/model-rig.js`: an Engine's position axes stay on the crew console
  (a tank's throttle still scrolls its tracks), but `applyRig` does not pose
  the node.

The exporter is right. The Engine's `rig` is the `.con`'s own servo, and the
gearbox, the helicopter collective floor (PHY-13) and the drivetrains read
it. Only the reading as a pose was wrong, so no glb or level bake changes.

## Blast radius

Model glbs with an Engine whose position axis carries drawn geometry:

| Tree | Big swings, spans of 10 degrees or more | +-1 degree lean |
|---|---|---|
| desertcombat | Humvee, Pickup, Technical, Technical_Recoilless, Lada, DesertPatrolVehicle, EE-9 | 32 (tanks, BRDM2, BM21, Katyusha, SCUD-B, Stryker, Urals, Kubelwagen) |
| dc_final | the same plus Humvee_MK19, Humvee_Tow, Humvee_minigun, LCAC | 40 (adds BMP1, M6, SA-9, the Ural variants, nx_M-923) |
| vanilla, xpack1, xpack2 | none | 15, 4, 6 (tanks, half-tracks, Katyusha, Kubelwagen, Schwimmwagen) |
| eod | Huey, Cobra and Loach hover and tail engines; M35 and Zil trucks (-6..10) | 45 |
| fhsw | BrokenTiger (+-30), E16A1, Ise, Mogami | 830 |

In the DC and DC Final level bakes, 2,036 wheels in 71 levels hung under a
-100..100 Engine. Surveyed from the glb node transforms, every steered wheel's
spring origin in both DC trees sits on its steering axis (0.000 m, or 0.014 m
on the M-923). The wheel meshes are authored up to 0.168 m off it, the same
kind of hub offset as the vanilla Willy's 0.105 m.

## How it was checked

- `tests/test_ground.py` `test_an_engines_position_axis_poses_nothing` and
  `test_the_model_browser_does_not_pose_an_engine_either` build the DC Humvee
  from its glb tree next to the Kubelwagen and the Willy, then drive them with
  throttle and full lock held. Against HEAD's modules the Humvee's Engine
  turns 100 degrees and its wheels move 0.67 to 1.41 m. With the fix the Engine
  stays at 0, no wheel moves across the ground, the fronts turn to their
  bundle's lock and the rears do not. The Kubelwagen loses its 1.4 degree
  lean. The Willy is identical before and after, and the distance each car
  drives is unchanged.
- Headless Chromium on the main checkout's viewer, pinned in place with the
  throttle and steering held. The DC Humvee on DC_Basrahs_Edge ends with its
  Engine at 0, its wheels within 2 mm of rest and its fronts at -50 degrees.
  DC Final's Technical on DC_Basrah_Nights ends the same way at -50 degrees.
  The vanilla Willy on El Alamein gives the same numbers before and after.

## Open

- The model browser rolls a car's wheels with the throttle only when its
  Engine is a rate axis (the Willy). A Humvee's throttle slider now moves
  nothing visible, which is right, but its wheels do not roll there either.
- `Vehicle.servoAxes` keys a servo by control, input and axis, so an Engine
  that binds `c_PIYaw` (the Kubelwagen, the tanks) shares its steering servo
  key with the front-wheel bundle, and the first one registered sets the
  rate. This fix does not change that, and it is already noted in
  `tracked-vehicle.js`.
