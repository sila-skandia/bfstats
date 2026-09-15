#!/usr/bin/env python3
"""Extract the shared HUD/menu sprite pack the map viewer draws with.

Two artifacts, both one-time and shared by every level:

  viewer/maps/_shared/hud/*.png + hud.json
      The map sprites and spawn-screen chrome out of
      `Mods/bf1942/Archives/menu.rfa`: the `conp_<nation>` /
      `baseflag_conp_<nation>` flag markers, the `map_circle` spawn ring,
      the `minimap_icon_*` vehicle-class silhouettes, the vehicle dots, the
      Objective capture-ring frames, the `icon_mapbar_small` bezel, the
      `Ingame/respawn/*` spawn-screen chrome and the kit photographs.
      Decoded to PNG with alpha preserved, at their original pixel sizes —
      they are point art and are never resampled here.

  viewer/maps/_shared/hud/minimap-icons.json
      Which icon each vehicle template carries on the map:
      `ObjectTemplate.setMinimapIcon` / `setMinimapIconSize` scanned out of
      `Objects.rfa` (139 statements over 110 templates in vanilla), keyed by
      the lowercased template name — the same name the level glb gives each
      `spawners` child node. Icon names are the sprite names in `hud.json`
      (directory prefix dropped, extension dropped, lowercased); the engine's
      own strings say `.tga` while the shipped files are `.dds`, so the name
      is normalised rather than trusted.

The sprite list itself comes from `features/authentic-spawn-map/README.md`
section 2, which was verified against the archives on this machine.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from bf42.rfa import ArchivePool, RfaArchive, find_archives_dir  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

VIEWER_HUD_DIR = Path(__file__).resolve().parent / "viewer" / "maps" / "_shared" / "hud"

# Everything the viewer draws, as archive paths under `menu/`. Output name is
# the lowercased basename with the extension swapped for `.png`.
NATIONS = ("us", "ger", "brit", "can", "jp", "rus")
SPRITES: list[str] = [
    # Control point flags: capturable, the neutral state, and the red-ringed
    # uncapturable main bases.
    *[f"Texture/conp_{n}" for n in (*NATIONS, "neutral")],
    *[f"Texture/baseflag_conp_{n}" for n in NATIONS],
    # Map markers.
    "Texture/Minimap/map_circle",
    "Texture/Minimap/map_dot",
    "Texture/Minimap/minimap_icon_ring_32x32",
    # Vehicle-class silhouettes (`destoyer` misspelling is the shipped name).
    *[f"Texture/Minimap/minimap_icon_{k}_16x16"
      for k in ("soldier", "tank", "apc", "plane", "common", "stationary")],
    "Texture/Minimap/minimap_icon_PT_Boat",
    "Texture/Minimap/minimap_icon_destoyer_32x32",
    "Texture/Minimap/minimap_icon_submarine_32x32",
    "Texture/Minimap/minimap_icon_battleship_64x64",
    "Texture/Minimap/minimap_icon_aircraft_carrier_64x64",
    # Vehicle dots.
    *[f"Texture/icon_vehicledot_{k}" for k in ("friend", "enemy", "empty", "local")],
    # The nine-frame capture-progress ring.
    *[f"Texture/Minimap/Objectives/Objective{f}"
      for f in ("000", "012", "025", "037", "050", "062", "075", "087", "100")],
    # HUD minimap bezel and the flag-status bar segments.
    "Texture/Minimap/icon_mapbar_small",
    *[f"Texture/Ingame/cpbar/cpbar_{k}_cp_16x8" for k in ("blue", "red", "gray")],
    # Spawn-screen chrome.
    *[f"Texture/Ingame/respawn/ingame_respawn_kits_{k}_256x128"
      for k in ("top", "middle", "bottom")],
    *[f"Texture/Ingame/respawn/ingame_respawn_kits_tab{k}_256x32"
      for k in ("", "2", "3")],
    "Texture/Ingame/respawn/ingame_respawn_long_512x64",
    "Texture/Ingame/respawn/ingame_respawn_small_256x64",
    # Kit photographs, both sides plus the theatre variants that exist.
    *[f"Texture/Kits/icon_{role}_{side}_selected"
      for role in ("scout", "assault", "antitank", "medic", "engineer")
      for side in ("allies", "axis")],
    "Texture/Kits/Icon_assault_jap_selected",
    "Texture/Kits/Icon_assault_russian_selected",
    "Texture/Kits/icon_assault_canadian_selected",
    "Texture/Kits/icon_engineer_jap_selected",
    "Texture/Kits/icon_engineer_usmarines_selected",
    # Team-header flags for the kit column.
    *[f"Texture/icon_flag_{n}" for n in NATIONS],
    # The rest of what `menu/InGame` draws on the spawn screen (see
    # extract_spawn_layout.py): the footer button plates at rest and under
    # the pointer, the class glyph in each kit row's header, and the ticket
    # counter's bar and flags.
    *[f"Texture/Menu/knapp{k}" for k in ("ext_n", "ext_mo", "3_n", "3_mo")],
    *[f"Texture/Debriefing/classes/class_{k}_16x16"
      for k in ("scout", "assault", "at", "medic", "engineer")],
    "Texture/icon_ticketbar",
    *[f"Texture/flag_ticket_{n}" for n in NATIONS],
]

# `flag(us|ge|uk|Jp|so|can)_m1` in a control point's `flagMesh` names the flag
# cloth the level hoists there; the map sprite set uses different codes.
# Recorded in the manifest so the viewer and this script cannot drift apart.
FLAG_MESH_NATION = {
    "us": "us", "ge": "ger", "uk": "brit", "jp": "jp", "so": "rus", "can": "can",
}


def extract_sprites(menu_rfa: Path, out_dir: Path, force: bool) -> dict:
    """Decode the sprite list to PNGs, returning the manifest dict."""
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    with RfaArchive(menu_rfa) as arch:
        # Casing varies and the declared extension cannot be trusted, so
        # resolve both against the real entry table.
        index = {e.lower(): e for e in arch.entries}
        missing: list[str] = []
        for stem in SPRITES:
            entry = None
            for ext in (".dds", ".tga"):
                entry = index.get(f"menu/{stem}{ext}".lower())
                if entry:
                    break
            if not entry:
                missing.append(stem)
                continue
            name = Path(stem).name.lower()
            dest = out_dir / f"{name}.png"
            raw = arch.read(entry)
            if entry.lower().endswith(".dds"):
                width, height, rgba = decode_dds(raw)
            else:
                width, height, rgba = decode_tga(raw)
            if force or not dest.exists():
                # `drop_alpha` defaults True in the shared encoder (map art is
                # opaque); these are cut-out sprites, so the alpha is the point.
                dest.write_bytes(encode_png(width, height, rgba, drop_alpha=False))
            manifest[name] = {
                "file": f"{name}.png",
                "size": [width, height],
                "source": entry,
            }
        if missing:
            print(f"warning: {len(missing)} sprites not in {menu_rfa.name}: "
                  f"{', '.join(missing)}", file=sys.stderr)
    return manifest


_CREATE = re.compile(r"(?i)^ObjectTemplate\.(?:create\s+\S+|active)\s+(\S+)")
_ICON = re.compile(r'(?i)^ObjectTemplate\.setMinimapIcon\s+"?([^"\s]+)"?')
_SIZE = re.compile(r"(?i)^ObjectTemplate\.setMinimapIconSize\s+(\d+)")


def icon_key(path: str) -> str:
    """`"Minimap/minimap_icon_tank_16x16.tga"` -> `minimap_icon_tank_16x16`,
    the name the sprite pack files it under."""
    leaf = path.replace("\\", "/").rsplit("/", 1)[-1]
    return leaf.rsplit(".", 1)[0].lower()


def extract_icon_map(game_dir: Path) -> dict[str, dict]:
    """template (lowercased) -> {icon, size} from every Objects archive.

    `size` is the engine's `setMinimapIconSize` draw size in pixels where one
    is declared (the 32/64 px ship icons), and absent otherwise — the default
    is the sprite's own 16 px.
    """
    archives = find_archives_dir(game_dir / "Mods" / "bf1942")
    if archives is None:
        sys.exit(f"no Archives directory under {game_dir}/Mods/bf1942")
    pool = ArchivePool()
    pool.add_dir(archives, ("objects",))
    templates: dict[str, dict] = {}
    for entry in pool.names():
        if not entry.lower().endswith(".con"):
            continue
        text = pool.try_read(entry)
        if text is None:
            continue
        current: str | None = None
        for line in text.decode("latin-1", "replace").splitlines():
            line = line.strip()
            if m := _CREATE.match(line):
                current = m.group(1).lower()
            elif (m := _ICON.match(line)) and current:
                templates.setdefault(current, {})["icon"] = icon_key(m.group(1))
            elif (m := _SIZE.match(line)) and current:
                templates.setdefault(current, {})["size"] = int(m.group(1))
    # A size with no icon declares nothing drawable; drop the strays.
    return {k: v for k, v in sorted(templates.items()) if "icon" in v}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR,
                        help=f"BF1942 install (default: {DEFAULT_GAME_DIR})")
    parser.add_argument("--out", type=Path, default=VIEWER_HUD_DIR,
                        help=f"output directory (default: {VIEWER_HUD_DIR})")
    parser.add_argument("--force", action="store_true",
                        help="re-encode PNGs that already exist")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    menu_rfa = None
    archives = find_archives_dir(game_dir / "Mods" / "bf1942")
    if archives:
        for child in archives.iterdir():
            if child.name.lower() == "menu.rfa":
                menu_rfa = child
                break
    if menu_rfa is None:
        sys.exit(f"menu.rfa not found under {game_dir}/Mods/bf1942")

    sprites = extract_sprites(menu_rfa, args.out, args.force)
    (args.out / "hud.json").write_text(json.dumps({
        "sprites": sprites,
        "flagMeshNation": FLAG_MESH_NATION,
    }, indent=1) + "\n")
    icons = extract_icon_map(game_dir)
    (args.out / "minimap-icons.json").write_text(
        json.dumps(icons, indent=1) + "\n")
    print(f"{len(sprites)} sprites and {len(icons)} template icons -> {args.out}")


if __name__ == "__main__":
    main()
