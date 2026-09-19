#!/usr/bin/env python3
"""Decode the Singleplayer > Instant Battle screen out of `menu.rfa`.

The sibling of `extract_spawn_layout.py`: same reader, same `Flattener`,
same 800x600 virtual space, a different set of pages. Where that one takes
the spawn interface out of `menu/InGame`, this one takes the front-end
screen the player picks a level and a side on, which is three pages laid
one over the other:

  menu/Background         the black field and the camouflaged plate
                          (`Menu/Background.tga`, (0,85) 800x450)
  menu/SkirmishMenu       the four panels: the difficulty panel on the
                          left, the level preview, the LEVELS list and the
                          TEAM list
  menu/SkirmishNavigation the green START button at (500,535)

Four artifacts, all under `--out`:

  menu-layout.json    the three pages as flat draw lists, each leaf with
                      its rect, texture or fill colour, font, alignment,
                      resolved display string, colour multiplier and the
                      `when` conditions the game evaluates before drawing
                      it. The level list box carries its own metrics (row
                      height, font, the frame/background/select colours
                      that `BfNewListBoxNode::read` turned out to hold).
  menu-levels.json    one record per level in the game's own level
                      archives: the title the loading screen uses, the two
                      sides' nations from `game.setTeamSkin`, and the
                      level's menu thumbnail.
  textures/*.png      every plate, button and flag the layout names.
  fonts/*.png+.json   the bitmap faces the text nodes name.

The screen is data, not CSS: nothing here is measured off a capture, and
nothing is drawn that the file does not place. The one thing the file does
not hold is the list box's *rows* - the engine fills `SkirmishLevelsList`
at runtime from the level archives, which is what `menu-levels.json` is
for.

Usage:
    python3 tools/bf1942-models/extract_menu_layout.py --out <dir>

The viewer reads it from `viewer/maps/_shared/hud/menu/`, beside the spawn
screen's own pack.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from extract_loading_assets import format_map_title  # noqa: E402
from extract_spawn_layout import (  # noqa: E402
    Flattener, VIRTUAL, data_value, extract_fonts, font_handles, font_id,
    load_lexicon, texture_key,
)
from bf42 import meme  # noqa: E402
from bf42.rfa import RfaArchive, find_archives_dir  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import decode_dds, encode_png  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from extract_hud_assets import decode_tga  # noqa: E402

VIEWER_MENU_DIR = (Path(__file__).resolve().parent / "viewer" / "maps"
                   / "_shared" / "hud" / "menu")

#: The pages that make up the screen, in the order they paint.
PAGES: list[tuple[str, str]] = [
    ("background", "menu/Background"),
    ("skirmish", "menu/SkirmishMenu"),
    ("navigation", "menu/SkirmishNavigation"),
]

#: Only the parts of `menu/Background` that belong to this screen. The page
#: also carries the main-menu buttons, the Bink player and the disconnect
#: dialogue; none of them is on the Instant Battle screen.
BACKGROUND_RECTS = [[0.0, 0.0, 800.0, 600.0], [0.0, 85.0, 800.0, 450.0]]

#: `game.setTeamSkin <team> <soldier>` -> the nation whose flag that side
#: flies. The flag sprites are `menu/Texture/icon_flag_<nation>.dds`, and the
#: nation set is the one `features/authentic-spawn-map/README.md` section 2
#: lists for them.
SKIN_NATION: dict[str, str] = {
    "germansoldier": "ger",
    "germandesertsoldier": "ger",
    "germanelitesoldier": "ger",
    "japanesesoldier": "jp",
    "ussoldier": "us",
    "usmarinesoldier": "us",
    "usmarine": "us",
    "britishsoldier": "brit",
    "britishdesertsoldier": "brit",
    "canadiansoldier": "can",
    "russiansoldier": "rus",
}

#: BF1942 numbers team 1 Axis and team 2 Allied everywhere: `ObjectTemplate.team 1`
#: is the Axis flag on every vanilla level, and `Campaign/Team` on this very
#: screen sets 1 under the AXIS row and 2 under ALLIED.
AXIS, ALLIED = 1, 2

TEAM_SKIN_RE = re.compile(r"(?im)^\s*game\.setTeamSkin\s+([12])\s+([A-Za-z0-9_]+)")

#: The nation flags, which every level needs two of.
FLAG_TEXTURES = [f"icon_flag_{n}" for n in ("us", "ger", "brit", "can", "jp", "rus")]

#: NOT IN THE DATA. The reference capture shows the two sides' flags in the
#: top corners of the level preview, the Allied nation's left and the Axis
#: nation's right. No menu page places them - searching every MemeFile in
#: `menu.rfa` for a picture whose name contains "flag" finds only
#: `menu/InGame`'s four control-point markers - and `icon_flag` is not in
#: BF1942.exe's string table either, so they are drawn by code this was not
#: traced to. The art and the nations are the game's own; only the rectangle
#: below is ours, and it is marked `fromCapture` in the JSON the way
#: `extract_spawn_layout.py` marks the spawn map's.
#:
#: Sized and placed against the description of the capture: "about 90 px wide
#: on a 600 px wide plate", i.e. 90/600 of the preview plate's 256 virtual
#: units, in the top corners of the thumbnail slot.
FLAG_SIZE = round(256 * 90 / 600, 1)


def list_rows(layout: dict, out: Path) -> dict | None:
    """Where the level list's rows go inside the list box.

    `BfNewListBoxNode` has no rect of its own: it fills the 178x185
    transform it shares with the scroll arrows and the scroll track. Rows
    drawn from the top of that transform start four units above the LEVELS
    heading's baseline and run past the plate, which is not what the game
    shows - the rows sit in the recessed well the plate art has for them.

    The well is not in the layout (the same way the spawn map's rect is not,
    MEME-8), but it *is* in the shipped art, so it is read off the plate
    rather than typed in: the run of dark, opaque rows down the middle of
    `menu_singlepl_levellist_256x256`. That gives 11 rows of the file's own
    14-unit pitch, which is what the reference capture shows.
    """
    page = layout["pages"]["skirmish"]["elements"]
    box = next((el for el in page if el["kind"] == "listbox"), None)
    if box is None:
        return None
    bx, by, bw, bh = box["rect"]
    plate = None
    for el in page:
        if el["kind"] != "picture" or el.get("var"):
            continue
        px, py, pw, ph = el["rect"]
        if px <= bx and py <= by and px + pw >= bx + bw and py + ph >= by + bh:
            plate = el
    if plate is None:
        return None
    entry = layout["textures"].get(plate["texture"])
    if entry is None:
        return None
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - Pillow is a hard dep elsewhere
        return None
    with Image.open(out / "textures" / f"{plate['texture']}.png") as img:
        pixels = img.convert("RGBA").load()
        width, height = img.size
    column = width // 4
    dark = [y for y in range(height)
            if (lambda p: p[3] > 8 and max(p[:3]) < 80)(pixels[column, y])]
    if not dark:
        return None
    # The plate is drawn stretched from its own pixels to the element's rect.
    px, py, pw, ph = plate["rect"]
    top = py + dark[0] * ph / height
    bottom = py + (dark[-1] + 1) * ph / height
    count = int((bottom - top) // box["rowHeight"])
    return {"fromPlateArt": plate["texture"],
            "top": round(top, 2), "bottom": round(bottom, 2), "count": count}


def flag_slots(layout: dict) -> dict | None:
    """Where the two nation flags go, from the preview slot's own rect."""
    for el in layout["pages"]["skirmish"]["elements"]:
        if el.get("var") == "Skirmish/SkirmishMap":
            x, y, w, _ = el["rect"]
            return {
                "fromCapture": True,
                "note": "no menu page places these; see FLAG_SIZE in "
                        "extract_menu_layout.py",
                "size": FLAG_SIZE,
                "allied": [x, y, FLAG_SIZE, FLAG_SIZE],
                "axis": [round(x + w - FLAG_SIZE, 1), y, FLAG_SIZE, FLAG_SIZE],
            }
    return None


# ---------------------------------------------------------------- flattening

def data_name(obj) -> str | None:
    """The symbol a data object is registered under, if any."""
    return obj.name or None if isinstance(obj, meme.Obj) else None


def action_sets(action) -> list[dict]:
    """Every `SetVariableAction` an action performs, unwrapping the
    `ActionListAction` and `SplitAction` wrappers around it.

    The team rows and the difficulty rows are pointer regions whose action
    is what selects the row - `Campaign/Team = 2` under ALLIED. The base
    `Flattener` only looks at a bare `SetVariableAction`, which is what the
    kit rows in `menu/InGame` use; these rows wrap theirs in a list.
    """
    out: list[dict] = []
    stack = [action]
    while stack:
        node = stack.pop(0)
        if not isinstance(node, meme.Obj):
            continue
        if node.cls in ("SetVariableAction", "SetStringAction"):
            var = data_name(node["Variable"])
            if var:
                out.append({"var": var, "value": data_value(node["Value"])})
        elif node.cls == "ActionListAction":
            stack = list(node.get("Actions") or []) + stack
        elif node.cls == "SplitAction":
            stack = [node["Action 1"], node["Action 2"]] + stack
    return out


def action_calls(action) -> list[str]:
    """The names of the `Function` objects an action calls."""
    out: list[str] = []
    stack = [action]
    while stack:
        node = stack.pop(0)
        if not isinstance(node, meme.Obj):
            continue
        if node.cls == "CallFunctionAction":
            name = data_name(node["Function"])
            if name:
                out.append(name)
        elif node.cls == "ActionListAction":
            stack = list(node.get("Actions") or []) + stack
        elif node.cls == "SplitAction":
            stack = [node["Action 1"], node["Action 2"]] + stack
    return out


def settled_values(root: meme.Obj) -> dict[str, float]:
    """Where the page's tweened variables come to rest.

    The front-end pages fade and slide their panels in with
    `BfAddSubEffectNode` / `BfAddSubNextEffectNode`, each of which ramps one
    variable from its current value to an "End value" it names. A variable
    driven by two of them (a fade-in to 1 and a fade-out to 0) has two
    targets; the screen this site draws is the arrived-at one, so the
    settled value is the larger. Taken from the file rather than assumed:
    without it the START button's `Navigation/Level3/Fade/AlphaFade12`
    reads as its pre-transition 0 and the button paints invisible.
    """
    out: dict[str, float] = {}
    for node in meme.walk_all(root):
        if node.cls not in ("BfAddSubEffectNode", "BfAddSubNextEffectNode"):
            continue
        name = data_name(node.get("Value"))
        end = data_value(node.get("End value"))
        if name and isinstance(end, (int, float)):
            out[name] = max(float(end), out.get(name, float("-inf")))
    return out


class MenuFlattener(Flattener):
    """`Flattener` plus the four classes the front-end pages use and the
    spawn screen does not.

    `TranslateNode` is sibling-scoped the way `CullNode` and `EffectNode`
    are: it shifts the origin of everything after it in the same list. Its
    X and Y are data objects, so a page can animate a panel in by writing
    them; at rest they hold the value the file ships, which is what is used
    here.
    """

    def __init__(self, lexicon, settled=None):
        super().__init__(lexicon)
        self.settled = settled or {}
        #: variable -> the channel it drives, for the doc and for a viewer
        #: that wants to animate the screen in later.
        self.color_bindings: dict[str, str] = {}

    def effect_color(self, effect):
        """`VariableColorEffect` and `BfMultiplyColorEffect2` bind their
        channels to data objects. A channel bound to a *named* variable is
        resolved through `settled_values`; an anonymous one is the literal
        the file holds, which is what the base already does."""
        if isinstance(effect, meme.Obj) and effect.cls == "BfMultiplyColorEffect2":
            return [1.0, 1.0, 1.0, self.channel(effect["Alpha"])]
        if isinstance(effect, meme.Obj) and effect.cls == "VariableColorEffect":
            return [self.channel(effect[c]) for c in ("Red", "Green", "Blue", "Alpha")]
        return super().effect_color(effect)

    def channel(self, obj) -> float:
        name = data_name(obj)
        value = data_value(obj)
        if name is not None:
            self.color_bindings[name] = "color"
            if name in self.settled:
                return self.settled[name]
        return float(value) if isinstance(value, (int, float)) else 1.0

    def extend(self, node, siblings, ox, oy, rect, color, when):
        cls = node.cls
        if cls == "TranslateNode":
            dx = data_value(node["X"]) or 0.0
            dy = data_value(node["Y"]) or 0.0
            return ox + dx, oy + dy, color, when
        if cls == "BfNewListBoxNode":
            self.emit_list_box(node, rect, color, when)
            return ox, oy, color, when
        if cls == "BfNavigationButtonNode":
            self.emit_nav_button(node, ox, oy, color, when)
            return ox, oy, color, when
        return super().extend(node, siblings, ox, oy, rect, color, when)

    def emit_list_box(self, node, rect, color, when) -> None:
        """The level list. Everything but its rows is in the file: the rows
        are `BfListBoxData`, which the engine fills at runtime."""
        el = self.leaf(
            "listbox", rect, color, when,
            data=data_name(node["Listbox data"]) or "",
            font=font_id(node["Font"]),
            rowHeight=node["Row height"],
            selectable=bool(node["IsSelectable"]),
            border=bool(node["Border or not"]),
            scrollbarWidth=node["Scrollbar width"],
            scrollbarOffset=node["Scrollbar offset from border"],
            showTooltip=bool(node["Show tooltip"]),
            background=[node[f"Background color {c}"] for c in
                        ("red", "green", "blue", "alpha")],
            frame=[node[f"Frame color {c}"] for c in ("red", "green", "blue", "alpha")],
            select=[node[f"Select color {c}"] for c in ("red", "green", "blue", "alpha")],
            onSelect=action_calls(node["Select action"]),
            onFocus=action_calls(node["Focus action"]),
        )
        el.pop("color", None) if el.get("color") == [1.0, 1.0, 1.0, 1.0] else None

    def emit_nav_button(self, node, ox, oy, color, when) -> None:
        """`BfNavigationButtonNode` is the three-state footer button. Its
        Width and Height are the pointer region and, as with `BfButtonNode`
        (MEME-7), the plate draws at texture size inside it."""
        rect = [ox, oy, node["Width"], node["Height"]]
        self.leaf("button", rect, color, when,
                  texture=texture_key(node["Picture"]),
                  hover=texture_key(node["Mouse over picture"]),
                  pressed=texture_key(node["Clicked picture"]),
                  calls=action_calls(node["Action"]),
                  sets=action_sets(node["Action"]))

    def emit_hit(self, node, siblings, rect, when) -> None:
        """The base records a `Kit/MouseOver/*` flag and a label key. These
        pages need what the region *does* as well, because that is how a
        team row selects its team."""
        action = node.get("Action")
        sets = action_sets(action)
        calls = action_calls(action)
        label = None
        for sib in siblings:
            for n in sib.walk():
                if n.cls == "TextNode":
                    src = n["String"]
                    if isinstance(src, meme.Obj) and src.cls == "BfLocaleStringData":
                        label = data_value(src["String Id"])
        if not sets and not calls and not label:
            return
        key = [round(v, 2) for v in rect]
        for el in self.elements:
            if el["kind"] == "hit" and el["rect"] == key:
                return  # one region per rect: enter / leave / click repeat it
        el = self.leaf("hit", rect, [1.0, 1.0, 1.0, 1.0], when)
        if sets:
            el["sets"] = sets
        if calls:
            el["calls"] = calls
        if label:
            el["label"] = label


# ------------------------------------------------------------------ decoding

def decode_page(data: bytes, lexicon: dict[str, str],
                keep: list[list[float]] | None = None) -> dict:
    """One page as a flat draw list. `keep` limits the walk to the top-level
    `TransformNode`s with those rects, for a page that holds more than this
    screen."""
    root, reader = meme.load(data)
    flat = MenuFlattener(lexicon, settled_values(root))
    tops = []
    for top in root.chain():
        if top.cls != "TransformNode":
            continue
        rect = [top["X"], top["Y"], top["Width"], top["Height"]]
        if keep is not None and rect not in keep:
            continue
        tops.append(top)
    flat.run(tops)
    return {
        "elements": flat.elements,
        "variables": flat.variables,
        "strings": flat.strings,
        "settled": flat.settled,
        "warnings": reader.warnings,
    }


def decode_layout(menu_rfa: Path, lexicon: dict[str, str]) -> dict:
    pages: dict[str, dict] = {}
    variables: dict[str, object] = {}
    strings: dict[str, str] = {}
    fonts: set[str] = set()
    with RfaArchive(menu_rfa) as arch:
        index = {e.lower(): e for e in arch.entries}
        for key, entry in PAGES:
            real = index.get(entry.lower())
            if real is None:
                sys.exit(f"{menu_rfa.name} has no {entry}")
            page = decode_page(arch.read(real), lexicon,
                               BACKGROUND_RECTS if key == "background" else None)
            for warning in page["warnings"]:
                # `menu/Background` also carries the main menu's Bink player
                # (`BfBinkNode`, no schema, MEME-11's remainder). It is
                # outside BACKGROUND_RECTS, so it costs this screen nothing.
                print(f"warning: {entry}: {warning}", file=sys.stderr)
            pages[key] = {"source": entry, "elements": page["elements"]}
            variables.update(page["variables"])
            variables.update(page["settled"])
            strings.update(page["strings"])
            fonts.update(el["font"] for el in page["elements"]
                         if el.get("font") and el["kind"] in ("text", "listbox"))
    return {
        "virtual": list(VIRTUAL),
        "source": f"{', '.join(e for _, e in PAGES)} (MemeFile 2.0) in "
                  f"Mods/bf1942/Archives/{menu_rfa.name}",
        "fonts": sorted(fonts),
        "strings": dict(sorted(strings.items())),
        "variables": dict(sorted(variables.items())),
        "pages": pages,
    }


# ------------------------------------------------------------------ textures

def layout_textures(layout: dict) -> set[str]:
    """Every plate in `menu.rfa` the layout names.

    An element with a `var` is a slot the engine fills at runtime, not a
    fixed plate: the level preview is a `VariablePictureNode` on
    `Skirmish/SkirmishMap`, whose shipped default happens to be Wake's
    `../Bf1942/Levels/Wake/Menu/thumbnail.tga`. That name is a level
    thumbnail, which `menu-levels.json` carries one of per level, and there
    is no `thumbnail` in `menu.rfa` to find.
    """
    names: set[str] = set()
    for page in layout["pages"].values():
        for el in page["elements"]:
            if el.get("var"):
                continue
            for field in ("texture", "hover", "pressed"):
                if el.get(field):
                    names.add(el[field])
    return names


def extract_textures(menu_rfa: Path, names: set[str], out_dir: Path,
                     force: bool) -> dict:
    """Decode every plate the layout names, by basename, out of `menu.rfa`.

    The layout spells `Menu/knapp3_N.tga`; the archive holds
    `menu/Texture/Menu/knapp3_n.dds`. Neither the case nor the extension in
    the data can be trusted, so both are resolved against the entry table
    (the same rule `extract_hud_pack.py` follows).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {}
    missing: list[str] = []
    with RfaArchive(menu_rfa) as arch:
        by_stem: dict[str, list[str]] = {}
        for entry in arch.entries:
            leaf = entry.rsplit("/", 1)[-1]
            if "." not in leaf:
                continue
            by_stem.setdefault(leaf.rsplit(".", 1)[0].lower(), []).append(entry)
        for name in sorted(names):
            candidates = by_stem.get(name, [])
            entry = next((c for c in candidates if c.lower().endswith(".dds")),
                         next(iter(candidates), None))
            if entry is None:
                missing.append(name)
                continue
            raw = arch.read(entry)
            if entry.lower().endswith(".dds"):
                width, height, rgba = decode_dds(raw)
            else:
                width, height, rgba = decode_tga(raw)
            dest = out_dir / f"{name}.png"
            if force or not dest.exists():
                dest.write_bytes(encode_png(width, height, rgba, drop_alpha=False))
            manifest[name] = {"file": f"textures/{name}.png",
                              "size": [width, height], "source": entry}
    if missing:
        print(f"warning: {len(missing)} textures not in {menu_rfa.name}: "
              f"{', '.join(missing)}", file=sys.stderr)
    return manifest


# -------------------------------------------------------------------- levels

def level_archives(archives: Path) -> dict[str, list[Path]]:
    """Level directory name (as the archive spells it) -> its archives,
    base first then the numbered patches, which override later-wins."""
    levels_dir = archives / "bf1942" / "levels"
    if not levels_dir.is_dir():
        levels_dir = next((c for c in archives.iterdir()
                           if c.is_dir() and c.name.lower() == "bf1942"), archives)
        levels_dir = next((c for c in levels_dir.iterdir()
                           if c.is_dir() and c.name.lower() == "levels"), levels_dir)
    out: dict[str, list[Path]] = {}
    for path in sorted(levels_dir.glob("*.rfa")):
        stem = path.stem
        base = re.sub(r"_\d{3}$", "", stem)
        out.setdefault(base.lower(), []).append(path)
    return out


def level_record(name: str, paths: list[Path], thumb_dir: Path | None,
                 force: bool) -> dict | None:
    """One level: its title, both sides' nations and its menu thumbnail.

    `thumb_dir` of None reads the record without decoding or writing the
    thumbnail, which is what a caller that only wants the nations needs.
    """
    skins: dict[int, str] = {}
    level_dir = name
    thumbnail = None
    for path in paths:
        with RfaArchive(path) as arch:
            for entry in arch.entries:
                low = entry.lower()
                if low.endswith("/init.con") and "/menu/" not in low:
                    parts = entry.split("/")
                    if len(parts) >= 3:
                        level_dir = parts[2]
                    for team, skin in TEAM_SKIN_RE.findall(
                            arch.read(entry).decode("latin-1", "replace")):
                        skins[int(team)] = skin
                elif low.endswith(("menu/thumbnail.dds", "menu/thumbnail.tga")):
                    thumbnail = (path, entry)
    if not skins and thumbnail is None:
        return None
    record: dict = {
        "dir": name,
        "level": level_dir,
        "title": format_map_title(level_dir),
    }
    for team, key in ((AXIS, "axis"), (ALLIED, "allied")):
        skin = skins.get(team)
        if skin:
            nation = SKIN_NATION.get(skin.lower())
            record[key] = {"skin": skin, "nation": nation,
                           "flag": f"icon_flag_{nation}" if nation else None}
            if nation is None:
                print(f"warning: {name}: no nation for team skin {skin!r}",
                      file=sys.stderr)
    if thumbnail is not None and thumb_dir is not None:
        path, entry = thumbnail
        dest = thumb_dir / f"{name}.png"
        if force or not dest.exists():
            thumb_dir.mkdir(parents=True, exist_ok=True)
            with RfaArchive(path) as arch:
                raw = arch.read(entry)
            if entry.lower().endswith(".dds"):
                width, height, rgba = decode_dds(raw)
            else:
                width, height, rgba = decode_tga(raw)
            dest.write_bytes(encode_png(width, height, rgba, drop_alpha=False))
        record["thumbnail"] = f"thumbnails/{name}.png"
    return record


def extract_levels(archives: Path, out_dir: Path, force: bool) -> dict:
    levels = []
    for name, paths in sorted(level_archives(archives).items()):
        record = level_record(name, paths, out_dir / "thumbnails", force)
        if record is not None:
            levels.append(record)
    return {
        "source": "bf1942/levels/*.rfa: game.setTeamSkin from each level's "
                  "Init.con, Menu/thumbnail.[dds|tga], title by "
                  "extract_loading_assets.format_map_title",
        "teams": {"axis": AXIS, "allied": ALLIED},
        "levels": levels,
    }


# ---------------------------------------------------------------------- main

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out", type=Path, default=VIEWER_MENU_DIR)
    parser.add_argument("--force", action="store_true",
                        help="re-encode textures, thumbnails and font atlases")
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
    layout["previewFlags"] = flag_slots(layout)
    layout["textures"] = extract_textures(
        menu_rfa, layout_textures(layout) | set(FLAG_TEXTURES),
        out / "textures", args.force)
    layout["fontFiles"] = extract_fonts(font_rfa, font_handles(layout),
                                        out / "fonts", args.force)
    layout["listRows"] = list_rows(layout, out)
    (out / "menu-layout.json").write_text(json.dumps(layout, indent=1) + "\n")

    levels = extract_levels(archives, out, args.force)
    (out / "menu-levels.json").write_text(json.dumps(levels, indent=1) + "\n")

    elements = sum(len(p["elements"]) for p in layout["pages"].values())
    print(f"{elements} elements over {len(layout['pages'])} pages, "
          f"{len(layout['textures'])} textures, {len(layout['fontFiles'])} fonts, "
          f"{len(levels['levels'])} levels -> {out}")


if __name__ == "__main__":
    main()
