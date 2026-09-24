#!/usr/bin/env python3
"""Extract the BF1942 front end's OPTIONS > CONTROLS screen.

The retail options screen the player binds keys on, out of the shipped
`menu.rfa`:

  `menu/OptionsNavigation`     the row under the tab strip — CONTROLS,
                               CUSTOMIZE, VIDEO, SOUND
  `menu/ControlsNavigation`    DEFAULT and SAVE, the row under that
  `menu/ProfileMenu`           the profile plate at the right of that row
  `menu/ControlsMenu`          the four tab heads — COMMON, INFANTRY, AIR,
                               LAND & SEA — on `Options/Controls/Tab`
  `menu/CommonControlsMenu`,   one per tab: the tabbed plate (each tab's own
  `menu/Controls*Menu`         `menu_control<n>_tab` art is the head that
                               reads as chosen) and the right-hand panel of
                               mouse sensitivity / invert settings
  `menu/<Tab>ControlsPage<n>`  the binding rows: a label, a primary box and
                               an alternate box per row, the "COMMON 1/3"
                               footer and its page arrows

## Where the row pages sit

The row pages are placed by `menu/ControlsPageLayer`, a `PathNode` the
reader has no schema for, so every rect in them comes out relative to the
page. `PAGE_ORIGIN` is that placement: the tabbed plate's own corner (27,125),
checked against a retail capture of the screen (the ENTER / EXIT VEHICLE
label lands at x=37, its box top at y=160, the "COMMON 1/3" footer at
y=479 — all three within a pixel of the capture). The extractor moves the
rows there, so the viewer paints every page in one coordinate space.

## What the rows are

Each row's label carries a lexicon key (`CONTROLS_COMMON_SHOW_MAP`) and the
page an `...Index` variable the engine reads its binding list by. The
engine's index-to-trigger table is not in any file; `viewer/controls-rows.js`
maps the lexicon keys to the `c_PI*` triggers the profile's `.con` lines
bind, and `tests/test_controls_menu.py` holds the two in step.

Usage:
    python3 tools/bf1942-models/extract_controls_menu_layout.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from extract_menu_layout import (  # noqa: E402
    TOP_TRANSFORMS, decode_page, extract_fonts, extract_textures,
    font_handles, layout_textures,
)
from extract_spawn_layout import load_chain_lexicon  # noqa: E402
from extract_main_menu_layout import LEVEL3_Y, PAGE_RECTS, VIEWER_MENU_DIR  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402

#: The tabbed plate's corner, where `menu/ControlsPageLayer` puts a row page.
PAGE_ORIGIN = (27.0, 125.0)

#: `Options/Controls/Tab` as `menu/ControlsMenu`'s tab heads set it.
TAB_IDS = {"common": 1, "infantry": 2, "landSea": 3, "air": 4}

LEVEL3 = {"Navigation/NavigationY": LEVEL3_Y}

#: (key, entry, settled, row page?) in paint order.
PAGES: list[tuple[str, str, dict[str, float] | None, bool]] = [
    ("background", "menu/Background", None, False),
    ("plate.common", "menu/CommonControlsMenu", None, False),
    ("plate.infantry", "menu/ControlsInfantryMenu", None, False),
    ("plate.air", "menu/ControlsAirMenu", None, False),
    ("plate.landSea", "menu/ControlsLandSeaMenu", None, False),
    ("tabs", "menu/ControlsMenu", None, False),
    ("rows.common.1", "menu/CommonControlsPage1", None, True),
    ("rows.common.2", "menu/CommonControlsPage2", None, True),
    ("rows.common.3", "menu/CommonControlsPage3", None, True),
    ("rows.infantry.1", "menu/InfantryControlsPage1", None, True),
    ("rows.infantry.2", "menu/InfantryControlsPage2", None, True),
    ("rows.air.1", "menu/AirControlsPage1", None, True),
    ("rows.air.2", "menu/AirControlsPage2", None, True),
    ("rows.landSea.1", "menu/LandSeaControlsPage1", None, True),
    ("rows.landSea.2", "menu/LandSeaControlsPage2", None, True),
    ("controlsNav", "menu/ControlsNavigation", LEVEL3, False),
    ("profile", "menu/ProfileMenu", None, False),
    ("optionsNav", "menu/OptionsNavigation", LEVEL3, False),
    ("mainNav", "menu/MainMenuNavigation", LEVEL3, False),
]


def moved(el: dict, dx: float, dy: float) -> dict:
    out = dict(el)
    out["rect"] = [el["rect"][0] + dx, el["rect"][1] + dy, *el["rect"][2:]]
    return out


def rows_of(elements: list[dict]) -> list[dict]:
    """A row page's rows, top to bottom: the label and the two boxes whose
    top edge sits five units above it. The boxes are the grey 90x19 frame
    fills; the footer ("COMMON 1/3") is the one keyed text with no box."""
    frames = [el for el in elements if el["kind"] == "fill"
              and el["rect"][2:] == [90.0, 19.0]]
    rows = []
    for label in elements:
        if label["kind"] != "text" or not label.get("key"):
            continue
        y = label["rect"][1] - 5
        boxes = sorted((f for f in frames if abs(f["rect"][1] - y) < 0.5),
                       key=lambda f: f["rect"][0])
        if len(boxes) != 2:
            continue
        rows.append({"key": label["key"], "text": label["text"],
                     "primary": boxes[0]["rect"], "alternate": boxes[1]["rect"]})
    return rows


def pager_of(elements: list[dict]) -> dict:
    """The footer's page arrows: `pilv` back, `pilh` forward."""
    out = {}
    for el in elements:
        if el["kind"] != "button":
            continue
        if "pilv" in (el.get("texture") or ""):
            out["prev"] = el["rect"]
        elif "pilh" in (el.get("texture") or ""):
            out["next"] = el["rect"]
    return out


def decode_layout(menu, lexicon: dict[str, str]) -> dict:
    pages: dict[str, dict] = {}
    variables: dict[str, object] = {}
    owners: set[str] = set()
    fonts: set[str] = set()
    index = {e.lower(): e for e in menu.entries}
    tabs: dict[str, dict] = {}
    for key, entry, settled, is_rows in PAGES:
        real = index.get(entry.lower())
        if real is None:
            sys.exit(f"the {'/'.join(menu.labels)} menu chain has no {entry}")
        owners.add(menu.owner(real) or "")
        page = decode_page(menu.read(real), lexicon, PAGE_RECTS.get(key),
                           settled, TOP_TRANSFORMS)
        for warning in page["warnings"]:
            # The pages lean on node classes the reader has no schema for
            # (`PointerXData`, `DataListData`, `DisableNode`): the binding
            # list, the define-key popup's placement, the video card gate.
            # None of them carries anything this screen draws.
            print(f"note: {entry}: {warning}", file=sys.stderr)
        elements = page["elements"]
        if is_rows:
            elements = [moved(el, *PAGE_ORIGIN) for el in elements]
            _, tab, number = key.split(".")
            tabs.setdefault(tab, {"id": TAB_IDS[tab], "pages": []})["pages"].append({
                "page": key,
                "rows": rows_of(elements),
                "pager": pager_of(elements),
            })
        # The define-key popups on `menu/ControlsMenu` are placed by
        # `Options/Controls/Key/DefineKeyX/Y`, which the engine writes from
        # the pointer; unsigned wrap-around rects are those, parked off
        # screen. They are not drawn.
        elements = [el for el in elements if all(abs(v) < 1e6 for v in el["rect"])]
        pages[key] = {"source": entry, "elements": elements}
        variables.update(page["variables"])
        variables.update(page["settled"])
        fonts.update(el["font"] for el in elements if el.get("font"))
    return {
        "virtual": [800, 600],
        "source": f"{', '.join(e for _, e, _, _ in PAGES)} (MemeFile 2.0) in "
                  f"Mods/{'+'.join(sorted(owners))}/Archives/menu.rfa",
        "navigationY": LEVEL3_Y,
        "pageOrigin": list(PAGE_ORIGIN),
        "tabs": tabs,
        "fonts": sorted(fonts),
        "variables": dict(sorted(variables.items())),
        "pages": pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose menu chain to read (default: bf1942)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's own pack dir)")
    parser.add_argument("--force", action="store_true",
                        help="re-encode textures and font atlases")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    sources = MenuSources(mod_chain(game_dir, args.mod))
    out = args.out or (VIEWER_MENU_DIR if sources.is_vanilla
                       else Path("viewer/maps/_shared/hud/menu"))
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    if not lexicon:
        print("warning: lexiconAll.dat not found, locale keys stay unresolved",
              file=sys.stderr)

    out.mkdir(parents=True, exist_ok=True)
    with sources.open_menu() as menu:
        layout = decode_layout(menu, lexicon)
        layout["textures"] = extract_textures(
            menu, layout_textures(layout), out / "textures", args.force)
    with sources.open_font() as fonts:
        layout["fontFiles"] = extract_fonts(fonts, font_handles(layout),
                                            out / "fonts", args.force)

    (out / "controls-layout.json").write_text(json.dumps(layout, indent=1) + "\n")

    rows = sum(len(p["rows"]) for t in layout["tabs"].values() for p in t["pages"])
    print(f"{len(layout['pages'])} pages, {rows} binding rows over "
          f"{len(layout['tabs'])} tabs, {len(layout['textures'])} textures, "
          f"{len(layout['fontFiles'])} fonts -> {out}")


if __name__ == "__main__":
    main()
