# A level's own effects, and the objects spawn effects stand up

Built 2026-10-07 in the Desert Combat parity round (package `dof-effects`,
finding MS-5 of `~/.cache/dc-sweep/reports/adv-modsystem.md`). The objects
spawn effects stand up got their bodies, their place in the collider and the
damageables, their lifetime and the levels' sounds the same day (package
`spawned-objects`, the section of that name below).

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
  `lodDistance` culls do not apply to it. (What removes it since is in the
  `spawned-objects` section: its Armor and the round, EMT-11.)
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

## Spawned objects: a body, a place in the world, a lifetime, sounds

Built 2026-10-07 (package `spawned-objects`), from the gaps the `dof-effects`
fix report and its review left. Each item is its own commit.

### What the game does

- **PHY-17.** A spawned object is built from its template like any other, so
  its `hasMobilePhysics` bit picks its physics node. DC's ruins write 0 and
  never move. Both PT boat rafts write 1, so their four `FloatingBundle`s act
  on them (the ship float law, PHY-3).
- **HP-19.** A destroyed object stays its template's `timeToLiveAfterDeath`
  (`SimpleObject::handleUpdate` lnxded `0x081db2e0`), which is 10 s where it
  is not written, after a one-tick latch. Then the server destroys it. With
  `fadeAtTimeToLiveAfterDeath` (on by default) it fades out from
  `timeToStartFadeAfterDeath` (8 s by default). `resetWhenRemoved` gives the
  hit points back instead, and `stayAsDestroyed` never removes it. The
  server's `sinkInToLandAfterDeathSpeed` setter writes those defaults back
  and keeps no speed. HP-15's "wreck-respawn timer" is this clock, and its
  clears are the `resetWhenRemoved` branch.
- **HP-20.** The first tick of the end game destroys every root
  PlayerControlObject (`clearWorld` `0x081578f0`), and a map restart
  destroys every object.
- **EMT-11.** Nothing else removes a spawned object. `GameServer::spawnObject`
  arms no spawner's abandon clock: the PCO keeps the constructor's -1 there.
  A raft (`timeToLiveAfterDeath 0`) is gone the tick after it is sunk. A ruin
  of 999999 hit points stands until the round ends.
- **ARM-11, the water key.** A hull that dies afloat dies on the `-1` tier.
  That tier holds the Elco80's `e_PTBoatWreck`, so it is where the raft comes
  from.

### What was built

1. **A body** (`viewer/effect-objects.js` `bodyKindOf`, `hold`, `step`). The
   emitter spec carries the payload's `hasMobilePhysics` (`bf42/effects.py`).
   The bake builds the object at depth 0, as a placed root, so PHY-17's stamp
   lands on it too. There are three kinds of body:
   - **Static.** The bit is clear (the engine default). The object stays
     where it was stood up.
   - **Float.** The object hangs float nodes over water. It gets a
     `FloatingHull`, the ship law stepped on the world's 30 Hz ticks, with
     the sea bed as a floor.
   - **Ground.** Any other mobile object falls under gravity until its
     geometry box meets the terrain. This is a viewer simplification: it
     keeps its spawn frame.

   A raft stood up 0.47 m under rises to +0.068 in about 2 s. A drop from
   4.4 m (Pirates' dinghy) bounces twice and then floats, because
   `FloatingHull` has no box drag, an open item of `body-float.js`.
2. **Part of the world.** `CollisionIndex.addOwner` (`static-index.js`)
   appends one object's hulls under a new owner id and re-packs the grid. It
   keeps every id already handed out. `WorldCollider.addOwner` wraps it. The
   object's Armor joins the damageables under the same id
   (`vehicle-wrecks.js` `registerDamageable`, split out of
   `registerDamageables`). From then on its living tier is the damage
   system's. A float body reports its pose through `setMovedOwner` and the
   world's positions. The effects bake now includes a spawned object's
   collision hulls, which it left out along with every particle's.
3. **What removes it.** `vehicle-wrecks.js` calls back when a spawned
   owner's clock runs out, and the round's end (`round.over`) removes every
   spawned PCO (`endOfRound`). Either way the object leaves the scene, the
   collider and the damageables (`EffectPlayer.removeObject`,
   `unregisterDamageable`). `vehicle-hits.js` and `__damageVehicle` now pass
   the world's water test to the immediate death re-pick. Before this, no
   PT boat killed by a round left a raft.
4. **`timeToLiveAfterDeath` for every damageable** (`vehicle-wrecks.js`
   `afterDeath`, `afterDeathOpacity`). The exporter writes the five words
   into the armour block (`bf42/con.py`, `bf42/assemble.py`) beside an
   Armor's own words, and the wreck clock reads them.
   - A template that writes none now goes at 10 s and fades from 8 s. Before
     this it went at 12.5 s, after a 2.5 s house-rule fade.
   - The removal hides whatever of the object still draws.
   - A wreck glb that arrives after the object is gone stands nothing up.
5. **Level bundle sounds** (`extract_effects.py` `level_sound_manifest`,
   `write_level_sounds`).
   - `--levels` writes `<level>/effects.sounds.json` from the level's own
     pool and files first. The samples go in the tree's `_shared/sounds`,
     and the row names the file as `effectSounds`.
   - The page fetches it with the level. `EffectAudio.setLevel` puts it in
     front of the mod's set. A bundle the level declares sounds as the level
     wrote it, a silent copy included.
   - Battle of Britain's chimneys (their `e_ExplGas` child), Kasserine
     Pass's own `e_Fire` (`vefr1..3`) and DC Final First Light's
     `e_OilFireSuper` (`rcktlp1`, `vefr1`) resolve.
   - Kasserine's own `e_ExplAni01` includes a `../../Common` path its level
     copy does not have, so it is silent there, and its `silent` entry
     blocks the mod's sound.

### How it was checked

- **Node harnesses**:
  - `tests/effect_objects_harness.mjs` with `test_effect_objects.py`:
    - The bodies, with a baked vanilla `e_PTBoatWreck` from the install.
    - The real collider, damage set and wreck module: a boot stops on a ruin
      roof, a round lands on its wall, the moved raft is met where it floats.
    - The removals, and the boat's water death.
  - `tests/vehicle_wrecks_harness.mjs` with `test_vehicle_wrecks.py`: the
    after-death clock, and a late wreck glb.
  - `test_effect_audio.mjs`: `setLevel`.
- **Python tests**:
  - `test_effects.py`: the spec flag, the armour block, the level sound
    files, Battle of Britain and Kasserine from the install.
  - `test_con.py`: the words, and the `sinkInToLand` order.
- **In the page** (port 5647, under the browser lock,
  `~/.cache/dc-sweep/spawned-objects/inpage.cjs`, scratch bakes routed in).
  - **The raft.** Vanilla Midway places no PT boat in the page's conquest
    set, so the raft ran on Invasion of the Philippines. Killing an `Elco80`
    gave tier `-1`. Its raft floated at water + 0.07 at 0.5 s and + 0.068
    from 1 s on, upright. It is a 35 HP damageable, and a cast down meets it
    at its new pose (`inpage/midway-raft-afloat.jpg`).
  - **The ruin.** On DC No Fly Zone Day 2, the live scene had the tower's two
    new words patched in memory (`hasMobilePhysics false`,
    `timeToLiveAfterDeath 0`). The kill stood one upright ruin up, and the
    tower stopped drawing (`inpage/nfz-ruin.jpg`).
    - A soldier walking at the ruin from 30 m stopped 13.04 m from its
      centre, its hull's wall. With its owner disabled he walked 41 m
      through it.
    - Fifteen AK rounds landed on it (material 93, priced 0 against that
      material), and a 500-point `__roundHit` took it to 999499.
    - The ruin's shell is open at the top, so a soldier dropped on it lands
      inside.
    - Before the death latch was added, the same run stood no ruin up: the
      tower went in the frame it died and stopped its own death tier.

### Re-extract (the lead runs these; adds to the list above)

- **Full scene re-bake of every tree** (vanilla, XPack1, XPack2, DC, DC
  Final): `extract_maps_all.py --mod M`, then `optimise_mesh` and publish.
  The armour block's after-death words are on placed nodes in every
  `scene.glb` (the Defgun's 85 s and the AA guns' 0 s are on most vanilla
  levels). Until then every hull uses the template default, 10 s fading
  from 8.
- **Model trees**, for the same armour words on the model glbs: the next
  model extract of each tree.
- The **effects bakes** listed above, rerun after this merge: the `_shared`
  bakes (rafts with their hulls and the mobile flag) and the `--levels` bakes
  (ruins with their hulls, and the new `effects.sounds.json`). Without
  `--no-sound`, a level run needs ffmpeg. It transcodes into each tree's
  `_shared/sounds`, so publish that directory's new files with the
  `effects.sounds.json` files and the `maps.json` rows.

## Open

- **A raft cannot be entered or driven.** It is a VCSea PCO with a ship
  Engine and two seats, and the page builds no vehicle instance for an
  object that arrives after the load.
- **The bots know nothing of a spawned object.** The nav map and the cover
  list are built at load, so they neither path round a ruin nor hide behind
  it.
- **A ground body keeps its spawn frame.** It is not tipped onto the slope
  (a simplification).
- **A float body has no box drag** (`body-float.js`), so a drop from height
  bounces before it settles.
- **The spawn path's soldier clearance (SPAWN-14) is not applied.** In the
  engine, `createObjectOnAllClients` refuses a VCLand object while a live
  soldier's origin is within 2 m, which DC's ruins are.
- **A spawned object with no hulls registers nowhere.** COL-17 gives it none
  when `hasCollisionPhysics` is clear, and without an owner id, splash
  cannot reach its Armor.
- **The round's end removes only spawned PCOs in the page.** HP-20 removes
  the level's own hulls too, and the page has no map restart.
- **A falling plane's clock still restarts when it lands** (the page's
  rule). HP-19's clock runs from the death.
- **Not read:** the client's half of a spawn emitter (EMT-10 is the
  server's).
- **For other packages:**
  - No Fly Zone Day 2's other objective PCOs (hangars, radar domes) move
    under the page's physics in the live 2026-09-30 bake. PHY-17's stamp
    fixes them on the re-bake.
  - The day-1 bake has none of the objective PCOs (MS-9).
- **Missing ledger rows.** `soldier-armor-effects.js` cites ARM-8..ARM-10,
  and the code cites EMT-9 for the ramp read. None of these rows exist.
