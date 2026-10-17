# FH and FHSW open issues

Status: opened 2026-10-12, after the first hand-testing round of FHSW 0.81 in
the map viewer. This page is the list of what is still known to be wrong, what
was fixed without being looked at in the page, and what rests on reading the
game rather than watching it. One row per issue; close a row by naming the
commit, do not delete it.

The round's fixes are in the git log of 2026-10-12 (`7a70f201` to `d3c5aa45`)
and in the folders each row points at. The engine facts behind them are ledger
rows in [bf1942-engine-reference](../bf1942-engine-reference/ledger.md).

## What is installed and baked

* FHSW 0.81 on this PC (`Mods/FHSW`, chain FHSW -> FH -> bf1942), 143 levels.
  The earlier folder was a half-synced mix with no sound archive; anything
  extracted from it before 2026-10-12 is void.
* Ten levels baked locally and not published: battle_of_foy, berlin-1945,
  gold_beach-1944, hungary_forest-1945, midway-1942, monster_des_stahles,
  moscow_outskirts-1941, pakfront, prokhorovka-1943, ramelle_neuville-1944.
  `Battle_of_Antarctica` is not in the 0.81 client.
* Instant Battle lists four of them (Foy, Berlin, Gold Beach, Prokhorovka):
  the game's own rule lists a level only when it ships `SinglePlayerAllied.con`
  or `SinglePlayerAxis.con`. The other six ship no single-player layer, no
  pathfinding maps and no co-op game type, and open by URL
  (`map.html?mod=fhsw&map=<Level>`).
* mesh.bfstats.io still serves the bake of the broken install.

## How to re-measure

| Check | Command (from `tools/bf1942-models`) | What it answers |
|---|---|---|
| Weapon conformance | `python3 conformance_weapons.py --mod fhsw --levels battle_of_foy,berlin-1945,gold_beach-1944,prokhorovka-1943` | What a hand weapon's scripts declare beside what the trees carry and the page reads |
| First-person rig motion | `python3 audit_viewmodel_motion.py --mod fhsw` | Rigs whose clips turn the rifle in the hands, drop a part, or do not return |
| Dropped weapon words | `python3 census_weapon_words.py --mod FHSW` and `tests/test_weapon_words.py` | FireArms words the script reader has no branch for |
| Vehicles and kits in the page | `flock /tmp/claude-1000/chromium.lock node audit_behaviour.mjs --mod fhsw --levels <level> --port 5310 --json <out>` | Drives, fires and spawns per level; one level per run (15 to 45 minutes) |
| Static audit | `python3 audit_mod.py --mod fhsw --audit sound models animation` | Guns under another weapon's script, level paint, rig motion |

## Open: a player sees it

Ranked by how soon a player meets it. "Seen" is how the issue is known.

| Id | Where | What is wrong | Seen | Lead |
|---|---|---|---|---|
| FHX-1 | Moscow Outskirts | Seven tanks on or beside `trainplatform_m1` do not move (T34_AP, T34-57, T34_ste, ValentineII_RR, KV-3Proto; BT7_AP in a revetment, T35 inside sandbags) | behaviour audit; page probe had T34_AP at 0.45 m/s | **Closed** by `cfeb36d5` (2026-10-14): a static a parked hull stands on is a surface its wheels ride. Re-measured 2026-10-17 (page audit, node harness): T34_AP 25.5 m, T34-57 21.9 m, KV-3Proto 25.9 m in 6 s; the harness on `ac45ecd9` reproduces the stall. The rest is the level: ValentineII_RR is stopped by `LocomotiveSteam_M1_1` ahead and reverses; BT7_AP faces into its revetment and reverses out; T35 is ringed by 1 m sandbags (pad delay 9999); T34_ste is immobile by its own `Physics.con` (`setTorque 0`, `setAcceleration 0/0/0`). The platform pads field team 1's template only, so they stand once the Axis holds the point (SPAWN-2, SPAWN-12) |
| FHX-2 | Prokhorovka | TB3 and TB3_T-40_SP72: dead or reversed controls, guns do not fire. Bf109-G6 dives 250 m hands-off | behaviour audit | **Closed** `8f5257a4` (2026-10-17): the TB3s' guns already fired on main; the dead or reversed controls were the audit dropping a ground-rolled TB3 at 70 m/s with its `TB3Airbreak` regulators at their stop. The audit now holds the flight 3 s and probes a heavy airframe 2.25 s; both TB3s fly and every seat fires. The Bf109-G6 dive is FHSW's data under AI-60; one offset line was misread (`setPositionOffset -0.5/0-0.42/0.569`, stream-read as (-0.5, 0, 0.42), CON-16; `9bb84e85`, needs the Bf109 re-extract and re-bake). Retail's hands-off attitude is not recorded |
| FHX-3 | Every level | A spent grenade, Panzerfaust, rifle grenade, satchel or smoke stays in hand and can be selected again: `changeWeaponWhenNoAmmo` (49 weapons) and `cantSelectWhenNoAmmo` (47) are honoured only for the explosives pack, by name (`hand-weapon.js`) | conformance tool | **Closed** `67b71244` (2026-10-17): the kit's item list is its `addTemplate` order (`Kit::Kit` 0x08295f60), and `selectBestLoadedWeapon` (0x08273a80) raises its first item with ammo when the held item is spent and says `changeWeaponWhenNoAmmo`, or at the end of a thrown weapon's hide time (FA-14). `cantSelectWhenNoAmmo` refuses an empty raise (`HandFireArms::enable` 0x08293bd3). `viewer/kit-select.js`; glbs patched with `patch_weapon_stats.py`. Page, Foy scout: two grenades thrown, the Greasegun comes up |
| FHX-4 | Berlin (Russian tank hunter) | The Molotov (`Molli`) leaves the hand with no wind-up: it declares `fireDelay 0.8` and no `fireOnce`, and `hand-fire.js` runs the wind-up only for `fireOnce` | read in code | **Closed** `27cd534e` (2026-10-17): a `fireDelay` weapon winds up whether or not it is `fireOnce` (FA-13: lnxded 0x0828a090, 0x08288890; client 0x0053d85a). Page, Berlin tank hunter: round and report 0.83 s after the trigger |
| FHX-5 | Foy, Gold Beach, Prokhorovka | Rifle grenades (`K98Grenade`, `GarandGrenade`, `No4Grenade`, `SG44Grenade`) are treated as hand throws: the round starts at the fist, the report plays at the click 0.8 s before the round, the rifle is hidden once the grenades are gone | read in code | **Closed** `27cd534e` (2026-10-17): the report already left with the round (`71d1770e`). A launcher's round now leaves from the eye plus `projectilePosition` (XHIT-12), and only a `hideDuringFireTime` weapon leaves the hand; nothing in the engine hides a weapon for running dry (FA-14). As a consequence every hand grenade's report now leaves with its round too |
| FHX-6 | Every level with lightmaps | Shadowed walls are darker than retail (Ramelle wall: retail 36/37/31, ours 26/26/22), and a vanilla-built mesh steps in brightness at its LOD distance: its farther LODs carry lightmap UVs of (0, 0), so they are drawn lit while LOD 0 is lightmapped | owner's report; `04a1677c` | By our reading of the client (LM-1) retail would sample the atlas's black corner on those LODs, which it does not show: there is a per-LOD gate we have not found. See [level-lighting-laws](../level-lighting-laws/README.md) |
| FHX-7 | Berlin | `RandomGerSeizedRifle10` (VG-1), prone reload: the rifle body turns 104 degrees against a still left hand | rig motion audit | **Closed**, mod data (2026-10-17): FHSW ships `1pLieReloadVG-1.baf` as a byte copy of the K98's `1pReloadK98.baf` while the weapon channel plays `VG-1Reload.baf`; the two files, read from the archive without the exporter (`viewmodel_source_motion.py`), combine to 104 degrees, as the rig plays. The audit accepts it in its `AUTHORED` table (`81cba1e2`) |
| FHX-8 | Gold Beach, Berlin, Foy | Reload clips flagged and not read: the Solothurn rifles (`HF_S18-*`, 110 degrees standing, at rest prone), rifle grenades (rifle 0.25 to 0.41 m from both hands), `M18_57mm_RLR`, Piat (`BOMB` ends 1.73 m off), Panzerschreck rocket (0.87 m, vanilla's is under the limit) | rig motion audit | **Closed**, mod data (2026-10-17): every flag reproduces from the archive bytes: the rifle-grenade hand-over-hand regrip, the Garand/G43/SG44 grenade fitting, the S18 set down on its bipod, the M18 on the shoulder, the Piat bomb and Panzerschreck rocket being loaded. Regrips are cleared by the audit's new unheld measure, the rest by `AUTHORED` (`81cba1e2`, `81434717`). The remaining open rig findings are being classified the same way |
| FHX-9 | Gold Beach, Moscow, Hungary | Towed guns (`45mmATGunmobile`, `Pak36mobile`, `IG37HEATmobile`, Nebelwerfer, `Flak18/36NoShieldAA`) can tumble when woken in play. `3f74baca` only stops the load settle writing the tumble back | behaviour audit; trace in [vehicle-collision-physics](../vehicle-collision-physics/README.md) | **Closed** `b33a425a` (2026-10-17): the body's root part was the first hull part the tree walk met, the left trail leg, not the mesh the engine's search finds (COL-15). Towed guns now settle in about 4 s with a 0.008 m first hop and recover from a shove; the hop came from the leg, which the engine never stands on the ground |
| FHX-10 | Gold Beach, Berlin, Moscow, Prokhorovka | The driver is thrown out or killed mid-drive: GmcAmmo, Nebelwerfer, PantherBunker, 45mmATGunmobile, PantherD, IL2, Ju87G | behaviour audit (`harness.exception`) | **Closed** except Nebelwerfer (2026-10-17): the TB3s crashed or bombed themselves once the pilot's seat was emptied (`8f5257a4`); the PantherBunker gunner died of his own shell's splash, retail-faithful (HFD-12; new info cause `veh.crew-killed-by-own-fire`, `e966f497`); GmcAmmo, 45mmATGunmobile, PantherD, IL2 and Ju87G do not reproduce. Nebelwerfer died 3 of 8 runs, only after GmcAmmo; the audit now names the killing blow (`aa5243b1`) |
| FHX-11 | Single vehicles | SdKfz251/9 immobile (Prokhorovka); Zis3 and Flak18/36mobile guns do not fire (Hungary, Moscow); Cavalry_Nagant steers reversed (Prokhorovka); exit refused on ZIS-30 | behaviour audit | **Closed** (2026-10-17): SdKfz251/9 (46 m), SdKfz7Tractor-Pak43_41, the Zis3 (fires and aims; its four ammo guns are FH's selector trick) and the ZIS-30 exit do not reproduce. Flak18/36mobile's seat 1 is the deploy seat, right button only, whose rounds carry an ObjectSpawner and two killer charges: a mechanic the page lacks (683 FHSW guns), now its own row. Cavalry_Nagant turns right under D; the audit's verdict read a collision spin |
| FHX-12 | Every level | Bots and other soldiers never stab or use an alternate fire. The third-person clips are baked (`918e5197`, `945da4f1`); the bot code has no melee notion | read in code | **Closed** `f1c5865b`, `d7868664` (2026-10-17): retail's AI has no melee rule; the fire plan re-picks its weapon by range (`choseWeapon` 0x085cf0e0, AI-156), so a knife comes out inside 1.5 m, and the trigger is the AI template's `weaponFire` (AI-157), so a bayonet stabs on the right button. Desert Combat bots had made 55 of 57 kills with knives. A sidecar or room player's stab is heard, and drawn on a sidecar remote; a room remote's thrust waits on the room carrying kits |
| FHX-13 | Every level | A bullet's fly-by (`projectile.ssc`, `bulletair1..7`) is played to nobody since `af04b2b5` took it off the launcher. It belongs to a round passing a listener, which is not modelled | read in code | **Closed** in code `c464792d` (2026-10-17): a sample's `trigger Volume` line marks the effect it waits on (SND-37); the page waited on the whole volume. Bots' ray bullets now fly their round's script past the listener (`passing-rounds.js`). The six trees take the flag with the sound re-extract (2026-10-17) |
| FHX-14 | Hungary Forest | Hungarian voices 404 (`voices/hun/*.mp3`) | behaviour audit | **Closed**, not reproduced (2026-10-17): `0bafde8e` added Hungarian and the FHSW voices step re-ran on 2026-10-15; local and live trees serve `voices/hun`. FHSW's `ctf-sounds.json` predated it; its `ctf_voices` step is re-run. The voice extractors now take every language the chain's soldiers declare and each line from its own script's path (`2fa51779`), and an unvoiced soldier is silent (`1e95472a`) |
| FHX-15 | Foy | With the knife in hand the player's third-person body still reports `M1Garand` | page probe | **Closed** `f3991834` (2026-10-17): two raises in one tick left a stale pose load running in `foot-body.js` `ensureFootBody`, which swapped the body back when it landed |
| FHX-16 | Three and four of one gun in range | The world-fire pool is three patches per weapon name and three of `shells.ssc` within 10 m: a fourth shooter is dropped or takes the oldest | read in code | **Closed** `c464792d` (2026-10-17): one sample buffer (file, 3D, loop, stream) holds 8 instances across every object; a one-shot steals the oldest, a loop the farthest and only for a nearer play (SND-38). World fire is 8 patches per weapon under that rule, effect scripts 8 per script |
| FHX-17 | Sticky charges, Panzerfaust30 | `isSticky 1` (Haft-Hohlladung and two more) does not stick; `delayToUse 1` has no reader | conformance tool | **Closed** `dc6ba096` (2026-10-17): `isSticky` (ProjectileTemplate+0x1ab, tested at 0x0831ef16) attaches the round to the struck object at the contact point and keeps its fuse running; glbs patched with `patch_round_depots.py`. `delayToUse` (FireArmsTemplate+0x244) is read by no game code in either binary |
| FHX-18 | Gold Beach | `beach_spawnpoint_4` is 1.1 m under the terrain. Pakfront's `t_34` spawn is authored 2.1 m under it in the level's own `ObjectSpawns.con` | audits | **Settled** `b421a2a5` (2026-10-16): retail stands a spawned soldier or hull at the point's pose and the terrain lifts it out on its first tick (ledger SPAWN-28); the page already lifts a soldier spawn onto the ground (`spawn-safety.js` `resolveSpawn`), so the authored depth is harmless in both |
| FHX-19 | Ramelle, Moscow | Bots stall | behaviour audit | **Root-caused, parked: owner's call** (2026-10-17). FHSW 0.81 ships no single-player layer, AI.con, strategic areas or search maps for Ramelle or Moscow, so retail runs no bots there. The page's two stand-ins stall: the nearest-enemy-flag fallback leaves the side holding every capturable flag idle, and the painted nav map cuts Ramelle's streets and bridge (13.3% agreement with the baked map in FHSWEurope's copy of the level, with which the bots route cleanly). Generated bot data is a separate project |
| FHX-20 | World objects | Grenades and rockets in flight, deployed weapons, mines and the CTF flag do not wear the level's alternative-path textures; the parachute canopy is not repainted on an in-page level switch | read in code | **Closed** `7d600f93` (2026-10-17): the client's texture load walks the level's alternative paths for every texture-creating TextureManager slot (LOAD-11: `0x00642340` via `0x006429d0`). Round clones, replay props, deployed weapons, CTF flags, canopy copies, cockpits and the effect libraries wear `wearPagePaint`, and the level switch repaints what the page kept. Aberdeen's Willys interior: 0 of 3 level textures before, 3 of 3 after |
| FHX-21 | FHSW Centurion, CenturionCS, AT17 (Operation_Varsity, Siegfried_Line-1945, Desert_Hill) | The `*_FireExtinguisher_PCO` seat's right button does nothing: `TankFireExtinguisher15/25_Alt` (FHSW `Common_Extinguisher/Weapons.con`, `c_PIAltFire`) throws an `invisible 1` round at `velocity 0` that carries `Extinguisher_repairpoint` for 7.5 s and plays `Extinguisher7.ssc`. Retail draws nothing; the page builds no gun group for it (`gun-groups.js` placeholder guard), so neither the sound nor the repair point happens | behaviour audit, minor `veh.fire-tool-unmodelled` (2026-10-16) | **Closed** `ebf6010f` (2026-10-16): the round's SupplyDepot children ride `projectile.depots` (`assemble.py`; `patch_round_depots.py` wrote them into 1,063 finished glbs of fh, fhsw and fhsweurope); the page keeps the group, flies the round as an undrawn body and stands the depot on it while it lives (`map.html` `guns.onRoundDepots`, `supply.js` `SupplyField.add`). Behaviour audit, Desert_Hill's three Centurions: the extinguisher seat fires once on the right button and the world gains one depot (`roundDepots: 1`), no finding; new cause `veh.round-depot-missing` |
| FHX-22 | FHSW Operation_SpringAwakening (`rusbase_su_01`, ISU152 5.7 m); FHSWEurope battle_of_iwo_jima (`m4_poa`, Sherman-POA_USMC 0.64 m) | A pad the level placed under the terrain. The page stands the ISU152 on the ground; the Sherman's wheels start 1.3 m under an 8-degree beach and the load settle's springs throw it 7 m up and 9.7 m down the slope (a node trace of the body world's settle, `hull-bodies.js` `settlePlacedVehicles`, 2026-10-16) | behaviour audit, minor `veh.pad-under-ground` | **Closed** `b421a2a5` (2026-10-16): retail hops a buried hull out and drops it beside its pad (server-lab recording of the ISU152: +11.38 m in the first tick, peak 119.24 at 0.40 s, rest 112.2; ledger SPAWN-28). The page lifted it 25.7 m because static (`hasMobilePhysics 0`) parts met the ground; they no longer do, and its settle now matches the recording to 0.01 m. The Sherman hops 4.6 m and rests 4 m down the beach. Behaviour cause `veh.pad-under-ground` is info, retail-faithful |
| FHX-23 | FHSW `DeployedMortar` (the mortar a kit deploys) | `lodDeployedMortar` is missing from `DeployedMortar.glb` and from its cockpit glb, so the deployed mortar has nothing to aim or fire with. Predates the 2026-10-16 batch | static audit, play-breaking `vehicle-part-missing` (`v_static`, `audit_play.py` vehicles; FHSW's only remaining `v_static` failure, 2026-10-16) | **Closed** `2a9af3a0` (2026-10-16): the exporter was right; the tree's glb predated the 2026-10-14 `CreateInvisible` subtree fix (12 nodes, a fresh export 49). 77 FHSW model glbs, FH's EnterpriseElevator and XPack2's Goblin and Natter were re-extracted with the new `mod_pipeline.py reextract`; level scenes were already current. `verify --mod FHSW --no-gates` passes all seven steps |
| FHX-24 | FH and FHSW mobile guns, artillery, torpedoes, spawn posts | A round that carries an ObjectSpawner spawns nothing: 683 FHSW FireArms (every mobile gun's deploy and killer rounds, e.g. `Flak18/36mobile_Transform_PCO1`; `PenetrateExplosion*`; `TorpedoRedDummyPCO`; `AdvancedPost_*`). The page drops them as placeholder guns (`gun-groups.js`), so a deploy seat does nothing | FHX-11 investigation, behaviour audit minor `veh.fire-tool-unmodelled` | In work (2026-10-17): the `projectile.depots` pattern of FHX-21, for ObjectSpawner children |

## Fixed, not yet looked at in the page

Each landed on offline evidence because the one headless browser was held by a
long audit. A hand test or a short page probe closes the row.

| Id | Fix | Commit | What would confirm it |
|---|---|---|---|
| FHV-1 | Bolt rifles no longer spin on reload or bolt (about 40 FHSW rifles; every first-person rig in five trees re-exported) | `d758adb2` | K98 on Hungary Forest: the rifle stays in the left hand. Probe ready, never run: `~/.cache/fhsw-bake-tmp/fpaudit/page/k98probe.cjs` |
| FHV-2 | Vanilla-built buildings no longer draw black from their first LOD distance (a regression of `cdb82376`, in for about two hours) | `04a1677c` | Berlin's city blocks and any vanilla guard tower from 20 m |
| FHV-3 | Fog range follows the client's view-distance rule; it moved on most levels of every tree | `3459a62d` | Only Foy was compared with a retail image. Wake went 250..500 to 75..450, Omaha -50..290 to 25..250 |
| FHV-4 | Prone knife swing, sniper rifles' reload clip, 17 restored grenade and smoke rigs | `26d9523d`, `d8a71698` | Rig reports only |
| FHV-5 | Level paint on dropped kits, seat bodies, replay soldiers and the multiplayer room | `b4a3021b` | Unit tests pin the call; only bots on foot were looked at |
| FHV-6 | Casing tick and clip ping from a bot's gun | `07480dd6`, `07fb80ee` | No bot fired in the 20 s watched |

## Read from the game, not watched in it

A retail capture or a bf42plus recording made in FHSW settles each. On
2026-10-17 the server lab settled four of them with sidecar soldiers pressing
the buttons (`lab-firearms.md`); FHR-2 and FHR-6 need the client.

| Id | Claim | Basis | Settled by |
|---|---|---|---|
| FHR-1 | `Knife_M1Bayonet_ID2` (slot 2 of the bayonet kits) and 30 more FHSW melee weapons have no swing: the copied animation state names a clip folder no archive holds, and the client deletes a copy left with no clip | Client code and four mods' recorded state tables (ANIM-16); no FHSW recording | **Refuted** (2026-10-17, lab runs 093245, 095052, 100430 under `~/.cache/agfhr/lab/runs/`): the copied knives swing. `copyState` (lnxded `0x08327c70`) never renames a state's random-transition names (`+0xc`), so a copied hub hands to its source's swings (`Ub_FireKnifeAllies1..5`); vanilla's German `KnifeAxis` swings them too. Exporter fixed `6633e1fe`; rigs and poses re-extracted with the knife pairs. See `lab-firearms.md` |
| FHR-2 | The shooter hears a casing tick 70 ms after every round, besides the casings that ring once after the clip | Client disassembly (SND-34) | Client only; the binary reading was re-read independently on 2026-10-17 and holds (`FireArms__Fire` message 0 at `0x0053dcbd`..`0x0053dd05`, EffectBundle `0x00568f70`, `shells_High.ssc` `Time Ramp 0.07`). Capture recipe in `MANUAL_STEPS.md` |
| FHR-3 | A magazine run dry waits for the reload key unless the weapon writes `autoReload 1` (89 of 312 in FHSW) | lnxded (FA-7) | **Verified** on the server (2026-10-17, run 093245): a held Greasegun fires 30 rounds in 3.87 s, then nothing for 6.1 s held and on three more pulls; the reload starts 0.03 s after the reload key. A Garand's clicks 9 and 10 fire nothing. The page already does this |
| FHR-4 | A bayonet rifle fires on the left button and thrusts on the right; the two block each other for their fire cycles | Scripts and lnxded (SWB-12, FA-11) | **Verified** on the server from taps (2026-10-17, run 093245): a right tap 0.02-0.09 s after a rifle round, a left tap 0.2 s after a thrust and a right tap 1 s into a reload are all dropped. Held buttons are not representative: the client sends a `fireOnce` weapon's button only on a fresh press (ZOOM-1). The page matches |
| FHR-5 | FHSW's Allied grenade throws without its pin pull (`copyState2 GrenadeAllies taimatu` leaves a clipless state first) | Script order and ANIM-16 | **Verified** in the server's table (2026-10-17, run 100430): `WeaponFireGrenadeAllies` has no clip and sits at 25356, after `WeaponFiretaimatu`; the body throw has both clips and the grenade leaves 0.96-1.0 s after the press. Whether the pin pull is visibly missing is a client drawing question |
| FHR-6 | A first-person casing shows through the ground: no gun's mesh particle declares collision (EMT-13) | Data in five mods | Client only; the reading was re-read independently on 2026-10-17 and holds (the `EmitterTemplate` constructor clears flag bytes `+0x4dc`..`+0x4e2` at `0x0050b75f`..`0x0050b783`). Capture recipe in `MANUAL_STEPS.md` |

## Not audited

* Vehicles on pakfront.
* Midway-1942 and Monster des Stahles: `audit_behaviour.mjs` cannot redeploy on
  an ObjectiveMode map ("cannot respawn: deploy-closed" for every vehicle).
  Monster des Stahles has no control points and no soldier spawns, only ships.
* The six levels without single-player data have never had a bot on them.
* The 1,834 weapon properties the conformance tool lists as declared and not
  acted on, beyond the rows above (HUD ammo-bar positions, `ammoType`,
  `addRootSpeed`, the round's effect words).

## Parked

* Owner's call (2026-10-17), not to be done in a maintenance round: generated
  bot data (FHX-19), the Desert Combat and DC Final knife-swing pose re-run
  (`poses_shared`, needed by `f1c5865b`'s knife), and the voice re-runs in
  bf1918, EoD, GC, Pirates, Interstate and bg42 that `2fa51779` makes stale.
  FHSWEurope ships the AI layer for Moscow_Outskirts-1941 and
  Ramelle_Neuville-1944; Ramelle's is on the same terrain, so it is the ground
  truth for any painter.
* Generated bot data for the levels that ship none (pathfinding grids from the
  heightmap and static collision, strategic areas from the Conquest control
  points), listed in the menu as experimental. Agreed in principle on
  2026-10-12 and not started.
* The eight more FHSW levels another session began baking at 22:38 on
  2026-10-12 (Guadalcanal, Iwo_Jima, Karelia, Kharkov_Winter-1941,
  Meuse_River_Line-1944, Supercharge-1942, Desert_Rose-1942,
  Battle_Of_Orel-1943) are not covered by anything on this page.
* The kits census restricted to baked levels (a further 4 to 5 times faster,
  but 25 kits lose their rows for unbaked levels): the owner's call.
* `extract_vehicle_sounds.py` takes about 32 minutes on FHSW, single process.
