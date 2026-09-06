---
name: bf1942-mod-extraction
description: >
  Guide and reference for extracting game assets, map dossiers, vehicle and kit textures,
  and gameplay intel from Battlefield 1942 and Refractor engine mod archives (.rfa).
  Use whenever inspecting, extracting, debugging, or extending asset pipelines for BF1942
  mods (Desert Combat, DC Final, Forgotten Hope, FHSW, Eve of Destruction, Galactic Conquest,
  BF1918, Interstate 82, Road to Rome, Secret Weapons).
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
