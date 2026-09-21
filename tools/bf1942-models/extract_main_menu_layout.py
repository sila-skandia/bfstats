#!/usr/bin/env python3
"""Extract the BF1942 front end's navigation and MULTIPLAY screen.

`extract_menu_layout.py` takes Singleplayer > Instant Battle. This one takes
the chrome around it and the screen beside it:

  `menu/MainMenuNavigation`   the tab strip — SINGLEPLAY, MULTIPLAY, OPTIONS,
                              CUSTOM GAME, INTRO, CREDITS — six
                              `BfNavigationButtonNode`s on `Menu/knapp_*.tga`
  `menu/MultiplayerNavigation` the row under it — INTERNET, LOCAL,
                              CREATE GAME, RENT SERVER
  `menu/InternetNavigation`   the row under *that* — REFRESH, STOP, APPLY
                              FILTER, CLEAR FILTER, ADD FAVORITE, ADD SERVER
                              — and the JOIN button in the bottom right
  `menu/InternetMenu`         the server browser itself: the plate, the
                              sortable SERVER / PLAYERS / PING / GAME TYPE /
                              MAP column heads, the filter row, the list box,
                              the CUSTOM FILTER and CONNECTION SPEED panels
                              and the "n/m  k PLAYERS ONLINE" footer
  `menu/CreateGameMenu`       the CREATE GAME page, with `…Page1`, `…Page2`
                              and `menu/CreateGameNavigation`'s two START
                              buttons

The play site's front end mirrors this: a SINGLEPLAY tab holding the Instant
Battle screen (the default) and a MULTIPLAY tab holding the room server's
list in the server browser's own furniture. The site answers for one of each
row's buttons — the room list is one list, not INTERNET and LOCAL, and
nothing here rents a server — so `viewer/play/nav-strip.js` draws the tabs it
can honour and `multiplay.js` keeps CREATE GAME. The plates, the strings, the
faces and every rectangle are the shipped files either way.

## Where the strip sits

`Navigation/NavigationY` is the whole strip's Y and the file holds all three
of its values: 85 one level in (the main menu), 58 two (MULTIPLAY chosen), 33
three (a screen under a sub-tab). Nothing in a page says which level *it* is
— the engine writes the variable on the way in — so this extractor settles it
at `LEVEL3_Y`, which is where both of the site's screens live: the tab row at
33, the sub-row at 59, and the page's own plate from 125 down, which is
exactly where `menu/SkirmishMenu` and `menu/InternetMenu` both start.

Usage:
    python3 tools/bf1942-models/extract_main_menu_layout.py
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
    font_handles, layout_textures, measure_rows,
)
from extract_spawn_layout import load_chain_lexicon  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402

#: `Navigation/Level3/Level3`, the Y the strip rests at over a sub-tab's own
#: screen. Read off the file rather than typed: the three `Navigation/Level*`
#: IntDatas hold 85 / 58 / 33 and this is the third.
LEVEL3_Y = 33.0

#: The pages this screen is, in the order they paint, and what settles for
#: each. `None` keeps whatever `settled_values` read out of the page.
PAGES: list[tuple[str, str, dict[str, float] | None]] = [
    ("background", "menu/Background", None),
    ("internet", "menu/InternetMenu", None),
    ("createGame", "menu/CreateGameMenu", None),
    ("createGamePage1", "menu/CreateGameMenuPage1", None),
    ("createGamePage2", "menu/CreateGameMenuPage2", None),
    ("createGameNav", "menu/CreateGameNavigation", None),
    ("internetNav", "menu/InternetNavigation", {"Navigation/NavigationY": LEVEL3_Y}),
    ("multiplayerNav", "menu/MultiplayerNavigation", {"Navigation/NavigationY": LEVEL3_Y}),
    ("mainNav", "menu/MainMenuNavigation", {"Navigation/NavigationY": LEVEL3_Y}),
]

#: The two CREATE GAME settings pages are placed by `menu/
#: CreateGameMenuPageLayer` — a `PathNode`, which the reader has no schema
#: for — rather than by a transform of their own, so their bodies hang off a
#: bare top-level `SplitNode` that the default walk skips. The page header
#: ("CREATE GAME 1/2" and its arrow) is on a transform and comes out either
#: way; everything else on the page is under the split.
WITH_SPLITS = {"createGamePage1", "createGamePage2"}

#: Per page, the top-level transforms to keep. None keeps every one.
#: `menu/Background` holds the same 800x450 plate twice (the still and the
#: Bink movie's frame); the Instant Battle pack keeps the first of them and
#: this keeps the same two rects so the two screens share one background.
PAGE_RECTS: dict[str, list[list[float]] | None] = {
    "background": [[0.0, 0.0, 800.0, 600.0], [0.0, 85.0, 800.0, 450.0]],
}

VIEWER_MENU_DIR = (Path(__file__).resolve().parent / "viewer" / "maps"
                   / "_shared" / "hud" / "menu")


def decode_layout(menu, lexicon: dict[str, str]) -> dict:
    pages: dict[str, dict] = {}
    variables: dict[str, object] = {}
    strings: dict[str, str] = {}
    fonts: set[str] = set()
    owners: set[str] = set()
    index = {e.lower(): e for e in menu.entries}
    for key, entry, settled in PAGES:
        real = index.get(entry.lower())
        if real is None:
            sys.exit(f"the {'/'.join(menu.labels)} menu chain has no {entry}")
        owners.add(menu.owner(real) or "")
        tops = TOP_TRANSFORMS + ("SplitNode",) if key in WITH_SPLITS else TOP_TRANSFORMS
        page = decode_page(menu.read(real), lexicon, PAGE_RECTS.get(key),
                           settled, tops)
        for warning in page["warnings"]:
            print(f"warning: {entry}: {warning}", file=sys.stderr)
        pages[key] = {"source": entry, "elements": page["elements"]}
        variables.update(page["variables"])
        variables.update(page["settled"])
        strings.update(page["strings"])
        fonts.update(el["font"] for el in page["elements"]
                     if el.get("font") and el["kind"] in ("text", "listbox"))
    return {
        "virtual": [800, 600],
        "source": f"{', '.join(e for _, e, _ in PAGES)} (MemeFile 2.0) in "
                  f"Mods/{'+'.join(sorted(owners))}/Archives/menu.rfa",
        "navigationY": LEVEL3_Y,
        "fonts": sorted(fonts),
        "strings": dict(sorted(strings.items())),
        "variables": dict(sorted(variables.items())),
        "pages": pages,
    }


def list_box(layout: dict, page: str, data: str) -> dict | None:
    """One of a page's list boxes, by the variable the engine fills it
    from. The rows are the part no file holds."""
    for el in layout["pages"][page]["elements"]:
        if el["kind"] == "listbox" and el.get("data") == data:
            return el
    return None


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

    # Where each page's rows sit inside its plate. The server list's own
    # well is the whole box (the filter strip above it is the site's to
    # drop, see `multiplay.js`); the CREATE GAME page's three lists each sit
    # under a heading band their plate art carries.
    measure_rows(layout, out, "createGame")

    box = list_box(layout, "internet", "Join/Internet/InternetServerList")
    if box is None:
        sys.exit("menu/InternetMenu has no server list box")
    #: How many whole rows the list box holds, for the room list's pager.
    layout["serverRows"] = int(box["rect"][3] // box["rowHeight"])

    (out / "main-menu-layout.json").write_text(
        json.dumps(layout, indent=1) + "\n")

    elements = sum(len(p["elements"]) for p in layout["pages"].values())
    print(f"{elements} elements over {len(layout['pages'])} pages, "
          f"{len(layout['textures'])} textures, "
          f"{len(layout['fontFiles'])} fonts, "
          f"{layout['serverRows']} server rows -> {out}")


if __name__ == "__main__":
    main()
