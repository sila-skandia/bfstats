# Bot stalemates

Reported 2026-09-24 on Bocage: after pushing out to the bridges, both sides
stopped. A Sherman and a Tiger plus a PanzerIV faced each other with nobody
firing (the Axis tanks above the Sherman, which aimed up and overshot); an
M10 at the lumber mill kept shelling the building it was pressed against;
three Allied soldiers stood still with their guns out.

## What the runner showed

Bocage, 8 a side, 420 s, seeds 1..4 (`sim/run.mjs --trace-every 3`), with the
approach's S terms traced (`fa` on each tick line) and main-gun rounds counted
per gun (`summary.json` `metrics.vehicleFire.byGun`):

| cause | where | engine? |
|---|---|---|
| A tank holding S for minutes and never firing: its single-shot trigger fires on the tick the miss *grows* (`BAPCConPrecision` 0x0854b570, ported exactly); the viewer's miss shrinks smoothly forever as the S-curve count fades, and the urge curve rebuilds the plan (and its minimum) every ~4 s | every tank; an M10 fired 3 rounds in four matches | the law is the engine's; the engine's miss jitters |
| The turret yanked off the target every ~4 s: `UCFire` falls under MoveTo's 3.0 at 4.1 s, MoveTo wins a tick, and its look-ahead (AI-123) swings the turret down the hull at full count; the M10 (aim scale 1) never won the 2 deg back | slow turrets | the engine's too (AI-129) |
| A tank inside `mid` (min + 50 m) whose aim is outside the -20 .. 5 deg window holds forever: a Tiger 10..14 deg above its target | the reported Tiger / PanzerIV | the engine's too; the viewer's window was also in the wrong frame (AI-128) |
| A hull against a building sees over it from its camera, holds S and shells the wall | the reported M10 | the engine's too: S reads only the memory record |
| A soldier walking at a tank's door, which stands on the hull's centreline, from the front or back: the hull stops him 4.4 m from the 3.5 m door | two Axis soldiers at a Tiger for 170 s | viewer: the engine walks to 6.25 m of the vehicle and holds Use within 12.375 m |
| A soldier leaving the Allied AA gun re-spawned beside it, inside its sandbag ring, and routed out over the bags | the reported soldiers standing still | viewer: the human steps out at `setSoldierExitLocation` |

## What changed

- `bot-plans.js approachAimValid`: the pitch against the hull's up axis
  (ENGINE, AI-128).
- `bot-aim.js PRECISION_SETTLE`: a single-shot aim closing by at most 2 mm a
  tick has settled; inside the precision it fires (INVENTION).
- `bot-plans.js execMouseTurretLookAt`: a tank with a seen firing target keeps
  its gun on it while MoveTo drives (INVENTION).
- `bot-plans.js execFireApproach`: S also needs a clear line from the barrel
  (`muzzleClear`); after 2 s without S inside `mid` the tank moves, toward the
  target when it is too low, unseen or behind cover, away when it is above
  the gun's elevation (`backOffGoal`) (INVENTION, `FIRE_UNBLOCK`).
- `bot-mount.js doorApproach`: the walk to a door ends beside the hull, on
  the soldier's side (INVENTION, `DOOR_APPROACH`).
- `bot-units.js units.leave` / `bot-referee.js leaveVehicle`: a bot steps out
  at the seat's `setSoldierExitLocation`, as the human does (CON).

The runner also traces the approach (`fa`: move, distance, the S terms, the
muzzle line, the hull-frame pitch) and tallies rounds per gun.

## Measured

Bocage, seeds 1..4, 420 s, the main checkout's viewer (before) against this
branch (after), the same runner:

| | before | after |
|---|---|---|
| M10 main-gun rounds | 3 | 43 |
| Tiger / Sherman main-gun rounds | 77 / 66 | 83 / 71 |
| hulls wrecked | 26 | 29 |
| tank drivers in Fire, not firing, in 20 s+ stalls | 1143 s | 719 s |
| tank drivers holding S without firing (traced S terms, seeds 1..3) | 946 s with ~1 round a stall | the trigger down on 16..48 % of such ticks |

## Still open

- The Sherman firing high at a tank on a crest is the fire correction
  (AI-105): a short round raises the aim by a tenth of the distance, and the
  next round over pulls it back. The engine's law, left as is.
- Soldiers at their own base, riders in a parked vehicle and drivers at
  their order point stand and scout: base-defence orders from the SAI, as in
  the engine.
- A Kübelwagen stuck in MoveTo near the Axis bridge (seed 3) is the hull stall
  already open (the Priest at the west bridge).
