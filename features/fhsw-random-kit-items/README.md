# FHSW: vanilla uniforms, case-mismatched names and `Random*` kit weapons

Status: built 2026-09-30 on a worktree branch; the FHSW trees need the
extraction commands at the end before the data half is live.

An audit of FHSW's live levels found three faults in the soldiers the viewer
draws. Engine claims are ledger rows: KIT-1..KIT-5, ANIM-13..ANIM-15, LOAD-7.

## 1. FHSW soldiers wore vanilla's body

`pose-compose.js` asked for a pair's split-pose recipe in every tree before it
asked for a single-file pose in any. FHSW's tree holds only single-file poses,
so for every pair vanilla also holds (`GermanSoldier__K98`, ...) vanilla's
recipe won, then its rig (after a 404 on FHSW's `rigs/`): a German side where
the MP40 gunners wore FHSW's uniform and the riflemen vanilla's.

Fix: each tree publishes `poses/index.json` (`extract_pose.py`
`write_pose_index`, rewritten from the directory listing by every pose run, and
on its own by `--index-only`). `pose-bases.js` `poseSources` walks the trees in
order, mod first, and asks each tree only for what its index lists, recipe then
glb. A tree without an index is guessed at as before, per tree. A recipe's rig
is looked for from the recipe's own tree onward.

## 2. Names differ only by case

The engine finds templates case-blind (LOAD-7); our files carry whichever
spelling the extractor was handed. Two fixes, one at the source and one at the
lookups:

- `bf42/kit.py` `spell_soldiers`: `loadouts.json` and `kits.json` now name a
  team's soldier as its `create` line does. Counterattack-1950's
  `frenchsoldier` becomes `FrenchSoldier`, whose files exist.
- `poses/index.json` maps the lowercased stem to the file's own, so a kit's
  `Mp40` finds `GermanSoldier__MP40.pose.glb`. `model-file.js` `byName` does the
  same for a manifest looked up by template name (`gaits.json` `weaponGrip`,
  `grips`, `stateMachine.weaponSpeeds`) in `foot-body.js`, `bot-visuals.js`,
  `netcode-render.js` and `replay-assets.js`. The viewmodel index
  (`arms-rig.js`) and `weapons.json` (`hand-fire-sound.js`) were already
  case-blind.

## 3. `Random*` kit weapons

A kit's `addTemplate RandomGBTankcommander` + `setRandomGeometries 4` is a roll,
never an item of that name (KIT-1). One process-wide counter, starting at 1 and
wrapping at each child's N, is bumped by every rolled child of every kit object
(KIT-2), and a kit object is made on every spawn and kit change (KIT-4). The
variant is a full weapon template: its model, sounds, AI entry and its own
animation states (ANIM-15), which `copyState` builds from two donors by clip
slot (ANIM-13).

- `bf42/kit.py` `RandomItem` / `random_items`: each kit's rolled children in
  roll order with their variants. `primary_weapon` returns a rolled spawn
  weapon by its bundle name.
- `loadouts.json`: `kits[k].random`, the bundle in `items`/`weapons` at its
  variants' slot, an `aiWeapons` entry per variant, the soldier respelled.
  `kits.json` items carry `variants`.
- `viewer/random-items.js`: the counter and the roll. `kit-loadout.js` rolls on
  every spawn (`rollSpawnKit`, called from `hand-weapon.js`
  `ensureHandWeapon`), when a bot's kit is dealt (`botKitFor`, and the headless
  `sim/level.mjs`), and a picked-up kit keeps the variant its ammo rows name
  (`adoptKitRolls`). Everything downstream sees the variant's name.
- `extract_pose.py --kit-poses`: a kit whose spawn weapon is rolled is one job
  per variant (`kit.pose_candidate_sets`). `extract_viewmodel.py --kits` asks
  for each variant (`kit_pairs`).
- `bf42/animstates.py`: `copyState` donors by slot and state name (ANIM-13).
  This also moves 7 vanilla weapon-channel states (`WeaponReloadK98` now plays
  the K98's own reload, which vanilla ships) and 469 FHSW ones.

With only its own kit rolling, a British tank commander (smoke roll N=6 after
the weapon's N=4) lands on the same variant each life: the counter law makes
the sequence depend on everything else created before it, which the page
models only as far as the kits it deals.

## 4. Vehicles roll too: DC's Lada and Pickup paints (2026-10-06)

The same `addBundleChilds` roll builds a vehicle's random child. DC's Lada
and Pickup declare their exterior hull `setRandomGeometries 3`:
`LadaCockpitExternal1..3` are the blue, green and beige Lada (`Lada_Hull1..3_m1`,
one shape, three textures), and `PickupCockpitExternal1..3` are three Pickup
paints. The exporter built variant 1 everywhere, so every Lada in every level
was blue.

- `bf42/assemble.py` `Assembler.random_counter` / `_rolled_template_name`: a
  level bake (`extract_map.level_assembler`) starts the counter at 1. Each
  rolled child it builds bumps the counter and takes `<name><counter>`, or
  nothing when the variant is undeclared (KIT-2, KIT-3), in placement order.
  The first Lada of a level is green, then beige, then blue. Every model
  export keeps variant 1, so the model browser, the thumbnails and the replay
  viewer's models are unchanged.
- `_lod_swap`: a cockpit glb's `replaces` names every declared variant. The
  cockpit glb is one export, and the hull it grafts onto can be any of the
  three; `vehicle-base.js` `graftCockpit` hides the one it finds and drops the
  rest.

Divergences:

- The roll is made once, at bake time. The engine makes a new object, and
  so a new roll, on every respawn. In the viewer, a respawned Lada keeps the
  paint it was baked with.
- The counter in the bake sees only the level's rolled children in placement
  order. The game's counter has also been bumped by everything created before
  the vehicles: every soldier's random head and kit roll, and every earlier
  round on the same server process.

Checked: `test_assemble.py` `test_a_level_bake_rolls_each_placements_paint`,
`test_a_roll_onto_an_undeclared_paint_builds_no_hull` and
`test_the_cockpit_swap_names_every_paint`. A scratch bake of DC Urban Siege
(`extract_maps_all.py --mod DesertCombat --levels DC_Urban_Siege`): its four
Ladas come out 3, 1, 1, 2 and its six Pickup-bodied hulls (Pickup, Technical,
Technical_Recoilless all build `lodPickupCockpit`) 2, 3, 1, 2, 2, 3 (one counter
for both, in placement order), against 1
everywhere in the live bake. The DC cockpit glbs (`extract_models.py --cockpit
Lada Pickup`) list all three variants in `replaces`.

## Checked

Unit tests: `test_random_items.py` (counter law, kit roll, spawn/bot/pickup),
`test_kit.py` `RandomItemTests` / `SpellSoldiersTests`,
`test_extract_loadouts.py` `RandomItemLoadoutTests`, `test_kit_poses.py`
(variant jobs, the pose index), `test_animstates.py` `CopyStateSlotTests`,
`test_viewmodel.py` (variant pairs), `test_pose_compose.py` and
`test_pose_bases.py` (index resolution, case, fallbacks, `byName`).

Headless Chromium on Gold_Beach-1944 and Counterattack-1950, before and after,
against a scratch extraction overlaid on the published FHSW tree: see
"Measured" below.

## Open

- The page's helmets and hip packs (`soldier-dress.js`) roll on their own, not
  through this counter, so a spawn's weapon roll is not perturbed by them as
  it is in the game.
- A bot keeps the kit it was dealt across its respawns (a page simplification
  older than this work), so it rolls once.
- KIT-5: whether a client rolls its own copy of a remote kit.
- ANIM-14: `copyState`'s floats are the copied clips' rates; the parser keeps
  the source rate.
- FHSW's `sounds/weapons.json` lacks most `!_PACK_COMMON` weapons ("sound script
  missing: objects/Handweapons/!_PACK_COMMON/Sounds/No2.ssc"): the variants
  share the base weapons' gap, a separate fault in `extract_weapon_sounds.py`.
