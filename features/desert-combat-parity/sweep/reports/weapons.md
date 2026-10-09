## Weapons, projectiles, kits and damage: census report (DC 0.7, with notes on DC Final)

### 1. Summary

**Domain score: 79%** (47.2 / 60 weighted).

- Most of what a DC infantryman uses every round works, because DC builds it on vanilla systems that are already data-driven. That covers the 12 kits per side on the 6-row spawn screen, rifles, LMGs, pistols, scoped weapons, SMAW/RPG-7, grenades, C4, mines, med/repair packs, the deployable mortar, and the damage tables. All 41 bound viewmodels and all hand-weapon sounds are present.
- The gaps are in DC's heavy and special weapons:
  - Artillery rockets (MLRS, BM-21, Scud) fly in a straight line.
  - Every rocket motor uses an invented 25 m/s² acceleration.
  - Shotguns lose their pellet spread.
  - The M82 and AA kit pads in DC 0.7 are inert.
  - TV-guided missiles do nothing useful.
  - Artillery spotting is not built.
- **Guided missiles: the lead's finding is confirmed.** The viewer has no seek or lock code. DC's own data never asks for one either: there is no seek, lock, guidance or countermeasure command in any DC 0.7 or DC Final `.con`. DC's "guidance" takes two forms:
  1. Proximity fuses. These are built and I measured them working.
  2. Missiles that are themselves vehicles the shooter flies, the way Secret Weapons' Wasserfall works (SA-3 site main rocket, Guided Tomahawk). These are not built, and the engine side needs a read.

### 2. Inventory

| # | Item | DC usage | Status | Wt | Evidence |
|---|---|---|---|---|---|
| 1 | Kit roster and 6-row spawn-screen selection | 12 kits per side; levels bind slots 0–5 (Us_Assault 37 levels, US_AT 36, Iraq_* about 35) | Works | H | `_shared/loadouts.json` holds every kit a level binds (checked by script). `deploy-screen.js:44-46` has the sixth slot. `acdc03b3` fixed the plates and clicks; ledger MEME-18 |
| 2 | Rifles, carbines, SMGs, LMGs, pistols (M16, AK47, CAR-15, AKS-74U, VSS, M249, PKM, M9, MK23, Hipo, PSS) | All 6 kits | Works | H | Deviation and recoil come from data (`weaponStats.deviation/recoil` in the viewmodel reports). Rounds hit body capsules through `guns.bodyCast` (`map.html:1030`). Damage on head/torso/limb (materials 40/41/42): 5.56 does 20/10/7.5, 7.62x54 does 40/20/17.5 |
| 3 | Shotguns (Remington, Saiga12k) | US/Iraq Support kits, every level | **Broken** | M | 8 barrels with authored turns up to ±1.5° (`addFireArmsPosition 0/0/0 1.25/-0.8/0` and so on). The hand weapon's `aimRay` (`hand-weapon.js:402`) ignores the muzzle argument, so all 8 pellets leave down the view axis inside the 0.25° `minDev` cone, which makes the shotgun shoot like a slug. Ledger XHIT-12 says the barrel's turn applies in the camera frame; `gun-groups.js` `cameraLaunch` already does that for vehicles |
| 4 | Sniper rifles and optics (M25, Tabuk; scoped CAR-15 and VSS) | Sniper and SpecOps kits | Works | M | `_shared/hud/scopes.json` has 15 optics and every scope texture is in the DC HUD pack. `soldier-hud.js:461-474`; SCOPE-1..5 |
| 5 | Under-barrel grenade launchers (M203, GP30) | Assault kits, slot 6 | Works | M | Fired as a shell with gravity 0.5 at 60 m/s, with sight art. 50 damage to a soldier |
| 6 | SMAW, RPG-7 | AT kits, every level | Works | H | Shell with gravity 0.4 at 100 m/s. 35 damage per hit on the M1A1/T72 hull material 54 (100 HP), 60 on BMP2, 100 on Humvee |
| 7 | Stinger, SA-7 (proximity-fused AA) | Every US_AT and Iraq_AT kit | **Partial** | M | The fuse is right (item 20). The motor is invented (item 21). The sight falls back to vanilla `sniper.tga`, because the weapon names no `setScopeIcon` (`soldier-hud.js:468`), so it probably draws a sniper blackout around the ring. Ring art comes from vanilla `scout_ring_128x128` |
| 8 | Frag and smoke grenades | Most kits | Works | M | `e_SmokeGrenade` is baked. Fuse rounds rest on surfaces. Tests pass. **Corrected 2026-10-10:** the smoke grenade did not work. `SmokeGrenadeProjectile` has `radius 0`, so it was not a fuse round, and the viewer ended it at its first touch and stopped `e_SmokeGrenade` with it (the emitter starts at 3.7 s, after the grenade has landed), so a thrown smoke grenade showed nothing. Fixed in `features/bf1942-blast-and-bounce/README.md` section 5 |
| 9 | C4 (ExpPack) and Detonator | SpecOps, AT2 | Works | M | `demolitions.js`; the viewmodels exist |
| 10 | AT landmine | AT and Support kits | Works | M | Proximity fuse at 3 m on objects over 130 kg (damage.json), lifetime 360 s |
| 11 | MedPack, RepairPack | Support kits | Works | M | Vanilla code path; viewmodels and loop sounds present |
| 12 | Deployable mortar (`Mortar_weap` → `mortarspawner3` → crewable `Mortar`) | Support kit, 27 levels | Works | M | `deployables.js` and `deployables-page.js` are wired (`map.html:1605`, `:2329`); DC `deployables.json` is present; the harness, copied to scratch, runs. Caveat in open question 6 |
| 13 | Kit pads: M82 heavy sniper and US AA kit | `US_Sniper_hvy` 34 pads on 9 levels, `US_AA` 23 pads on 4 levels | **Missing** | M | `deployables-page.js:317` only makes a pad for a kit that `loadouts.json` knows. DC 0.7's loadouts has neither kit, because `extract_loadouts.py` never reads `ObjectSpawner` kits. The DC tree also has no first-person viewmodels for M82Sniper or SA-7 (third-person poses exist). DC Final has both |
| 14 | Artillery spotting (binocular marker, vehicle `CallArtillary`, artillery camera) | Binoculars in 3 kits; `binocularsprojectile` on Humvee, BRDM, Technical, MH-6, AH-6 and others; M-109 on 17 levels, M-1974 12, MLRS 15 | **Missing** | M | `features/artillery-spotting/README.md`: "The rest is not built" (SPOT-1..16). The viewer has no magType-2 path. Binoculars zoom only |
| 15 | First-person viewmodels for bound kits | 41 soldier×weapon pairs | Works | H | All present with clips; no missing textures. Stinger uses Bazooka clips (as the data says). `Mortar_weap` has no clips, and retail DC defines no state for it either |
| 16 | Hand-weapon sounds | 35 weapons | Works | H | `sounds/weapons.json` covers every kit weapon. The 6 silent ones are missing in retail too (`M4`, `MP5SD`, `Mortar_weap` wavs absent from the archives) |
| 17 | Ammo, reload, resupply, kit pickup | All | Works | M | `kit-ammo`, `kit-drops` and `weapon-bar` tests pass. Multi-barrel pulls charge one round (`hand-fire.js:194`) |
| 18 | Hand-MG overheat (M249, PKM) | HeavyAssault kits | Missing | L | `heatAddWhenFire 0.0265 / 0.03`, `coolDownPerSec 0.3`, `timeDelayOnOverHeat 2` are not in `weaponStats`, and the hand path has no heat |
| 19 | Ballistic rounds (bullets, tank and autocannon shells, artillery shells) | Everywhere | Works | H | `projectile-flight.js` gravity, drag (PHY-7), falloff, splash (HP-9). Minor: the 25 mm `gravityModifier 0.2` is ignored because bullet-kind rounds never fall |
| 20 | Proximity fuses (Stinger, SA-3 alt rocket, AIM-9, AA-10, AMRAAM, flak, mines) | 22 DC projectile rows | Works | M | **Measured** (`weapons_fuse_run.mjs`). The Stinger bursts within 10 m of any vehicle moving faster than 2.5 m/s: UH-60, AH-64, F-16, even an M1A1 (no team or class test, PROX-5). It does not burst near a helicopter hovering at 1 m/s (PROX-3). Primer 0.1 s holds |
| 21 | Rocket-motor flight (`c_ETRocket` child Engine and Wing) | 21 DC templates: Hydra, Hellfire, Maverick, AIM-9/7, AA-10, AMRAAM, AT-2, Magic II, Stinger, SA-3 and others | Partial | M | `projectile-flight.js:42` `ROCKET_ACCEL = 25` is invented (parity-audit P-2). The baked `parts` (torque, differential, acceleration, maxSpeed, wingLift) are never read. Hellfire (350 m/s, lives 50 s) would reach about 1600 m/s with no limit |
| 22 | Artillery rockets that should arc (MLRS, BM-21, Scud) | MLRS 19 on 15 levels, BM-21 8 on 8, Scud 9 on 9 | **Broken** | M | `round-launch.js:440` sets gravity 0 for every `kind:'rocket'`, but these declare no `gravityModifier`, so the engine default of 1.0 applies (IMP-7). An MLRS rocket fired at 45° flies straight: about 4.9 km up after 20 s. A gravity-only arc would land about 680 m out. Vanilla's Katyusha has the same problem |
| 23 | Missiles the shooter flies (SA-3 main rocket, Guided Tomahawk; AIM-54 is not placed) | `sa-3` 17 on 4 levels plus 2 radar domes; Fletcher, Fletcher2, Gato on 4 levels | **Broken** | L | `projectileTemplate` names a PlayerControlObject: `SA-3GuidedRocket` (comment: "Converted to Wasserfall-like code") and `Guided_Tomahawk`. It is baked as `kind:'shell'`/`'bullet'` (F14A, SA-3, Fletcher2 extras), so it flies as a dumb round and does nothing. Nothing in the viewer launches a vehicle |
| 24 | Cluster bombs (CBU-87) | A10_C and AV-8C, 3 levels | Broken | L | `CBU87Prj` is invisible, so it is baked `kind:'bullet'` and takes the no-gravity tracer path: 14 submunitions per pull fly level next to the jet. `e_CBU87Emission2` (a mesh emitter, defined in DC `OBJECTS.rfa`) is missing from `effects.glb` |
| 25 | Dumb bombs (Mk83, Snakeye; DC Final's GBU-27 is unguided) | F-14B, AV-8B, A10_B, Nimitz | Works | L | `bomb-release.js`, BOMB rows |
| 26 | Torpedoes, depth charges | Sub7C, Fletcher, Gato | Works | L | `torpedo-run.js`; BOMB-12 (no homing) |
| 27 | Sounds of a projectile in flight (bullet crack, rocket motor, bomb whistle) | 70 DC projectiles plus 16 rocket Engines carry a `.ssc` | Missing | L | No code plays a projectile's own `loadSoundScript` |
| 28 | Material damage and armour tables | 213 materials, 179 modifier groups, 155 projectile rows | Works | H | The 6 `missingScripts` (AssaultRifles and so on) are absent from DC's `game.rfa` too. Soldier capsule materials 40/41/42 and vehicle hulls resolve. Armour HP and effects come from the extras |
| 29 | Explosions, splash, impact effects and sounds | 216 bundles | Works | H | The report lists 30 as missing, but 22 of them are sound-only bundles carried in `effects.sounds.json` (`e_collision_Soldier`, `e_warning_*`). 5 are defined nowhere in retail. Only `e_CBU87Emission2` is a real gap |
| — | Guided seekers, lock-on HUD or tone, flares and chaff, laser-guided bombs | none | N/A | — | No such command or template in DC 0.7 or DC Final. TOW, Spandrel and Hellfire are straight rounds with gravity 0 |

Score by status: 16 Works items (40 weight), 2 Partial (4), 4 Broken (6), 4 Missing (6). Sum of score × weight = 47.2 out of 60, which is 78.7%.

### 3. Root causes

- **The rocket flight is a placeholder.** It sets gravity 0 for every rocket and adds a fixed 25 m/s². That one choice explains items 21 and 22, plus vanilla's Katyusha. DC uses `c_ETRocket` on 21 projectiles, against one in vanilla, so parity-audit P-2's "low impact" rating does not hold for DC.
- **The `kind` label decides physics, not the data.** Rounds baked as "bullet" never fall (CBU-87 submunitions, 25 mm), and PlayerControlObject projectiles become "shell" or "bullet" (items 23 and 24). The exporter (`bf42/assemble.py` ~1906) chooses the kind from whether the round is visible; the viewer then hard-codes gravity per kind.
- **Kits an ObjectSpawner places are invisible to the loadouts extractor.** That is item 13. DC Final only escapes because its levels also bind the same kits to slots.
- **The hand weapon's camera launch drops the barrel transform** (item 3). Vehicles already do this correctly in `gun-groups.js` `cameraLaunch`.
- **Lost record:** salvage commit `75edb204` kept the mortar and pad code but not `features/dc-mortar-and-kit-pads/README.md`, `tests/test_deployables.py`, or ledger rows SPAWN-9..16, all of which the code cites. They are absent from every branch and worktree.

### 4. Work packages (most valuable first)

**WP1. Fly rockets by their data: gravity first, then the real motor.** Closes 22 and 21. Size M (the gravity half is S).
- Problem: see items 21 and 22. MLRS, BM-21 and Scud are DC staples on 15, 8 and 9 levels.
- Engine source: IMP-7 (`gravityModifier` defaults to 1). Needs an engine read for how a Projectile's child `Engine` (`c_ETRocket`: `setTorque`, `setDifferential`, `setAcceleration`/`setMaxSpeed` vectors, `setInputToRoll c_PIThrottle`) and its `Wing` (`setWingLift`) push a projectile.
- Files: `viewer/projectile-flight.js` (rocket step, about :42 and :460), `viewer/round-launch.js` (:440 gravity rule). Both are hot (shared with WP4, WP6 and WP9), so one agent should own them or the packages should run in sequence.
- Proof: a node harness that flies `MLRSRocket`, `BM21_Rocket`, `SCUD-BRocket` and `KatyushaRocket` from their glb extras at 30° and 45° and asserts a finite landing range. Compare against a parity-lab Katyusha salvo if one can be recorded.
- Bake: none if the viewer applies the default of 1 when `gravity` is absent; the `parts` are already baked.

**WP2. Lay DC 0.7's kit pads.** Closes 13. Size S–M.
- Problem: item 13.
- Engine source: SPAWN-1/2 and the `deployables.js` header, whose cited SPAWN-9..16 must be restored.
- Files: `extract_loadouts.py` (also collect Kit templates named by any level `ObjectSpawner` `setObjectTemplate`), then run `extract_viewmodel.py` for USSoldier/IraqSoldier × M82Sniper and SA-7 in DC.
- Also: restore `features/dc-mortar-and-kit-pads/README.md` with its `features/README.md` line, `tests/test_deployables.py` (the harness exists), and the ledger rows.
- Proof: `loadouts.json` lists `US_Sniper_hvy` and `US_AA`; `deployables_harness` and the kit-drops harness pass; `loadoutKit()` resolves every pad on the 13 levels.
- Bake: re-extract DC `_shared/loadouts.json` and the viewmodels, then publish with `publish-mesh-delta.py`.

**WP3. Fire a hand weapon's barrels along their own turns.** Closes 3. Size S.
- Problem: item 3.
- Engine source: XHIT-12, BOMB-1 (salvo).
- Files: `viewer/hand-weapon.js` (the `aimRay` at :402 should apply the muzzle's transform relative to the FireArms node in the camera frame, as `cameraLaunch` does). Possibly export `cameraLaunch` from `gun-groups.js`.
- Proof: a node test fires the Remington's 8 muzzles from its glb and checks the pellet directions against the authored turns, within `minDev`.
- Bake: none.

**WP4. Build artillery spotting.** Closes 14. Size L.
- Engine source: SPOT-1..16 and `features/artillery-spotting/README.md`, which was read end to end on 2026-09-30.
- Files: a new spotting module; `hand-fire.js` (magType-2 branch); `seat-camera.js` / `seat-view.js` (artillery camera); HUD.
- Shared with vanilla, XPack and FHSW, so it is valuable well beyond DC.
- Proof: the harness places a marker 30 m above the spotter, an artillery seat switches to the marker view, and the bots' type-14 driver (SPOT-16) still passes.
- Bake: possibly the extras for `artPos` seats; check with `test_sim_vehicles`.

**WP5. Ride a missile that is a vehicle** (SA-3 main rocket, Guided Tomahawk, and Secret Weapons' Wasserfall). Closes 23. Size M–L.
- Needs an engine read: what `FireArms::Fire` / `createProjectile` does when `projectileTemplate` is a PlayerControlObject. Who enters it, what `CameraDelayTime`/`CameraDelayDistance` do, how the rocket's `timeToLive` behaves, and `destroyOnExit`, `DelayToUse` and `DestroyVehicleWhenNoAmmo` on `SA3RocketGun`.
- Files: `bf42/assemble.py` (mark the projectile `kind:'vehicle'` with the template), `viewer/round-launch.js`, `spawned-craft.js`/`vehicle-instance.js`, `local-player.js` (seat handover).
- Bake: re-extract SA-3, the air_radardome glbs, Fletcher/Fletcher2/Gato and F14A, plus a full re-bake of the levels that place them.
- Proof: a node harness fires `SA3_mainRocket`, a flyable `SA-3GuidedRocket` appears with the firer seated, and its 25-round burst destroys it.

**WP6. Bullet-kind rounds respect gravity; fix the cluster bomb.** Closes 24 and the 25 mm part of 19. Size S–M.
- Engine source: IMP-7, BOMB-8.
- Files: `projectile-flight.js` (tracer path) and `round-launch.js`, both hot. Needs a census first, because a bullet with no declared `gravityModifier` must fall; `CBU87Prj` is one. Also `extract_effects.py` / `bf42/effects.py` for the mesh emitter `Em_CBU87Bomb`.
- Proof: a harness drops an A-10C CBU pull; the 14 submunitions land in the authored spread pattern.
- Bake: rebuild DC `_shared/effects.glb`.

**WP7. Stinger and SA-7 sight with no scope picture.** Fixes the sight part of 7. Size S.
- Needs an engine read: the default of `ScopeIcon` (template +0x494) when there is no `setScopeIcon`.
- Files: `viewer/soldier-hud.js:468`. Shared with WP8.
- Proof: a unit test of the `CrossHair/*` variables while the Stinger is zoomed.

**WP8. Hand-MG heat.** Closes 18. Size S–M.
- Engine source: GUN-12, HUD-10 (`ATIconAndHeatBar`).
- Files: `extract_viewmodel.py` (export the heat fields), `hand-fire.js` or `kit-ammo.js` (reuse the `fire-state.js` heat law), `soldier-hud.js`.
- Bake: re-extract the DC and DC Final viewmodels.

**WP9. Sounds of projectiles in flight.** Closes 27. Size M.
- Engine source: SND/SSC rows. Needs an engine read for how a projectile's own `.ssc` and its Engine child's `.ssc` are triggered. Read the section 11 invariant of the `bf1942-mod-extraction` skill first.
- Files: the extractor (projectile scripts into `effects.sounds.json` or a new manifest), plus `projectile-flight.js` hooks (hot).

### 5. Open questions

1. What thrust law does an Engine child of a Projectile follow (`c_ETRocket` torque × differential? the acceleration vector?), and does the Wing child's `wingLift 0.1` stabilise or lift the round? This needs an engine read and blocks WP1's second half.
2. How does the engine launch a PlayerControlObject projectile (Wasserfall path)? This needs an engine read and blocks WP5. The parity audit's "no guided weapon in Refractor 1" missed this path.
3. What does `ScopeIcon` default to on a `useScope` weapon that names none (Stinger, SA-7)?
4. What is the FireArms `velocity` default? The BRDM2 Spandrel declares none; the viewer uses `velocity ?? 100`.
5. Do any of the hand weapons I left out of my scan (M4, MP5SD, Sandbag, APLandmine, M16A2) appear in some level's kit or pad that the scene scan missed? I found none.
6. The deployables harness has DC 0.7's mortar (`projectilePosition 0/0/0`, velocity 2) never clearing the 2 m soldier clearance on a level throw: it rests 0.93 m ahead and dies at 1 s. DC Final's changelog ("raised projectile spawn point to stop mortar falling") suggests retail 0.7 was also flaky here. Worth a server-lab check before anyone "fixes" it.
7. The status of most Works items comes from code, data and node harnesses, not from play. Per the brief, I opened no browser.

Scratch files are in `~/.cache/dc-sweep/weapons/`: the con dumps (`dc_objects/`, `dcf_objects/`, `dc_game/`), the scan scripts (`weapons_projscan.py`, `weapons_kits.py`, `weapons_hfa.py`, `weapons_glbscan.py`, `weapons_levels.py`), the fuse measurement (`weapons_fuse_run.mjs`, `weapons_masses.json`), `weapons_levels.json` (vehicle → levels → projectiles), and `harness_deploy/` (the deployables harness, runnable).