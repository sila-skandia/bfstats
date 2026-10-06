# Desert Combat's mortar and kit pads

Status (2026-10-06): both are built in the viewer. The mortar deploys on the map
page; kit pads lay down and hand out every kit the tree's `loadouts.json`
knows. DC 0.7's own two pad kits (the M82 and the Stinger) reach that file
once the lead re-extracts its tree (commands below). DC 0.7's mortar not
clearing its thrower is open.

The engine's ObjectSpawner, as a soldier on foot meets it, in two forms:

- **The mortar.** DC's Support kit carries `Mortar_weap`. Its round,
  `mortarbomb`, carries the ObjectSpawner `mortarspawner3`, and that spawner
  places a `Mortar` a soldier can crew. Nothing on the hand weapon names the
  mortar. The chain is weapon -> `projectileTemplate` -> the round's
  `addTemplate` children -> the spawner -> its `setObjectTemplate <team>`.
- **Kit pads.** A level's ObjectSpawner whose `setObjectTemplate` names a Kit
  lays that kit on the ground for anyone to take. DC 0.7 places `US_Sniper_hvy`
  (the M82 Barrett) on 18 levels and `US_AA` (the SA-7) on 6, and hands out
  neither from a spawn-screen slot. DC Final places the same kits on 22
  levels, and also binds them to slots on some.

The engine rules are ledger SPAWN-9..SPAWN-16. They sit beside SPAWN-2 (which
`setObjectTemplate` entry a spawner uses), AI-121 (the spawn pose), XHIT-12
(the round leaves from the camera) and KITDROP-1..8 (a kit on the ground).

## The record

The code was written on 2026-09-30 by an agent that hit its usage limit
before it wrote this README, `tests/test_deployables.py` and the SPAWN rows.
All three are cited by the code. Salvage commit `75edb204` kept the code. The
originals never existed: the agent's transcript has no write to any of them,
and no branch, worktree, stash, reflog entry or dangling object holds them.
They were written on 2026-10-06 from the code, its citations and a fresh read
of every cited address. That read corrected one claim: `SpawnerPad.tick`'s
`critical(id)` hook stands for `Armor::isDestroyed` (vt+0xc8), not critical
damage (SPAWN-11).

## What was built

| Piece | File | What it does |
|---|---|---|
| Spawner data | `tools/bf1942-models/extract_deployables.py` -> `models/mods/<mod>/deployables.json` | The weapons whose round carries a spawner, the spawner's fields with the engine's defaults filled in (`ObjectSpawnerTemplate` ctor, SPAWN-9), and the hit points, critical damage and category of each object it places |
| Rules | `viewer/deployables.js` | The round's flight and death, `spawnClear` (SPAWN-14), `AbandonClock` (SPAWN-13), `calcSpawnDelay` and `SpawnerPad` (SPAWN-9..12). No three.js, so node runs it |
| Page | `viewer/deployables-page.js` | Follows the human's mortar round (`guns.onShot`), places the tree's own `Mortar.glb` under the level's `spawners` group, where its seats, doors and gun work as on a placed emplacement, and runs its abandon clock. Builds a `SpawnerPad` for each `objectSpawns` entry of the active mode whose template is a kit `loadouts.json` knows (matched case-blind: DC spells `US_Sniper_hvy` three ways). It removes the bake's inert copy at the pad and lays the kit through `kit-drops-page.js` `placeKit`. A pad under a control point (`osId`) follows the flag (SPAWN-12) |
| Kit on a pad | `viewer/kit-drops.js`, `viewer/kit-drops-page.js` | A pad's kit lies with no timer (SPAWN-15), is taken with G like any dropped kit, and keeps its `objectId` through the hands that take it, so the pad stays full while the kit exists |
| Pad kits in the extractors (2026-10-06) | `bf42/kit.py` `level_pads`, `bind_pads`; `extract_loadouts.py`; `extract_kits.py`; `extract_viewmodel.py` `kit_pairs` | Below |

### Pad kits in the extractors

Kit extraction bound only `game.setKit` kits (`1d00baa7`). So DC 0.7's
`loadouts.json` had no row for `US_Sniper_hvy` or `US_AA`, the page made no
pad, the bake's pile (kit, helmet, packs, M82, M9 and knife) sat inert, and
the tree had no pickup glb and no M82 or SA-7 first-person rig.
DC Final escaped only because some of its levels bind the same kits to slots.

- `kit.spawner_templates` reads the templates a level's *placed* spawners name
  in every gameplay layer the level ships. Those are the layers a bake writes
  `objectSpawns` for: each mode directory, plus each game type whose `run`
  lines straddle two. Both sides' entries count, because a pad hands out the
  holder's. A malformed layer is skipped and the rest still count.
  `kit.level_pads` does this per level, through the mod chain as a bake reads it.
- `kit.bind_pads` keeps the kits. Each one is live on that level (`levels`,
  `pads`). Every soldier the level fields goes in `pickupSoldiers`, because
  the pickup has no team test (KITDROP-6). A kit no slot binds anywhere is
  drawn in the kit browser on its own side's soldier (`setKitTeam`).
- `extract_loadouts.py` writes a row for a kit only pads place. Its hit points
  are those of the level's soldier on the kit's side. A kit a slot binds keeps
  the row its slot gives. A level's own copy of a pad kit gets a `levelKits` row.
- `extract_kits.py` exports a pad kit's pickup mesh and worn parts. It lists
  `pads` and `pickupSoldiers` on the kit's `kits.json` row, and only on a kit
  some pad places.
- `extract_viewmodel.py` `kit_pairs` also asks for each pickup soldier's
  sleeves, so an Iraqi who takes the M82 holds it in Iraqi arms.

Operation Bragg's pads also name `ust`, `ist`, `usk` and `isk`. They are
`PlayerControlObject` spawn carriers from the level's
`objects/talilSpawns/objects.con`, not kits, and stay out
(`tests/test_kit.py` `RealDesertCombatPadTests`).

`extract_pose.py --kit-poses` (the service record) does not pass `pads`, so
its poses are unchanged.

## How it was checked

- `tests/test_deployables.py` runs `deployables_harness.mjs` against
  `deployables.js`. It checks the clearance, the abandon clock, the delay
  formula, a pad's first-frame spawn and full slot, and the team entry. It
  also runs `kit_pads_harness.mjs`, which drives `deployables-page.js` under
  node with the vendored three.js on a made-up level. That level has an M82
  pad spelled `US_Sniper_Hvy`, a two-sided AA pad, a vehicle and Bragg's `UST`.
  It gives two pads, the baked copy gone and the kits laid at its spot. With
  the old loadouts it gives no pads and the pile stays.
- `tests/test_kit.py` (`LevelPadTests`, `BindPadsTests` and
  `RealDesertCombatPadTests` on the installed DC archives),
  `tests/test_extract_loadouts.py` `PadKitManifestTests`, and
  `tests/test_viewmodel.py` `test_a_pad_kit_is_held_in_every_side_s_sleeves`.
- Every tree was extracted into scratch, with HEAD's code and then this code:
  - Vanilla and XPack1: `loadouts.json`, `kits.json` and every kit glb are
    byte-identical before and after. Vanilla's are also identical to the live
    tree.
  - XPack2: `loadouts.json` and the glbs are identical. `kits.json` gains
    `pads` and `pickupSoldiers` on `GermanElite_JetPack` (Essen, Hellendoorn,
    Kbely Airfield, Raid on Agheila) and `GermanElite_Scout` (Raid on
    Agheila). Both kits were already slot-bound, so the page already made
    those pads.
  - DC Final: `loadouts.json` is identical. `kits.json` gains the pad fields
    on `US_Sniper_hvy`, `US_AA` and `Iraq_AA`.
  - DC: the loadouts gain exactly two rows, and the kits gain two rows and
    two pickup glbs (417 and 420 triangles, every texture resolved).
- The page was checked over the whole tree: every level's and mode's
  `objectSpawns` from the live `scene.json` files went through
  `kit_pads_harness.mjs`.
  - DC: 18 levels and 59 level-modes hold 214 kit-pad entries. All 214 become
    pads with the new `loadouts.json`, against 0 with the live one. The pads
    lay 129 kits in their first second (US_AA 50, US_Sniper_hvy 79); the rest
    wait on their team or flag.
  - DC Final: 266 of 266.
- The six new DC rigs (`USSoldier` and `IraqSoldier` x `M82Sniper` and `SA-7`,
  and `IraqSoldier` x `KnifeAllies` and `M9_beretta`) were exported to
  scratch. Each has all its clips and no missing textures. DC Final's live
  `viewmodels/index.json` already holds all nine pairs the new `kits.json`
  asks for.
- The weapon sounds, third-person poses and scope art for `M82Sniper` and
  `SA-7` were already in the DC tree.
- On the page (2026-10-06, headless, the scratch `loadouts.json`, `kits.json`,
  pickup glb and rigs served over the live tree's with `page.route`), DC's
  Desert Shield made its 4 M82 pads. The scene's 4 baked piles were gone and
  the 4 kits lay with their pickup mesh drawn. With the live `loadouts.json`
  it made no pads and the 4 piles stayed. An Iraqi and then a US soldier
  each stood on a pad and took the kit (`__kitDrops.pickup`). Each then held
  `M82Sniper`, 10 rounds and 4 magazines, in his own sleeves
  (`IraqSoldier__M82Sniper`, `USSoldier__M82Sniper`). The kit kept its pad's
  `objectId` and the pad's slot stayed full. No page errors.

## What is open

- **DC 0.7's mortar never clears its thrower** (SPAWN-16, derived and not
  measured). `projectilePosition 0/0/0` lands the round 0.93 m ahead of him,
  and it dies at 1 s before the spawn point is 2 m from his origin. So on a
  level throw it places nothing. DC Final's `Mortar_weap/Objects.con` raised
  the point to 0/1/0 "to stop mortar falling". Whether retail 0.7 deploys at
  all on flat ground is a server-lab question (skill `bf1942-server-lab`).
  Do not "fix" it before that is measured.
- The placed mortar is in no collision index the page builds at load, so
  rounds and blasts do not reach it. A room does not replicate the mortar or
  the pads.
- Not read: the rest of `PlayerControlObject::handleFrameUpdate` after the
  abandon billing (a terrain and combat-area test), and the `Object.setOSId`
  side of a pad's join to its control point. `Kit::enable` is called through
  its vtable, so its callers beyond the spawn path are not enumerated.
- Any dropped kit is anyone's (KITDROP-6), but only pad kits ask for the
  other side's sleeves. An Iraqi who takes a dead American's `US_Assault`
  still borrows US arms (`arms-rig.js viewmodelRigFor`).
- Pad kits are common outside DC. A census of the installed mods found pads
  that place kits in FH (217 kits), bf1918 (162), bg42 (54), EoD (51),
  FinnWars (40), Interstate (9) and GCMOD (6); FHSW's census was not
  finished. Each of those trees moves when its kits are next re-extracted.
  FHSW's `telemark-1943/ObjectiveMode/ObjectSpawns.con` has ten
  `Object.absolutePosition` lines with no argument, and
  `level.parse_static_objects` raises on them. `level_pads` skips that
  layer, but a bake of that level probably hits the same error.

## Re-extracting a tree

From `tools/bf1942-models`:

```bash
# Desert Combat 0.7
python3 extract_loadouts.py --mod DesertCombat \
    --out viewer/maps/mods/desertcombat/_shared/loadouts.json
python3 extract_kits.py --mod DesertCombat \
    --maps viewer/maps/mods/desertcombat/maps.json --out viewer/models/mods/desertcombat
python3 extract_viewmodel.py --mod DesertCombat \
    USSoldier SA-7 IraqSoldier SA-7 IraqSoldier KnifeAllies IraqSoldier M9_beretta \
    USSoldier M82Sniper IraqSoldier M82Sniper \
    --out viewer/models/mods/desertcombat/viewmodels
# DC Final: only kits.json moves
python3 extract_kits.py --mod DC_Final \
    --maps viewer/maps/mods/dc_final/maps.json --out viewer/models/mods/dc_final
```

Then publish with `scripts/publish-mesh-delta.py`. No level re-bake is
needed, because the page takes the bake's pile out itself.
