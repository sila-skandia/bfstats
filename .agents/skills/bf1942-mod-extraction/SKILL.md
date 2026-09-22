---
name: bf1942-mod-extraction
description: >
  Guide and reference for extracting game assets, map dossiers, vehicle and kit textures,
  and gameplay intel from Battlefield 1942 and Refractor engine mod archives (.rfa).
  Use whenever inspecting, extracting, debugging, or extending asset pipelines for BF1942
  mods (Desert Combat, DC Final, Forgotten Hope, FHSW, Eve of Destruction, Galactic Conquest,
  BF1918, Interstate 82, Road to Rome, Secret Weapons).
  Also use when recreating or inspecting any BF1942 interface surface -- spawn screen,
  kit selector, minimap, scoreboard, HUD bars, menus, buttons, fonts, UI strings -- or when
  asking "where is this texture", "what font does the game use", "how is this screen laid
  out"; section 10 maps where the real menu art, MemeFile layouts, bitmap fonts and
  lexicon strings live, and how to find them fast.
  Also use when a question about a Refractor file format needs settling against the game
  itself -- "is this field really reserved", "what does the engine do with this value",
  "x-ref BF42 source to verify X", "is our reader right about this" -- see section 9 for
  the decompiled BF1942.exe reference corpus and the rule for when it is worth opening.
---

# Battlefield 1942 & Mod Artifact Extraction Guide

This guide documents the architecture, file formats, engine conventions, and extraction
techniques for Battlefield 1942 and its extensive ecosystem of total conversion mods.

---

## 1. Refractor Flat Archive (.rfa) Architecture

Refractor 2 stores all levels, objects, animations, and interface textures in uncompressed
or LZO-compressed flat archives (`.rfa`).

### Header & Entry Table
- **Magic Header**: Optional 28-byte string `Refractor2 FlatArchive 1.1  `. If absent, archive base offset is 0.
- **Data Block**: `data_size` (uint32) followed by `compressed` flag (uint32).
- **Index Table**: Located at `base_offset + data_size`:
  - `entry_count` (uint32)
  - For each entry: `name_length` (uint32), `entry_name` (latin-1 string, backslashes normalized to forward slashes), `compressed_size` (uint32), `uncompressed_size` (uint32), `data_offset` (uint32), plus 12 unused bytes.

### LZO1X Decompression
- Compressed chunks within the data payload use **LZO1X**.
- A compressed entry starts with `segments_count` (uint32), followed by per-segment metadata `(compressed_size, uncompressed_size, segment_offset)`.
- **Every segment is LZO, even when `compressed_size == uncompressed_size`.** That is not a "stored verbatim" marker — LZO output can equal or exceed its input, and all 448 break-even segments across vanilla and nine mods inflate cleanly (`animations/GrenadeAllies.ske`, 247 == 247, reads as garbage if taken raw). Inflate first; fall back to verbatim only for a break-even segment LZO rejects; a size mismatch still raises.
- Can be decompressed safely with standard system `liblzo2.so` via Python `ctypes` without any third-party Python libraries (`liblzo2.so.2` / `liblzo2.so`).

---

## 2. Linux Case-Sensitivity Gotchas

Battlefield 1942 was authored on Windows where filesystems are case-insensitive. Total conversion mods routinely exhibit casing inconsistencies that break naive Linux file lookups:

| Mod | Folder on Disk | Archives Subdirectory | Impact if Case-Sensitive |
|---|---|---|---|
| Galactic Conquest | `GCMOD` | `Archives` | Fails if searching for `gcmod` |
| Eve of Destruction | `EoD` | `archives` (lowercase!) | `mod_dir / "Archives"` returns empty; skips all vehicles and kit icons |
| Interstate 82 | `interstate` | `archives` (lowercase!) | `mod_dir / "Archives"` returns empty |
| Desert Combat Final | `DC_Final` | `Archives` | Fails if searching for `dc_final` |

### Robust Discovery Rule
Always perform case-insensitive directory lookups:
```python
def find_archives_dir(mod_dir: Path) -> Path | None:
    if not mod_dir.is_dir():
        return None
    for child in mod_dir.iterdir():
        if child.is_dir() and child.name.lower() == "archives":
            return child
    return None
```

---

## 3. Mod Content Inheritance Chains

BF1942 mods inherit content hierarchically. A mod does not duplicate assets from its base dependencies; instead, its `init.con` declares search paths using `game.addModPath`:

```con
game.addModPath Mods/FHSW/
game.addModPath Mods/FH/
game.addModPath Mods/Bf1942/
```

### Inheritance Resolution
1. **Resolution Order**: Nearest child first, falling back to parents:
   - `fhsw` -> `fh` -> `bf1942`
   - `dc_final` -> `desertcombat` -> `bf1942`
   - `gcmod` -> `bf1942`
   - `eod` -> `bf1942`
2. **Partial Overrides**: A mod map (e.g. Desert Combat's `Gazala`) may only define `ObjectSpawnTemplates.con` and `Init.con`, relying on the parent `bf1942/levels/Gazala.rfa` for `ControlPoints.con` (flags) and `Terrain.con` (world size).
3. **Underlay Mechanism**: When extracting level files, underlay the level dictionary with files from parent level archives so un-overridden files are resolved.

---

## 4. Object & Vehicle Classification

A level's `ObjectSpawnTemplates.con` spawns thousands of objects, including boundary markers (`killercage`), explosion triggers (`e_ExplBombBig`), radar towers, and soldier kit pickups alongside real vehicles.

### Classification via `objects.rfa` Hierarchy
The engine's own internal folder structure in `objects.rfa` classifies every template:

- `Objects/Vehicles/Land/<Name>/` -> `"land"`
- `Objects/Vehicles/Air/<Name>/` -> `"air"`
- `Objects/Vehicles/Sea/<Name>/` -> `"sea"`
- `Objects/Stationary_Weapons/<Name>/` -> `"emplacement"`
- `Objects/HandWeapons/<Name>/` -> `"handweapon"` (dropped from vehicle arsenal)

### Normalization and Suffix/Prefix Stripping
Spawner templates often append editor suffixes or wrappers:
- Suffixes: `_spwn`, `_spwnx`, `_bot`, `_spawn` (e.g., `mi4t_spwn` -> `mi4t`)
- Prefixes: `stationary_`, `tripod_`, `eod_` (e.g., `stationary_dshk` -> `dshk`)
- Emplacement aliases: `boforsa`, `boforsb` -> `bofors`

---

## 5. Kit Systems & Role Resolution

Vanilla BF1942 has 5 fixed kits (`assault`, `medic`, `engineer`, `at`, `scout`). Mods invent hundreds of specialized kits (EoD has 232 kits; FHSW has 571 kits).

### Extracting Kit Definitions from `objects.rfa`
Every kit `.con` script in `objects.rfa` defines:
```con
ObjectTemplate.create Kit Empire_Trooper
ObjectTemplate.setType Assault
ObjectTemplate.setKitIcon 1 "kits/Icon_assault_allies_selected.tga"
```

1. **`ObjectTemplate.setType <Type>`**:
   Maps the mod kit to canonical engine roles:
   - `Assault`, `RocketPack` -> `"assault"`
   - `AT` -> `"at"`
   - `Medic` -> `"medic"`
   - `Scout` -> `"scout"`
   - `Engineer`, `EngineerLandmine` -> `"engineer"`
2. **`ObjectTemplate.setKitIcon <Slot> <Path>`**:
   Points directly to the kit's texture inside `menu.rfa` (e.g., `menu/Texture/Kits/Vietcong/rifleman_selected.dds` or `kits/Icon_assault_allies_selected.tga`).

### Asset Pipeline Extraction
- `extract_hud_assets.py` parses all `objects.rfa` kit templates, looks up target DDS/TGA textures in `menu.rfa`, and emits `tournament-images/hud/kits/<mod>/<normalised_template>.png`.
- Fallback art: If no custom template icon exists, the API resolves `<role><side>.png` (e.g., `assaultaxis.png`), falling back along the mod search path.

---

## 6. Texture Formats (DDS & TGA)

All Refractor textures are stored as DDS or TGA:
- **DDS Formats**:
  - DXT1 (`0x31545844`): 4x4 block compression, 1-bit alpha or 4-color punchthrough.
  - DXT3 (`0x33545844`): 4x4 block compression with explicit 4-bit alpha channels.
  - DXT5 (`0x35545844`): 4x4 block compression with interpolated 8-step alpha ramp.
  - Uncompressed RGB/RGBA: 16/24/32-bit with channel bitmasks.
- **TGA Formats**:
  - Uncompressed (Type 2) and Run-Length Encoded (Type 10) 24-bit BGR and 32-bit BGRA. Rows run bottom-up unless bit 5 of descriptor byte is set.
- **Conversion**: Decoded directly to raw RGBA scanlines and packed into standard PNG via `zlib` (IDAT chunks + CRC32).

---

## 7. 3D Model, Pose, & Thumbnail Extraction Pipeline

The pipeline under `tools/bf1942-models/` extracts interactive 3D glTF/GLB models, authentic animation poses, and portrait thumbnails for the web viewer (`viewer/`).

### Complete Extraction Workflow for a Mod

For any mod (e.g. `FHSW`, `EoD`, `DesertCombat`, `FH`):

```bash
# 1. Extract 3D models with multi-worker parallelism (-j)
python3 tools/bf1942-models/extract_all.py --mod <Mod> \
  --out tools/bf1942-models/viewer/models/mods/<mod_id> \
  --configuration-all -j 16

# 2. Extract authentic faction-matched poses (stand/crouch/lie)
python3 tools/bf1942-models/extract_pose.py --mod <Mod> \
  --matrix --match-faction -j 16 --export \
  --out tools/bf1942-models/viewer/models/mods/<mod_id>/poses

# 3. Generate model thumbnails (MANDATORY for viewer lineup & cards)
# Ensure the local viewer server is running on port 5273 (threaded server recommended):
python3 -c "from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer; import os; os.chdir('tools/bf1942-models/viewer'); ThreadingHTTPServer(('0.0.0.0', 5273), SimpleHTTPRequestHandler).serve_forever()" &

# Render portrait thumbnails and stamp into models.json via Playwright:
node tools/bf1942-models/shoot.mjs --thumbs \
  --url "http://localhost:5273/?mod=<mod_id>" \
  --out tools/bf1942-models/viewer/models/mods/<mod_id>/thumbs \
  --manifest tools/bf1942-models/viewer/models/mods/<mod_id>/models.json \
  --skip-existing -j 8

# Alternatively, extract_all.py supports --thumbs directly:
python3 tools/bf1942-models/extract_all.py --mod <Mod> \
  --out tools/bf1942-models/viewer/models/mods/<mod_id> \
  --thumbs -j 16

# 4. Rebuild mod registry so the mod appears in viewer dropdowns
python3 tools/bf1942-models/build_mods_manifest.py
```

### Critical Rules for Model & Thumbnail Extraction
1. **Always generate thumbnails**: The model browser cards and scale lineup rely on `entry.thumb` in `models.json`. Without thumbnails, the UI displays blank "no thumbnail" placeholders. Always run `shoot.mjs --thumbs` or `extract_all.py --thumbs`.
2. **Faction/Side pose filtering**: Always pass `--match-faction` (or `--match-side`) to `extract_pose.py`. Refractor mods have hundreds of weapons; unfiltered cross-product posing creates tens of thousands of invalid combinations and takes hours.
3. **Monolithic archive unpacking**: Mods like FHSW concatenate vehicle scripts into `!_PACK_<FACTION>/Compressed.con`. The library builder unpacks virtual paths using `rem folder = <Name>` and `rem sauce = <File>`.
4. **DirectX 8 index buffer format**: Refractor index buffers are unsigned 16-bit (`uint16` / `<H`). Always unpack indices as unsigned to prevent signed 32,767 overflow on large warships and complexes.

---

## 8. Deployment to Hetzner Asset Storage

**Auto-proceed.** Extraction and publishing are one job, not two, and neither needs
sign-off. Run the extraction scripts, upload the result, verify it, report once at
the end. Do not stop to ask whether to extract, whether to upload, or to have each
`kubectl` command approved — the project's per-command confirmation rule does not
apply to asset work. New assets a feature needs are part of delivering that feature:
extract them, get them on the volume, and confirm the site serves them.

What still deserves a pause: scaling deployments, applying manifests, and deleting
or overwriting existing content on the volume.

- **Storage Location**: Kubernetes PVC `bf42-stats-pvc-v2` mounted at `/mnt/assets` on `filebrowser` and `/mnt/data/assets` on `bf42-stats`.
- **Upload Method**: Streaming tar over `kubectl exec`:
  ```bash
  tar -cf - dossiers hud | kubectl --context hetzner -n bf42-stats exec -i filebrowser-857667c845-vcqsv -- tar -xf - -C /mnt/assets
  ```
- **Permissions**: Ensure files are world-readable:
  ```bash
  kubectl --context hetzner -n bf42-stats exec filebrowser-857667c845-vcqsv -- chmod -R a+rX /mnt/assets/dossiers /mnt/assets/hud
  ```
- **Safety**: Never touch or overwrite `/mnt/assets/.filebrowser.db`.

---

## 9. Settling a Format Question Against the Game Binary

**Gameplay gate:** If the question is about what a player, flag, spawn point,
vehicle pad, control point, HUD, ticket system, or audio cue does at runtime,
load and follow `.agents/skills/bf1942-map-player-investigation/SKILL.md` before
changing an extractor or viewer. A survey can identify candidate data, but it
cannot establish gameplay semantics. Do not invent a default or synthetic audio
fallback while the binary behavior is open.

Our readers reconstruct proprietary formats from observation, and observation of vanilla
data is often right by coincidence and wrong on mods. The cross-reference corpus lives in
the bfstats repo at `features/bf1942-engine-reference/`:

- `symbols.json` — address to name, with a `confidence` field (`verified` / `working` /
  `inferred` / `open`). Pinned to one binary: **BF1942.exe sha256 `60c9452d…cd3699`**.
  Other builds relocate everything.
- `ledger.md` — every assumption our readers make and its verification status. **Read this
  first.** The question may already be answered, or already known to be a dead end.
- `xref.py` — lookup plus a driver for the Ghidra bridge. `./xref.py check` verifies the
  hash before you trust an address. Record findings with `./xref.py add` as you go.
- `include/` — C stubs with per-field provenance, to diff against decompiler output.
- `surveys/` — scripts that measure a claim across all installed mods.

### Measure before you decompile

**This is the rule that matters.** Before opening Ghidra, write a survey: parse every `.sm`
across the ~14 installed mods under `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/` and
count how many files the question actually affects. `surveys/stride_vs_flags.py` is the
template — it covers 33,038 meshes in one run.

A survey is minutes and usually answers the question outright. Decompilation is hours.
One past investigation burned a session on a field that turned out to affect **1 mesh in
33,038**, and a second on an engine behaviour with **zero** occurrences in real data. A
`Counter` would have caught both in thirty seconds.

For file-format questions, open the binary when a model is *visibly* wrong and the data
cannot explain why. For map/player gameplay questions, binary tracing is mandatory even
when the authored data looks self-explanatory: the engine may ignore, clamp, combine, or
reinterpret those fields, and viewer behavior is not evidence.

### Working with the binary

Ghidra must be running with the project open and the GhidraMCP extension enabled; the
bridge is a plain REST API on `127.0.0.1:8089` (`/mcp/schema` self-describes all 239
endpoints). No MCP server is registered with Claude Code — `xref.py` wraps what matters.

Hard-won specifics, all verified:

- **The client is stripped.** Of 16,601 functions essentially all are `FUN_*`; the 262
  recovered "classes" are DLL import groups and MSVC STL instantiations. Expect no names.
- **Analysis is incomplete** — 4,574 undefined code regions in `.text`. String anchors
  routinely land outside any defined function.
- **Do not run a global re-analysis.** A vtable is an exact list of entry points: read it,
  then `POST /create_function` at each target. That recovered 32 functions in one pass with
  zero failures where a full reanalyse would have churned for a long time.
- **Read past the end of a vtable.** `.rdata` continues into that class's string constants,
  and those are far better anchors than a bare literal. `".sm"` and
  `"Texture/ObjectLightmaps/"` sit immediately after the geometry template vtable and have
  one xref each.
- **Ignore `0x00838b5e`–`0x008b191f`.** 495 KB of CRT static-initializer thunks. Ten of the
  seventeen references to `"StandardMesh/"` are in there, and every one is just a global
  `std::string` being constructed. A string trail that leads here is a dead end.
- **Function prologue** for hand-recovery: `0x90` padding, then `SUB ESP,imm` followed by
  `PUSH EBX/EBP/ESI/EDI`.
- **The `.sm` load chain is already mapped** (template vtable `0x00905a90`): `+0x8c`
  loadFile, `+0x88` readStream, `+0x90` readHeader, `+0x98` readLods, `+0x9c`
  readMaterials. Vertex payloads are read as one flat `stride * count` blob and handed to
  `RendPCDX8_singleton` — **nothing on the load path interprets vertex layout**, so layout
  questions belong to the renderer, not the loader.

### Recording

Anything worked out goes back into `symbols.json` and `ledger.md` in the same breath.
Never promote a symbol without evidence, and never name a field on a plausible guess — an
invented name is worse than `reserved`, because the next agent will trust it.

**Gameplay-sim facts (hit points, fall damage, soldier death) are settled against the
Linux dedicated server** (`bf1942_lnxded.static`), not the client — the server is
authoritative for HP. Fall damage is real (a soldier who falls far enough loses HP via
`BFSoldier::handleDamage` → `Armor::damage`), kinetic (`HP ∝ impact speed²`), and the
soldier-fall branch of `GameServer::handleCollisionLandOrWater` (`0x08154960`,
`0x8154d20`) is the exact code. The full re-derivation, the `*0x15c` dispatch
identification, the constants, and the one remaining unknown (the per-surface
MaterialManager scalar — how to resume) are written down in
`features/bf1942-3d-models/fall-damage-research-groundwork-2026-09-17.md`.

---

## 10. UI, HUD and Menu Art: Where the Real Designs Live

**Rule: the game's interface is data.** Its textures, the screen layouts that place them,
the bitmap fonts and the label strings are all shipped files. Before styling any
recreation of a BF1942 screen — spawn screen, minimap, scoreboard, HUD bars, menus — find
the real thing. Hand-rolled CSS reads as custom no matter how carefully it is tuned.

**Then check that the art is actually used.** The spawn-screen rebuild extracted the
`ingame_respawn_*` panel plates and still drew the kit column in CSS, which went unnoticed
until the user saw it. Grep the consumer for each extracted sprite name before calling a
surface authentic.

### Where each thing lives

| What | Where | Format / reader |
|---|---|---|
| Menu and HUD textures | `Mods/<mod>/Archives/menu.rfa` under `menu/Texture/` (523 in vanilla) | DDS, occasionally TGA — `decode_dds` |
| Screen layouts (positions, which texture, font, colour, text, show/hide conditions) | extensionless `menu/<Name>` entries in `menu.rfa`, 91 in vanilla. `menu/InGame` holds the spawn screen, scoreboard, map vote and chat; `MainMenu`, `CreateGameMenu` and the rest hold the front end | binary `MemeFile 2.0` (`dice::meme::*` node graph) — `bf42/meme.py`; format in `features/bf1942-engine-reference/ledger.md` MEME-1..9 |
| Menu fonts | `Mods/bf1942/Archives/Font.rfa`: `Font/{Trebuchet MS8,11,14,18,standard6}[ - Latin].dif` + `.tga` | text glyph table + 8-bit alpha atlas — `bf42/font.py` |
| HUD font | `Font.rfa`: `Font/BF1942.font` + `Font/BF1942.tga` | a different text format: `key = value` header, then `char x y x2` rows |
| Label strings | `Mods/<mod>/lexiconAll.dat` (casing varies: `lexiconall.dat`) | `u32 count, u32 columns`, then per record a key + 8 UTF-16LE NUL-terminated translations. Layout text nodes carry keys such as `RESPAWN_SUICIDE` |
| Map art | per level `Textures/InGameMap.dds` | one texture for the spawn map, HUD minimap and fullscreen map; the grid is painted in. Coordinate math is in `bf1942-map-images` |
| Which icon a vehicle or kit shows | `Objects.rfa`: `ObjectTemplate.setMinimapIcon` / `setMinimapIconSize`, `setKitIcon` | `.con` text; paths say `.tga`, shipped files are often `.dds` — probe both |
| Engine-hardcoded names | `BF1942.exe` string table, e.g. `font/BF1942.font`, `Menu/Load.tga`, all 60+ `dice::meme::` class names | `strings -n 6 BF1942.exe \| grep ...` |

`menu/Texture/` directory map (vanilla):

- `Ingame/respawn/` — spawn-screen plates: `kits_{top,middle,bottom}`, `kits_tab{,2,3}`,
  `long_512x64`, `small_256x64`
- `Menu/knapp*_{n,mo,mc}` — button plates at rest / mouse-over / pressed (`knappExt` red,
  `knapp3` green, `knappprf`, `knapp1/2`); `Menu/buttons/` — arrows and scroll controls;
  `menu_*` — front-end panel frames and olive header strips (`*_rubr_*`)
- `Minimap/` — player ring, vehicle-class icons, `map_circle`, `icon_mapbar_small` bezel;
  `Minimap/Objectives/` — nine-frame capture ring
- root — `conp_<nation>`, `baseflag_conp_<nation>`, `icon_flag_<nation>`,
  `icon_vehicledot_*`
- `Kits/` — kit photographs; `Debriefing/classes/` — the 16 px class glyphs the spawn-screen
  kit rows use; `Debriefing/medals/`
- `Ingame/` — HUD health, ammo, stamina and heat bars, `cpbar/`, `Artillery/`, `text-mess/`
- `Voting/` — scoreboard and map-vote frames; `Vehicle/`, `Weapon/` — roster icons (see
  `bf1942-map-images`); `Radio/`, `ToolTip/`, `Load/`, `Briefing/`, `Submarine/`

**Asset names are Swedish** (DICE): *knapp* button, *pil* arrow, *upp/ner* up/down,
*v/h* left/right, *rubr* heading, *mitt* middle, *karta* map, *logga* logo. Grep for those,
not the English words.

**Every mod ships its own `menu.rfa`** (16 of the installed mods do) and its own lexicon; resolve along the
`game.addModPath` chain, nearest child first. The installed vanilla `Font.rfa` is a 2012
double-size replacement. Its `.dif` metrics match the original, but `BF1942.font` does not
(256 px atlas instead of 128). The untouched 2004 file is kept in
`Mods/bf1942/Archives/Font-Original.zip`.

### Fastest ways to find what a screen is made of

1. **`strings` the archive.** RFA index names are plaintext, and layout files are often
   stored uncompressed, so node names, texture paths, font files and locale keys show up in
   order: `strings -n 6 menu.rfa | grep -iE 'respawn|kit/|knapp|\.dif'`. One grep found
   the entire spawn-screen recipe.
2. **`strings` the exe** for textures and fonts the engine loads by name, and for the
   `dice::meme::` class list.
3. **Make a contact sheet.** Decode a whole `menu/Texture/<dir>` into one labelled PNG
   (`RfaArchive` + `decode_dds` + PIL) and look at it. Names alone do not tell you which
   plate is the red one.
4. **Get a real capture.** Pull frames from a gameplay recording with
   `ffmpeg -vf fps=1`, crop and nearest-neighbour upscale the regions in question, then
   compare against the render element by element.
5. **Positions:** layout units are an 800x600 virtual screen stretched to the display. A
   capture's pixel pitch divided by the data's pitch confirms the scale (720/600 at 720p).

### Already built — extend these, do not rewrite them

- `tools/bf1942-models/extract_hud_pack.py` — sprite pack plus `minimap-icons.json`
- `tools/bf1942-models/extract_spawn_layout.py` — flattens the spawn-screen subtree of
  `menu/InGame` into `spawn-layout.json`, writes its fonts, resolves its strings
- `tools/bf1942-models/bf42/meme.py`, `bf42/font.py` — readers, tested in `tests/`
- Output: `viewer/maps/_shared/hud/`, served at `https://mesh.bfstats.io/maps/_shared/hud/`

**Open items live in two places. Read them before starting, and add to them when you
stop.** Viewer and interface next steps, ranked with leads, are in
`features/authentic-spawn-map/README.md` §8 (spawn-map dimming, ticket counters, minimap
frame and zoom, mod-specific chrome, scoreboard, the rest of the HUD) and are summarised in
`features/bf1942-3d-models/parity-gaps.md` under *Interface*. Engine questions are `open`
rows in `features/bf1942-engine-reference/ledger.md` (MEME-10, -11, -13, MMAP-1, -2,
FONT-1), with addresses in `symbols.json` (`./xref.py list ui`). The key one: the spawn
map's rect and dimming are **not** in the layout data. The engine fills an empty `ClipNode`
at runtime, so `(280,33) 512x512` was measured from a capture.

Full detail: `features/authentic-spawn-map/README.md` sections 2 and 7, and
`features/bf1942-3d-models/minimap-and-fullmap.md`.
