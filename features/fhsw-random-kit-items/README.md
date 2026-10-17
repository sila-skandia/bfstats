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

## 5. Seventeen rolled and thrown items had no arms (2026-10-12)

The behaviour audit on Battle_Of_Foy: `RandomGerGrenadierRG2` raised with no
first-person rig, and only `RG3` in the tree. The game has the rig. `RG1`
and `RG2` are stick grenades whose `Ub_StandAim` state is a copy of
GrenadeAxis's; a later copy in the script names
`StandWalkRun/1p/RandomGerGrenadierRG2/1pStandAimRandomGerGrenadierRG2.baf`,
a folder no archive holds, and the old parser let it replace the first, so
the state had no idle and no rig was written. The engine keeps the first
copy (ledger ANIM-16), and since 26d9523d the parser does too, but that
commit re-exported only the rigs whose clips moved. 17 FHSW pairs had become
exportable and were not: `RandomGerGrenadierRG1/2`, `RandomSmokeItem4Ger1/4`,
`RandomSmokeItem5Ger1/4`, `RandomSmokeItem4RDG21/24`, `GeballteLadung` on four
soldiers, `RDG33` on four, `RDGGeballte`. All 17 exported into the local
FHSW tree (690 to 707 rigs, nothing published); FH, vanilla and the packs
had none missing.

`tests/test_viewmodel_rigs_on_disk.py` fails when a kit of a baked level
hands out an item whose rig `viewmodels/index.json` does not list.

## 6. A level copy's rolled items were asked for by the bundle (2026-10-17)

`test_every_kit_pair_of_a_baked_level_has_a_rig` failed on
`FMGermanSoldier__RandomP08P38`, `FMGermanSoldier__RandomSmokeItem4Ger` and
`RussianSoldier__RandomSmokeItem4RDG2` (FHSW) and the last again in
FHSWEurope. The engine never makes the bundle (KIT-1), and neither does the
page: `loadouts.json` `levelKits` carries each level copy's own `random`
list, and `random-items.js` rolls it, so on Kiew `4German_OfficerMp40` hands
out `RandomP08P381..3` and `RandomSmokeItem4Ger1..6`, and on Berlin
Outskirts `4Rus_OfficerPPS43Smoke` hands out `RandomSmokeItem4RDG21..4`
(four rolls, where the mod's kits roll six).

The fault was ours: `kits.json` listed a level copy's items by name alone,
and `kit_pair_levels` took a rolled item's variants only from the kit's own
row, so a bundle only the level's copy carries (the mod's Kiew officer kit
carries `WalterP38`, its copy `RandomP08P38`) went to the rig exporter by its
bare name: twelve "no such weapon template" lines in the FHSW run, all
bundles.

- `extract_kits.py` `item_rows`: a level copy's items carry their own
  `variants`, read from that level's load, as the kit's own items do.
- `extract_pose.py` `kit_pair_levels`: a level copy's rolled item asks for
  its own `variants`, else the kit's own roll of it, else every variant any
  kit in the file rolls under that name (`rolled_bundles`, for a `kits.json`
  written before the first change; it can ask for more variants than the
  copy rolls, never fewer: no level copy's roll of a carried item is wider
  than the mod kit's in any tree on this PC).

The log line `RussianSoldier + RandomSmokeItem4RDG21: idle clip unreadable:
Animations/StandWalkRun/1p/RandomSmokeItem4RDG21/1PStandAimRandomSmokeItem4RDG21.baf`
(and RDG24, `RandomSmokeItem4Ger1/4`, `RandomGerGrenadierRG1/2`,
`GeballteLadung`, `RDG33`, `RDGGeballte`) is from the two 2026-10-12 runs
before 26d9523d, the section 5 fault. No archive of the chain holds that
folder; the later `copyState` that names it never replaces the first, and
the first gives RDG21 and RDG24 `StandWalkRun/1p/GrenadeAllies/1PStandAimGrenadeAllies.baf`
(the others `GrenadeAxis`'s, `RandomP08P381` `WalterP38`'s). The 2026-10-17
runs export all of them in both trees, as does a scratch export from current
main. Not an LZO or archive-read failure.

Vanilla, XPack1, XPack2: no rolled kit items. FH: six bundles, all in kits'
own rows, no level copy rolls one; nothing missing in any of the four.

## 7. A dropped kit is held in the picker's arms (2026-10-17)

A pickup has no team test (KITDROP-6), so on any level a soldier of either
side can hold what the other side's kits hand out, in his own sleeves.
`kit_pair_levels` asked only for a kit's slot soldiers and pad soldiers, and
the page borrowed another soldier's rig of the weapon (`arms-rig.js`
`rigEntryFor`): a Russian with a picked-up MP40 wore German sleeves.

- `kit_pair_levels(kits, levels, loadouts)`: with `loadouts.json`, every
  team soldier of a level (`levels[<level>][<team>].soldier`) is paired with
  every item any kit of that level hands out, rolled variants included.
  `extract_viewmodel.py --loadouts` (default `<maps dir>/_shared/loadouts.json`)
  and the pipeline's `viewmodels` step (now after `loadouts`) pass it.
- `pose-bases.js` `rigEntryIn`: the soldier's own rig first, in any tree and
  case; another soldier's only when no tree has his.

Pairs per tree (exported levels), before -> after, and the rigs the next
viewmodels pass adds: vanilla 113 -> 183 (9), XPack1 147 -> 242 (95),
XPack2 145 -> 244 (99), FH 252 -> 330 (78), FHSW 3,121 -> 4,224 (1,112),
FHSWEurope 2,696 -> 3,329 (635); 2,028 in all. A scratch export of 50 of
FHSW's at `-j 20` took 41 s, 29 s of it the one-off load (a one-rig run),
so about 0.25 s a rig: some 8-9 minutes across the six trees, and about
2.7 MB a rig before `optimise_mesh.py` moves the textures out.
`test_viewmodel_rigs_on_disk.DROPPED_PENDING` lists the trees not re-run yet.

Not done: the third-person poses (`extract_pose.kit_item_pairs`) still pose
only the kits' own pairs.

## 8. The kits audit checks every roll (2026-10-17)

`audit_play.py` (`audit_mod.py --audit kits`) skipped every `Random*` item.
It now checks each variant `<bundle><n>` the kit can roll on that level
(loadouts `levelKits` / `kits` `random`, else kits.json `variants`): a
declared variant goes through the weapon's rig causes and, with its rig,
must have a pose (`kit-roll-variant-no-pose`); a roll the table names no
template for is `kit-roll-variant-unlisted` (a blocker: the chain or level
declares it after all) or `kit-roll-variant-undefined` (accepted, KIT-3:
nothing declares it, so that spawn gets nothing). Fixture:
`test_audit_play.py` `KitTree` (`test_each_roll_of_a_rolled_item_needs_a_template_a_rig_and_a_pose`).
On the trees of 2026-10-17 it walks 44 rolled pairs in FH, 1,981 in FHSW and
240 in FHSWEurope (none in vanilla or the packs), and finds nothing.
`audit_behaviour.mjs` plays the variant each spawn rolls (`__kitRotation()`
names it), so it needed no change.
