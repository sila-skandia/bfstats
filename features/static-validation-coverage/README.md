# Static validation coverage

The owner's goal (2026-10-15): validate as much as possible by parsing files,
without loading a map, so that no more than 5% of defects are ones only he can
find. Everything else should be caught during baking and extraction.

This folder measures how close the checks are to that. It holds the corpus of
defects found on extracted mod content, each one classed by how it could have
been caught, the static checks added to close the gaps, and where the pipeline
runs them.

## The corpus

`corpus.tsv` has one row per distinct defect, 373 in all. 89 of them were found
by the owner play-testing. The rest were found by agents while working (227)
or by an audit or gate (57). The rows come from five sources, deduplicated by
root cause and commit:

* `features/fhsweurope-extraction`, `features/fhswe-mechanics-audit`
* `features/fh-fhsw-open-issues`, `features/fh-mod-extraction/*`,
  `features/fhsw-random-kit-items`
* `features/desert-combat-parity`, `features/swrtr-asset-audit`,
  `features/sw-rtr-behaviour`, and the regression corpus in
  `features/mod-extraction-pipeline`
* `fix` commits since 2026-09-15 that touch an extractor (`extract_*.py`,
  `bf42/`, `patch_*.py`, `scene_layers.py`)
* `fix` commits since 2026-09-15 that touch the viewer for mod content

Two owner reports from 2026-10-15 are included, both already fixed in main:

* **al_marj-1942 Flak 18/36 selector.** The round selector (W/S, APHE/AA) did
  not toggle. Commits 7b73c9a8 and 0d29c5b8.
* **203_hill-1904 Russians.** They had no kit look, and their GrenadeRus drew
  as a plain cylinder that could not be thrown. Commits d547c1d5 and 7cb796e7.

Feature requests, behaviour that matches retail, bot-AI and netcode tuning, and
harness-only bugs are left out.

Columns: `id`, `date`, `mods`, `found_by` (owner, agent or audit), `symptom`,
`cause`, `layer` (extractor, viewer, pipeline or mod-data), `class`, `check`,
`sources`.

### Classes

| Class | Meaning |
|---|---|
| a | An existing static check catches it today. That means file parsing only: no browser, and no viewer code run. The checks are the `audit_mod.py` sub-audits, the censuses, the `verify` steps, the `rules` and `corpus` gates, and the unit tests over the real tree. A check added after the report still counts. A census that only counts where a viewer rule applies does not count for a viewer bug: that row is c |
| b | Static checking could catch it, but no check exists. Either the root cause put wrong or missing data in the tree, and comparing the tree with the install's `.con`/`.rfa`/`.rs`/`.ssc`/`.tga` files would show it, or the viewer ignores a word that the data declares |
| c | Catching it needs viewer or sim code running (a node harness, `audit_behaviour.mjs` or `audit_render.mjs`), but the check can be automated |
| d | Only a human can find it. The defect is aesthetic, or it is a match against retail captures with no invariant that can be measured in the files |

## Headline, before this work

| Corpus | a | b | c | d |
|---|---|---|---|---|
| Owner-found (89) | 23 (26%) | 27 (30%) | 36 (40%) | 3 (3%) |
| All (373) | 108 (29%) | 147 (39%) | 112 (30%) | 6 (2%) |

* **Only-human defects are already under 5%:** 3 of the 89 owner reports,
  and 6 of all 373 rows. Two are fits to retail captures (scoreboard colours,
  the rifle-grenade recoil pose). One is the brightness step at the LOD
  distance (FHX-6), where the retail rule has not been read yet.
* **Most owner reports could have been caught without a human:** 56% by a
  static check (a + b), and another 40% by an automated runtime check (c).
* **Before this work, almost none of it ran on a bake.** The static audits
  existed, but `run --no-gates` runs only the five `verify` steps. Those steps
  catch 1 of the 89 owner-found rows (the stale `.glb.gz`) and 12 of the 373.
  The other class-a rows are caught only when someone runs `gates`, which
  includes the 15-45 min-per-level behaviour gate, or runs a census by hand.
* **Where the root causes lived**, for the owner-found rows: 45 in the
  extractor, 44 in the viewer. All 25 owner-found class-b rows in the
  extractor are data in the tree that disagrees with the install, which is
  what a bake-time check is for. The viewer half is mostly class c.

## The owner-found defects

The full corpus, with sources, is in `corpus.tsv`.

| id | mods | symptom | layer | class | check |
|---|---|---|---|---|---|
| alpha0-texels-not-alpha-tested | XPack1,XPack2,vanilla,FH | Barbed wire, track links, N1K1 reflector sight drawn as solid blocks | extractor | a | corpus probe alpha_floor; audit_mod.py opaque-material-cutout-texture (added after) |
| bolt-rifle-no-bolt-clip | FH,FHSW,vanilla | bolt rifle has no bolt animation | extractor | a | audit_mod.py bolt-rifle-no-bolt-clip; corpus probe bolt_clips (added after) |
| caen-pak40-muzzle-silent | vanilla | Caen Pak40 muzzle blast silent | extractor | a | audit_mod.py sound missing sample files (added after) |
| carried-templates-not-catalogued | DC,DC Final | Deck AV-8 has no model, cockpit or wreck; cockpit glb 404 | extractor | a | audit_completeness.py vehicle model not in tree (added after) |
| fh-crosshair-red-block | FH | red block drawn where the crosshair should be | extractor | a | audit_completeness.py hud pack files / audit_mod.py icons missing (added after) |
| fh-gmc-no-engine-sound | FH | GMC truck has no engine sound | extractor | a | audit_mod.py sound engine-without-script; corpus probe sound_families (added after) |
| fhsw-mg42-ricochet-sound | FHSW | Mounted MG42 plays ricochet, not fire sound | extractor | a | audit_mod.py sound weapon-in-table-under-another-script (added after) |
| fhswe-axis-pads-no-snow-skin | FHSWEurope,all trees with pads | Axis pad tanks in summer paint on a winter level | extractor | a | audit_mod.py soldier-level-paint-missing / v_levels expected_level_skins with pad_images (added after) |
| fhswe-cass-seal-white | FHSWEurope | Building windows lose transparency, white panels past 55 m | viewer | a | audit_mod.py textures untextured materials (Cass_*_M1_Material8) |
| fhswe-p40-sunk-in-hangar | FHSWEurope | P-40 below the hangar floor, flips over on entry | viewer | a | audit_mod.py placement hull-sunk-in-static (added after) |
| flettner-launcher-motor-loop | XPack2 | Launcher holds rocket motor loops at cockpit 6 s | extractor | a | census_vehicle_weapon_sounds.py (added after) |
| level-archive-hud-art-unread | XPack2 | Flettner, Greyhound etc. show flak gun HUD picture | extractor | a | census_vehicle_icons.py (added after) |
| lightmapped-lod-rungs-streak | FHSW,FHSWEurope,all trees | O_Hotel buildings streaked at distance | extractor | a | mod_pipeline corpus probe lightmapped_rungs; surveys/census_lod_chains.py (added after) |
| rotor-blur-pair-by-suffix | DC,DC Final | MH-53 rotors never turn into the blurred disc when flown | extractor | a | tests/test_flight.py over real glbs: every rotor carries the pair (added after) |
| rs-doubled-quote-canopy | DC,DC Final | AV-8, F-16 and Su-25 cockpit canopies opaque white; HUD smeared | extractor | a | audit_mod.py textures rs-texture-line-unparsed (added after) |
| soldiers-slide-no-gait | FHSW,FHSWEurope | Bots slide instead of running or walking | extractor | a | mod_pipeline corpus probe gait_clips (added after) |
| stationary-gun-not-static | FH | Nebelwerfer hangs in the air, thrown 9-13 m up at load | extractor | a | corpus probe static_stamp; audit_mod.py placement floating object (added after) |
| su76-mount-white-wrong-extension | FH,FHSW | Tank turret (SU-76 casemate gun mount) draws flat white | extractor | a | audit_mod.py textures texture-not-found; corpus probe spelled_extension (added after) |
| sw-agheila-loading-black | XPack1,XPack2 | Raid on Agheila cover and loading screen black | viewer | a | audit_completeness.py loading-background-missing; test_level_art (added) |
| vehicle-sound-list-one-mode | vanilla,EoD | 16 vanilla and 85 EoD vehicles silent | extractor | a | audit_mod.py sound vehicle engine coverage (added after) |
| viewmodel-part-mirror-spin | FHSW | K98 reload spins the rifle like a clock | extractor | a | audit_mod.py animation weapon-spins (audit_viewmodel_motion.py, added after) |
| viewmodel-weld-not-anchored | FH,FHSW | SVT40, G43 and Sten jump out of the hand on each shot | extractor | a | audit_mod.py animation (audit_viewmodel_motion.py) leaves-hands (added after) |
| weapon-link-words-unread | FHSW,FH | Linked bayonet slots keep separate mags; stab overlaps shot | viewer | a | surveys census_weapon_words.py UNREAD_WEAPON_WORDS |
| beginrem-kit-binding-live | vanilla | Canadians bare-headed with Colt in replay | extractor | b | level kit bindings inside beginrem blocks skipped |
| bob-factory-wreck-hull | vanilla | Intact factory wears wreck rubble collision | extractor | b | hasDestroyedLod alternative never grafted onto the intact hull |
| bob-spawn-inside-building | vanilla | Soldiers spawn inside BoB radar towers | extractor | b | OnlyForAI groups excluded from human spawns |
| capture-flag-icon-missing | FH,all mods | Capture flag under minimap never shows | extractor | b | mod hud-layout.json leaf set vs menu/InGame leaves (ShowFlagIcon) |
| eod-mortar-arms-behind | EoD | Mortar gunner's arms behind him, not on tube | extractor | b | IK lines in glb only on AnimatedBundle/FireArms-derived templates |
| fhswe-203hill-level-kits | FHSWEurope | 203_hill Russians bareheaded; GrenadeRus a plain cylinder that cannot be thrown | extractor | b | kits.json worn glb null and missing rigs for templates the level archive declares (test_kit_worn_glbs_on_disk.py added with fix) |
| fhswe-createinvisible-subtree-dropped | FHSWEurope,FHSW,XPack2 | T-34/OT-34 drive as bare hulls; IS-2 has no cannon, HUD or camera | extractor | b | every child template, weapon and camera in the .con vehicle tree has a node in the glb |
| fhswe-flak18-selector-dead | FHSWEurope | al_marj-1942 Flak 18/36 round selector (W/S, APHE/AA) will not toggle | extractor | b | non-reset RotationalBundle bound to a key in .con vs the model glb rig axes (census_springless_held_axes.py added with fix); viewer half: audit_behaviour.mjs W/S on static guns |
| fhswe-lightmaps-palette | all trees with lightmaps | Buildings too white (Cass_6_M1 facade saturates) | extractor | b | each lightmap PNG texel equals its TGA index through the level Palette.pal |
| fhswe-loading-upside-down | FHSWEurope,FHSW,bf1918,Pirates | Loading pictures drawn upside down | extractor | b | webp row order vs stored rows of each RLE ls.tga given its origin bit |
| fhswe-mod-icon-empty | FHSWEurope | Mod icon empty in the Custom Game dialog | extractor | b | every mods.json row has icons/mods/<id>.png and init.con name/version |
| fhswe-radio-language-missing | FHSWEurope,FHSW | Hungarian side speaks US radio; Hungarian voices 404 at Hungary Forest | extractor | b | every soldier setRadioLanguage has a voices/languages.json entry (voices-nation-missing checks flag nation only) |
| fog-range-wrong-setter | all trees | Foy haze much farther than retail | extractor | b | scene.json fog vs client view-distance rule run on the .con |
| held-craft-spawnoffset-ignored | FHSW,FHSWEurope,DC | Carrier deck planes sunk to their wings in the deck | viewer | b | held craft lowest vertex vs deck top at spawner pose plus spawnOffset |
| hidden-springs-dropped | vanilla,XPack1,XPack2 | KettenKrad on its back; bikes reverse drives forward | extractor | b | invisible Springs in .con present as nodes in glb |
| hud-tga-bottom-left-flipped | FHSW,FH | Rifle grenade zoom sight upside down | extractor | b | TGA type 10 origin bit vs decoded orientation for every HUD image |
| lightmap-bound-mesh-no-uv1 | FHSW | Rubble piles draw black from 15 m | extractor | b | lightmap extra only on meshes with .sm lightmap byte and uv1 |
| loaded-dummy-rounds-not-drawn | DC,vanilla | AV-8A wing racks show no AIM-9s | viewer | b | racks declaring visibleDummyProjectileTemplate vs drawn nodes |
| lzo-break-even-segment-raw | vanilla,all mods | Grenade on its side floating; thrown one invisible | extractor | b | every .ske/.baf rfa segment inflates and parses |
| menu-movie-never-played | all | Front-end background movie never plays | extractor | b | background.bik in the chain has a WebM |
| mesh-tga-bottom-left-flipped | FH | Tank reticle discs read upside down | extractor | b | TGA origin bit vs decode orientation over mesh textures (unit test only) |
| mode-script-template-active-unread | FHSW | Monster des Stahles round ends at once, defeat music | extractor | b | mode-script ObjectTemplate.active addTemplates vs baked glb |
| parachute-in-poses | vanilla,all | 13.5 m parachute stands on soldier's head | extractor | b | pose glbs have no foreign-skeleton skinned parts |
| seat-no-crosshair | vanilla | No crosshair drawn in any seat | extractor | b | PCO setCrossHairType in .con vs glb hud block |
| sherman-13deg-list | vanilla | Sherman/Priest/M10 list 13 degrees | extractor | b | every Spring has a collision node in the glb |
| teamonvehicle-read-as-team | vanilla,FHSW,mods | Midway spawns Japanese ships for US fleet | extractor | b | spawner hull per team vs instance team |
| terrain-detail-quoted-name | FHSW,vanilla | Ground near US spawn a smooth white blur | extractor | b | Terrain.con detailTexName resolves and scene has terrainDetail |
| bayonet-stab-barrels-as-rifle | FHSW,XPack1,XPack2 | Garand bayonet left click fires six rounds; clip empty in two clicks | viewer | c | audit_behaviour.mjs kit.barrels (added after) |
| dc-air-input-signs-inertia | DC | Harrier and Black Hawk answer input the wrong way, spin when crewed | viewer | c | tests/flight_harness.mjs: sign of every input per airframe |
| dc-vacated-aircraft-hangs | DC | Bailing out of a DC aircraft leaves it hanging in the sky | viewer | c | tests/flight_harness.mjs: vacated DC airframe falls |
| delayed-launcher-fires-on-click | FHSW,FH,DC | Rifle grenade report on click; grenade stays on muzzle | viewer | c | audit_behaviour.mjs: report and round time vs fireDelay |
| driveless-gun-cockpit-not-fetched | FH,FHSW | PaK 40/Flak gunner sees plain world, no shield/ring | viewer | c | audit_render.mjs: seat with cockpit.glb shows its interior |
| dry-mag-auto-reloads | all | Empty magazine reloads without R | viewer | c | audit_behaviour.mjs: dry magazine stays dry without autoReload |
| fhswe-bridge-plank-no-deck | all trees | GAZ falls through Woodbrdg_M1 bridge; longPlanks_m1 crossing carries no wheel | viewer | c | tests/perf/decktrace.cjs node drive over raised bridge and plank statics |
| fhswe-nimrod-pad-floating | FHSWEurope | Nimrod pad hovers 1.75 m over a sandbag pile | viewer | c | census_hulls_on_statics.mjs node settle: hulls held over a static by few vertices |
| first-stab-silent | FHSW,XPack1,XPack2 | First stab plays no sound | viewer | c | audit_behaviour.mjs kit.alt-fire sound-started |
| garand-casings-stack | FHSW,FH | 28 casing voices at once; casing not drawn from rig | viewer | c | page audio log: voices per string |
| grenade-leaves-on-click | vanilla | Grenade released on click, not end of wind-up | viewer | c | audit_behaviour.mjs release time vs fireDelay |
| held-depot-outlives-carrier | FHSW,FHSWEurope | A-26 rearms anywhere in flight | viewer | c | node supply harness: depot dies with held object (census_held_depots.py counts) |
| held-objects-not-map-marks | FHSW,FHSWEurope,all trees | Bomber attitude symbol never drawn, icons at picture size, held objects in seat cycle | viewer | c | audit_render.mjs minimap marks per held object at declared size (census_minimap_icons.py counts) |
| hud-literal-before-load | FHSW | Zoom shows sniper blackout/medkit before weapon sight loads | viewer | c | audit_render.mjs: HUD frame vs final after sprites land |
| hud-sprites-exhaust-sockets | FHSW | Cromwell textures white on Gold Beach | viewer | c | audit_render.mjs: failed requests on load |
| lightmap-degenerate-uv1-black | vanilla,FHSW,FH,XPack | city blocks and guard towers black from 15 m | viewer | c | audit_render.mjs buildings beyond first LOD distance not black |
| lightmap-lod0-only | FHSW,vanilla | Foy objects darken at LOD switch, fences glaring white | viewer | c | audit_render.mjs pixel delta across LOD distance |
| loaded-round-muzzle-rotation | DC,DC Final,FHSW | F-14B Mk 83s hang about 35 degrees nose-down | viewer | c | tests/loaded_rounds_harness.mjs: rounds level with the rack |
| loading-pause-after-100 | all | Loading screen pauses after 100%, then briefing | viewer | c | node harness tests/test_load_briefing_js.py |
| mod-replay-no-vanilla-fallback | XPack1,XPack2 | Mod replay/bots draw no hull for inherited vanilla vehicles | viewer | c | replay harness: every recorded hull and prop resolves a glb |
| norden-bombs-overshoot | FHSW,FHSWEurope | Norden bombs land 330-980 m ahead of the sight (partial fix) | viewer | c | node bomb harness: impact vs sight ground point (census_round_attitude.py counts; retail capture still needed) |
| nosehull-hides-sight | FH | KV-1 nose view shows plain world, no optical sight | viewer | c | audit_render.mjs gunner nose view shows the sight disc |
| pak38-ring-black-box | FHSW | PaK 38 sight ring black box in first inside view | viewer | c | audit_render.mjs gunner views, canvas readback |
| plunger-charge | vanilla | Plunger doesn't detonate; charge stands on end | viewer | c | audit_behaviour.mjs demolition |
| rollgrip-friction-slide | DC,DC Final | Parked Harrier slides 247 m; rotates sideways on pull | viewer | c | flight harness parked drift |
| round-selector-springs-back | FH,FHSW,FHSWEurope | SU-122 round selector snaps back on key release | viewer | c | audit_behaviour.mjs veh.selector-springs-back (census_held_axes.py only counts) |
| seaplane-parked-pontoon-wetted | FHSWEurope,FHSW | Catfish seaplanes lose HP parked on water and die | viewer | c | tests/seaplane_water_harness.mjs: parked hull holds its HP (census_seaplanes.py counts) |
| seat-near-plane-clips-interior | vanilla | Driver sees green wedge, no interior box | viewer | c | audit_render.mjs seat views |
| seat-spawn-shows-kit-rifle | FHSWEurope,FHSW | B-29 air-spawn gunner sees the kit's Garand over the seat | viewer | c | audit_behaviour.mjs spawn.seat-shows-kit (census_seat_spawns.py only counts) |
| shared-node-axis-overwrite-no-pan | FH,vanilla,DC,EoD | tripod MG42 and bow MGs elevate but never traverse | viewer | c | audit_behaviour.mjs: each seat axis moves its node |
| ship-grounds-on-collision-box | all trees | PT boats cannot be driven from the dock | viewer | c | node ship harness: driven off the dock (census_ship_undersides.py counts) |
| stab-swing-cut-same-frame | FHSW,XPack1,XPack2 | Right button stab draws no thrust | viewer | c | audit_behaviour.mjs kit.alt-fire (added after) |
| static-carrier-not-deck-host | DC | Boarded MH-53 on the Nimitz rocks, tumbles, pitch reads inverted | viewer | c | headless sim: aircraft boarded on static carrier stands level (test_sim_vehicles.py) |
| tank-mg-car-horn | vanilla | Tank MG honks like a car horn | viewer | c | node audio harness RMS/tonality per weapon |
| touch-aim-zooms-stab | FHSW,XPack1,XPack2 | Touch AIM button zooms instead of stabbing | viewer | c | behaviour harness touch-event pass |
| twin-gunner-sights-stacked | FHSW,FHSWEurope | B-40 gunner seats show no sight or a doubled ring | viewer | c | audit_render.mjs gunner inside views show the sight (census_seat_sights.py models it) |
| fhx6-walls-dark-lod-step | FHSW,vanilla | shadowed walls darker than retail; brightness step at LOD distance | viewer | d | retail frame comparison; retail rule unread |
| rifle-grenade-recoil-pose | FHSW | Rifle grenade recoil pose not held as retail | viewer | d | matched to a retail capture; engine hold unexplained |
| scoreboard-row-colours | vanilla | Scoreboard rows white, Allied wrong blue | extractor | d | colours only from a retail capture |

## Open: class b by theme

The 147 class-b rows grouped by subject. Both columns count the 147: all rows,
then the owner-found ones.

| Theme | Rows | Owner |
|---|---|---|
| Level data: spawns, control points, modes, fog, terrain, lightmaps | 30 | 5 |
| Declared words the reader drops (projectile, weapon, kit, sonar) | 26 | 3 |
| Kits, loadouts, rigs, poses | 22 | 5 |
| Vehicle tree: parts, springs, axes, physics, wrecks, variants | 22 | 6 |
| Sound coverage | 18 | 2 |
| HUD, menu, TGA orientation, icons | 13 | 6 |
| Other (soldier body, damage, seats, AI) | 16 | 0 |
