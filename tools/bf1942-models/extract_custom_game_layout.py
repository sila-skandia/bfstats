#!/usr/bin/env python3
"""Decode the Custom Game mod-list dialog out of `menu.rfa`.

The sibling of `extract_menu_layout.py`: same reader, same `decode_page`,
one page instead of three - `menu/CustomGameMenu`, the dialog the main
menu's CUSTOM GAME tab opens. It carries the icon plate behind the
selected mod, the NAME / VERSION / INFO column headers (real lexicon
strings, not ours), and the list box itself - frame, select colour, row
height, font - everything but the rows, which `menu/CustomGameList`
fills at runtime from the mods installed on disk, the same way
`menu/SkirmishMenu`'s `SkirmishLevelsList` is filled from the level
archives.

`menu/CustomGameNavigation` (the real ACTIVATE / VISIT WEB PAGE buttons)
is not decoded here. ACTIVATE is CD-key activation, which means nothing
in a browser, and both buttons already share `knapp3_n`/`knapp3_mo` -
the same plate `menu/SkirmishNavigation`'s START button uses and
`extract_menu_layout.py` has already pulled out. `viewer/play/mod-picker.js`
draws its own two buttons on that plate instead of decoding a second
navigation page for a texture already on disk.

The rows themselves are not the game's data either: what a mod's own
`init.con` sets with `game.setCustomGameVersion` / `...Url` / `...Info`
lives in `build_mods_manifest.py`'s `MOD_INFO` table, read once by hand
out of each installed mod's `init.con` (and, where it points at a lexicon
key like `EOD_INFO`, that mod's own `lexiconAll.dat`) - a fixed set of
facts about specific mods, the same kind of table `MOD_NAMES` already is.

Usage:
    python3 tools/bf1942-models/extract_custom_game_layout.py --out <dir>

The viewer reads it from `viewer/maps/_shared/hud/menu/`, beside the
Instant Battle screen's own `menu-layout.json`.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from extract_menu_layout import (  # noqa: E402
    decode_page, extract_textures, layout_textures, VIEWER_MENU_DIR,
)
from extract_spawn_layout import (  # noqa: E402
    extract_fonts, font_handles, load_lexicon,
)
from bf42.rfa import find_archives_dir  # noqa: E402

#: The one page this dialog needs. `menu/CustomGameNavigation` (the real
#: ACTIVATE / VISIT WEB PAGE buttons) is deliberately not decoded - see the
#: module docstring.
PAGE = ("modlist", "menu/CustomGameMenu")


def decode_layout(menu_rfa: Path, lexicon: dict[str, str]) -> dict:
    from bf42.rfa import RfaArchive
    key, entry = PAGE
    with RfaArchive(menu_rfa) as arch:
        index = {e.lower(): e for e in arch.entries}
        real = index.get(entry.lower())
        if real is None:
            sys.exit(f"{menu_rfa.name} has no {entry}")
        page = decode_page(arch.read(real), lexicon, None)
    for warning in page["warnings"]:
        print(f"warning: {entry}: {warning}", file=sys.stderr)
    fonts = {el["font"] for el in page["elements"]
             if el.get("font") and el["kind"] in ("text", "listbox")}
    return {
        "virtual": [800.0, 600.0],
        "source": f"{entry} (MemeFile 2.0) in Mods/bf1942/Archives/{menu_rfa.name}",
        "pages": {key: {"source": entry, "elements": page["elements"]}},
        "fonts": sorted(fonts),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out", type=Path, default=VIEWER_MENU_DIR)
    parser.add_argument("--force", action="store_true",
                        help="re-encode textures and font atlases")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    mod = game_dir / "Mods" / "bf1942"
    archives = find_archives_dir(mod)
    if archives is None:
        sys.exit(f"no Archives directory under {mod}")
    by_name = {c.name.lower(): c for c in archives.iterdir()}
    menu_rfa, font_rfa = by_name.get("menu.rfa"), by_name.get("font.rfa")
    if not menu_rfa or not font_rfa:
        sys.exit(f"menu.rfa / Font.rfa not found under {archives}")
    lexicon_path = next((c for c in mod.iterdir()
                         if c.name.lower() == "lexiconall.dat"), None)
    lexicon = load_lexicon(lexicon_path) if lexicon_path else {}
    if not lexicon:
        print("warning: lexiconAll.dat not found, locale keys stay unresolved",
              file=sys.stderr)

    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    layout = decode_layout(menu_rfa, lexicon)
    layout["textures"] = extract_textures(
        menu_rfa, layout_textures(layout), out / "textures", args.force)
    layout["fontFiles"] = extract_fonts(
        font_rfa, font_handles(layout), out / "fonts", args.force)
    (out / "custom-game-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    print(f"wrote {out / 'custom-game-layout.json'}", file=sys.stderr)


if __name__ == "__main__":
    main()
