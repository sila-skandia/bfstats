#!/usr/bin/env python3
"""Decode the multiplayer end-of-round debriefing out of `menu/LoadMenu`.

When a round ends, the client builds the debriefing (`BfMenu_debriefing`,
BF1942.exe 0x006aad90, ledger ROUND-8) and draws it from `menu/LoadMenu`,
over the world. The file holds two plates for it, chosen by `StartingGame`
(`BfMenu+0x6dc`): `Debriefing/MP_debriefing_512x512` for 2 and 3 (a game
joined or hosted), and `SP_debriefing_512x512` with the campaign bar, the
statistics list and the DONE / REPLAY buttons for 0, 1 and 4. This writes the
first, the one a multiplayer round ends on, as a flat draw list in the same
800x600 virtual space and with the same `Flattener` as the score board:

  the plate          `MP_debriefing_512x512` at (150,100)
  the title          `Debriefing/DebriefingHeading`, Trebuchet MS18, centred
                     (the client writes `DEBRIEFING_TOTAL_VICTORY` and the rest)
  the tickets        each side's ticket flag (`AxisTicketFlagLoad`) and count
                     (`AxisTicket`), Trebuchet MS11 - Latin
  BEST PLAYERS       `DEBRIEFING_HEADING`, Trebuchet MS8
  the heading strip  a black and an olive quad, PLAYERNAME and the score,
                     kills, deaths and ping icons
  the list           `Debriefing/DebriefingList`, `standard6`, row height 76

There is no level line and no countdown on this plate: `DebriefingText` is
drawn by the single-player plate only.

The rows are the client's, and are not in the file. `FUN_006aa4f0` fills the
list with the top three of `getPlayersSortedByScore` (PlayerManager vt+0x30),
one row each: the rank digit (`ToolTip/<n>_16x16`), the side's ticket flag,
the name, the score, kills, deaths and ping, and a 32x32 medal by rank and
side (`FUN_006a9f00`: gold, silver, bronze). The columns are the eight
`addColumn` ints at 0x006aa40d..0x006aa46a. `viewer/round-end.js` carries
that half (`DEBRIEFING_LIST`); this file packs the art the rows name with
the plate's own.

Artifacts, under `--out` (default `<hud pack>/debriefing/`):

  debriefing-layout.json   the draw list, the variables with the file's own
                           sample values, the resolved strings, manifests for
  textures/*.png           every plate and icon the plate and its rows name
  fonts/*.png + *.json     the bitmap faces its text nodes name

Usage:
    python3 tools/bf1942-models/extract_debriefing_layout.py [--mod bf1942]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from extract_hud_pack import hud_dir_for  # noqa: E402
from extract_spawn_layout import (  # noqa: E402
    VIRTUAL, extract_fonts, font_handles, load_chain_lexicon,
)
from extract_menu_layout import (  # noqa: E402
    data_value, extract_textures, settled_values,
)
from extract_scoreboard_layout import BoardFlattener  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402

#: The multiplayer plate, by its texture; its parent transform is the group.
PLATE = "debriefing/mp_debriefing_512x512"

#: The art the client's rows name (`FUN_006aa4f0`, `FUN_006a9f00`), which the
#: file does not: the three rank digits and the six 32x32 medals.
ROW_TEXTURES = (
    "1_16x16", "2_16x16", "3_16x16",
    "axis_xl_gold_32x32", "axis_xl_silver_32x32", "axis_xl_bronze_32x32",
    "allied_xl_gold_32x32", "allied_xl_silver_32x32", "allied_xl_bronze_32x32",
)


class DebriefingFlattener(BoardFlattener):
    """The board's flattener, plus a bound picture with no default.

    The plate's two ticket flags are `VariablePictureNode`s on
    `AxisTicketFlagLoad` / `AlliedTicketFlagLoad`, whose shipped value is the
    empty string. The base takes an empty picture for a solid quad (the olive
    strips are drawn that way); a bound one is a slot the client fills
    (`BfHud_loadTeamIcons` writes the side's ticket icon), so it stays a
    picture with its variable and no texture."""

    def emit_picture(self, node, rect, color, when) -> None:
        if node.cls == "VariablePictureNode":
            src = node["First part"]
            var = src.name if isinstance(src, meme.Obj) else None
            if var and not (data_value(src) or ""):
                self.leaf("picture", rect, color, when, texture=None, var=var)
                return
        super().emit_picture(node, rect, color, when)


def find_plate_group(root: meme.Obj) -> meme.Obj | None:
    """The `TransformNode` whose children draw the multiplayer plate."""
    for node in meme.walk_all(root):
        if node.cls != "TransformNode":
            continue
        for child in node.children():
            if child.cls == "PictureNode" and \
                    str(child.get("Picture") or "").lower().replace("\\", "/") \
                    .startswith(PLATE):
                return node
    return None


def decode_layout(loadmenu: bytes, lexicon: dict[str, str],
                  source: str | None = None) -> dict:
    root, reader = meme.load(loadmenu)
    top = find_plate_group(root)
    if top is None:
        raise SystemExit("menu/LoadMenu has no multiplayer debriefing plate")
    flat = DebriefingFlattener(lexicon, settled_values(root))
    flat.run([top])
    fonts = {el["font"] for el in flat.elements
             if el.get("font") and el["kind"] in ("text", "listbox")}
    return {
        "virtual": list(VIRTUAL),
        "source": source or "menu/LoadMenu (MemeFile 2.0) in "
                            "Mods/bf1942/Archives/menu.rfa",
        "group": {"var": "StartingGame", "values": [2, 3],
                  "rect": [top["X"], top["Y"], top["Width"], top["Height"]]},
        "fonts": sorted(fonts),
        "strings": dict(sorted(flat.strings.items())),
        "variables": dict(sorted(flat.variables.items())),
        "elements": flat.elements,
    }


def layout_textures(layout: dict) -> set[str]:
    """Every fixed plate the layout names, plus the rows' digits and medals."""
    names = {el["texture"] for el in layout["elements"] if el.get("texture")}
    names.update(ROW_TEXTURES)
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose menu chain to read (default: bf1942)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's hud pack "
                             "dir + /debriefing)")
    parser.add_argument("--force", action="store_true",
                        help="re-encode textures and font atlases")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    sources = MenuSources(mod_chain(game_dir, args.mod))
    out = args.out or (hud_dir_for(sources.mod_id) / "debriefing")
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    if not lexicon:
        print("warning: lexiconAll.dat not found, locale keys stay unresolved",
              file=sys.stderr)
    out.mkdir(parents=True, exist_ok=True)

    with sources.open_menu() as menu:
        index = {e.lower(): e for e in menu.entries}
        entry = index.get("menu/loadmenu")
        if entry is None:
            sys.exit(f"the {'/'.join(menu.labels)} menu chain has no menu/LoadMenu")
        layout = decode_layout(
            menu.read(entry), lexicon,
            f"menu/LoadMenu (MemeFile 2.0) in "
            f"Mods/{menu.owner(entry) or sources.mod_id}/Archives/menu.rfa")
        layout["textures"] = extract_textures(menu, layout_textures(layout),
                                              out / "textures", args.force)
    with sources.open_font() as fonts:
        layout["fontFiles"] = extract_fonts(fonts, font_handles(layout),
                                            out / "fonts", args.force)
    (out / "debriefing-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    print(f"{len(layout['elements'])} elements, {len(layout['textures'])} textures, "
          f"{len(layout['fontFiles'])} fonts -> {out}")


if __name__ == "__main__":
    main()
