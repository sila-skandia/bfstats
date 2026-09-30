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
