# A level's own effects, and the objects spawn effects stand up

Built 2026-10-07 in the Desert Combat parity round (package `dof-effects`,
finding MS-5 of `~/.cache/dc-sweep/reports/adv-modsystem.md`).

Destroying an objective building on Desert Combat's No Fly Zone (both days)
or Weapon Bunkers showed nothing. Its death tier names a bundle such as
`e_air_control_tower_desWRECKPCO`, and only the level's own archive declares
it. `_shared/effects.glb` is baked from the mod's object scripts, so the name
resolved nowhere and `effects.play` returned nothing. Vanilla Battle of
Britain had the same gap: its radar towers' `e_ScrapMetal_RadarTower` and the
Ju88's `e_ScrapMetal_Ju88A`.

## What the game does

- A level's scripts run before the mod's, and the first `create` of a name
  wins (`extract_map.LevelFirst`). A level's bundles exist while that level is
  loaded, and they beat a mod bundle of the same name. Kasserine Pass, for
  one, redeclares `e_ExplGas`.
- **EMT-10.** An emitter with `isSpawnEffect 1` makes no particle. The game
  creates its template as a real object at the spawn point, in the spawn frame
  (`GameServer::spawnObject`, sent to every client). The server runs only
  these emitters, and it asks for no camera. Each WRECKPCO emitter is vanilla's
  PT boat raft emitter, copied word for word. Its payload is the ruined
  building, a PCO with 999999 HP that burns at its own `1000000` tier.
- **ARM-11.** Each effect of an armour tier, the death tier included, is a
  child of its object at the authored offset, with no rotation of its own.

## What was built

- `extract_effects.py --levels` bakes each level's own bundles into
  `<level>/effects.glb`, with `effects.report.json` beside it. It uses the
  level bake's library (`scene_layers.LevelContext`), so the scripts are the
  ones `Init.con` runs, in the engine's order. It names the glb in the
  level's `maps.json` row as `effects`, and it optimises what it wrote. A level
  with no bundles of its own loses the key and the files. `extract_maps_all.py`
  keeps the key, the glb and now its `.gz` across a full re-bake.
- `bf42/effects.py` `emitter_spec`: a spawn emitter's particle is
  `{kind: "object", template}`. `Assembler.bake_effect_library` hangs the
  object's whole tree under the emitter node. It bakes that tree with the
  model export's material settings.
- `viewer/effects.js`: `EffectLibrary.setLevel` puts a level's library in
  front of the mod's. `EffectPlayer` clones an object emitter's tree into the
  world at the spawn point and frame (`#spawnObject`). The view and
  `lodDistance` culls do not apply to it, and the object stays until `clear()`
  (a level change).
- `viewer/effect-objects.js` (`onObject`) lights the object, hides its
  collision hulls and starts its own living tier (`tierAt` on
  `ceil(hitPoints)`).
- `viewer/map.html` fetches the row's `effects` glb with each level
  (`loadLevelEffects`). A row with no key costs no request. This avoids
  probing for a file most levels lack, which the CDN would cache as a 404.
- `viewer/vehicle-wrecks.js`: a death now plays its tier once. Every caller
  hands the death tier to `showDamageTier`, and `wreckVehicle` then played it
  a second time, at the hull's origin on the ground's normal. In the page, one
  kill stood the ruin up twice. `wreckVehicle` now plays only the `e_ExplGas`
  stand-in, and only for a hull with no death tier. `playTier` gives each entry
  of a tier its own anchor at its own offset (ARM-11). Before, two entries of
  one bundle shared the first one's offset.

## What changes for vanilla and the expansions

These changes are engine-correct by EMT-10 and ARM-11. They need the
re-extracts listed below to show.

- `e_PTBoatWreck` and `e_Type38Wreck` were listed as missing in every tree's
  `_shared/effects.report.json`, because their emitter's payload is a PCO. They
  now bake as raft objects: the raft appears where the boat died, about 19 KB
  of geometry each.
- XPack2's `e_EssenSiloWreck` and `e_EaglesNestSafeWreck` were debris that
  fell for 3 to 5 s and vanished. They are now wreck objects that stay where
  they spawn.
- Death tiers keep their offsets and the hull's heading. Battle of Britain's
  dish scrap now starts 8 m up, and a Kubelwagen's explosion 1.2 m up. Each
  death explosion plays once instead of twice.
- Three vanilla-era levels get a glb of their own, in every tree that holds
  them:
  - Battle of Britain: 3 bundles, 511 KB raw.
  - Kasserine Pass: 7 bundles, 125 KB. Five of them are its own copies of
    common bundles.
  - Raid on Agheila: 4 bundles, 505 KB, among them `e_SpawnAmmobox`, a spawn
    effect.

  A scratch run over XPack2's 32 rows found no others.

## How it was checked

- `tests/test_effect_objects.py` with `effect_objects_harness.mjs` uses the
  page's modules, the vendored three.js and the GLTFLoader. The install-gated
  case bakes No Fly Zone, builds the control tower's armour from the level
  library, and kills it through `showDamageTier` + `wreckVehicle`, as
  `vehicle-hits.js` does. The checks pass:
  - `e_air_control_tower_desWRECKPCO` resolves.
  - One `air_control_tower_des_wreck` (a PCO) stands at the tower's position
    with a heading error of 0.
  - It starts `e_DefGunDamage` x3 and `e_PanzFire`.
  - `clear()` removes it.
- The synthetic cases cover the library's level set, the death tier played
  once in the host frame at two offsets of one bundle, and the stand-in.
- `tests/test_effects.py` `SpawnEffectTests` and `LevelEffectsTests` cover the
  object spec, the baked object tree, which names a level's glb holds, and how
  the row and files are written and cleared. `tests/test_extract_maps_all.py`
  covers the kept `.gz`.
- In the page, No Fly Zone Day 2 ran with the scratch glb routed in through
  Playwright (`~/.cache/dc-sweep/dof-effects/inpage.cjs`, under the browser
  lock). `__effectNames()` listed the four WRECKPCO bundles. Killing the Iraqi
  tower with `__damageVehicle` gave `objects: 1`, with smoke and fire on the
  ruin (`inpage/after-dead*.jpg`). Before the double play was fixed, the same
  run gave `objects: 2`.
- The scratch bakes give No Fly Zone and Day 2 4 bundles each (2.9 MB raw,
  0.6 MB gzipped after `optimise_mesh`), Weapon Bunkers 1, and Battle of
  Britain 3. None is missing.

## Re-extract (the lead runs these)

```bash
cd tools/bf1942-models
# the level sets: seconds a level, optimised as written
python3 extract_effects.py --mod bf1942 --levels Battle_of_Britain Kasserine_Pass
python3 extract_effects.py --mod DesertCombat --levels      # every row; 3 levels get a glb
python3 extract_effects.py --mod DC_Final --levels
python3 extract_effects.py --mod XPack1 --levels
python3 extract_effects.py --mod XPack2 --levels
# the mod-wide sets, for the rafts and XPack2's wrecks
python3 extract_effects.py --mod bf1942 --out viewer/maps/_shared
python3 extract_effects.py --mod XPack1 --out viewer/maps/mods/xpack1/_shared
python3 extract_effects.py --mod XPack2 --out viewer/maps/mods/xpack2/_shared
python3 extract_effects.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared
python3 extract_effects.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared
```

Then publish the level glbs, their `.gz`, the four `maps.json` files and the
`_shared/effects.*` files with `scripts/publish-mesh-delta.py`. A `maps.json`
row without the `effects` key loads exactly as before.

## Open

- The ruin draws, burns and stays. It is not in the level's collider or its
  damageables, so nothing stands on it or shoots it further. A raft does not
  float or drive.
- **A spawned hull stays at its spawn point, which is not where it rests.**
  The raft is a mobile PCO with four floaters (`hasMobilePhysics 1`); the
  game drops or lifts it onto the water. Measured through the page's own
  modules (review, 2026-10-07): an `Elco80` floating where `body-float.js`
  puts it (root 1.87 m under the water) stands its raft up with the root
  0.47 m under the water, 0.54 m below where its own floaters hold it, so it
  shows half sunk. A recorded Midway raft (`replay_20260927-203459`, object
  681) rides at water + 0.07 to 0.12 m, which is the float law's +0.068. A boat
  that sank before it died puts it deeper. Other mods hit the same gap on
  their next effects bake: Pirates' Privateer dinghy (`0/5/3`) would hang
  4.4 m above the water, FHSW's `Independence` carriers put two rafts at
  their own origin height (`±14/0/85`), and FH's bee nest spawns an
  `Elco80Raft` on dry ground. The fix is a body for
  the adopted object (`body-float.js` `FloatingHull` over water, the ground
  otherwise), not a snap to the water level.
- What removes a spawned object in the game was not read. The page keeps it
  until the level changes.
- The client's half of a spawn emitter was not read (EMT-10 is the server's).
- A level bundle's sound is not exported. The level-only bundles with a
  script are `e_BritainFactory_SmokeStacks` and `e_Fire` (vanilla) and
  `e_OilFireSuper` (DC Final). They play silent.
- The building's own `.wreck.glb` (its destroyed LOD) lingers 10 s and fades
  over the ruin. The tower declares `timeToLiveAfterDeath 0`, which the wreck
  code does not read.
- Found in the page, for other packages:
  - No Fly Zone Day 2's objective PCOs leave their baked pose under the page's
    physics. The tower ended about 6 m higher and on its side, and hangars
    floated. They declare `hasMobilePhysics 0`. The ruin stands up in the
    dying tower's frame (ARM-11, EMT-10), so until that is fixed the Day 2
    ruin lies on its side too (review re-run, 2026-10-07).
  - The day-1 bake has the buildings' plain bundles (`air_control_tower_m1`)
    but none of the objective PCOs, so on day 1 nothing can be destroyed
    (MS-9's unreached scripts).
- `soldier-armor-effects.js` cites ledger ARM-8..ARM-10, and the code cites
  EMT-9 for the ramp read. None of these rows exist in the ledger. ARM-11 and
  EMT-10 were numbered past them.
