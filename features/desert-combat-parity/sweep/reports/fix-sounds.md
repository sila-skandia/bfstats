All four items are built and committed on `worktree-agent-a20481fc1ba4e03dc` (5 commits, 31 files, nothing pushed). Release tails, reload foley, vehicle gun tails and part sounds now play in code, but every tree needs re-extracting and re-patching before anyone hears them. The commands are below.

## What was wrong and what changed

**1. Hand-gun release tails.** The extractor already wrote them; every tree simply predates commit 75edb204. I re-extracted all five in-scope trees into scratch. DC's M16 now carries `M16_release` and the AK47 `akm_release`; tails appear on 25 DC weapons, 26 DC Final, 14 vanilla, 18 XPack1 and 20 XPack2. No other field moved. A test now pins the shape on DC's own M16 script.

**2. Vehicle gun tails (D9).** As you said, the trigger already existed, so I added no second one. The real cause was that it found no data on any tree, vanilla included. Both gun lookups in `ssc-specs.js` rebuilt each gun's spec and left out the press and release edges, so the rack built none. They now carry them. A new harness runs the gun cycle and the rack together the way `map.html` wires them:
- one spin-up per press, no release while the trigger is held, one release per burst, slot 4 only when its gate opens;
- its sweep starts every edge sample of every level: vanilla 230 guns, DC patched in scratch 565, DC Final 741. DC's live tree has 0 because its scenes predate the edges.

**3. Reload foley.** I read the engine: `FireArms::Reload` (lnxded 0x08289d80, client 0x00539c80) triggers patch 1 once, at the start of the magazine change. It is recorded as ledger SND-17.
- **Extractor:** each weapon now ships a `reload` entry: one mp3 per load, each with its `Time` delay, plus the layers bystanders need.
- **Your shot:** one line in `startReload`, which R and the dry-magazine change both go through.
- **Bots:** one hook call in `bot-referee.js`, then `map.html` → `page-audio.js` → `world-fire.js` plays it at the bot.
- **Seated guns:** the rack triggers the gun's reload patch when its reload timer starts. Only a few have one: DC's TOW and Spandrel, XPack1's M3 Grant, DC Final's PKM and helicopter racks.
- Nobody else hears a reload: every one of vanilla's 239 reload loads, and 563 of DC's 573, fades to nothing past 1 m in the game's own data.

**4. Part sounds.** I read both binaries and recorded ledger SND-18 to SND-23:
- every object's patches start once when the client builds its sound;
- a turret or gun mount (RotationalBundle) plays while it turns, with `Default` set to its turning rate in degrees per second;
- a landing gear plays patch 0 going up and patch 1 coming down;
- flaps, tracks and the M-109's seat play from creation for good, with `Default` 0;
- a patch can be pressed and let go over and over.

The extractor ships these parts keyed by node in `sounds.vehicles[].parts` and in `vehicle-sounds.json`. `engine-audio.js` gained a mode that follows that press-and-release behaviour, and `vehicle-audio.js` plays each part by its class rule. Every part loop goes through `resolveAcross`, so an M1A1's two `moderntreads` tracks are one voice.

## Tests and measurements

- **Part harness:** the M1A1 turret servo is silent at rest, full volume at pitch 0.6 at 20 deg/s, silent the frame it stops and back on the next turn. It also covers the tracks, an A-10's gear (including a leg the page snaps in one frame, which plays nothing) and its flap.
- **Coherence sweeps with parts included** (every turret turning, gear travelling, hull at 8 m/s), on trees I patched in scratch: no offences anywhere.

  | Tree | Arbitrated (before parts) | Part loops heard |
  |---|---|---|
  | vanilla | 731 (279) | 3,409 |
  | DC | 1,229 (100) | 5,384 |
  | XPack1 | 909 | 4,272 |
  | XPack2 | 877 | 4,486 |
  | DC Final | 1,831 | 7,973 |

  The in-patch sweep is also clean on vanilla, DC and DC Final.
- **Page probe** (headless, under the browser lock, port 5623, now stopped; patched scenes served without writing the shared tree):
  - Sherman tower loops come up while traversing and go quiet after it stops.
  - DC M1A1 servo plays at 0.415, pitch 0.584 at 8.4 deg/s; the script predicts 0.417 and 0.584.
  - A Spitfire's gear retracts on patch 0 and reverses onto patch 1 with the end clunk.
- **Full Python suite:** 4,608 tests, 3 failures. All three are the published-table check in `test_extract_vehicle_sounds` for bf1942, XPack1 and XPack2, which compares against the live tables and fails until those trees' sounds layers are re-patched.

## Commands for you (from `tools/bf1942-models`, main checkout, after merging)

```
python3 extract_weapon_sounds.py --mod bf1942 --out viewer/models/sounds
python3 extract_weapon_sounds.py --mod XPack1 --out viewer/models/mods/xpack1/sounds
python3 extract_weapon_sounds.py --mod XPack2 --out viewer/models/mods/xpack2/sounds
python3 extract_weapon_sounds.py --mod DesertCombat --out viewer/models/mods/desertcombat/sounds
python3 extract_weapon_sounds.py --mod DC_Final --out viewer/models/mods/dc_final/sounds
python3 patch_scene.py --layer sounds --mod bf1942 --all
python3 patch_scene.py --layer sounds --mod XPack1 --all
python3 patch_scene.py --layer sounds --mod XPack2 --all
python3 patch_scene.py --layer sounds --mod DesertCombat --all
python3 patch_scene.py --layer sounds --mod DC_Final --all
scripts/publish-mesh-delta.py models
scripts/publish-mesh-delta.py maps --hash
```

- **Weapon sounds:** about 340 to 850 new mp3s per tree, 2.0 to 6.0 MB.
- **Sounds layer:** the scratch runs had no failures; DC added 57 new shared samples (0.75 MB), vanilla 17, DC Final 6.

## Files outside the package list

- `hand-fire.js`, one line: `startReload` now lives there, not in `hand-weapon.js`, which I did not touch.
- `bot-referee.js`: one hook call and one doc line.
- `map.html`: the `onReload` hook in the bot setup and one `fireStates` getter for page audio.
- Also `page-audio.js`, `ssc-specs.js`, `ssc-curves.js`, `gun-cycle`-free tests, the ledger and `symbols.json`, both skills, `features/README.md`, and a new folder `features/hand-weapon-sound-edges`.

## Rows for `desert-combat-parity`

- **A2:** built for both hand and vehicle guns; data pending your commands.
- **A3:** built (SND-17); data pending.
- **A6:** built (SND-18 to SND-23); data pending.

## Still open

- What feeds a part's `Speed` and `Acceleration` in the engine was not traced. A part uses its hull's motion.
- Replayed soldiers' reloads are not wired; that is the `replay*` session's files.
- EoD and FHSW were not re-extracted (out of scope). FHSW has tails but no reload.
- **For the air package:** boarding the Corsair on Midway's carrier plays one gear clunk because the legs really twitch. `aircraft.js` `autoGear` retracts on height alone (the deck is 38.8 m up) and never reads `gearUpEngineInput`, which the engine also requires (SND-21).

All scratch output, logs and probe scripts are in `~/.cache/dc-sweep/sounds/`; the build records are D11 in `features/vehicle-sound-coverage/README.md` and the new `features/hand-weapon-sound-edges/README.md`.