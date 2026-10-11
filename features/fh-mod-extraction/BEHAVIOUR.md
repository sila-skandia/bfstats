# FH behavioural audit

Status: harness built, kit clusters triaged (2026-10-11). Partial: the vehicle,
air and spawn clusters belong to another agent; Omaha team 2 kits are open (below).
Nothing here is published.

`audit_mod.py` reads files. `tools/bf1942-models/audit_behaviour.mjs` drives
the viewer: it spawns, boards, drives, flies, fires, reloads, stands on flags.

## Running it

```bash
cd tools/bf1942-models
flock /tmp/claude-1000/chromium.lock \
  node audit_behaviour.mjs --mod fh --levels all --json out.json \
       [--quick] [--only vehicles,kits,flags,spawns,bots] [--vehicle <regex>] \
       [--url http://localhost:5310 | --port 5310] [--accepted file.json] [--static static.json]
python3 audit_behaviour.py --mod fh --quick --json out.json     # same, via the wrapper
python3 -m unittest tests.test_audit_behaviour                   # no browser needed
```

* Nothing in the harness names a mod, level, vehicle or kit: levels come from
  `maps.json`, vehicles from `objectSpawns`, kit rows from `_shared/loadouts.json`.
* Output: `{levels:[{level, vehicles_tested, vehicles_failed, kits_tested,
  kits_failed, duration_s, ...}], findings:[{check, level, template_or_kit,
  severity, cause_key, evidence, retail_faithful, accepted}], tested:[...]}`.
* Exit 1 on any unaccepted blocker/major; 2 when it could not stage. Accepted =
  an entry of `audit_behaviour_accepted.json` (each with `evidence`), or a
  finding the static audit already explains (`--static`, engine/weapon script
  absent from the install), or a cause the harness classifies itself with
  `retail_faithful: true` and the evidence in the row.
* `--quick`: up to two hulls per class, the weapon each kit spawns holding.
  Measured: Gold Beach quick 229 s (8 hulls, 10 kits, spawns, flags, 20 s of bots).
  Full kit pass: 76-490 s a level.
* One Chromium at a time (flock); a lost browser is relaunched and each phase is
  retried once on a fresh page before it is reported as `harness.phase-aborted`.

## What each check measures

| Check | How | Cause keys |
|---|---|---|
| vehicle drive | hold W 6 s; steer D 2.5 s; reversed-sign check | `veh.immobile` (retried on a second instance), `veh.steer-reversed`, `veh.no-steer`, `veh.nan-state` |
| air | ground roll; level flight hands-off from 70 m/s; back stick, roll, rudder signs | `air.no-throttle`, `air.diverges`, `air.pitch/roll/yaw-reversed|dead` |
| ship | throttle 8 s, draft against `__ships()` target | `ship.immobile`, `ship.draft-wrong` |
| seats, guns, turrets | each seat: number key, traverse and elevate by look delta, hold fire: shots, projectile or hit, weapon voice or effect sound | `veh.gun-no-fire`, `veh.gun-silent`, `veh.yaw/pitch-no-response|reversed` |
| engine sound | audio rack entry built (waits up to 20 s: a build takes about 3.5 s), engine layers | `veh.no-engine-sound`, `veh.audio-not-built` |
| wreck | destroy, step 2.5 s, `wrecked` | `veh.no-wreck`, `veh.wreck-falls-through` |
| spawns | teleport to each soldier spawn, 20 frames: falls, below terrain, not grounded | `spawn.not-on-ground` |
| flags | stand on the flag as team 1 for lose+get+4 s; owner against `controlPointStep` for the same settings | `flag.law-mismatch` |
| kits | per team and row: raise every slot (rig arrives, viewmodel true), fire (shots, clip change), zoomed fire, empty-magazine reload, weapon-in-hand weld | `kit.weapon-not-raised`, `kit.weapon-no-fire`, `kit.weapon-leaves-hands`, `kit.reload-never-completes`, `kit.no-first-person-rig` |
| any unit | page errors and 404s during the unit (an absent `*.cockpit.glb` the manifest says does not exist is not one) | `page.error`, `asset.404` |
| bots | 8 bots, N s, travelled distance, vehicles boarded | `bots.stalled` |

### The weld metric (the SVT40 class)

The weapon is a child of the right hand bone; its `*_grip` node carries the
clip's grip track. The metric is the weapon's pose in each hand bone's frame
against its rest after the raise settles, taking the better hand, flagged above
4 cm or 0.5 rad. Calibration, measured, not assumed:

| Rig | Grip in hand, rest | During a shot |
|---|---|---|
| FH SVT40 (after 93f37cb3) | (0.089, 0.027, 0.029) | unchanged, 3 mm in camera space |
| FHSW SVT40 (not re-extracted) | (0.089, 0.027, 0.029) | jumps to (0, 0, 0) for the shot then eases back over about 20 frames: the owner's defect, reproduced |

A camera-space metric was tried first and is wrong: it fired on every rifle at
16 cm because the arms and the camera kick move with the weapon. Thrown items
(`weaponStats.throw` in the rig) leave the hand by design and are excluded.

## Results, FH, kits (all six levels, full mode)

Counts are findings in the coordinator's scorecard clusters before and after the
harness fixes (the "before" is `out/mod-pipeline/fh/gates/behaviour.partial.json`):

| Cluster | Before | After | Verdict |
|---|---|---|---|
| `kit.weapon-leaves-hands` | 84-156 major | 0 on gun weapons | harness noise (camera-space metric, a rest sampled before the raise settled, throwers). SVT40, G43, Sten, K98, Garand, Mp40, Bren all 0 cm. |
| `kit.weapon-no-fire` | 10 major + 4 minor | 0 on 5 of 6 levels; 1 on Ramelle | binoculars are tools (rounds Infinity, no shots by design); `SatchelShort`/`SatchelGerShort` fire when raised cleanly in a probe on Iwo and Ramelle (rounds 2 to 1); the sweep reading was a swap-timing artefact, a retry-once is now in the harness (not yet re-run) |
| `kit.weapon-not-raised` | 7 major | 0 on 5 levels | the engineer dying to his own satchel (hp 0, items locked) and the rig arriving after the poll; fixed in the harness (respawn between weapons, wait on `viewmodel` twice) |
| `kit.reload-no-response` | 39 minor | replaced | a reload from 1 round spent is not a reload in this engine; the check is now empty magazine, R, rounds refill: 0 failures on 5 levels |
| `kit.no-fire-clip` | 8 minor | 0 | `Katana` and `GermanShovel`: their fire states name `1pFireKatanaA..E.baf` / `1pFireGermanShovelA..E.baf`, which are in no archive of the FH chain (checked with `try_read` over the whole pool); the knife has them. Install-absent, retail faithful. `M1Carbine`, `Bar1918A1Semi`, `RandomMarineEngineer2` and the other semi-autos on a looping BAR fire clip show the clip for one tick: the loop returns to `_POSE_` on release and `Ub_FireEnd` is never entered (ledger BODY-8). Marked `info`, `retail_faithful`, by the harness itself. |
| harness: 4 "browser closed" deaths, `level.harness-failure` on Omaha, 12 `harness.exception` | | | Omaha: `__soldier()` null after the vehicle phase killed the player (now `ensureOnFoot` before spawns and flags). Browser loss: relaunch, phase retry. Exceptions: `__handWeapon` throws mid rig swap (wrapped as `__hw`), hooks read null after a death. |

Kit sweep (full) after the fixes, per level `kits_failed` of 10: Gold Beach 0,
Iwo Jima 0, Prokhorovka 0, Tarawa 0 (one minor: `Mortar-G` reload plays no clip
change), Road to Ramelle 1 (`SatchelGerShort`, see above), Omaha 10.

## Open

1. **Omaha Charlie, all kits.** Team 2 reports "carries no weapon slots" for all
   five rows and team 1 has four `weapon-not-raised` and two reload misses. Omaha
   is `Conquest` only and the heaviest level; the probe that would separate "the
   kit really has no slots on the Allied side" from "the rig arrives later than
   the 7 s the harness waits" was stopped when the machine was needed. Do not
   treat as a defect or as clean. Check `levels.omaha_charlie-sector-1944` in
   `_shared/loadouts.json` and re-run `--levels Omaha_Charlie-Sector-1944 --only kits`.
2. `SatchelGerShort` on Ramelle: confirm the retry-once removes it.
3. `Mortar-G` and `Grenade97`-style reload with no arms clip: minor, untriaged.
4. Static audit gap: `audit_mod.py`'s `viewmodel-clip-absent-from-install` did not
   see Katana and GermanShovel (their fire families bake as empty `{}`); it only
   flagged Binoculars. A `fire1..5 empty` rule belongs there.
5. Vehicle, air, spawn and asset clusters (Nebelwerfer silent, Ha-Go and Kurogane
   immobile, TB3, audio-not-built on air) are the other agent's; the harness
   changes made here for them (sound via effect plays, `master>0`, retry on a
   second instance, model-less objects, `--static` cross-reference) are in the file.

## Method notes that cost time

* `window.__handWeapon()` and `__handRig()` are null for a while after a spawn or
  a weapon select: the rig is a fetch. Poll with real time as well as frames.
* A semi-auto weapon shows `clip` idle one frame after the shot; sample every
  frame (dt 1/30) or it reads as "no fire animation".
* FH's engineer carries a satchel and dies to it when thrown at his feet.
* Another session's long `audit_render` held the Chromium lock for 40+ minutes;
  `flock` is not FIFO. Plan for waits.

## Vehicle findings (2026-10-11, non-kit clusters, first triage)

Triage was cut short by the owner needing the CPU; the table says what was proven.
Harness edits (`audit_behaviour.mjs`, untracked, shared with the kit agent) are in
the working tree and not yet re-swept.

| finding | cause | state | evidence |
|---|---|---|---|
| `veh.audio-not-built` (15), `veh.gun-silent` on Ha-Go | rack builds a hull's layers one decoded sample at a time; headless software GL gave a Corsair 23 s (6 s on vanilla Iwo Jima), the poll waited 20 s | harness fixed (90 s sleep-only wait); subset re-run on Iwo Jima shows no audio-not-built | `fhveh` timing: built at 23.2 s |
| `veh.no-engine-sound` Bunker_Hill | Engine node binds no script | accepted (static audit `engine-without-script`) | static.json |
| `veh.gun-silent` Nebelwerfer, Katyusha, Werfer, AirRocket, torpedoes | rocket motor `.ssc` hangs on the projectile's child Engine; `flight_sound_names` asked only the projectile's own script | FIXED in `extract_effects.py` (`_motor_script_of`); FH `_shared/effects.sounds.json` rebuilt, +20 names, no new samples. Needs the same sound-only re-extract for vanilla (+4), XPack1 (+4), XPack2 (+4), FHSW (+77), DC (+20), DC Final (+19), EoD (+5), bf1918 (+4), GCMOD (+11), Pirates (+2), Interstate (+5), FinnWars (+5) | `tests/test_effects.py RocketMotorSoundTests` |
| `veh.gun-silent` SdKfz251 | FireArms is a tripod-MG deployer (`SdKfz251MGDeploySpawner`), magSize 1, no script anywhere | to accept (data) | Weapons.con |
| `veh.gun-silent` MXY-7 Baka | `RocketThrust` round only has `Projectile.ssc` (bullet whiz one-shots, not played by design, D12) | to accept | Weapons.con |
| `asset.404` Oma_arty.wreck.glb | `drawsMesh` counted another template's mesh (Oma_arty_bomb shells under a meshless control object); its spawner expires one every 45 s | FIXED in `vehicle-wrecks.js`; test `test_vehicle_wrecks.py` | glb extras |
| `veh.no-wreck` AltSpawn01/EastAxis/WestAxis/BarnSpawn | meshless paratroop/bridge spawn shells: no LodObject, nothing to wreck | harness fixed (meshless skipped) | scene.glb extras `geometry: None`, no mesh |
| `veh.steer-reversed` CivTrck | projection taken after 5 s of full lock (past 180 degrees) | harness fixed (read at 1 s); not re-run | |
| `air.*-reversed` (Baka, G4M2-E, N1K1-Jb, Zero in the interim run) | probes inherited the previous probe's deflected surfaces | harness fixed (36-frame neutral settle, baseline first); not re-run | |
| `veh.yaw/pitch-reversed` BT7, Stuart, PanzerIVF2 | bearing measured against the first sample's hull frame while the hull crept | harness fixed (own-frame bearing); not re-run | |
| `veh.wheels-static` KV1, UniversalCarrier | wheel-named nodes are `Spring` parts under `AnimatedBundle` tracks, as vanilla Tiger | harness fixed (tracked hulls skipped) | tree dump |
| `veh.wreck-falls-through` LVT4, Barkasse | not reproduced with the water exemption (Tarawa subset: 0 findings) | stale | tarawa.json |
| `spawn.not-on-ground` Gold Beach | old harness; now 1 of 39: `beach_spawnpoint_4` authored 1.2 m under the terrain | open (probe queued: does the soldier stand on a floor) | gold.json |
| `air.no-throttle` TB3 | 2 engines of B17 type (torque 2.6) on a 20 t hull; accelerates steadily (9.7 m/s at 16 s, throttle ramp 5/250) | looks like data (slow take-off, same engine law as G4M2-E), unconfirmed against B17; `gun-no-fire` on its bomb rack not reproduced | plane probe |
| `veh.immobile` Ha-Go Iwo Jima (pad 1094,78,-957) | hull never grounded (`g:false`) with 4 static contacts, 0.8 m above terrain 77.47; Kurogane and Chi-ha on the same base drive | OPEN: something static under that pad holds it | gnd probe |
| `veh.immobile` Kurogane Tarawa | pad 0 sits on a 3 m-high sand lump (pitch 4-8, roll swings, 0.3-0.8 m/s); pad 1 drives (13 m/s) | probably authored placement; unconfirmed | gnd probe |
| hull null after ground roll (Corsair-R, Mustang, N1K1, G4M2-E) | aircraft left the strip and was lost about 11 s into a ground roll (speed 17 m/s, still grounded); cause of the loss not identified | OPEN | plane probe |

### Nebelwerfer: carriage traverse and launch report (2026-10-11)

- Retail: the Nebelwerfer root is a static PlayerControlObject (PHY-17), and its
  `NebelwerferComplex` bundle declares `setInputToYaw c_PIYaw`, `setMaxSpeed 5/0/0`
  with no limits. A/D yaws the whole mount (seat, camera, tower, legs) at 5 deg/s;
  the hull never moves. Pak40, Pak38, Wz36, ZiS-3, mortars, howitzers and every MG
  tripod declare the same (survey: 35 stationary roots in FH). The data was in the
  level bakes all along; `viewer/seat-survey.js` `CARRIAGE_INPUT` / `turret-rig.js`
  `TurretRig.carriage` now drive it. `fbded906`'s static stamp stays.
- Sound: the FireArms has no script; the report is the first two one-shots of
  `NebelwerferRocketEngine.ssc` (`flaksmall`, `nebel1`) on the round's child Engine,
  which `extract_effects.build_sound_manifest` dropped as "loops only". Kept now for
  `motor_round_names` (motor-only rounds whose weapon has no script). Needs the
  sound-only re-extract for the other mods (same list as the row above).

### Guns that elevated and never panned (2026-10-11)

- Report: playing FH, most mounted guns could not be panned; the tripod MG42 at
  Gold Beach's `2nd_line` flag (`stationary_mg42`, pad at 1518, 40, -1109) was the
  named one.
- Cause, in the viewer, not in the level or the extract. FH's
  `StationaryMG42PointRotation` binds both mouse axes on one RotationalBundle
  (`setInputToYaw c_PIMouseLookX`, `setInputToPitch c_PIMouseLookY`, limits
  -60..60 and -70..30, 70 deg/s each). The extract carried both axes correctly
  (`rig.axes.yaw` and `rig.axes.pitch` on the one node, in `Stationary_mg42.glb`
  and in the level's `scene.glb`). `turret-rig.js` ran one `TurretAxis` per axis
  and each wrote `rest x its own angle` onto the node, so the pitch axis, stepped
  second, replaced the traverse every tick. The engine keeps the three angles
  together and poses the bundle from all of them (GUN-20).
- Vanilla splits the two over a yaw parent and a pitch child, which is why it
  went unseen: 7 of vanilla's 235 mouse-aimed gun seats had the fault (the Ju88A
  gunners, and `Stationary_Browning`, whose zero-speed dummy pitch on the
  traverse bundle was peered under the real elevation and wiped the traverse the
  same way). FH: 132 of 731 seats, every tank's bow or hull machine gun, the
  tripod MG34 and MG42, the StuG, Jagdpanzer and SU-152 main guns, the bomber
  turrets. XPack1 8 of 257, XPack2 15 of 288, Desert Combat 2 of 326, DC Final 8
  of 393, EoD 16 of 496.
- Fix: `TurretRig` gives its axes one pose table (`node -> rest, angles`) and a
  node is posed as `rest x Ry(yaw) x Rx(pitch) x Rz(roll)` from every angle held
  for it; `swingToward` (a bot's aim) turns the elevation about the traversed
  axis; `seat-survey.js` no longer makes a zero-speed axis a peer of a live one.
  No asset changes, nothing to re-extract or publish.
- Checked: `tests/test_seats.py` (the FH MG42 shape pans 35 degrees in half a
  second at 70 deg/s, elevates, does both, and `pointAlong` lands within 0.05
  degrees; the Browning's traverse bundle stays level). A sweep of every seat of
  every extracted model through `surveyVehicle` + `TurretRig` (push the mouse each
  way for a second, compare the gun's and camera's line): after the fix every gun
  seat that binds both mouse axes moves on both, in all seven trees, except
  XPack2's Wasserfall, whose launcher points straight up, so its traverse turns
  the rocket about its own line.
- Checked in the page (headless Chromium, `map.html?...&shots=1`, deployed,
  seated through `__enterSeat`, `__lookDelta` 30 counts a frame for 20 frames
  right, 20 up, 60 left; the gun's line read in the hull's frame), with the
  two modules served from before the fix and then as fixed:

  | gun | build | after right | after up | after left |
  |---|---|---|---|---|
  | FH Gold Beach `Stationary_mg42` at `2nd_line` | before | yaw 0 (servo at 56.7) | yaw 0, pitch -57.7 | yaw 0 (servo at -60) |
  | | fixed | yaw 56.7 | yaw 56.7, pitch -57.7 | yaw -60, pitch -57.7 |
  | vanilla Berlin `Stationary_Browning` | before | yaw 0 (servo at 70) | flipped over: the 70 degrees of elevation applied twice | the same |
  | | fixed | yaw 70 | yaw 70, pitch -70 | yaw -70, pitch -70 |

  The vanilla tripod Browning was as fixed in place as FH's MG42, and its
  elevation ran at twice the rate, past vertical.
- Open, seen in the same sweep and not faults of this kind: FH's `Sturmboot`
  binds a `c_PIMouseLookY` bundle with no gun and no camera under it; 21 torpedo
  mounts and the tower spotlight traverse only, and seven seats (CharB1's hull
  gun, the SdKfz 251 rocket frames, Wurfgerat 40) elevate only, all as authored.

