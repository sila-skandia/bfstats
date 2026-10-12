# First-person level paint: the arms wear the level's textures

Status: built 2026-10-12. FHSW's ten baked levels carry skins locally
(nothing published). Vanilla, XPack1, XPack2 and FH do not yet: one
`--level-skins-only` run each, seconds, no rig rewritten (section 4).

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

Of the baked levels, the trees that still need their skins written:
bf1942 7 levels (11 textures), XPack1 7 (11), XPack2 9 (17), FH 10 (18).

    python3 extract_viewmodel.py --mod <M> --maps <maps>/maps.json \
        --out <models>/viewmodels --level-skins-only

## 5. Open

- **Third-person bodies have the same miss.** The pose rigs are mod-wide too:
  on Battle of Foy the level repaints 10 of the 158 textures FHSW's pose glbs
  carry (`Amerov_Z`, `Amerun_Z`, `Germov_r`, `Germun_r`, the `Hand0N_r` set, a
  face). `rig_images` takes any folders and `wearSkin` any scene; the body
  loader does not call it yet.
- Hand weapons drawn bare (a pair with no rig) and dropped kits take the
  skin only for images the arms rigs also carry.
- A level that changes its paths by game mode (FH's `v_is_coop` arm) is read
  as a Conquest host runs it, as the bake does.
