#!/usr/bin/env python3
"""Decode the spawn screen out of `menu/InGame` for the map viewer.

Two artifacts next to the sprite pack `extract_hud_pack.py` writes:

  viewer/maps/_shared/hud/spawn-layout.json
      The spawn interface and the ticket counter as flat draw lists in the
      engine's 800x600 virtual space, read from the serialized
      `dice::meme::*` node graph in `Mods/bf1942/Archives/menu.rfa`
      (`bf42/meme.py` documents the stream). Every leaf carries its rect,
      texture or fill colour, font and alignment, resolved display string,
      colour multiplier and the `when` conditions (the `CullNode`s above
      it) that decide whether the game draws it — so the AXIS/ALLIED tab,
      the selected row, the mouse-over tint and the SUICIDE/CLOSE and
      RESUME/DONE swaps are all the game's own branches, evaluated by the
      viewer against its state. Locale keys are resolved through
      `Mods/bf1942/lexiconAll.dat` (English column).

  viewer/maps/_shared/hud/fonts/<face>.png + <face>.json
      The bitmap fonts those text nodes name, out of `Font.rfa`: the atlas
      as white RGBA with the coverage as alpha, and the glyph table
      (`bf42/font.py`).

The map pane itself is not in the data: the engine hot-swaps the level's
`InGameMap` into an empty `ClipNode` under `ShowMap`, and its rectangle is
code. The one recorded here is measured from a 1280x720 capture of the real
screen (kit column, footer and ticket bar all land where the data says, so
the map's edges are read off the same frame) and marked as such.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.font import decode_alpha_tga, font_json, parse_dif  # noqa: E402
from bf42.rfa import RfaArchive, find_archives_dir  # noqa: E402

sys.path.insert(0, str(Path.home() / ".claude/skills/bf1942-map-images/scripts"))
from extract_map_images import encode_png  # noqa: E402

VIEWER_HUD_DIR = Path(__file__).resolve().parent / "viewer" / "maps" / "_shared" / "hud"

VIRTUAL = (800, 600)

# Measured, not decoded — see the module docstring. 440..1260 x 40..655 on a
# 1280x720 frame, with the frame's 8 px left crop taken out.
MAP_RECT = [280, 33, 512, 512]


# --------------------------------------------------------------------- lexicon

def load_lexicon(path: Path, keep: str = "last") -> dict[str, str]:
    """`lexiconAll.dat`: u32 record count, u32 columns, then per record the
    key and one UTF-16LE NUL-terminated string per language. English is the
    first language column.

    The file is not a map: 31 of the vanilla file's 1,693 keys occur twice
    and seven of those pairs hold different strings, so which occurrence
    wins is a choice. `keep="last"` is the reader's long-standing one and
    stays the default; `keep="first"` is for callers that want the earlier
    record. None of the seven differing pairs is a key any spawn-screen
    element names, so `menu/InGame` reads the same either way - the level
    titles in `extract_menu_layout.py` are the caller that cares
    (`Omaha_Beach` is "OMAHA BEACH" at record 976, inside the level-title
    block 958..979, and "Omaha Beach" at record 1332, inside a block of
    control-point labels)."""
    data = path.read_bytes()
    count, cols = struct.unpack_from("<II", data, 0)
    pos = 8
    out: dict[str, str] = {}

    def read() -> str:
        nonlocal pos
        end = pos
        while data[end:end + 2] != b"\0\0":
            end += 2
        s = data[pos:end].decode("utf-16-le")
        pos = end + 2
        return s

    for _ in range(count):
        key = read()
        values = [read() for _ in range(cols - 1)]
        if keep == "first" and key in out:
            continue
        out[key] = values[0]
    return out


# ---------------------------------------------------------------- flattening

def texture_key(path: str) -> str:
    """`kits/Icon_scout_axis_selected.tga` -> `icon_scout_axis_selected`, the
    sprite pack's file stem."""
    leaf = path.replace("\\", "/").rsplit("/", 1)[-1]
    return leaf.rsplit(".", 1)[0].lower()


def font_id(handle: str) -> str:
    """`Trebuchet MS14 - Latin.dif` -> `trebuchet_ms14_latin`."""
    stem = handle.rsplit(".", 1)[0].lower()
    return re.sub(r"[^a-z0-9]+", "_", stem).strip("_")


def data_value(obj):
    """The literal a data object holds, following variable defaults."""
    if isinstance(obj, meme.Obj):
        if "Value" in obj.fields:
            return obj["Value"]
        if "String" in obj.fields:
            return obj["String"]
    return None


def condition(obj) -> dict | None:
    """A `CullNode` variable as `{var, op, value}`; value is a literal or
    `{"var": name}` when the game compares two variables."""
    if not isinstance(obj, meme.Obj):
        return None
    if obj.cls == "BoolData":
        if not obj.name:
            # A literal: `CullNode Variable=BoolData{False}` is how the
            # data switches a branch off for good.
            return {"const": bool(obj["Value"])}
        return {"var": obj.name, "op": "eq", "value": True}
    if obj.cls == "NotData":
        inner = condition(obj["Data"])
        if inner and "const" in inner:
            return {"const": not inner["const"]}
        if inner and inner.get("op") == "eq":
            return {**inner, "op": "ne"}
        return inner
    if obj.cls in ("AndData", "OrData"):
        terms = [condition(obj["Data 1"]), condition(obj["Data 2"])]
        return {"op": "and" if obj.cls == "AndData" else "or", "terms": [t for t in terms if t]}
    ops = {"EqualData": "eq", "NotEqualData": "ne", "LessData": "lt", "LessEqualData": "le"}
    if obj.cls in ops:
        a, b = obj["Data 1"], obj["Data 2"]
        value = {"var": b.name} if isinstance(b, meme.Obj) and b.name else data_value(b)
        return {"var": a.name, "op": ops[obj.cls], "value": value}
    return None


def effect_color(obj) -> list[float] | None:
    if not isinstance(obj, meme.Obj):
        return None
    if obj.cls == "ColorEffect":
        return [obj["Red"], obj["Green"], obj["Blue"], obj["Alpha"]]
    if obj.cls == "VariableColorEffect":
        return [data_value(obj[k]) for k in ("Red", "Green", "Blue", "Alpha")]
    return None


def mul_color(a: list[float], b: list[float]) -> list[float]:
    return [round(x * y, 4) for x, y in zip(a, b)]


def align_of(style) -> str:
    cls = style.cls if isinstance(style, meme.Obj) else ""
    if "Center" in cls:
        return "center"
    if "Right" in cls:
        return "right"
    return "left"


class Flattener:
    """Walks a node list the way the renderer does: a `CullNode` gates the
    siblings after it, an `EffectNode` colours them, a `SplitNode` is a
    branch, a `TransformNode` moves the origin and sets the rect its leaves
    fill."""

    def __init__(self, lexicon: dict[str, str]):
        self.lexicon = lexicon
        self.elements: list[dict] = []
        self.variables: dict[str, object] = {}
        self.strings: dict[str, str] = {}

    def effect_color(self, effect):
        """The multiplier an `EffectNode`'s effect applies. A method so a
        subclass can resolve effects whose channels are bound to variables;
        the base is the module function, unchanged."""
        return effect_color(effect)

    def note_variables(self, obj) -> None:
        if isinstance(obj, meme.Obj):
            if obj.name and obj.cls in ("BoolData", "IntData", "FloatData", "StringData"):
                self.variables.setdefault(obj.name, data_value(obj))
            for v in obj.fields.values():
                self.note_variables(v)

    def run(self, nodes: list[meme.Obj], ox=0.0, oy=0.0, rect=None, color=None, when=None):
        color = color or [1.0, 1.0, 1.0, 1.0]
        when = list(when or [])
        rect = rect or [0, 0, *VIRTUAL]
        for node in nodes:
            self.note_variables(node)
            cls = node.cls
            if cls == "CullNode":
                cond = condition(node["Variable"])
                if cond:
                    when.append(cond)
            elif cls == "EffectNode":
                c = self.effect_color(node["Effect"])
                if c:
                    color = mul_color(color, c)
            elif cls == "TransformNode":
                x, y, w, h = ox + node["X"], oy + node["Y"], node["Width"], node["Height"]
                self.run(node.children(), x, y, [x, y, w, h], color, when)
            elif cls == "SplitNode":
                self.run(node.children(), ox, oy, rect, color, when)
            elif cls in ("PictureNode", "VariablePictureNode"):
                self.emit_picture(node, rect, color, when)
            elif cls == "TextNode":
                self.emit_text(node, rect, color, when)
            elif cls == "BfButtonNode":
                self.emit_button(node, nodes, ox, oy, color, when)
            elif cls in ("CullEventActionNode", "CullVariableAndEventActionNode"):
                self.emit_hit(node, nodes, rect, when)
            else:
                ox, oy, color, when = self.extend(node, nodes, ox, oy, rect, color, when)

    def extend(self, node, siblings, ox, oy, rect, color, when):
        """Every class the cases above do not name. The base walks into the
        node's own children, which is what `menu/InGame` needs and all it
        ever needed.

        A subclass overrides this to add classes without restating the
        dispatch. Like `CullNode` and `EffectNode`, a class here may be
        sibling-scoped rather than a leaf (`TranslateNode` shifts the origin
        for everything after it in the same list), so the hook returns the
        state the loop carries forward.
        """
        self.run(node.children(), ox, oy, rect, color, when)
        return ox, oy, color, when

    def leaf(self, kind, rect, color, when, **extra) -> dict:
        el = {"kind": kind, "rect": [round(v, 2) for v in rect]}
        if any(c.get("const") is False for c in when):
            return el  # switched off in the data; nothing ever draws it
        when = [c for c in when if "const" not in c]
        if color != [1.0, 1.0, 1.0, 1.0]:
            el["color"] = color
        if when:
            el["when"] = when
        el.update(extra)
        self.elements.append(el)
        return el

    def emit_picture(self, node, rect, color, when) -> None:
        if node.cls == "VariablePictureNode":
            src = node["First part"]
            name = data_value(src) or ""
            var = src.name if isinstance(src, meme.Obj) else None
        else:
            name, var = node["Picture"], None
        if not name:
            # An empty picture is a solid quad in the current colour: this
            # is how the olive header strip and the selected-row fill are
            # drawn.
            self.leaf("fill", rect, color, when)
            return
        el = self.leaf("picture", rect, color, when, texture=texture_key(name))
        if var:
            el["var"] = var

    def emit_text(self, node, rect, color, when) -> None:
        src, style = node["String"], node["Style"]
        font = font_id(style["Font handle"]) if isinstance(style, meme.Obj) else "standard6"
        extra: dict = {"font": font, "align": align_of(style)}
        if isinstance(src, meme.Obj) and src.cls == "BfLocaleStringData":
            key = data_value(src["String Id"])
            extra["key"] = key
            extra["text"] = self.lexicon.get(key, key)
            self.strings[key] = extra["text"]
        elif isinstance(src, meme.Obj):
            extra["text"] = str(data_value(src))
            if src.name:
                extra["var"] = src.name
        self.leaf("text", rect, color, when, **extra)

    def emit_button(self, node, siblings, ox, oy, color, when) -> None:
        rect = [ox, oy, node["Width"], node["Height"]]
        # The button's label is the text node that follows it in the same
        # list; its locale key names the button.
        key = None
        for sib in siblings[siblings.index(node) + 1:]:
            for n in sib.walk():
                if n.cls == "TextNode":
                    src = n["String"]
                    if isinstance(src, meme.Obj) and src.cls == "BfLocaleStringData":
                        key = data_value(src["String Id"])
                        break
            if key:
                break
        self.leaf("button", rect, color, when,
                  texture=texture_key(node["Picture"]),
                  hover=texture_key(node["Mouse over picture"]),
                  id=key)

    def emit_hit(self, node, siblings, rect, when) -> None:
        """A pointer region: the kit rows toggle a `Kit/MouseOver/*` flag,
        the tabs and buttons run actions we cannot read (their
        ActionListAction bodies are opaque), so those carry the label key
        of the text beside them instead."""
        action = node.get("Action")
        hover = None
        if isinstance(action, meme.Obj) and action.cls == "SetVariableAction":
            var = action["Variable"]
            if isinstance(var, meme.Obj) and var.name.startswith("Kit/MouseOver/"):
                hover = var.name
        label = None
        for sib in siblings:
            for n in sib.walk():
                if n.cls == "TextNode":
                    src = n["String"]
                    if isinstance(src, meme.Obj) and src.cls == "BfLocaleStringData":
                        label = data_value(src["String Id"])
        if not hover and not label:
            return
        # One region per rect: the rows repeat the node three times for
        # enter / leave / click.
        for el in self.elements:
            if el["kind"] == "hit" and el["rect"] == [round(v, 2) for v in rect]:
                if hover and "hover" not in el:
                    el["hover"] = hover
                return
        el = self.leaf("hit", rect, [1.0, 1.0, 1.0, 1.0], when)
        if hover:
            el["hover"] = hover
        if label:
            el["label"] = label


def find_group(root: meme.Obj, var: str) -> meme.Obj | None:
    """The top-level TransformNode whose first child culls on `var`."""
    for top in root.chain():
        kids = top.children()
        if kids and kids[0].cls == "CullNode":
            v = kids[0]["Variable"]
            if isinstance(v, meme.Obj) and v.name == var:
                return top
    return None


def decode_layout(ingame: bytes, lexicon: dict[str, str]) -> dict:
    root, reader = meme.load(ingame)
    groups = {}
    fonts: set[str] = set()
    variables: dict[str, object] = {}
    strings: dict[str, str] = {}
    for key, var in (("spawn", "Kit/ShowKit"), ("tickets", "ShowTicket")):
        top = find_group(root, var)
        if top is None:
            raise SystemExit(f"menu/InGame has no {var} group")
        flat = Flattener(lexicon)
        flat.run([top])
        groups[key] = {
            "rect": [top["X"], top["Y"], top["Width"], top["Height"]],
            "elements": flat.elements,
        }
        fonts.update(el["font"] for el in flat.elements if el["kind"] == "text")
        variables.update(flat.variables)
        strings.update(flat.strings)
    return {
        "virtual": list(VIRTUAL),
        "source": "menu/InGame (MemeFile 2.0) in Mods/bf1942/Archives/menu.rfa",
        "map": {"rect": MAP_RECT, "measured": True},
        "fonts": sorted(fonts),
        "strings": dict(sorted(strings.items())),
        "variables": dict(sorted(variables.items())),
        "groups": groups,
    }


# -------------------------------------------------------------------- fonts

def font_handles(layout: dict) -> dict[str, str]:
    """font id -> `Font/<face>.dif` entry, from the ids the layout uses."""
    faces = {"standard6": "standard6", "trebuchet_ms8": "Trebuchet MS8",
             "trebuchet_ms11": "Trebuchet MS11", "trebuchet_ms14": "Trebuchet MS14",
             "trebuchet_ms18": "Trebuchet MS18"}
    out = {}
    for fid in layout["fonts"]:
        base = fid.removesuffix("_latin")
        face = faces.get(base)
        if face is None:
            print(f"warning: no face for font id {fid}", file=sys.stderr)
            continue
        out[fid] = f"Font/{face}{' - Latin' if fid.endswith('_latin') else ''}.dif"
    return out


def extract_fonts(font_rfa: Path, handles: dict[str, str], out_dir: Path, force: bool) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with RfaArchive(font_rfa) as arch:
        index = {e.lower(): e for e in arch.entries}
        for fid, dif_name in handles.items():
            dif = index.get(dif_name.lower())
            tga = index.get(dif_name.lower().replace(".dif", ".tga"))
            if not dif or not tga:
                print(f"warning: {dif_name} not in {font_rfa.name}", file=sys.stderr)
                continue
            font = parse_dif(arch.read(dif).decode("latin-1"))
            png = out_dir / f"{fid}.png"
            if force or not png.exists():
                w, h, rgba = decode_alpha_tga(arch.read(tga))
                png.write_bytes(encode_png(w, h, rgba, drop_alpha=False))
            (out_dir / f"{fid}.json").write_text(font_json(font))
            manifest[fid] = {"file": f"fonts/{fid}.png", "glyphs": f"fonts/{fid}.json",
                             "source": dif, "lineHeight": font.line_height}
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--out", type=Path, default=VIEWER_HUD_DIR)
    parser.add_argument("--force", action="store_true", help="re-encode font atlases")
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
    lexicon_path = next((c for c in mod.iterdir() if c.name.lower() == "lexiconall.dat"), None)
    lexicon = load_lexicon(lexicon_path) if lexicon_path else {}
    if not lexicon:
        print("warning: lexiconAll.dat not found, locale keys stay unresolved", file=sys.stderr)

    with RfaArchive(menu_rfa) as arch:
        ingame = arch.read(next(e for e in arch.entries if e.lower() == "menu/ingame"))
    layout = decode_layout(ingame, lexicon)
    layout["fontFiles"] = extract_fonts(font_rfa, font_handles(layout), args.out / "fonts", args.force)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "spawn-layout.json").write_text(json.dumps(layout, indent=1) + "\n")
    n = sum(len(g["elements"]) for g in layout["groups"].values())
    print(f"{n} elements, {len(layout['fontFiles'])} fonts -> {args.out}")


if __name__ == "__main__":
    main()
