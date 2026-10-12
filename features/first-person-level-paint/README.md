# Level paint: the arms and the soldiers wear the level's textures

Status: built 2026-10-12, first for the first-person arms (sections 1 to 4),
then the same day for the third-person soldiers and what they carry
(section 6). All five trees (bf1942, XPack1, XPack2, FH, FHSW) carry their
skins locally; nothing is published.

Reported from hand-testing FHSW's Battle of Foy as the Allied assault kit:
"In retail the player has gloves, I don't see that in ours."

## 1. What retail draws

The gloves are a texture, not a mesh, a kit or a soldier. Battle of Foy's
soldier is the mod's ordinary `USSoldier` (`game.setTeamSkin 2 USSoldier`),
its hands the ordinary `1pUSRightHand` / `1pUSLeftHand` whose shader names
`texture/Ste_hand2`. The level's `Init.con`
(`FHSW/Archives/bf1942/levels/Battle_Of_Foy.rfa`, lines 14 to 26; team skin line 41) adds
thirteen `textureManager.alternativePath` folders, and the engine looks a
texture's file name up under each, in the order declared, before the path the
shader wrote (ledger LOAD-3). For the M1 Garand rig:

| Rig image | What Foy reads | From |
|---|---|---|
| `texture/Ste_hand2.dds` (bare skin) | `texture/ENVIROMENT_WINTER/Ste_hand2.dds`, a grey wool glove | FH `texture.rfa` |
| `texture/Ame1_sleeve_T.dds` (summer sleeve) | `texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds`, olive winter | FH `texture.rfa` |

`GENERAL_US_WINTER` holds a `Ste_hand2` too (a green glove) and loses:
`ENVIROMENT_WINTER` is declared first. The German sleeve on the same level is
`texture/Levels/bulge/Ger1_sleeve_T.dds`, white.

## 2. Why we missed it

`extract_viewmodel.py` builds each `<Soldier>__<Weapon>.fp.glb` once a mod,
from `build_pools(chain, [])`: the mod's archives with no level loaded and no
alternative path. `arms-rig.js` `fetchRig` asks for the rig by soldier and
weapon only. Nothing in the chain knew a level. The level bake has applied the
alternative paths since 2026-09-30 (`extract_map.mount_level_pools`), but only
to what it bakes into `scene.glb`: statics and placed vehicles. Everything
extracted mod-wide and mounted at run time skipped the rule.

## 3. What was built

- `extract_viewmodel.py`, with `--maps`: after the rigs, `write_level_skins`
  resolves every image the tree's rigs carry (and vanilla's, which a mod's
  page mounts for inherited pairs) as each baked level would, and writes what
  differs: `viewmodels/skins.json` (level folder, then rig image to the file
  the level reads) and `viewmodels/skins/<level>.skin.glb` holding those
  textures, one material each. `optimise_mesh.py` moves them into the shared
  texture store like any glb's. `--level-skins-only` rewrites just these.
- `viewer/level-skin.js`: fetches the index once a tree and a skin once a
  level, and swaps the colour maps of a rig before `mountRig` binds its
  shading. `arms-rig.js` `fetchRig` calls it for the page's soldier and for a
  replay's first-person weapon (`ctx.levelDir`). A tree without skins.json, a
  level without a row and a skin that fails to load leave the rig as it was.
- `audit_mod.py` `level_paint_findings` (in the `models` audit): for each baked
  level, what the install says the level repaints against what skins.json
  hands the page. `viewmodel-level-paint-missing` names the level, the rig
  image and the file.
- `mod_pipeline.py`: the `viewmodels` step already passes `--maps`, so every
  run of it writes the skins.

Tests: `tests/test_viewmodel_level_skin.py` (Foy's own path order, a level
archive's folder as a path, the skin file, the index, the viewer swap under
node).

Checked in headless Chromium on Battle of Foy, FHSW, Allied assault, M1
Garand: before, a bare hand and a grey-brown sleeve; after, a grey wool glove
and an olive sleeve, with `skins/battle_of_foy.skin.glb` fetched once.

## 4. How far the same cause reaches

Levels whose alternative paths change a texture some arms rig of the mod
carries, read from the install on this PC (all levels the mod can load, with
the teams' own soldiers only):

| Mod | Levels | Repaint a rig | Hands | Examples |
|---|---|---|---|---|
| bf1942 | 23 | 7 | 0 | Kasserine Pass's sleeves and landmine (`AltTextures`), the Pacific grenade (`Texture/Pacific`), Truk's sleeves |
| XPack1 | 29 | 7 | 0 | the inherited vanilla seven |
| XPack2 | 32 | 9 | 2 | Hellendoorn and Telemark: `Texture/Winter/Ste_glove`, the commando and elite jackets |
| FH | 80 | 63 | 9 | sleeves on 57 levels, gloves on the winter ones |
| FHSW | 162 | 130 | 24 | sleeves on 103, gloves on 24, the satchel on 65 |

The skins of a tree are rewritten in seconds, with no rig or body touched
(the run optimises what it wrote):

    python3 extract_viewmodel.py --mod <M> --maps <maps>/maps.json \
        --out <models>/viewmodels --level-skins-only

## 5. Open

- **Things thrown, fired or set down are not painted.** A grenade in the air,
  a rocket, a deployed weapon (`deployables-page.js`), a mine on the ground
  and the CTF flag load their own glbs and are not handed to
  `wearPagePaint`. Their images are in the skin only where a soldier's glb
  carries the same one (Foy's `landmine_T` is, through the arms rig).
- **Vehicles spawned at run time** take the level's paint from the level's
  own bake where the bake holds the same template (`replay-assets.js`
  `levelSkins`, by leaf name). That is a second mechanism with the same
  purpose; it was left alone.
- **One picture under two names in one body.** The texture store keeps a
  picture once, and GLTFLoader hands every image at one address the same
  texture, named for the first. A body whose glb holds two images of the same
  bytes that a level repaints differently would have both painted as the
  first. Not seen in the five trees; not ruled out by a census either.
- **The parachute canopy** is painted when it is first loaded and not again
  when the page changes level in place.
- A level that changes its paths by game mode (FH's `v_is_coop` arm) is read
  as a Conquest host runs it, as the bake does.

## 6. The third-person soldiers (2026-10-12)

The owner, after the gloves: "fix the third-person bodies too". Same cause,
same mechanism, more loaders.

### What is mounted on a soldier at run time

| What | Loaded by | Files | Painted before |
|---|---|---|---|
| The body, on foot and in a seat: the page's own, the bots', a replay's, the room's, the controls preview | `pose-compose.js` (`compose`, `monolithic`), for `foot-body.js`, `bot-visuals.js`, `seat-pose.js`, `seat-body.js`, `replay-assets.js`, `netcode-render.js`, `controls-preview.js` | `poses/rigs/<Soldier>.rig.glb` + `poses/*.pose.json`, or `poses/*.pose.glb` | no |
| The weapon in the hand of a split pose | `pose-compose.js` `compose` | `<Weapon>.glb` | no |
| Helmet, pack and pouches of the kit | `soldier-dress.js` `dress` | `*.kit.glb` named by kits.json `worn` | no |
| A dropped kit | `kit-drops-page.js` `sourceFor`; a replay's, `map.html` `kitPickupModel` | kits.json `pickup.glb` | no |
| The parachute canopy | `foot-body.js` `footCanopyAsset` | `poses/gaits/*.glb` | no |
| A soldier's plain model, a replay's and the room's last resort | `replay-assets.js` `model`, `netcode-render.js` `model` | `<Soldier>.glb` | no |
| The first-person arms, and the bare weapon where a pair has no rig | `arms-rig.js` `fetchRig` | `viewmodels/*.fp.glb`, `<Weapon>.glb` | yes, for images an arms rig also carries |
| Gait, swim, death and blast clips | `foot-body.js`, `replay-assets.js` | `poses/gaits/*.gait.glb` | joints only, nothing to paint |

The deploy screen draws no soldier (its kit list is HUD art), so it has
nothing to paint.

### What was built

- `extract_viewmodel.py`: `soldier_glbs(models)` lists the glbs above for a
  tree (everything under `poses/`, every `glb` kits.json names, the model of
  every kit item and kit soldier), and `painted_images` adds their images to
  the arms rigs' (vanilla's too for a mod's tree). `expected_level_skins`
  resolves that set, so the one `skins.json` and the one
  `skins/<level>.skin.glb` a level now cover both. `--level-skins-only` is
  unchanged. In `mod_pipeline.py` the `viewmodels` step already runs after
  the kit and pose steps, which is the order this needs: the skins are read
  off the bodies on disk.
- `viewer/level-skin.js`:
  - `sharePagePaint` / `wearPagePaint`: the page's level for loaders that are
    not told it. `arms-rig.js` shares it (`page.currentDir`); the composer,
    the dresser, the kit drops, the canopy and the two plain-model loaders
    wear it before the shading rebuilds their materials. A model browser
    shares none and is left alone.
  - One index a tree and one skin a level for the whole page, whoever asks,
    so the arms and every body hold the same texture objects. Nothing is
    cloned a soldier: the swap is on the cached rig's and weapon's own
    materials, which every figure of that soldier shares.
  - A repaint is undone by name: the composed poses are kept for the page and
    the page changes level in place, so a material holding one level's
    texture takes the next level's or its own back. `pose-compose.js` paints
    again whenever it hands a kept pose out.
  - A skin's texture is found by its material's name (the image it replaces).
    The texture's own name fails where the texture store has made one file of
    several (Foy's four `Hand0N_r` gloves): GLTFLoader names the one texture
    for the first. This was wrong for the arms too.
- `audit_mod.py` `level_paint_findings`: unchanged for an arms rig's image
  (`viewmodel-level-paint-missing`); an image only a soldier's glb carries is
  `soldier-level-paint-missing`. A tree with poses and no `viewmodels/` is
  held to its levels too.

Tests: `tests/test_viewmodel_level_skin.py` (`SoldierImageTests`,
`AuditTests`, and the viewer's cases under node: one file for two images, a
kept body across a level change, the page's paint, one index for two askers,
each loader painted before it is shaded).

### Census

Baked levels on this PC, and what `skins.json` hands the page (image and
level pairs; before is the arms rigs alone):

| Tree | Baked levels | With a skin | Pairs before | Pairs now | Most |
|---|---|---|---|---|---|
| bf1942 | 23 | 7 | 11 | 39 | Truk 19, Kasserine Pass 15 |
| XPack1 | 29 | 7 | 11 | 39 | the inherited vanilla seven |
| XPack2 | 32 | 9 | 17 | 57 | Hellendoorn 9, Telemark 9 |
| FH | 10 | 10 | 18 | 126 | Tarawa 25, Iwo Jima 24, Midway 18 |
| FHSW | 10 | 10 | 23 | 111 | Moscow Outskirts 23, Battle of Foy 21, Midway 20 |

Battle of Foy's 21: the US uniform (`Amerov_Z`, `Amerun_Z`, `USequip`,
`USdecalS`) from `GENERAL_US_WINTER` and `Levels/bulge`, the German
(`Germov_r`, `Germun_r`, `ghelm_r`, a face, the big pack) from `Levels/bulge`
and `GENERAL_GER_WINTER`, five hands, the radio and two scout covers from
`ENVIROMENT_WINTER`, and the four the arms already had.

Held against the indexes as the first-person fix left them, the audit reports
28, 28, 40, 108 and 88 `soldier-level-paint-missing`; against today's, none.

### Checked

Headless Chromium, `map.html?mod=fhsw&map=battle_of_foy&shots=1&botCount=10`,
a bot of each team stood on foot and framed from 2.4 m, the same run with
`viewmodels/skins.json` answered 404 as the before:

| | Before | After |
|---|---|---|
| US | grey-brown summer jacket and trousers, bare hands | olive winter jacket, dark gloves, canvas leggings |
| German | field-grey tunic, dark helmet, bare hands | white smock, whitewashed helmet, dark gloves, winter face |

Read off the bots' materials: before, 30 distinct textures and none from a
level folder; after, eight of 35 are (`GENERAL_US_WINTER/Amerov_Z`,
`Levels/bulge/Germov_r`, `ENVIROMENT_WINTER/Hand01_r`, ...), with one
`skins.json` and one `battle_of_foy.skin.glb` fetched. Control, vanilla El
Alamein (no row): the index is asked, no skin is fetched, no bot holds a
texture from a level folder, and the desert German is drawn as before.

Not looked at in a browser: a dropped kit, a seated body, a replay's
soldiers and the room's. They go through the same call and the unit tests
pin its place in each loader.
