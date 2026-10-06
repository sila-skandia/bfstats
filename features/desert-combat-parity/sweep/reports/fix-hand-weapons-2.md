All five items are done, plus the multi-barrel charge you added, in seven commits on `worktree-agent-a10adb9500e8e7c21`. Item 5 needed no code change: the viewer already starts a round's first sweep where retail does. The page sees the camera shake, the grenade charge and the shotgun's one-shell charge only after the viewmodel re-extract below.

**Merging onto main (a8bbe93e):** there is one conflict, in `ledger.md`, and both sides only add rows after GUN-16: keep both. Main's engine-reads work took GUN-17 for the stabilization words, so I renumbered my rows to GUN-18 and GUN-19 (`452f362d`). The suites I touched pass on the merged tree.

**1. A refused pull restarts the lockout (GUN-18).**
- **What was wrong:** `FireState` started the lockout on the round that crossed heat 1 and never restarted it. The binary only lets a pull reach `Fire` once the reload, the lockout and the fire timer are all spent. `Fire` refuses a pull at heat 1 or more and starts the lockout again.
- **Fix:** a new `FireState.trigger(held)` call, made before `step`. The heat's tick loop ends each tick with the held pull. `hand-fire.js` and `world-vehicle-tick.js` report the trigger, two small hunks in the vehicle file. The heat is now float32, as the engine stores it.
- **Result:** checked against the binary's law emulated in float32.

| Gun | First refusal, engine | Before | Now |
|---|---|---|---|
| M249 | 61 | 60 | 61 |
| PKM | 51 | 50 | 51 |
| MG42, Browning, coax | 38, 38, 25 | same | same |

  - Total rounds over a 30 s hold now match the engine, and the seat guns fire on its exact ticks.
  - A held trigger after the first lockout fires 0.2–0.3 rounds a second, down from 0.4–0.5.
  - Letting go on the crossing round no longer locks the gun.
- `replay-hud.js` never reports a trigger, so it keeps the old lockout-at-crossing rule.

**2. Weapon fire camera shakes (CS-8..CS-11).** Read in both binaries:
- how a shake fades, chains through its slots and ends;
- only entering a different state restarts it, so a looping automatic shakes once per burst;
- cloned states carry no shake;
- `Camera::getTransformation` applies it to the drawn view only, never to where rounds launch.

What was built:
- `bf42/animstates.py` parses the shake lines.
- `extract_viewmodel.py` writes them into `clips.<family>.cameraShake`.
- A new `viewer/fire-shake.js` runs the engine's law.
- `hand-fire.js` steps the shake, and `map.html` puts it on the camera around the world and viewmodel renders only.
- **Reload fix:** I also made `startReload` wait for the last round's fire cycle (BODY-7). Without that a dry Bazooka reloaded on the next frame and cut its fire state and shake short.
- **In the page** (scratch Bazooka served in): the shot moves the drawn view up to 1.19 m and 0.63° for 20 frames, the rounds stay on the steady camera, and the No4 sniper sways 0.20° while aiming.

**3. Grenade hold-to-charge (GUN-19).** The fire button sets the heat to 1.0 and throws at full strength. Holding alt-fire adds 0.03 a tick, full after 34 ticks. Letting go throws at `velocity × heat` after the `fireDelay` wind-up. Built in a new `viewer/throw-charge.js` and `hand-fire.js`; the HUD bar shows the charge. In the harness, half a second of charge throws at 0.45 of the velocity.

**4. A kit off the ground keeps its heat (KITDROP-9).** Read in the binary: dropping disables the gun, which keeps its heat and lockout, and a disabled object is skipped by `updateObjects`, so it does not cool on the ground. This settles GUN-16's inference. I also corrected one detail there: `enable` posts a message rather than re-registering the item. The fix carries heat and lockout through the kit's rows in `kit-ammo.js` and `kit-drops.js`.

**5. Where the first sweep starts (IMP-8).**
- **Engine:** the round is born at the spawn point. The physics moves it on the tick it is fired, before collision sweeps `pos − v·dt → pos`. So the 0.73 m from the eye to an RPG-7's spawn point is never tested.
- **Terrain:** it only counts a segment crossing its surface from above. A rocket born under a slope steeper than about 22° runs on underground.
- **Viewer:** `projectile-flight.js` and `world-collider.js` already behave the same way, so `round-launch.js` is untouched.

**Multi-barrel charge (your add-on, BOMB-13).** `onShot` now charges what `salvo()` returns, and `roundsLeft` answers the hand weapon's own rounds. A `blastAmmoCount` weapon pays one round per pull. Two barrels now cost two rounds (one before), and a two-barrel gun fires only one barrel on its last round. Main's `salvo()` takes the flag, and the merged tree passes.

**Tests:** new suites `test_fire_shake`, `test_grenade_charge` and `test_hand_fire`; extended `test_hand_heat`, `test_animstates` and `test_hud`. The full suite ran 4,728 tests with 3 failures, all `test_extract_vehicle_sounds` published-table checks (bf1942, XPack1, XPack2). I didn't touch that extractor: the shared tree now carries main's sound `parts` and my branch's older extractor does not, so they should pass once merged.

**Commits** (`git log --oneline main..HEAD`):
- `40a7766b` refused pull
- `a52e0a4e` camera shake and reload wait
- `70af33b5` salvo charge
- `0f5d6326` grenade charge
- `e68f2aef` kit heat
- `452f362d` GUN-18/19 renumber
- `6414a6e9` first-sweep reading

**Files outside my list:**
- `kit-ammo.js`: the kit's rows are built there.
- `soldier-hud.js`: one line to feed the charge to the heat bar.
- `map.html`: +3 lines in `draw`.
- `extract_viewmodel.py` and `bf42/animstates.py`: the extractor hunk.

**Asset commands.** Only `clips.*.cameraShake` changes (plus `weaponStats.heat` and `blastAmmoCount` from earlier work); nodes and meshes are identical (checked on scratch Bazooka, No4Sniper and Thompson):
```
cd tools/bf1942-models
python3 extract_viewmodel.py --kits viewer/models/kits.json --maps viewer/maps/maps.json --out viewer/models/viewmodels
python3 extract_viewmodel.py --mod DesertCombat --kits viewer/models/mods/desertcombat/kits.json --maps viewer/maps/mods/desertcombat/maps.json --out viewer/models/mods/desertcombat/viewmodels
python3 extract_viewmodel.py --mod DC_Final --kits viewer/models/mods/dc_final/kits.json --maps viewer/maps/mods/dc_final/maps.json --out viewer/models/mods/dc_final/viewmodels
cd ../.. && python3 scripts/publish-mesh-delta.py textures models --hash
```
`extract_viewmodel.py` runs `optimise_mesh.py` itself unless `--no-optimise` is passed. This one pass covers the earlier M249/PKM heat re-extract and the shotguns' `blastAmmoCount`. Until it runs, a DC Remington pull costs eight rounds.

**Rows for `desert-combat-parity`:**
- Weapon fire camera shakes (CW15): Works once re-extracted.
- Grenade charge: Works once re-extracted.
- Hand-MG lockout restart: Works.
- Kit heat on pickup: Works.
- First-sweep question: settled, already matched retail.

**Still open:**
- **`replay-hud.js`:** could report the trigger between rounds to show the engine's lockout restarts.
- **Shakes not built:** explosion, hit and death shakes, and the stationary guns' `FireMachineGunShake`.
- **XPack weapons:** they have no viewmodels, so they get no shake.
- **For the `bots` package:** bots throw at full strength, and model no hand-weapon heat, so their dropped M249s come up cold.
- **Object sweep:** whether the object sweep catches a round born inside a static's hull is unread.

Scratch scripts are in `~/.cache/dc-sweep/hand-weapons-2/`, and the port 5640 server is stopped.