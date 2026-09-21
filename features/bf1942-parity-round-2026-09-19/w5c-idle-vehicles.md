# W5-C: a vehicle nobody is in is not firing

The owner: "When a tank or plane spawns, or you exit one while firing, the
firing animation still appears on the plane or tank. I've seen it with the
spitfire where you were flying it and crashed. When it respawns you see it in
the firing state."

## What was wrong

One latch, three ways in. A gun's firing state is not a flag anywhere; it is
spread across scene nodes that outlive every object that drives them, and
`GunFire.advance` is the only thing that ever puts any of them back:

| Where it lives | Who resets it | Why that stopped happening |
|---|---|---|
| a baked flash emitter's `visible` (`userData.effect`) | `advance`, at the emitter's own `timeToLive` | `releaseGuns()` splices the group out of `guns.groups` the instant the seat empties, so `advance` never looks at that gun again |
| the barrel's `position` (`userData.home`) | `advance`, over `recoil.size / recoil.speed` seconds | same splice, mid-recovery. The next entry's fresh group starts at `recoil = 1` (home), so nothing ever writes the position again |
| the streak template's `visible` (`userData.tracerMesh`) | `GunFire.collect`, on entry | nothing hid it at level load: that sweep named `effect`, `projectileMesh` and `projectileTrail` and not this |
| `FireState` ammo / heat / reload (seats.js) | nothing | held in a `WeakMap` keyed on the FireArms node, and a respawn reuses the node |

`wreckVehicle` then hides the intact hull with those `visible` flags intact and
`respawnVehicle` turns the whole subtree back on, which is the owner's Spitfire
exactly.

Not implicated, and worth saying because they are the obvious next questions:

- **The seat occupant.** `seatPoseActions` is `lower` and `upper` only -- the
  seated soldier has no fire clip to be stuck in -- and `disposeSeatPose()`
  runs on every exit path, so there is no occupant on an unoccupied vehicle at
  all. Measured: `__seatSoldier()` is `null` after the exit.
- **`viewmodel-anim.js`'s `fireLoops` / `fireRunning`.** Entirely the soldier's
  first-person viewmodel (`hw.*`); no vehicle reaches it.
- **Audio.** Measured on Aberdeen under the default autoplay policy with a real
  click: seated and quiet, 3 live buffer sources (the level's ambient); trigger
  held, 12 with a 9-voice engine bus; after the exit, back to 3 with the engine
  bus and all weapon patches gone. One latent hole closed anyway --
  `stopEngineAudio` returned early with no engine bus, skipping the teardown of
  weapon patches that `setupEngineAudio`'s no-spec branch builds without one.
  No vanilla vehicle on Aberdeen takes that branch.

## The fix

`viewer/idle-vehicle.js`, framework-free so it runs under node:

- `idleFirePose(root)` -- payloads dark, guns at home. Idempotent.
- `idleFireState(root, lookups)` -- full magazine, cold barrel, no reload. For
  a respawn only: stepping out of a half-empty tank and back in is the same
  object and keeps what it spent.

Called from where the state lives rather than from any one exit path:

- `GunFire.release(group)` (gunfire.js) -- trigger off, out of the index, then
  `idleFirePose`. Replaces four copies of trigger-off-and-splice in map.html.
- `respawnVehicle` -- both functions, on the whole hull.
- the level load sweep -- `idleFirePose(currentRoot)`.

## Numbers

Served on :5333, headless SwiftShader, `?shots` + `__renderOnce`.

| | before | after |
|---|---|---|
| Battle of Britain at load, streak templates drawing across the level | 15 (4 Spitfires, 11 Brownings) | 0 |
| Spitfire, trigger held, E: emitters left lit | `e_MuzzHeavy_10`, `em_1P_MuzzHeavy_10`, `e_MuzzHeavy_11`, still there 4 s later | none |
| Sherman, trigger held, E: emitters left lit | 7, the cannon's blast smoke and puff included | none |
| Sherman, exit one frame into the cannon's recoil | barrel 0.100 m out of battery, permanently | 0 |
| Spitfire: fly, hold the trigger, be destroyed, wait out the spawn delay | respawns with all three flashes lit | respawns dark |

The `before` rows were taken by disabling `idleFirePose` inside
`GunFire.release` and re-running the same scripts.

## Tests

`tests/test_idle_vehicle.py` + `tests/idle_vehicle_harness.mjs`: ten cases, one
per entry point plus the module's own contract, on the real `GunFire` and a rig
shaped the way the exporter arms a tank. Disabling the reset fails three.

Suite: 2,260 green (`python3 -m unittest discover -s tests`).
