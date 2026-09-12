---
name: bf1942-mod-extraction
description: >
  Guide and reference for extracting game assets, map dossiers, vehicle and kit textures,
  and gameplay intel from Battlefield 1942 and Refractor engine mod archives (.rfa).
  Use whenever inspecting, extracting, debugging, or extending asset pipelines for BF1942
  mods (Desert Combat, DC Final, Forgotten Hope, FHSW, Eve of Destruction, Galactic Conquest,
  BF1918, Interstate 82, Road to Rome, Secret Weapons).
  Also use when a question about a Refractor file format needs settling against the game
  itself -- "is this field really reserved", "what does the engine do with this value",
  "x-ref BF42 source to verify X", "is our reader right about this" -- see section 8 for
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

## 7. Deployment to Hetzner Asset Storage

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

## 8. Settling a Format Question Against the Game Binary

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

Open the binary when a model is *visibly* wrong and the data cannot explain why. Do not
open it to satisfy curiosity about a reserved field.

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
