# Community maps

A community map is a level made for the stock game, not for a mod: its
archive goes in vanilla's `Mods/bf1942/Archives/bf1942/levels/`, it binds the
vanilla kits and vehicles, and its `Menu/Init.con` says `game.setMapId
"BF1942"`. The viewer lists such levels under their own entry in the Custom
Game picker, **Community Maps**, instead of mixing them into vanilla's Instant
Battle list.

## How it works

Community Maps is a *view* of vanilla's tree, not a tree of its own.

* **The bake** is vanilla's: `extract_maps_all.py --levels <level>` writes
  `viewer/maps/<level>/` and a row in vanilla's `maps.json`, like any vanilla
  level. `mod_pipeline.py` has no vanilla config; the extra artefacts it
  writes for a mod (kits, loadouts, rigs, voices) are vanilla's already.
* **The menu row**: `extract_menu_layout.py` (vanilla) re-reads the levels
  folder, so its `menu-levels.json` gains the level's title, teams and
  thumbnail (`thumbnails/<level>.png`, the map's own menu art).
* **The registry**: `build_mods_manifest.py` writes a `community` row in
  `models/mods.json` whenever vanilla's `maps.json` holds a level outside
  `RETAIL_LEVELS` (the 23 a 1.61 install ships). The row has vanilla's paths,
  `tree: "bf1942"`, `levels: [...]`, counts on the Maps tab only, version
  1.61, `https://bfstats.io` and the stats site's sigil as its icon
  (`viewer/icons/mods/community.png`, from `ui/src/assets/clippy_my_boi.webp`).
  Vanilla's Maps count leaves the community levels out.
* **The pages** (`viewer/mods.js`):
  * `treeOf(mod)` is the tree an id reads: the HUD pack, menu theme,
    background movie and music, and the vanilla checks use it, so the view
    looks exactly like vanilla.
  * `menuLevels(mod, mods, rows)` filters a menu list: the view keeps only its
    `levels`, and vanilla drops the levels a view claims. Instant Battle
    (`play/skirmish.js`) and Create Game (`play/multiplay.js`) use it.
  * `map.html` does not filter. It loads any level in its tree, which a
    recording of a community map needs: the game records it as `bf1942`.
  * `trees(mods)` drops views from the recording level lists
    (`recording-inspect.js`, `replay-open.js`), whose levels are already in
    vanilla's list.

## Adding one

```bash
cp <map>.rfa [<map>_003.rfa] "$HOME/.wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/bf1942/levels/"
cd tools/bf1942-models
python3 extract_maps_all.py --levels <map> -j 4    # from a clean worktree at HEAD
python3 extract_menu_layout.py                     # the menu row and thumbnail
python3 build_mods_manifest.py                     # the community row
```

A `_003.rfa` beside the level is a patch archive. The game, and the bake, read
it over the base archive (Strasbourg's replaces Conquest's spawners).

## Levels

| Level | Source | Added | Published |
|---|---|---|---|
| strasbourg | `Strasbourg Fix 28-12-2021.zip` plus `strasbourg_003.rfa` (Conquest spawner patch) | 2026-10-20 | no, local only |

## Open

* No loading screen. Vanilla has no pipeline step that writes a `loading`
  block for an added level, so it shows the theatre default.
* The bake, the menu row and the registry are local. Publishing them is a
  vanilla tree-wide send, which also carries `menu-layout.json` regenerated
  by current code.
