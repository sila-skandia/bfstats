#!/usr/bin/env python3
"""Extract OPTIONS > CUSTOMIZE, the game's general options screen.

Writes `<hud>/menu/general-options-layout.json` beside `controls-layout.json`,
which the controls screen lays its fourth section out of:

`pages.general`     `menu/GeneralOptionsMenu`: the CUSTOMIZE plate and its
                    rows -- PLAYERNAME, TOOLTIP, RADIO TOOLTIP, STATIC MINIMAP
                    (tick boxes bound to `Options/General/ToolTip`,
                    `RadioToolTip`, `StaticMinimap`), MINIMAP TRANSPARENCY (a
                    74-unit track and its `Options/General/MinimapTransparency`
                    percentage) and CROSSHAIR COLOR's RED, GREEN and BLUE
                    tracks.
`pages.generalNav`  `menu/GeneralOptionsNavigation`: DEFAULT and SAVE.
`textures`          the plate's two pictures, under `textures/`.

The screen has no row for the radio tooltip's colour in any shipped menu
(vanilla, Road to Rome, Secret Weapons, Desert Combat): the client registers
`Options/General/Radio/Color/Radio{Red,Green,Blue}` and no page binds them.

    python3 extract_general_options_layout.py             # vanilla
    python3 extract_general_options_layout.py --mod xpack2 --out <stage>/.../hud/menu
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_controls_menu_layout as controls  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from extract_spawn_layout import extract_fonts, font_handles, load_chain_lexicon  # noqa: E402

PAGES = (
    ("general", "menu/GeneralOptionsMenu", None),
    ("generalNav", "menu/GeneralOptionsNavigation", controls.LEVEL3),
)


def decode_layout(menu, lexicon: dict[str, str]) -> dict:
    index = {e.lower(): e for e in menu.entries}
    pages: dict[str, dict] = {}
    variables: dict[str, object] = {}
    fonts: set[str] = set()
    owners: set[str] = set()
    for key, entry, settled in PAGES:
        real = index.get(entry.lower())
        if real is None:
            sys.exit(f"the {'/'.join(menu.labels)} menu chain has no {entry}")
        owners.add(menu.owner(real) or "")
        page = controls.decode_page(menu.read(real), lexicon, None, settled,
                                    controls.TOP_TRANSFORMS)
        for warning in page["warnings"]:
            # The plate's last child is a `DisableNode` the reader has no
            # schema for; every row this screen draws is read before it.
            print(f"note: {entry}: {warning}", file=sys.stderr)
        pages[key] = {"source": entry, "elements": page["elements"]}
        variables.update({k: v for k, v in page["variables"].items()
                          if k.startswith("Options/General/")})
        fonts.update(el["font"] for el in page["elements"] if el.get("font"))
    return {
        "virtual": [800, 600],
        "source": f"{', '.join(e for _, e, _ in PAGES)} (MemeFile 2.0) in "
                  f"Mods/{'+'.join(sorted(owners))}/Archives/menu.rfa",
        "fonts": sorted(fonts),
        "variables": dict(sorted(variables.items())),
        "pages": pages,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942")
    parser.add_argument("--out", type=Path, default=None,
                        help="the pack's menu directory (default: vanilla's)")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)

    sources = MenuSources(mod_chain(args.game_dir.expanduser(), args.mod))
    out = args.out or controls.VIEWER_MENU_DIR
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    out.mkdir(parents=True, exist_ok=True)
    with sources.open_menu() as menu:
        layout = decode_layout(menu, lexicon)
        layout["textures"] = controls.extract_textures(
            menu, controls.layout_textures(layout), out / "textures", args.force)
    with sources.open_font() as fonts:
        layout["fontFiles"] = extract_fonts(fonts, font_handles(layout), out / "fonts", args.force)
    (out / "general-options-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    print(f"general-options-layout.json: {len(layout['pages']['general']['elements'])} leaves, "
          f"{len(layout['textures'])} textures, {len(layout['fontFiles'])} fonts -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
