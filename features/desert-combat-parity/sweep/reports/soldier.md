## Soldiers, HUD, menus, sound and front end: Desert Combat census

### 1. Summary

**Domain score: 85%** (87.4 of 103 weighted points). By area: soldiers 83%, HUD 91%, menus and front end 91%, sound 79%.

- **Mostly done.** The 30 Sep commits made the interface and soldier side very complete:
  - every DC kit weapon has a 3P pose, a gait and a 1P arms rig;
  - every HUD, scope, minimap and vehicle icon the data names resolves to a packed sprite;
  - the spawn screen, scoreboard, radio, voices, loading screens, menu music and movie are DC's own.
- **What is left is behaviour, not assets.** Five sound behaviours the page never plays: reload foley, release tails, track and turret noise, bullet fly-by and rocket motors. DC's pickup kits (the Barrett on 18 levels) cannot be picked up. There is no round-end screen. Blasts never throw a soldier on the play page.
- **Most gaps affect every mod.** Only the pickup kits are DC-specific. That fits the owner's "unfinished" feeling sitting mostly in other domains (flight).

What I ran:
- **Unit tests.** 21 relevant suites, 453 tests, all OK.
- **Weapon-bar harness on DC data.** Correct for 5- and 6-item kits.
- **Both coherence sweeps re-pointed at the 35 DC levels.** `test_vehicle_audio.mjs`: 35 levels, 100 arbitrated twins, all pass. `test_engine_audio_default.mjs`: 35 levels, OK.
- **glb, JSON and archive surveys.** The scripts are in `~/.cache/dc-sweep/soldier/`.

No browser was used. "Works" means the data and the code path agree; the page itself was not run.

### 2. Inventory

Weights: H=3, M=2, L=1.

| Item | DC usage | Status | W | Evidence |
|---|---|---|---|---|
| **Soldiers** | | | | |
| S1 Soldier models and skins per side | USSoldier and IraqSoldier on all 35 levels (35 each); 7 rigs in the tree | Works | H | DC rigs carry DC body textures (different texture hashes from vanilla `poses/rigs/*.rig.glb`). IraqSoldier reuses the Ger meshes, as DC's own con does |
| S2 3P weapon poses and grips | 31 kit weapons, 62 soldier×weapon pairs | Works | H | All `poses/<S>__<W>.pose.json` present. Palm metrics are within vanilla's range; the only large left-palm values are one-handed items |
| S3 3P gaits for DC animation sets | 26 new weapon sets in `Animations.rfa` (1,226 new entries), plus `AnimationStatesMod.con` | Works | H | `gaits/gaits.json` maps every kit weapon to a grip (Stinger→Bazooka, as DC's states do). Only `Mortar_weap` has no gait (weapons agent) |
| S4 1P arms rigs | 41/41 pairs DC's kits hand out | Works | H | `viewmodels/index.json` has 41 stems. Every rig glb carries its 17 clips plus textures. Zero-frame clips are only no-reload items. `arms-rig.js:132` matches case-blind (Mk23/MK23, CAR-15/Car-15). Page not run |
| S5 Death animations | Generic die and explosion states. DC's RPG7, SA-7 and SMAW `DieHit` uppers are unreferenced by DC's states | Works | M | `gaits/die.gait.glb` has 20 clips, identical to vanilla |
| S6 Death helmet drop | `addArmorEffect 0 e_soldierdeath_us/iraq` | Works | M | `soldier-armor-effects.js` (a death in a seat is open) |
| S7 Blast throws soldier | DC raises `explosionForceMod` from 75 to 150 | **Missing** | M | `knockback.js:42` says "The page throws nobody"; replay only |
| S8 Soldier-template tuning | `repairFactor` 0.20, `explosionForceMod` 150 (`timeToLiveAfterDeath` 20 is read) | Partial | L | `kit-loadout.js:370` hard-codes 0.15. `explosionForceMod` is read by nothing |
| S9 Random heads | `setRandomGeometries 3`; DC ships `us2face` and `us3face` | Partial | L | `bf42/con.py:660` always takes head 1 (every mod) |
| S10 Parachute | Vanilla `Parachute`, drag 24 | Works | L | parachute gait and canopy are in the DC tree |
| S11 Worn kit parts | Helmets and packs | Works | M | `*.kit.glb` present for every bound kit |
| S12 Level-spawned pickup kits | `US_Sniper_hvy` (M82 Barrett) on 18 levels (35 spawns); `US_AA` on 4 (5); `ust`, `ist`, `usk`, `isk` on Operation Bragg | **Broken** | M | Not in `_shared/loadouts.json`, so `deployables-page.js:24` makes no pad. The scene bakes an inert pile at the pad (kit, helmet, packs, M82, M9, knife: `dc_desertshield/scene.glb`). No `__pickup` glb; no M82 1P rig |
| S13 Seat and occupant poses | 12 US/Iraqi seat poses | Works | M | `poses/seat-poses.json`; all files present |
| **HUD** | | | | |
| H1 Soldier panel | Health bars per kit, stance icons, ammo icons and ammo types | Works | H | 232 kit sprite references resolve (176 DC, 56 vanilla). Every weapon's `hud.icon` resolves. DC's layout has 74 variables, none DC-only |
| H2 Weapon bar | 5–7 item kits | Works | H | `weapon_bar_harness.mjs` on DC layout plus loadouts: correct icons and highlight for slots 1–6 |
| H3 Scopes and sights | 15 optic entries (M25, Tabuk, VSS, M82, SMAW, RPG, GP30, M203, CAR-15, ...) | Works | M | Every `scopeIcon` and `sightIcon` in `scopes.json` is in the sprite pack |
| H4 Crosshair | CHTCrossHair 98 seats, CHTIcon 114, CHTNone 202 | Works | H | DC sets no `setCrossHairIcon`; `vehicle-hud.js:454` reads the layout's leaf |
| H5 Team art | Ticket and control-point flags, map markers | Works | H | `soldier-icons.json` (HUD-11..13, MMAP-4) |
| H6 Minimap icons | 151 spawned templates | Works | M | All vehicles resolve. The misses are kits and level-local buildings (Tower.dds etc.), which HUD-13 leaves open |
| H7 Vehicle HUD | 418 seat HUD fields over 92 vehicles | Works | H | Every `vehicleIcon` and ammo icon resolves |
| H8 Kill feed | Text `[word]` lines; 1,370 lexicon names | Works | H | `chat-log.js:119`. Unnamed kit weapons (SMAW, VSS, AKS-74U, CAR-15) print their key, as retail does (per its comment) |
| H8b Kill-feed name lookup by case | `Mk23` vs lexicon `MK23`; 53 spawner spellings differ from the lexicon only by case | Partial | L | `killWord` does an exact-key lookup. Needs an engine read on whether `Locale::getWide` is case-blind |
| H9 Tab scoreboard | Opposition/Coalition, Iraqi flag, class glyphs | Works | M | e9c6408a; tests pass |
| H10 Round end | Winner screen, DC debriefing strings, 12 medal textures, win/lose music | **Missing** | M | `round-state.js:577` sets `round.over` and no UI reads it. `scoreboard.js:205`: "plays one round and never ends it". `music/win.mp3` and `lose.mp3` exist but nothing plays them (all mods) |
| **Menus and front end** | | | | |
| M1 Mod picker | DC entry in `models/mods.json` | Works | M | |
| M2 Front-end layouts, movie, menu music | DC overrides only `InGame` and `CreditsMenu`; strings, background, `background.webm` and `menu.mp3` (slaughter4) are DC's | Works | M | |
| M3 Loading screens | 35/35 levels, 9 DC pictures, `vehicle4.mp3` | Works | M | All files present |
| M4 Briefing | 34/35 levels have objectives | Works | M | 73 Easting ships none in its own `Menu/Init.con` (data-faithful) |
| M5 Spawn screen and kit selector | 6 select rows, coa/opp pictures | Works | H | acdc03b3; `spawn-layout.json` has the `select` leaves and 12 row pictures |
| M6 Radio menu and per-side language | DC `radio-layout.json`, `languages.json` | Works | M | df1b03e1 |
| M7 Console | generic | Works | L | |
| M8 Credits screen | DC `CreditsMenu` | Missing | L | `play/front-end.js:25`: CREDITS is not answered |
| M9 Room play, sixth kit slot | DC binds 6 slots | Partial | L | `server/authority.mjs:64` knows 5 classes |
| **Sound** | | | | |
| A1 Hand-weapon fire | 29/31 kit weapons | Works | H | `models/mods/desertcombat/sounds/weapons.json` has 54 entries. Binoculars has no script; `Mortar_weap`'s wav is absent from the archives (silent in retail too) |
| A2 Press and release tails (hand and vehicle guns) | DC's `M16_release`, `akm_release`, `hk_fire_release`, ... | Partial | M | Hand guns: code exists (`hand-fire-sound.js:92`, `extract_weapon_sounds.py:277`), but **0/54 DC entries** carry `release` because the file (30 Sep 13:25) predates 75edb204 (18:42). Vanilla, XPack1 and DC Final are stale the same way. Vehicle guns: slots 2..4 are never triggered (vehicle-sound-coverage D9, "Not done") |
| A3 Hand-weapon reload foley | Every gun's Reload patch (M16: 13 loads) | **Missing** | M | No `reload` key in any `weapons.json`; no audio module mentions reload (all mods) |
| A4 Vehicle engines | 1,105/1,248 spawns have an entry | Works | H | The remainder are kits, buildings and the SA-3 (its scripts are part sounds, A6). Coherence sweep on 35 DC levels passes |
| A5 Vehicle gun fire, horns | 125/228 FireArms sounded | Works | H | Silent ones are CallArtillery and missile racks with no script in DC's own data. Horns are FireArms and play |
| A6 Vehicle part sounds | Tracks (`moderntreads`, `tnkcls`), turret servo (`m1turretservo`), gun elevation, landing gear (61 scripts), flaps and ramps (68 RotationalBundle, 18 Wing) | **Missing** | M | Not extracted (`vehicle-sounds.json` holds engine plus weapons only). All mods |
| A7 Projectile flight sounds | `bulletair1..10` fly-by on 40 DC projectiles; `RPG7_rkt` and `SA-7_rkt` motor loops | **Missing** | M | Nothing in the extractor or viewer reads a projectile's in-flight script; only a bomb rack's release thump is used. All mods |
| A8 Ambience | 24/35 beds (the other 11 levels ship no `Environment.ssc`); 1,077 area emitters (arab radios, oil pumps) | Works | M | |
| A9 Impacts and explosions | 134 bundles, 252 mp3 references | Works | H | All files present |
| A10 Damage alarms | `e_warning_jet`, `_heli`, `_tank` armour tiers | Works | L | Sound-only bundles. `effects.js:310` plays sound before the geometry lookup |
| A11 Radio voices | 97 US and 97 Iraqi stems | Works | M | `radio-sounds.json` lists none missing for us/iraq |
| A12 Announcer and CTF | | Works | M | |
| A13 Pain and death voices | 26 per nation | Works | M | |
| A14 Footsteps and falling | DC `soldier.json` | Works | M | |
| A15 `.ssc` feature coverage | 1,399 DC scripts | Works | M | No directive or control source vanilla lacks: Extern `Engine::Rpm` 808, `DiveAngle` 2. All are parsed |

### 3. Root causes

- **Kit extraction binds only `game.setKit` kits** (1d00baa7). Kits an ObjectSpawner places never reach `loadouts.json`, so they get no pad, no pickup glb and no 1P rig (S12).
- **Sound slots other than Fire and Fire Loop are not played** (A2, A3). This covers Reload, and Release, Shell Bounce and MG distance on vehicle guns. The hand-gun tails are coded but sit behind an un-run re-extract.
- **The sound extract covers only Engine and FireArms scripts** (A6, A7). RotationalBundle, LandingGear and Wing scripts, and projectile scripts, are never shipped. DC uses them heavily (61 gear scripts vs vanilla's 14), but vanilla has the same gap.
- **The play page has no end of round** (H10). It also never applies blast impulses to soldiers (S7). Both affect every mod.

### 4. Work packages

**WP1. Make level-spawned kits pickable: DC's Barrett, Stinger and Bragg kits (S12). Size M.**
- *Problem.* `US_Sniper_hvy` and `US_AA` (plus `ust`, `ist`, `usk`, `isk`) are absent from `loadouts.json`, so they are baked as inert piles and G does nothing.
- *Change.* `extract_kits` should also collect every Kit template a mapped level's ObjectSpawners name, from the mod objects and the level archive. Write their `__pickup` glbs. Run `extract_viewmodel --kits` for M82Sniper (US and Iraqi sleeves). The viewer side (`deployables-page.js` SpawnerPad, `kit-drops.js:156`) is already data-driven.
- *Engine source.* `features/kit-drops/README.md`, ledger `KIT` and `KITDROP` rows.
- *Files.* `extract_kits.py`, `bf42/kit.py`, `bf42/roster.py`, `extract_viewmodel.py`, perhaps the pickup-glb writer in `extract_models.py`.
- *Proof.* `test_kit.py` case: DC `loadouts.json` has `US_Sniper_hvy`. `kit_drops_harness`. On the page, G on Desert Shield's pad (owner).
- *Assets.* Re-extract DC and DC Final `loadouts.json`, `kits.json`, pickup glbs and viewmodels; publish. No re-bake: the page removes the baked copy.

**WP2. Play the hand weapon's Reload slot and re-extract the press and release tails (A2 hand half, A3). Size M.**
- *Problem.* Every reload is silent. DC's `*_release` tails are coded but the data predates the commit that writes them.
- *Change.* Re-run `extract_weapon_sounds.py` for every tree. Add a `reload` layer group (slot 1). Trigger it from the reload start in `hand-weapon.js`, and in `world-fire.js` for other soldiers.
- *Engine source.* SND-12..16 for the slots. **Needs an engine read:** what triggers patch 1. `FireArms::reloadAmmo` is in `symbols.json` (SUP-8); find where it calls the sound slot.
- *Files.* `extract_weapon_sounds.py`, `viewer/hand-fire-sound.js`, `viewer/hand-weapon.js` (**hot: the weapons agent**), `viewer/world-fire.js`.
- *Proof.* `test_weapon_sounds.py`; `test_gun_one_shots.mjs`; a reload-trigger harness; DC `weapons.json` M16 and AK47 carry `release`.
- *Assets.* Re-extract `models/**/sounds` in every tree; publish.

**WP3. Fire vehicle guns' release slots 2..4 on burst end (A2 vehicle half). Size S.**
- *Change.* `FireArms__updateSound` (`0x00539fb0`, SND-12) is already read; the viewer only lacks the trigger.
- *Files.* `viewer/vehicle-audio.js`, `viewer/engine-audio.js` (**hot: the coherence guards; give WP3 and WP4 to one agent or run them in sequence**).
- *Proof.* `test_vehicle_audio.mjs` plus the DC sweep: copy the test and point `mapsDir` at `maps/mods/desertcombat/` (scratch copy in `~/.cache/dc-sweep/soldier/audiotest/`).
- *Assets.* The layers already ship their `slot`, so no re-extract is expected.

**WP4. Vehicle part sounds: tracks, turret servo, gun elevation, landing gear, flaps and ramps (A6). Size L.**
- *Change.* Ship the part scripts keyed by node in `scene.json` `sounds.vehicles[].parts` and `vehicle-sounds.json`. Evaluate them in the vehicle rack, with the part's rotation rate, the hull speed and the gear state as sources, inside `resolveAcross`.
- *Engine source.* SND-3 names `RotationalBundle::updateSound` lnxded `0x081d8630`. **Needs an engine read:** what feeds `Speed` and `Default` for a RotationalBundle, LandingGear and Wing.
- *Files.* `extract_map.py` (**hot: ground and air agents**), `extract_vehicle_sounds.py`, `viewer/vehicle-audio.js`, `viewer/ssc-coherent.js`.
- *Proof.* An M1A1 turret-servo harness; both coherence sweeps over vanilla and DC.
- *Assets.* `patch_scene.py --layer sounds --mod M --all` for every tree, then `publish-mesh-delta.py maps --hash`.

**WP5. Bullet fly-by and rocket motors from the projectile's own script (A7). Size M.**
- *Change.* Carry each projectile's `.ssc` into the damage layer's projectile table, then trigger it in `projectile-flight.js` or `round-visuals.js` through `effect-audio.js` pools and the voice budget.
- *Engine source.* **Needs an engine read:** when a Projectile's patches trigger. `bulletair*` are `trigger Volume` with distance ramps; the motor loops are `loop`.
- *Files.* `extract_map.py` damage layer (**hot**), `viewer/projectile-flight.js`, `viewer/effect-audio.js`.
- *Proof.* A harness flies a round past the listener and checks exactly one trigger.
- *Assets.* `--layer damage` and samples per tree; publish.

**WP6. Round end: winner screen, debriefing, win/lose music and restart (H10). Size M.**
- *Engine source.* `features/round-end-winner-screen/README.md`, research complete and design awaiting approval; DC levels' `game.set*Debriefing*` strings.
- *Files.* A new `round-end` module, `map.html` (**hot**), `scoreboard-screen.js`, `page-audio.js`, `round-state.js`.
- *Proof.* A round-state harness to zero tickets, then `scoreboard_screen_harness`.
- *Assets.* Medal sprites may need adding to `extract_hud_pack`; the music already exists.

**WP7. Throw soldiers on blasts, scaled by the soldier's `explosionForceMod` (S7, part of S8). Size M–L.**
- *Engine source.* `knockback.js` header (`handleExplosionOnObject` `0x08156500`, `triggerFallingAnimation`). **Needs an engine read:** the impulse formula, i.e. what `forceOnExplosion` and `explosionForceMod` scale.
- *Files.* `knockback.js`, `walking-body.js` / `soldier.js` (**hot**), `projectile-damage.js`, `bot-visuals.js`, `bf42/con.py` (extract the mod).
- *Proof.* A knockback harness: a DC soldier gets twice vanilla's push.
- *Overlap.* The weapons agent (projectiles).

**WP8. Soldier-template numbers from data (S8). Size S.**
- *Change.* Extract `repairFactor`, the heal factors and `explosionForceMod` per soldier into `gaits.json` `soldierBody` or `loadouts.json`. Replace `kit-loadout.js:357/370`.
- *Assets.* Re-extract the poses gait manifest or loadouts per tree.

**WP9. Kill-feed names case-blind (H8b). Size S.**
- *Change.* Gated on an engine read of `Locale::getWide` (`0x005815b0`) case handling.
- *Files.* `chat-log.js`, `comms.js`.
- *Proof.* `chat_log` / `radio_chat` harness.

**WP10. Room play with six kit slots (M9). Size S.**
- *Files.* `server/authority.mjs:64`, `deploy-screen.js` naming.

**Optional, low value:** random heads (S9: `con.py:660` plus pose recipes per head); the CREDITS page (M8).

### 5. Open questions

1. What retail shows for DC's own data gaps: `US_AT` and `US_AT2` have no `setKitIcon` or `setKitName`, and DC ships no `Icon_spec2_axis_selected`. Probably moot, because DC's rows draw weapon pictures.
2. HUD-13: whether the engine's file system finds level-local minimap icons (DC's `Tower.dds`, `VehicleBunker.dds`). Unsettled.
3. Whether the live site's `weapons.json` is newer than this PC's. I did not probe mesh.bfstats.io; if it is newer, WP2's tails may already be live.
4. Engine reads still needed: the Reload slot trigger, the Projectile sound trigger, the RotationalBundle, LandingGear and Wing sound sources, `explosionForceMod`, and `Locale::getWide` case.
5. `Mortar_weap` (the Support primary on 27 levels) has a graft rig with no clips, no gait and a missing wav. I left it to the weapons agent.
6. Everything marked Works is a data-plus-code verdict. 1P rig placement, scope overlays and alarm loops were not seen in the page.