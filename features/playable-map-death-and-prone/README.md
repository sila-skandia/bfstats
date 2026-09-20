# Three fixes on the playable map

Asked for 2026-09-20, against `tools/bf1942-models/viewer/map.html` and the two
modules under it. All three are one round: a death that ends in the spawn
screen, a row of floating rifles that should never have been there, and the
prone slide BF1942 actually has.

## 1. You die with the vehicle, and the death cam shows the crash

**Was:** the hull exploded, HP-15's input gate refused the controls, and the
player sat inside a burning wreck with nothing to do until it faded. Nothing
killed him; nothing opened the spawn screen.

**Now:** `wreckVehicle()` calls `killOccupantInWreck()` before it tears the seat
down — the one place a vehicle dies, whatever killed it (a shell, the burn-down
from `hpLostWhileCriticalDamage`, drowning, the combat area). That reads the
hull's live pose, empties the seat through `leaveManned()` (which delegates to
`leaveVehicle()` for anything with a drivetrain, so one call covers a jeep, a
tank, a plane and a bare manned gun), puts the suspended on-foot body down at
the vehicle's own `soldierExitLocation`, takes its Armor to zero, and latches
the death cam. `onFoot()` owns the rest — the same countdown and the same
`openDeploy()` a death on foot already ran through.

The engine side is `subsystems/hitpoints-and-damage.md` §7: the client opens the
spawn screen on local death (`FUN_004933d0` → `SpawnScreenStuff::setVisible`).
The beat in between is not decoded and never was, so the framing is house rules,
and they are now two named shots rather than one set of literals:

| | lift | back | pitch | beat |
|---|---|---|---|---|
| `DEATH_CAM.foot` | 3.5 m | 0 | −0.9 | 1.2 s |
| `DEATH_CAM.vehicle` | 4.5 m | 7.5 m | −0.55 | 3.0 s |

The subject differs, which is the whole reason for two: on foot it is the body
that just fell over and the camera floats straight above it; in a vehicle it is
the burning hull (`deathCamTarget`), so the camera pulls back behind the wreck
and holds long enough to watch it. Measured on Berlin, the hull projects to NDC
(0.000, 0.019) — dead centre — and a ray down the view axis hits
`T-34_Hull_M1` at 6.7 m.

One thing fell out of this that was already wrong for the on-foot death:
`openDeploy()` set `deployRejoin = !!soldier`, so RESUME offered to hand the
player back a corpse and `Kit/IsAlive` said he was alive. It is now
`!!soldier && !soldierDead`.

A free-fly pilot (the debug checkbox, no soldier waiting) has no life to lose:
the seat still empties and the camera goes back to the flythrough.

## 2. The floating assault weapons are gone

Every level with soldier spawns had a rifle hovering at chest height on each pad
— twenty-eight of them on Berlin, the Sg44 on the Axis side and the BAR on the
Allied.

They were meant to be people. `placeSpawnSoldiers()` cloned
`<Soldier>__<assault primary>.pose.glb` onto every pad so a flythrough would
have figures in it. But `Object3D.clone()` **does not rebind a skeleton**: every
clone's `SkinnedMesh.skeleton` still pointed at the template's bones, and the
template is not in the scene, so all 28 bodies skinned to the same spot near the
world origin. The weapon is a plain `Mesh` parented into the *cloned* bone tree,
so it alone travelled with the clone. Proven in the page before the fix:

    n0BodyBone: { name: 'Bip01_Spine3', world: [0, 1.48, 0.02], inClone: false }
    n0Gun:      [1809.67, 40.27, -1810.58]
    n1Gun:      [1806.59, 39.99, -1778.59]
    sameSkeleton: true

They are removed rather than rebound with `SkeletonUtils.clone()`. The pads are
empty in the real game, this is a playable map now rather than a flythrough, and
a motionless mannequin on every spawn point is not something a player should
walk into. `splashTargets()` loses them as grenade targets; the player's own
body and every vehicle are still in that list.

## 3. The prone dive, and where it comes from

**PHY-7**, new. `BFSoldier::handlePlayerInput` (lnxded `0x08273c70`) does not
reach `directionalSpeed` unscaled. Before the tables it runs both state
machines' `AnimationStateMachineInstance::checkTransitions(input, float&,
float&, float&)` and keeps the **lower body's** three floats — the `iVar20 == 0`
arm of the two-machine loop — and the first survives as a multiplier:

    vCmd = soldier[0x4b] * directionalSpeed[pose*2 + (ramp <= 0)] * stateSpeed

The three floats are that state's own `AnimationStateMachine.setSpeed <fwd> <?>
<strafe>`. Every walk, run, stand, crouch and lie state in
`animations/AnimationStates*.con` declares `setSpeed 1.0 1.0 1.0`, so the
multiplier is inert — with one exception, in `AnimationStatesLie.con`:

    AnimationStateMachine.createState Lb_RunStandToLie
    AnimationStateMachine.addAnimation Animations/Lie/LowerBody/3PJump2LieLower.baf 1.5 c_AsmPlayOnce
    AnimationStateMachine.addTransitionWhenDone Lb_Lie
    AnimationStateMachine.setSpeed 6.0 1.0 1.0
    AnimationStateMachine.setFlag c_AsmIsLying

That is the dive, and it is the whole of the prone slide. `BFSoldier::getPose()`
(`0x0827ddc0`) reads the animation machine's own current state flags, so
`c_AsmIsLying` means the pose is already PRONE for the whole of it and the table
hands out 1 m/s — times 6.0, which is exactly the standing run. You keep running
speed for the length of the clip, then drop to a crawl when `Lb_Lie` takes over.

`3PJump2LieLower.baf` is **11 frames** and the state plays it at **1.5x**, so at
the same nominal 26 fps `STANCE_TRANSITION` is derived against the dive lasts
**0.282 s** — about **1.7 m**. (`3pAnimationsTweaking.con` separately says
`set3pAnimationSpeed Lb_RunStandToLie 1.40`, which would make it 0.302 s; the
`addAnimation` rate is used, for consistency with the rest of that table, and the
two answers are 20 ms apart.)

Which of the three routes to the floor you get is decided in the same function:
it multiplies the forward input by the *current* state's own forward speed and
branches on the sign. Backward gives `Lb_StandToLie`, from a crouch gives
`Lb_CrouchToLie`, and both declare `setSpeed 1.0 1.0 1.0` — no slide at all.
Standing still takes the dive branch too, and simply has no ramp for the 6.0 to
multiply.

Carried as `DIVE_SPEED_FACTOR` / `DIVE_DURATION` and
`SoldierBody.setStateSpeed(factor, seconds)` in `physics.js`, chosen in
`soldier.js`'s `#applyStance`. The eye takes the same 0.282 s down, because it is
one animation state, not two.

Measured, in the node harness and again in the page:

| | distance over 0.282 s |
|---|---|
| run, then Z | **1.70 m** |
| the same span once `Lb_Lie` has taken over | 0.283 m |
| backing up, then Z | 0.283 m |
| from a crouch, then Z | 0.283 m |

### One thing read on the way that is NOT acted on

The same decompile shows the ramp register reaching the table **squared**:

    r     = ramp / 127
    vCmd  = sign(r) * r * r * table * stateSpeed        (0x082749xx)

`physics.js`'s `rampedDirectionalSpeed` and the ledger's PHY-6 both have it
linear. Squaring it changes the shape of every standing start on the page, which
is a movement-feel change well outside what was asked for here, so it is
recorded and left alone. Settle it before anyone touches the ramp again.

## Verification

- `python3 -m unittest tests.test_soldier tests.test_physics` under
  `tools/bf1942-models` — 91 tests, including three new ones for the dive.
- Live, on Berlin, through the page's own keyboard and deploy paths: the
  `soldierSpawns` group is gone; a T34 killed under the player leaves him dead
  beside the wreck with the camera 4.49 m up and 7.50 m back at pitch −0.55 and
  the wreck dead centre, and the spawn screen opens at **exactly 3.00 s**; the
  on-foot death is unchanged at 3.5 m / −0.9 / 1.17 s; Z at a run slides 1.70 m.

A caution for anyone verifying this in a browser: `map.html` imports
`./physics.js` and `./soldier.js` with no cache buster, and a plain reload keeps
the old modules. `await fetch('./physics.js', {cache:'reload'})` before
`location.reload()`, or check
`(await import('./physics.js')).DIVE_SPEED_FACTOR` before believing a null
result.
