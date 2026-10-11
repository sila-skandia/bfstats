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
