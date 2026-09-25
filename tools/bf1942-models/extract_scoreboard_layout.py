#!/usr/bin/env python3
"""Decode the in-game score board out of `menu/InGame` for the map viewer.

The third sibling of `extract_spawn_layout.py` and `extract_menu_layout.py`:
same reader, same `Flattener`, same 800x600 virtual space. The board is one
top-level entry of `menu/InGame`, the `TransformNode (0,-15) 800x800` whose
first child culls on `Scoreboard/SpawnScoreBoard`. There is only one such
page in the file: the spawn screen's SCORE BOARD button (a single
`BfButtonNode` calling `Kit/ScoreboardSpawnInterface`) and the held
`c_PIShowScoreBoard` key (`IDKey_Tab`, `c_CMPushAndHold`, in every shipped
`Settings/Default/Controls/*.con`) both show it, and the page tells the two
apart itself through `Scoreboard/FromSpawnScoreboard`, which swaps the label
on its one red button.

What the page holds, all of it in the data:

  two team panels    `Voting/scoreboard_512x470` at (10,60) and (409,60), each
                     with the side's name in Trebuchet MS18 and its rounds won
                     (`Scoreboard/AxisRoundWon`), an olive heading strip with
                     the score / kills / deaths / ping / ID icons and the
                     side's ticket flag (`AxisTicketFlag`), a
                     `BfNewListBoxNode` on `Scoreboard/AxisScoreboardList`
                     (row height 18, `standard6 - Latin`), a second olive strip
                     and the totals row (`Scoreboard/Axis{Player,Score,Kills,
                     Deaths,Ping}Total`).
  the button frame   `Voting/scoreboard_buttonframe_780x64` with the buddy,
                     vote-kick and map-vote buttons and the red close button
                     (`Kit/DoneSpawnScoreboard`), hidden at the end of a round.
  the server plate   `ingame_serverIP_256x32`: server name, address, map name.
  the vote message   `Voting/kick_mapmessage_long`, multiplayer only.

What it does NOT hold is the list box's rows and the columns they are set in:
the engine builds both at runtime. The columns are in the client, in the one
function that looks the two lists up by name (`AlliedScoreboardList` pushed at
0x006df9de, `AxisScoreboardList` at 0x006dfa30): two identical runs of
thirteen `addColumn` calls (`FUN_007d4240`, the int stored at column +0x14)
with 25, 150, 175, 210, 245, 280, 310, 355, 370, 385, 400, 415, 450, each run
closed by one `addColumnNoWidth` (0x007d42a0). They are recorded here as
`LIST_COLUMNS`. The list box's draw (vtable 0x0093cde8 +0x68 = 0x007d1390)
starts a cell's text at the box's left edge + 10 + that int. With the box at
panel x = -5 that puts column 25 at panel x 30 and column 175 at 180, one unit
right of the heading strip's own label (29) and score icon (179), which is how
the columns were matched to what they show: 175 score, 210 kills, 245 deaths,
280 ping, 310 ID, 25 the player's name. Column 0 is the kit glyph: the
client draws each row's class icon there, left of the name under the
heading strip's empty first cell (a retail Bocage capture, not the row-fill
code, is the evidence; see `ROW_ICONS`). What column 150 and the ones past
310 carry was NOT read and is left unnamed.

The row glyphs are the `Debriefing/classes` set in `menu.rfa`: one 16x16 per
class for a human row (`class_scout_16x16`), a yellow twin for a bot row
(`class_bot_scout_16x16`), and a skull for a dead player in each colour
(`dead_16x16`, `bot_dead_16x16`). They are recorded as `rowIcons` and
packed with the board's other plates.

Artifacts, all under `--out` (default `<hud pack>/scoreboard/`, a directory of
its own so no other extractor's manifest is touched):

  scoreboard-layout.json   the flat draw list, the variables with the file's
                           own sample values, the resolved strings, the list
                           columns, the per-team row colours `Menu.con` sets,
                           and manifests for:
  textures/*.png           every plate, button and icon the page names
  fonts/*.png + *.json     the bitmap faces its text nodes name

Usage:
    python3 tools/bf1942-models/extract_scoreboard_layout.py --out <dir>
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
    VIRTUAL, extract_fonts, find_group, font_handles, load_chain_lexicon,
)
from extract_menu_layout import (  # noqa: E402
    MenuFlattener, data_value, extract_textures, settled_values,
)
from bf42 import meme  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from bf42.rfa import ArchivePool, find_archives_dir  # noqa: E402

#: The variable the board's top-level group culls on.
BOARD_VAR = "Scoreboard/SpawnScoreBoard"

#: The ints the client passes to the list box's `addColumn` (`FUN_007d4240`)
#: for the two score lists (the runs at 0x006dfa75..0x006dfb13 and
#: 0x006dfb33..0x006dfbd1) -- the same thirteen for both, each run followed
#: by one `addColumnNoWidth`. `field` is what the column shows,
#: named where the heading strip's own icon sits over it -- and, for column
#: 0, where the retail capture puts the row's kit glyph.
LIST_COLUMNS = [
    {"x": 0, "field": "icon"},
    {"x": 25, "field": "name"},
    {"x": 150, "field": None},
    {"x": 175, "field": "score"},
    {"x": 210, "field": "kills"},
    {"x": 245, "field": "deaths"},
    {"x": 280, "field": "ping"},
    {"x": 310, "field": "id"},
    {"x": 355, "field": None},
    {"x": 370, "field": None},
    {"x": 385, "field": None},
    {"x": 400, "field": None},
    {"x": 415, "field": None},
    {"x": 450, "field": None},
]

#: A cell's text starts this far right of the list box's left edge, before the
#: column's own int is added (`local_dbc = boxLeft + 10.0` in the list box's
#: draw, 0x007d1390).
LIST_TEXT_INSET = 10.0

#: The five classes the engine's `setType` vocabulary names, as the viewer's
#: own keys (`bf42/kit.py` TYPE_LABELS; `antitank` is the `at` glyph).
ROW_ICON_CLASSES = {
    "scout": "scout",
    "assault": "assault",
    "antitank": "at",
    "medic": "medic",
    "engineer": "engineer",
}

#: The list rows' glyphs, `menu/Texture/Debriefing/classes/*`: the class
#: icon a human row and a bot row each get, and the skull that replaces it
#: while the player is dead. Texture names are the pack's lower-cased stems.
ROW_ICONS = {
    "human": {k: f"class_{v}_16x16" for k, v in ROW_ICON_CLASSES.items()},
    "bot": {k: f"class_bot_{v}_16x16" for k, v in ROW_ICON_CLASSES.items()},
    "dead": "dead_16x16",
    "botDead": "bot_dead_16x16",
}

#: The game's own per-team row colours, and where it sets them: the client's
#: `Bf1942/Game/Init/Menu.con` runs `Game.setAxisRadioColor 1/0.35/0.35` and
#: `Game.setAlliedRadioColor 0.4/0.6/1`, and the board draws a row's name and
#: its numbers in them, and a retail capture's ink cores are #d65454 on the Axis
#: panel and #54aed8 on the Allied one, which is those two through the face's
#: own coverage. The buddy green is the one the chat settings use for a buddy
#: (the client's own literal, `extract_radio.py` records it the same way), and
#: the local player's own row is drawn in it.
MENU_CON = "Bf1942/Game/Init/Menu.con"
TEAM_COLOR_KEYS = {"axis": "AxisRadioColor", "allies": "AlliedRadioColor"}
TEAM_COLORS_SOURCE = ("Bf1942/Game/Init/Menu.con: Game.setAxisRadioColor and "
                      "Game.setAlliedRadioColor")
BUDDY_COLOR = [0.0, 1.0, 0.0]


def read_team_colors(game_dir: Path, mod: str) -> dict:
    """The sides' row colours, read out of the chain's `Menu.con`.

    `Menu.con` sits in the `bf1942` archive of the chain, the same file
    `extract_radio.py` takes the chat colours from. A chain whose archive is
    missing leaves both sides null, which `rowColor` in the viewer then falls
    back for."""
    pool = ArchivePool()
    for step in mod_chain(game_dir, mod):
        archives = find_archives_dir(step)
        if archives is not None and (archives / "bf1942").is_dir():
            pool.add_dir(archives / "bf1942", ("game",))
    raw = pool.try_read(MENU_CON)
    settings: dict[str, str] = {}
    if raw is not None:
        for line in raw.decode("latin-1").splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[0].lower().startswith("game.set"):
                settings[parts[0][len("Game.set"):].lower()] = parts[1]
    colors: dict[str, list[float] | None] = {}
    for side, key in TEAM_COLOR_KEYS.items():
        value = settings.get(key.lower())
        rgb = [float(v) for v in value.split("/")] if value else []
        colors[side] = rgb if len(rgb) == 3 else None
    colors["buddy"] = list(BUDDY_COLOR)
    return colors


class BoardFlattener(MenuFlattener):
    """`MenuFlattener` plus the one class the board adds.

    `VariableEffectNode` is sibling-scoped like `EffectNode`. The board uses
    it twice, both times as `AlphaFadeEffect` at a literal level 0.0 over the
    KICK and BAN plates a player who is not the remote admin gets instead of
    the live buttons. What level 0 of an alpha fade draws was not read out of
    the client, so the leaves under it are emitted with `fade: 0.0` and the
    painter decides; they are not dropped here.
    """

    def __init__(self, lexicon, settled=None):
        super().__init__(lexicon, settled)
        self._fade: float | None = None

    def run(self, nodes, ox=0.0, oy=0.0, rect=None, color=None, when=None):
        outer = self._fade
        super().run(nodes, ox, oy, rect, color, when)
        self._fade = outer  # a fade ends with the list it was declared in

    def extend(self, node, siblings, ox, oy, rect, color, when):
        if node.cls == "VariableEffectNode":
            effect = node["Effect"]
            if isinstance(effect, meme.Obj) and effect.cls == "AlphaFadeEffect":
                level = data_value(node["Effect level"])
                self._fade = float(level) if isinstance(level, (int, float)) else None
            return ox, oy, color, when
        return super().extend(node, siblings, ox, oy, rect, color, when)

    def leaf(self, kind, rect, color, when, **extra):
        el = super().leaf(kind, rect, color, when, **extra)
        if self._fade is not None:
            el["fade"] = self._fade
        return el


def decode_layout(ingame: bytes, lexicon: dict[str, str],
                  source: str | None = None,
                  colors: dict | None = None) -> dict:
    root, reader = meme.load(ingame)
    top = find_group(root, BOARD_VAR)
    if top is None:
        raise SystemExit(f"menu/InGame has no {BOARD_VAR} group")
    flat = BoardFlattener(lexicon, settled_values(root))
    flat.run([top])
    fonts = {el["font"] for el in flat.elements
             if el.get("font") and el["kind"] in ("text", "listbox")}
    return {
        "virtual": list(VIRTUAL),
        "source": source or "menu/InGame (MemeFile 2.0) in "
                            "Mods/bf1942/Archives/menu.rfa",
        "group": {"var": BOARD_VAR,
                  "rect": [top["X"], top["Y"], top["Width"], top["Height"]]},
        "listColumns": {
            "source": "BF1942.exe 0x006dfa75..0x006dfb13 and "
                      "0x006dfb33..0x006dfbd1: FUN_007d4240 addColumn",
            "textInset": LIST_TEXT_INSET,
            "columns": LIST_COLUMNS,
        },
        "rowIcons": ROW_ICONS,
        "colors": colors if colors is not None else {},
        "colorsSource": TEAM_COLORS_SOURCE,
        "fonts": sorted(fonts),
        "strings": dict(sorted(flat.strings.items())),
        "variables": dict(sorted(flat.variables.items())),
        "elements": flat.elements,
    }


def layout_textures(layout: dict) -> set[str]:
    """Every fixed plate the page names, plus the list rows' glyphs. A leaf
    with a `var` is a slot the engine fills at runtime (the two ticket
    flags), except that its shipped default is still a real plate and is
    taken too."""
    names: set[str] = set()
    for el in layout["elements"]:
        for field in ("texture", "hover", "pressed"):
            if el.get(field):
                names.add(el[field])
    icons = layout.get("rowIcons") or {}
    for group in ("human", "bot"):
        names.update((icons.get(group) or {}).values())
    for key in ("dead", "botDead"):
        if icons.get(key):
            names.add(icons[key])
    return names


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose menu chain to read (default: bf1942)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's hud pack "
                             "dir + /scoreboard)")
    parser.add_argument("--force", action="store_true",
                        help="re-encode textures and font atlases")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    sources = MenuSources(mod_chain(game_dir, args.mod))
    out = args.out or (hud_dir_for(sources.mod_id) / "scoreboard")
    lexicon = load_chain_lexicon(sources.lexicon_paths)
    if not lexicon:
        print("warning: lexiconAll.dat not found, locale keys stay unresolved",
              file=sys.stderr)
    out.mkdir(parents=True, exist_ok=True)

    with sources.open_menu() as menu:
        index = {e.lower(): e for e in menu.entries}
        entry = index.get("menu/ingame")
        if entry is None:
            sys.exit(f"the {'/'.join(menu.labels)} menu chain has no menu/InGame")
        layout = decode_layout(
            menu.read(entry), lexicon,
            f"menu/InGame (MemeFile 2.0) in "
            f"Mods/{menu.owner(entry) or sources.mod_id}/Archives/menu.rfa",
            read_team_colors(game_dir, args.mod))
        layout["textures"] = extract_textures(menu, layout_textures(layout),
                                              out / "textures", args.force)
    with sources.open_font() as fonts:
        layout["fontFiles"] = extract_fonts(fonts, font_handles(layout),
                                            out / "fonts", args.force)
    (out / "scoreboard-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    print(f"{len(layout['elements'])} elements, {len(layout['textures'])} textures, "
          f"{len(layout['fontFiles'])} fonts -> {out}")


if __name__ == "__main__":
    main()
