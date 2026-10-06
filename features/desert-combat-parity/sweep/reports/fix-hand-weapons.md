All three items are done, plus the turn-spread fix you added. Six commits are on the branch and the full suite passes (4,625 tests, 10 skipped). One thing to decide first: commit `ee962a9e` changes the heat law in `fire-state.js`, which you marked "reuse only". It also changes how fast every vanilla vehicle MG overheats. I kept it as its own commit so you can drop it.

**1. Shotguns fire their barrels along their own turns.** The hand weapon's aim ignored the barrel it was handed, so all eight pellets left down the view axis. The engine turns the eye's frame by each barrel's own rotation (XHIT-12, now written out as XHIT-16). New `viewer/hand-aim.js` hands the eye and the gun to `cameraLaunch`, which `gun-groups.js` now exports.
- **Measured:** the baked Remington's pattern went from 0.42°×0.24° to 2.42°×2.35°. In the page, each of the eight pellets left within 0.22° of its authored turn.
- **Vanilla:** unchanged, since no vanilla hand weapon has a turned or offset barrel. DC's RPG-7 and Stinger now launch from their `projectilePosition` in the eye's frame, as XHIT-12 says.
- **Bots, the server's view:** bots fire a shotgun as one ray per pull, so one pellet with an eighth of the damage. The server runs the same barrel loop for everyone, so this is wrong too. It is in `bot-referee.js`, so it belongs to the `bots` package.

**2. Stinger / SA-7 sight.** The engine read settles open question 3: the sniper blackout with the ring is what retail draws. The client's template constructor (`0x0053c3f0`) starts the scope picture as `sniper.tga` and the sight as `scout_ring_128x128.tga`, and the HUD copies both every frame. DC ships neither file and falls back to vanilla's art. Nothing the page draws changes; the two fallbacks are now named constants citing new ledger row SCOPE-6, and `test_hud` covers it.

**3. Hand-MG heat.**
- **Hand path:** each kit item gets one `FireState` over its heat words, so a hot gun swapped away comes back hot. The trigger is gated on it, and the heat bar reads it (GUN-16).
- **Grenades:** they also declare `heatAddWhenFire`, but `velocityDependentOnHeat` makes that the throw's charge (GUN-14). I added that word to `bf42/con.py` so grenades get no overheat.
- **Export:** `extract_viewmodel.py` now writes `weaponStats.heat` (small helper, two one-line call sites).
- **Why the law commit:** under the old `FireState` rule neither the M249 nor the PKM could ever overheat at their real 10 rounds a second. The binary (GUN-14, GUN-15) adds heat with no clamp and drains it only between rounds, never during the lockout.
- **Ledger:** GUN-13 (whole-tick fire rate) was cited by `gun-cycle.js` but missing from the ledger, so I restored it.

Rounds fired before the first refused pull:

| Gun | Before | After |
|---|---|---|
| DC M249 | never | 60 (5.9 s) |
| DC PKM | never | 50 |
| Vanilla stationary MG42 | 73 | 38 |
| Vanilla pintle Browning | never | 38 |
| Vanilla coaxial Browning | 49 | 25 |

In the page, a scratch-extracted M249 fired 61–62 rounds, then one round per 2 s lockout, and the heat bar rose to 1.01.

**4. Turn spread (CW3).** The cone reads the raw mouse-look input value (`PlayerInput[c_PIMouseLookX/Y]`) the soldier stores each tick, before zoom and recoil are applied, with a 0.01 deadzone (DEV-10). On foot that is the infantry profile's 1.35 scale, not the Air profile's 3.85 from MLK-7, and 1.0 is a 90°/s swing. `deviation.js` used to divide a rad/s slew by 30 instead.
- **Fix:** `deviation.js` now takes the value as it is, and `hand-fire.js` reads the held mouse axis through a one-line bag addition in `map.html`.
- **Bots:** they already pass this unit, so their DC weapons now open the cone on a swing too.
- **Measured:** an M16 at 90°/s hits its 2° cap in 20 ticks; in the page the cone went 0.4 → 2.37 in a second. Vanilla's zero `setTurnDev` adds nothing.
- **Unproven unit:** how many DirectInput counts one browser pixel is.

**Also found:** the engine's deviation cone is a square of hundredths of a radian per axis (DEV-9). The viewer draws a disc of whole degrees, about 1.75 times too wide on each axis, for every gun. That is in `round-launch.js`, so it belongs to the `rounds` package.

**Commits:**
- `a738343f` shotgun barrels
- `aa48dd5d` scope default
- `ebbcbea9` hand-MG heat
- `ee962a9e` heat law in `fire-state.js`
- `2cbef68a` page measurements
- `f95b72c8` turn spread

**Files outside my list, and why:**
- `hand-aim.js` (new): a small module so the aim can be tested under node.
- `bf42/con.py`: parses `velocityDependentOnHeat`.
- `fire-state.js`: the heat law above.
- `deviation.js`: the turn-spread item you added.
- `map.html`: +1/−2 lines.
- `test_seats.py`, `test_replay_hud.py`: expectations updated to the new heat law.

Docs: `features/hand-weapon-barrels-sight-and-heat/README.md`, with its line in `features/README.md`. New ledger rows: DEV-9, DEV-10, XHIT-16, SCOPE-6, GUN-13 (restored), GUN-14, GUN-15, GUN-16.

**Assets.** The hand MGs only heat in the page after this re-extract (proven in my scratch dir; only `weaponStats` changes):
```
cd tools/bf1942-models
python3 extract_viewmodel.py --mod DesertCombat --out viewer/models/mods/desertcombat/viewmodels USSoldier M249 IraqSoldier PKM
python3 extract_viewmodel.py --mod DC_Final --out viewer/models/mods/dc_final/viewmodels USSoldier M249 IraqSoldier PKM USSoldier Mortar_weap IraqSoldier Mortar_weap
python3 optimise_mesh.py viewer/models/mods/desertcombat/viewmodels viewer/models/mods/dc_final/viewmodels
cd ../.. && python3 scripts/publish-mesh-delta.py textures models --hash
```
No vanilla or XPack hand weapon has an overheat, so nothing else is needed. These can go in the same pass as kit-pickups' DC viewmodel re-extract.

**Rows for `desert-combat-parity`:** weapons item 3 Works; item 7's sight part Works (confirmed, no change); item 18 Works once re-extracted; Weapons #2 turn spread Works.

**Still open:**
- **Lockout start:** it starts on the round that crosses heat 1 rather than on the refused pull after it.
- **Tick order:** whether the fire or the drain runs first in a tick moves the round counts by a few.
- **Grenade charge:** hold-to-charge, release-to-throw is read but not built.
- **Offset frame:** barrel offsets are still added in the eye's frame, not the barrel's own turned frame; only FHSW's suicide bomb shows it.
- **Lab check:** a server-lab recording of a held MG42 would confirm the 38 rounds against the real game.