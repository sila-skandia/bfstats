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
python3 extract_loading_assets.py --mod bf1942 --levels <map>   # loading block + the map's own picture
python3 extract_loadouts.py --maps viewer/maps/maps.json --delta  # the level's kits row
python3 build_mods_manifest.py                     # the community row
```

The kits a community map deals are vanilla's, but `loadouts.json` is keyed by
level: a level with no row there deals the page's fallback kits. Strasbourg
had none until 2026-10-21 (`audit_mod.py --mod bf1942 --audit loadouts`,
`loadout-level-missing`); `--delta` reads only the levels the file lacks.

`extract_maps_all.py` writes the scene only. The `loading` block in
`maps.json` (title, picture, music) comes from `extract_loading_assets.py`,
which reads the level's own `Menu/Init.con` `game.setLoadPicture`. A row
without one loads behind the page's fallback picture (Omaha's): Strasbourg
did until it ran, though its archive ships `Menu/Texture/Load/strasbourg.tga`.
Run it with `--levels`: a full run also rewrites vanilla's shared loading
chrome and music, and its MP3 transcode is not byte-stable.

A `_003.rfa` beside the level is a patch archive. The game, and the bake, read
it over the base archive (Strasbourg's replaces Conquest's spawners).

## Levels

| Level | Source | Added | Published |
|---|---|---|---|
| strasbourg | `Strasbourg Fix 28-12-2021.zip` plus `strasbourg_003.rfa` (Conquest spawner patch) | 2026-10-20 | 2026-10-20 |
| 76 levels, listed below | `community-mappack-by-michaels/` (78 archives) | 2026-11-09 | 2026-11-09 |

The michaels pack holds 78 archives. `Invasion_of_the_Philippines.rfa` is
byte-identical to retail's (same SHA-1) and was left out, and
`shigaisen_A_001.rfa` is a patch to `shigaisen_A`. Every other archive is one
level with `game.setMapId "bf1942"`. Nine of them carry single-player data and
so also show in Instant Battle: `a_sliver_of_hope`, `attack_on_pearl_harbor`,
`berlinjeeps`, `giza`, `highway_tampa`, `makin_atol`, `oahu`, `tiger_ace`,
`xhaos_kart_race`. 24 deal their own copies of vanilla kits (`levelKits` in
`loadouts.json`).

`_o_jka__`, `_o_jka__big`, `a_sliver_of_hope`, `air_attack`, `arena_tl`,
`attack_on_pearl_harbor`, `beinbrekkbakken`, `berlinjeeps`, `bomberfight`,
`bomberfight_big`, `bowling_for_bad_guys`, `densloe_practice`,
`downhill_to_the_beach_two`, `dsfootball`, `giza`, `happy_saint_patrick_s_day`,
`highway_tampa`, `hop`, `jeep_bowl`, `jeep_only`, `jeep_race___`,
`jeep_racing`, `jeeprace`, `kingof_thehill`, `knife_championship`,
`knife_fight`, `koh`, `long_hurdles`, `makin_atol`, `matrix`, `oahu`,
`omaturi_channel_air`, `omaturi_channel_airmini`,
`omaturi_channel_battleship`, `omaturi_channel_cannon`,
`omaturi_channel_knife`, `omaturi_channel_sniper`,
`omaturi_channel_sniper_day2`, `omaturi_channel_submarine`,
`omaturi_channel_tank`, `parcours_challenge`, `parcours_challenge_simplified`,
`quest_for_adventure`, `rallyrace`, `rennpiste_gebirge`, `shigaisen_a`,
`shigaisen_b`, `shigaisen_c`, `shigaisen_d`, `shigaisen_g`, `short_hurdles`,
`sniper_challenge`, `tank_bowl`, `tanquilizer`, `team_liberation_air_race`,
`the_airport`, `the_bridge`, `the_corridor`, `the_dungeon`, `the_fortress`,
`the_maze`, `the_room`, `the_street`, `the_street_day2`, `the_street_g`,
`tiger_ace`, `tl_plane_training`, `tl_race`, `tsukuba_circuit`, `umi`,
`umi_s`, `up_and_down`, `vxf_stunts_one`, `waterworld`, `xhaos_kart_race`,
`xhaos_lake`.

Findings from the bake, all in the maps' own data:

* `umi` and `omaturi_channel_submarine` place no statics (`objects.placed`
  0): they are open sea, and their ships are the levels' own vehicle templates
  laid by 24 and 20 object spawners.
* Unresolved templates are mostly ambient-sound objects whose samples bake
  through the sounds path anyway (`happydaysde*`, `PHSiren`, `cricket`). The
  rest name nothing the archives declare: `Coastline` (berlinjeeps, oahu),
  `AlliedBase`/`AxisBase` (both parcours levels), `pyramidbase` (giza),
  `iraq_flag`/`us_flag` (shigaisen_g).
* A few textures are missing: an empty `texture/` name, `sherW2_f`,
  `B17Win_L`, `RUBBLE_5`, `it_house01_rubble`, `pf_w2_r`.

## A batch from a machine without vanilla's tree (2026-11-09)

The owner's Mac had no local copy of vanilla's tree: `viewer/maps` held only
what `serve_viewer.py` had fetched on demand, and there was no `maps.json`.
Every step here read-modify-writes a manifest, so a run there would have
written registries holding only the new levels. The batch ran into a separate
root seeded from the live volume instead, and only that root was published:

```bash
R=~/.cache/community-bake            # {maps,models,textures}
for p in maps/maps.json maps/_shared/loadouts.json maps/_shared/damage.json \
         maps/_shared/hud/hud.json maps/_shared/hud/soldier-icons.json models/mods.json; do
  mkdir -p $R/$(dirname $p); curl -s -o $R/$p "https://mesh.bfstats.io/$p?cb=$(date +%s)"
done
python3 extract_maps_all.py --levels <names> -j 8 --out $R/maps
python3 extract_menu_layout.py --out $R/menu-out --hud-pack $R/maps/_shared/hud
python3 extract_loading_assets.py --mod bf1942 --output-dir $R/maps --levels <names>
python3 extract_loadouts.py --maps $R/maps/maps.json --delta --out $R/maps/_shared/loadouts.json
```

Then, by hand: the new rows of `menu-out/menu-levels.json` and their
thumbnails added to the live `menu-levels.json`, and the live `mods.json`'s
`community` row replaced with `build_mods_manifest.describe_community` over
the merged `maps.json`. Before publishing, take out of the root what the bake
rewrote vanilla-wide and production already holds. That means
`vehicle-sounds*.json`, sonar, spotting, `_shared/load/`, `_shared/music/`,
and every shared sample the volume has under the same name. A bare sample
name is the archive's own wav, so a size difference there is only a different
LAME build. Then `publish-mesh-delta.py textures maps --root $R` and `models`
last.

* **Seed `damage.json` too.** The bake merges each level's rounds into the
  file it finds. Unseeded, the 2026-11-09 run dropped
  `spitfirecannon_projectile` and `bf109cannonprojectile`, which only the
  levels not baked there declare, and the live table was merged back in
  before the send (76 rounds, plus 7 from the pack).
* **A level archive's suffix can be upper case** (`giza.RFA`,
  `vxf_stunts_one.RFA`, `A_Sliver_of_Hope.RFA`). The game and the bake load
  them, but `extract_menu_layout.level_archives` globbed `*.rfa` and left them
  off the menu list. It now matches the suffix in any case
  (`tests/test_menu_layout.py` `LevelArchiveSuffixTests`).

Timings on the M5 Max (18 cores, 48 GB): the smoke test of `The_Room` took
24 s alone, and the other 75 levels took 7 min 52 s wall, including the vehicle
sound tables and `optimise_mesh` (2.2 GB of glbs down to 782 MB). `-j 8` started
only 7 workers. `memory_capped_jobs` gives each level 2 GiB (`PER_LEVEL_BYTES`)
against `vm_stat`'s free, inactive and speculative pages, which on macOS are
about 21 of the 48 GB, less a 4 GiB reserve. Any `-j` above 8 gets 8 there.
Measured alone, `parcours_challenge` took 93 s at 0.59 GB peak RSS and `oahu`
110 s at 0.77 GB, each on one core (user time equals wall time). A vanilla
level is therefore about a third of the budget, and the cap, not the cores,
bounds a vanilla batch on this machine.

## Open

* Publishing a single level still follows the batch recipe above: a
  hard-linked or seeded root, registry last. A tree-wide send also carries
  vanilla's `menu-layout.json` regenerated by current code, which was left
  local on 2026-10-20 and again on 2026-11-09.
* `PER_LEVEL_BYTES` is one number for every mod. Vanilla levels peak at 0.6
  to 0.8 GB, so a per-mod figure (or `vm_stat`'s compressed and purgeable
  pages counted as available on macOS) would let a vanilla batch use the
  cores.
