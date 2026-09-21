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

## Adversarial review

Re-derived on port 5334, worktree tree against a `git archive 2883708` copy of
the pre-fix tree on the same port. Suite 2,265 green.

Reproduced as claimed, before and after:

| | pre-fix | this branch |
|---|---|---|
| Battle of Britain at load, streak templates drawing | 15 (4 Spitfires, 11 Brownings, named) | 0 |
| Spitfire, trigger held, E | `e_MuzzHeavy_10`, `em_1P_MuzzHeavy_10`, `e_MuzzHeavy_11` still lit 4 s later | none |
| Sherman, trigger held, E | 7 lit, the cannon's blast smoke and puff included | none |
| Spitfire: fly, hold the trigger, be destroyed, wait out the delay | respawns with all three lit | respawns dark |
| Aberdeen Sherman: fire twice, be destroyed, respawn, re-enter (`Ammo/PrimaryAmmo`) | 28 of 30 | 30 of 30 |

Three corrections and one addition.

**The recoil number is wrong.** `snapexit.mjs`, the stream's own script, exits
on the first frame the barrel is displaced and leaves the Sherman's
`ShermanGunBarrel` standing **0.26667 m** out of battery for the rest of the
level, not 0.100 m. The defect is larger than the write-up says; the fix zeroes
it either way.

**The audio branch is unreachable, but the change is still right — for another
reason.** Across all 277 shipped levels (vanilla, EoD, XPack1, XPack2) and
4,296 spawn templates, 3,985 of them drivetrain, exactly 17 drivetrain vehicles
have no `sounds.vehicles` entry and **none** of those 17 has a FireArms name
matching a weapon patch elsewhere in its level — so `setupEngineAudio`'s
no-spec branch never builds a weapon patch, and the leak the commit message
describes cannot happen in any shipped data. What the unconditional teardown
*does* fix is reachable: `leaveVehicle` never clears `aircraft`/`car` (they are
only nulled when entering a different vehicle, `setPilot` ~6743, and on a level
switch, ~12620), so an engine load still in flight at the moment of an exit
passes `setupEngineAudio`'s `(!aircraft && !car)` guard and starts the engine
and its gun patches on a vehicle nobody is in. Before this commit nothing tore
that down until the next entry; now the pending generation-guarded teardown
does, 2.4 s later. UNVERIFIED on the page: it needs a load slow enough to
straddle the exit.

**The wreck and level-load wirings were carried by no test.** Deleting both
`idleFirePose(visual.node)` / `idleFireState(...)` from `respawnVehicle` and
`idleFirePose(currentRoot)` from the load sweep left all ten of the new tests
green and the whole suite byte-identical. `IdleVehicleWiringTests` now pins all
three call sites on `map.html`'s source, the way `test_map_entry` pins its own,
and bans a fifth hand-rolled `guns.groups.splice` from growing back in
`collectGuns` / `collectMannedGuns` / `releaseGuns`.

**The latch had a fourth limb: the emitter's own transform.** `advance` does
not only strobe a flash, it *places* it — `basePos + drift` along the direction
of fire for anything declaring `offsetInDof`/`speedInDof`, and a billboard
quaternion for anything declaring `billboard` — and both stop dead when the
group leaves the index. Hiding the node does not put either back, and
`GunFire.collect` re-reads `basePos`/`baseQuat` **off that node** on the next
entry, so the drift is re-baked as the authored placement and the emitter walks
one more drift from its muzzle every enter-fire-exit cycle, permanently. 589 of
the 3,998 published glbs carry such an emitter (206 vanilla, 383 across the
three mods).
Measured on Kasserine Pass' AA_Allies, whose `Em_MuzzAAgunB_WSmoke` declares
`speedInDof 10` over a 0.5 s life, local z:

| | authored | 1 cycle | 2 cycles | 3 cycles |
|---|---|---|---|---|
| pre-fix | -1.0 | -1.667 | -5.0 | -8.333, and still drawn |
| this branch before review | -1.0 | -1.667 | -2.0 | -2.333, hidden |
| with the restore in `release` | -1.0 | -1.0 | -1.0 | -1.0 |

`GunFire.release` now puts every emitter back on its own `basePos`/`baseQuat`
and back to `age = Infinity` before `idleFirePose` runs. Two harness cases and
two tests cover it; removing the restore fails both.

Checked and clear:

- **Nothing goes dark that should still be firing.** No vehicle in vanilla or
  any of the three mods has a FireArms node nested inside another (all 64
  nested cases across the 3,998 glbs are bayonets and knives, hand weapons that
  never reach `release`), so `idleFirePose(group.node)` can never reach a
  second group's payloads. Rounds already in flight are parented to the scene
  by `#adopt`, not to the gun, so the "they finish their flight" contract is
  untouched. Seat switch mid-burst, captured on Aberdeen: leaving the hull
  gunner's `Browning` with the trigger still down puts its flash out and lights
  the driver's cannon and coaxial on the same frame, which is right.
- **Netcode and replay.** `world.setPlayerVehicle` is only ever called for
  `LOCAL_PLAYER`, `netcode-render.js` contains no gun plumbing at all, and
  `replay.js`'s groups are soldier clones collected with `replace: false` that
  no `release` site can name — `collectGuns`' foreign filter, `releaseGuns` and
  `collectMannedGuns` all iterate `vehicleGuns`/`mannedGuns` only.
- **The `world.js` exclusion holds, by ordering.** `releaseGuns()` and
  `world.clearPlayerVehicle(LOCAL_PLAYER)` sit in the same synchronous function
  on every exit path (`leaveVehicle`, `leaveManned`, `setPilot(false)`, and
  `killOccupantInWreck`, which delegates to `leaveManned`), with no await
  between them, so no world tick can re-engage a released group.
- **`viewmodel-anim` and the seat occupant.** `fireLoops`/`fireRunning` occur
  only inside `hw.*` hand-weapon code; `seatPoseActions` is `lower`/`upper` and
  nothing else.
- **`idleFirePose` reaches everything, not just what the build loaded.** Ships
  (Midway's Hatsuzuki: three flash emitters lit, none after the exit, all three
  recoil nodes home), a Sherman's nested hull gunner, and EoD's Cobra on
  `?mod=eod` all come back idle; the EoD load sweep reports 0 drawn payloads.
- **`FireState.reset()` is complete** — ammo, magsLeft, heat, reloadRemaining,
  overheatRemaining, and the `unlimited`/`hasHeat` derivations — and the
  respawn really does reuse the node: `wreckVehicle` only hides
  `visual.node`'s children and adds a wreck beside them.

One caveat for anyone re-running the stream's scripts: `scenario.mjs` probes by
node *name*, and on a map carrying several instances of a template the first
match need not be the `owner` it entered. On `?mod=eod` Aces Over Vietnam two
more nodes named `EoD_Cobra` appear mid-run and the probe silently switched to
one of them. Probe by owner.
