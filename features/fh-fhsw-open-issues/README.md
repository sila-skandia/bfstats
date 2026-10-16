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
| FHX-1 | Moscow Outskirts | Seven tanks on or beside `trainplatform_m1` do not move (T34_AP, T34-57, T34_ste, ValentineII_RR, KV-3Proto; BT7_AP in a revetment, T35 inside sandbags) | behaviour audit; page probe had T34_AP at 0.45 m/s | The platform may not be a drivable surface. Undiagnosed |
| FHX-2 | Prokhorovka | TB3 and TB3_T-40_SP72: dead or reversed controls, guns do not fire. Bf109-G6 dives 250 m hands-off | behaviour audit | Not looked at |
| FHX-3 | Every level | A spent grenade, Panzerfaust, rifle grenade, satchel or smoke stays in hand and can be selected again: `changeWeaponWhenNoAmmo` (49 weapons) and `cantSelectWhenNoAmmo` (47) are honoured only for the explosives pack, by name (`hand-weapon.js`) | conformance tool | The next weapon retail picks is not established: `selectBestLoadedWeapon` (lnxded `0x08273a80`) walks a kit list no script word is known to fill (ledger FA-10). `cantSelectWhenNoAmmo` can be built alone |
| FHX-4 | Berlin (Russian tank hunter) | The Molotov (`Molli`) leaves the hand with no wind-up: it declares `fireDelay 0.8` and no `fireOnce`, and `hand-fire.js` runs the wind-up only for `fireOnce` | read in code | Not measured in the page |
| FHX-5 | Foy, Gold Beach, Prokhorovka | Rifle grenades (`K98Grenade`, `GarandGrenade`, `No4Grenade`, `SG44Grenade`) are treated as hand throws: the round starts at the fist, the report plays at the click 0.8 s before the round, the rifle is hidden once the grenades are gone | read in code | Whether retail sounds at the click is not established |
| FHX-6 | Every level with lightmaps | Shadowed walls are darker than retail (Ramelle wall: retail 36/37/31, ours 26/26/22), and a vanilla-built mesh steps in brightness at its LOD distance: its farther LODs carry lightmap UVs of (0, 0), so they are drawn lit while LOD 0 is lightmapped | owner's report; `04a1677c` | By our reading of the client (LM-1) retail would sample the atlas's black corner on those LODs, which it does not show: there is a per-LOD gate we have not found. See [level-lighting-laws](../level-lighting-laws/README.md) |
| FHX-7 | Berlin | `RandomGerSeizedRifle10` (VG-1), prone reload: the rifle body turns 104 degrees against a still left hand | rig motion audit | Same signature as the bolt rifles fixed in `d758adb2`, on one weapon |
| FHX-8 | Gold Beach, Berlin, Foy | Reload clips flagged and not read: the Solothurn rifles (`HF_S18-*`, 110 degrees standing, at rest prone), rifle grenades (rifle 0.25 to 0.41 m from both hands), `M18_57mm_RLR`, Piat (`BOMB` ends 1.73 m off), Panzerschreck rocket (0.87 m, vanilla's is under the limit) | rig motion audit | Some may be authored motion |
| FHX-9 | Gold Beach, Moscow, Hungary | Towed guns (`45mmATGunmobile`, `Pak36mobile`, `IG37HEATmobile`, Nebelwerfer, `Flak18/36NoShieldAA`) can tumble when woken in play. `3f74baca` only stops the load settle writing the tumble back | behaviour audit; trace in [vehicle-collision-physics](../vehicle-collision-physics/README.md) | Three parts start under the ground and the hull hops a metre. Whether retail makes the first hop is unknown |
| FHX-10 | Gold Beach, Berlin, Moscow, Prokhorovka | The driver is thrown out or killed mid-drive: GmcAmmo, Nebelwerfer, PantherBunker, 45mmATGunmobile, PantherD, IL2, Ju87G | behaviour audit (`harness.exception`) | Undiagnosed |
| FHX-11 | Single vehicles | SdKfz251/9 immobile (Prokhorovka); Zis3 and Flak18/36mobile guns do not fire (Hungary, Moscow); Cavalry_Nagant steers reversed (Prokhorovka); exit refused on ZIS-30 | behaviour audit | SdKfz7Tractor-Pak43_41 failed the audit and drove at 13 m/s in a probe |
| FHX-12 | Every level | Bots and other soldiers never stab or use an alternate fire. The third-person clips are baked (`918e5197`, `945da4f1`); the bot code has no melee notion | read in code | |
| FHX-13 | Every level | A bullet's fly-by (`projectile.ssc`, `bulletair1..7`) is played to nobody since `af04b2b5` took it off the launcher. It belongs to a round passing a listener, which is not modelled | read in code | |
| FHX-14 | Hungary Forest | Hungarian voices 404 (`voices/hun/*.mp3`) | behaviour audit | A language missing from `LANGUAGE_NATIONS` extracts nothing |
| FHX-15 | Foy | With the knife in hand the player's third-person body still reports `M1Garand` | page probe | |
| FHX-16 | Three and four of one gun in range | The world-fire pool is three patches per weapon name and three of `shells.ssc` within 10 m: a fourth shooter is dropped or takes the oldest | read in code | |
| FHX-17 | Sticky charges, Panzerfaust30 | `isSticky 1` (Haft-Hohlladung and two more) does not stick; `delayToUse 1` has no reader | conformance tool | Engine test `0x0831ef16` noted in `projectile-damage.js` as unmodelled |
| FHX-18 | Gold Beach | `beach_spawnpoint_4` is 1.1 m under the terrain. Pakfront's `t_34` spawn is authored 2.1 m under it in the level's own `ObjectSpawns.con` | audits | Authored data; what retail does with it is not established |
| FHX-19 | Ramelle, Moscow | Bots stall | behaviour audit | |
| FHX-20 | World objects | Grenades and rockets in flight, deployed weapons, mines and the CTF flag do not wear the level's alternative-path textures; the parachute canopy is not repainted on an in-page level switch | read in code | [first-person-level-paint](../first-person-level-paint/README.md) |
| FHX-21 | FHSW Centurion, CenturionCS, AT17 (Operation_Varsity, Siegfried_Line-1945, Desert_Hill) | The `*_FireExtinguisher_PCO` seat's right button does nothing: `TankFireExtinguisher15/25_Alt` (FHSW `Common_Extinguisher/Weapons.con`, `c_PIAltFire`) throws an `invisible 1` round at `velocity 0` that carries `Extinguisher_repairpoint` for 7.5 s and plays `Extinguisher7.ssc`. Retail draws nothing; the page builds no gun group for it (`gun-groups.js` placeholder guard), so neither the sound nor the repair point happens | behaviour audit, minor `veh.fire-tool-unmodelled` (2026-10-16) | Needs a group for a FireArms whose round carries a SupplyDepot child, and the depot spawned with the round |
| FHX-22 | FHSW Operation_SpringAwakening (`rusbase_su_01`, ISU152 5.7 m); FHSWEurope battle_of_iwo_jima (`m4_poa`, Sherman-POA_USMC 0.64 m) | A pad the level placed under the terrain. The page stands the ISU152 on the ground; the Sherman's wheels start 1.3 m under an 8-degree beach and the load settle's springs throw it 7 m up and 9.7 m down the slope (a node trace of the body world's settle, `hull-bodies.js` `settlePlacedVehicles`, 2026-10-16) | behaviour audit, minor `veh.pad-under-ground` | What retail does with a spawner under the ground is not established (no ledger row); FHX-18 is the same question for soldier spawns |
| FHX-23 | FHSW `DeployedMortar` (the mortar a kit deploys) | `lodDeployedMortar` is missing from `DeployedMortar.glb` and from its cockpit glb, so the deployed mortar has nothing to aim or fire with. Predates the 2026-10-16 batch | static audit, play-breaking `vehicle-part-missing` (`v_static`, `audit_play.py` vehicles; FHSW's only remaining `v_static` failure, 2026-10-16) | Find why the exporter drops the LOD part (`bf42/assemble.py`), re-extract through the pipeline's `models` step or `reextract_models_subset`, then `verify --mod FHSW --no-gates` |

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

A retail capture or a bf42plus recording made in FHSW settles each. None
exists on this PC.

| Id | Claim | Basis | Settled by |
|---|---|---|---|
| FHR-1 | `Knife_M1Bayonet_ID2` (slot 2 of the bayonet kits) and 30 more FHSW melee weapons have no swing: the copied animation state names a clip folder no archive holds, and the client deletes a copy left with no clip | Client code and four mods' recorded state tables (ANIM-16); no FHSW recording | A click with that knife in retail, or `~/.cache/fhsw-bake-tmp/knife/cmp.py FHSW <recording>` |
| FHR-2 | The shooter hears a casing tick 70 ms after every round, besides the casings that ring once after the clip | Client disassembly (SND-34) | A retail recording of a Garand clip |
| FHR-3 | A magazine run dry waits for the reload key unless the weapon writes `autoReload 1` (89 of 312 in FHSW) | lnxded (FA-7) | Emptying a Thompson in retail |
| FHR-4 | A bayonet rifle fires on the left button and thrusts on the right; the two block each other for their fire cycles | Scripts and lnxded (SWB-12, FA-11) | Retail |
| FHR-5 | FHSW's Allied grenade throws without its pin pull (`copyState2 GrenadeAllies taimatu` leaves a clipless state first) | Script order and ANIM-16 | Retail |
| FHR-6 | A first-person casing shows through the ground: no gun's mesh particle declares collision (EMT-13) | Data in five mods | Retail |

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
