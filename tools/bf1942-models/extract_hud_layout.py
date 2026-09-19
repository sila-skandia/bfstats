#!/usr/bin/env python3
"""Decode the in-game HUD out of `menu/InGame` for the map viewer.

Writes `viewer/maps/_shared/hud/hud-layout.json`, next to the sprite pack
`extract_hud_pack.py` writes and the spawn screen `extract_spawn_layout.py`
writes: the soldier and vehicle HUD as flat draw lists in the engine's
800x600 virtual space, read from the same serialized `dice::meme::*` node
graph in `Mods/bf1942/Archives/menu.rfa` that the spawn screen comes from
(`bf42/meme.py` documents the stream; `extract_spawn_layout.py`'s
`Flattener` is the model this one follows).

`menu/InGame`'s root is one flat sibling list (`root.chain()`, 53 entries in
vanilla) of independent, absolutely-positioned pages and widgets -- the
spawn screen and ticket counter `extract_spawn_layout.py` already reads are
two of them, gated by `Kit/ShowKit` and `ShowTicket`; the ones here are
gated by their own variable, e.g. `Soldier/ShowSoldierIcon`,
`Vehicle/ShowVehicleIcon`, `HitFromDir/HitFromDir`. Each top-level entry's
own X/Y/Width/Height (or, for a few, its SplitNode's implicit full-screen
rect) is already absolute -- there is no shared ancestor transform to
account for, exactly as for the spawn screen.

Every element carries a `kind`:

  picture           a fixed sprite (`PictureNode`).
  variable-picture  a sprite the game swaps at runtime (`VariablePictureNode`,
                    `BfVariablePictureNode`) -- `texture` is the DEFAULT the
                    data ships, `var` the binding the live game overrides it
                    through (a weapon's `setAmmoIcon`, a vehicle's own
                    `Vehicle/VehicleIcon`, ...).
  fill-picture      a two-state gauge (`BfVariablePictureFillNode[2]`): an
                    empty and a full picture (literal or bound, matching the
                    node), a value/max (almost always bound), a pixel size
                    and the `horizontalAlign`/`fillOrder` flags the data
                    carries -- kept raw; which edge/direction they fill from
                    is not settled here (see Notes).
  fill              a solid-colour quad (`PictureNode` with an empty
                    picture) -- the same convention `extract_spawn_layout.py`
                    uses for the spawn screen's header strip and row fill.
  text              a bound or literal string, with its bitmap font and
                    alignment.
  occupied-seat     one vehicle seat's HUD dot (`BfOccupiedVehicleNode`
                    inside a `BfTransformNode`): `position` (0-based seat
                    index) and the seat's rect, resolved from the data's own
                    default X/Y plus the bindings that move it (`posVar`).
  crosshair         the `BfCrosshairNode` leaf's own bindings.

`when` is the list of `CullNode` conditions gating an element, same shape
`extract_spawn_layout.py`'s `spawn-layout.json` uses: `{"var","op","value"}`
(`value` is a literal or `{"var": name}` for a variable-vs-variable
comparison), `{"op":"and"/"or","terms":[...]}}`, or `{"const": bool}` for a
branch the data disables outright. Two additions this file's conditions
need that the spawn screen's never did (documented in `notes`, not applied
silently): De Morgan's negation of an `and`/`or` (`NotData` wraps an
`OrData` more than once here), and `gt`/`ge` for the two comparisons this
graph writes with the literal first (`5 <= Weapon/NumberOfItems`) -- there
is no `GreaterData`/`GreaterEqualData` class anywhere in the corpus, so the
tool that authored this graph always emits `<`/`<=` and expects the reader
to flip it when the bound variable is the second operand.

Fonts: exactly the fonts `extract_spawn_layout.py` already knows how to
pull out of `Font.rfa` (`font_handles`, `extract_fonts`) -- every text node
found here uses `standard6[.dif]`, `standard6 - Latin.dif` or
`Trebuchet MS11 - Latin.dif`, all already in its `faces` table.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_models import DEFAULT_GAME_DIR, mod_chain  # noqa: E402
from extract_hud_pack import hud_dir_for  # noqa: E402
from bf42 import meme  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from extract_spawn_layout import (  # noqa: E402
    align_of, extract_fonts, font_handles, font_id, load_chain_lexicon,
    load_lexicon, texture_key,
)

VIEWER_HUD_DIR = Path(__file__).resolve().parent / "viewer" / "maps" / "_shared" / "hud"

VIRTUAL = (800, 600)

SOURCE = "menu/InGame (MemeFile 2.0) in Mods/bf1942/Archives/menu.rfa"

NOTES = [
    "IntData is stored as a raw u32 on disk and bf42/meme.py does not "
    "sign-extend it; any field below whose raw value was >= 2**31 has been "
    "reinterpreted here as its negative two's-complement value (e.g. "
    "Ammo/SoldierAmmo/SoldierAmmoPosY's default is stored as 4294967279, "
    "shown here as -17) -- a mechanical bit reinterpretation, not a new "
    "engine fact.",
    "fill-picture's horizontalAlign/fillOrder booleans are recorded as the "
    "data has them; which edge a bar fills from, and what a horizontal vs. "
    "vertical alignment means for a 32x64 (tall) vs 64x32 (wide) bar, is "
    "not established here -- R1/R2 territory.",
    "Recover/ShowRecover is an int selecting between several mutually "
    "exclusive small bars sharing one screen slot: 3 for the soldier slot "
    "(soldierIcon), 4/5/6/7 for the vehicle slot (vehicleHealth). Which "
    "state is which (rocket-pack refill vs. reload vs. heat vs. stamina) "
    "is inferred only from which empty/full texture pair each branch "
    "binds, not confirmed against engine code.",
    "Ammo/AmmoType (soldierAmmo, 1-7), Ammo/PrimaryAmmoBar and "
    "Ammo/SecondaryAmmoBar (primaryAmmo/secondaryAmmo, 0/2-6) are int "
    "selectors choosing which icon+bar combination the ammo panel shows. "
    "BF1942.exe's own strings name enums that look related "
    "(ATAmmoBar, ABAmmoBarHeatBar, ABAmmoBarOnly, ABAmmoBarReloadBar, "
    "ABHeatBarOnly, ...) but no confirmed mapping from these integers to "
    "those names is recorded here.",
    "A bare non-boolean Data used directly as a CullNode condition (only "
    "HitFromDir/HitFromDir, gating all of hitIndicator) is treated here as "
    "\"nonzero\" (op ne, value 0) -- inferred from the same variable being "
    "separately compared to 0 and to 1-8 elsewhere in the same subtree, "
    "not read off the engine's CullNode-variable-getter code.",
    "supplyIcon's ShowFlagIcon and ShowNonTakeableFlagIcon each carry two "
    "elements at different rects (x=640 and x=720, same y) with "
    "complementary Axis/AlliedFlagIcon conditions; which the game actually "
    "shows for a given ownership state is only as encoded in each "
    "element's own `when`, not checked in a live game.",
    "occupied-seat rects use Vehicle/VehiclePos/VehiclePosX1-6/Y1-6's own "
    "small literal defaults (55..85 / 5..30) as pixel offsets from the "
    "vehicle-icon panel's origin; this has not been checked against how "
    "the engine repositions them for a real multi-seat vehicle.",
    "The turret icon's body picture (vehicleIcon, icon_tank_turn_body_32x32) "
    "carries a RotateEffect bound to IconLookRotation (recorded on that "
    "element as `rotation`); the back plate and barrel pictures next to it "
    "do not. Units (radians vs. degrees), sign and pivot are not resolved "
    "here.",
    "The crosshair's CrossHair/CrossHairRed/Green/Blue feed one "
    "VariableColorEffect through a DivData by 256 (a 0-255 storage "
    "convention there) but CrossHair/CrossHairAlpha is a plain 0-1 float; "
    "both are recorded as observed, not reconciled.",
    "Vehicle/VehiclePlayers/VehiclePlayersText1-6's default strings "
    "('(1) CannonFodderwwww sgdgkjs', ...) read as leftover editor-preview "
    "text, not real defaults meant for a player to ever see; kept verbatim.",
    "Only the base game's Mods/bf1942/Archives/menu.rfa is read, matching "
    "extract_hud_pack.py and extract_spawn_layout.py -- a mod that ships "
    "its own menu.rfa is not surveyed.",
    "hitIndicator has 7 picture elements, not 8: direction 1's own "
    "TransformNode carries an extra, unnamed `CullNode Variable=BoolData "
    "{False}` ahead of its HitFromDir/HitFromDir==1 check -- the data's own "
    "way of switching a branch off for good (the same convention "
    "extract_spawn_layout.py documents), so it never reaches the elements "
    "list at all. The other 7 directions (2-8) are all wired up.",
]


# --------------------------------------------------------------- resolving

def to_signed32(v: int) -> int:
    return v - 0x100000000 if isinstance(v, int) and v >= 0x80000000 else v


def named(obj) -> str | None:
    return obj.name if isinstance(obj, meme.Obj) and obj.name else None


def default_value(obj):
    """The literal default a Data object resolves to: a plain value for a
    leaf (BoolData/IntData/FloatData/StringData/WstringData), or, for the
    handful of fill-picture bindings built from one, the numeric result of
    Add/Sub/Mul/Div over such leaves (both sides must resolve, matching how
    the crosshair's colour channels are actually built: e.g.
    `CrossHair/CrossHairRed / 256`). None if it can't be resolved (not a
    guess -- the caller keeps the field out rather than invent a value)."""
    if not isinstance(obj, meme.Obj):
        return None
    if obj.cls == "BoolData":
        return bool(obj["Value"])
    if obj.cls == "IntData":
        return to_signed32(obj["Value"])
    if obj.cls == "FloatData":
        return obj["Value"]
    if obj.cls == "StringData":
        return obj["String"]
    if obj.cls == "WstringData":
        return obj["Wstring"]
    ops = {"AddData": lambda a, b: a + b, "SubData": lambda a, b: a - b,
           "MulData": lambda a, b: a * b,
           "DivData": lambda a, b: a / b if b else None}
    if obj.cls in ops:
        a, b = default_value(obj["Data 1"]), default_value(obj["Data 2"])
        if a is None or b is None:
            return None
        return ops[obj.cls](a, b)
    return None


NEG_CMP = {"eq": "ne", "ne": "eq"}
FLIP_CMP = {"lt": "gt", "le": "ge", "gt": "lt", "ge": "le", "eq": "eq", "ne": "ne"}


def negate(cond: dict | None) -> dict | None:
    """De Morgan for `and`/`or`, direct flip for `eq`/`ne`; anything else is
    wrapped rather than guessed at (this corpus's NotData never wraps a
    Less(Equal)Data, so that case is left unhandled on purpose)."""
    if cond is None:
        return None
    if "const" in cond:
        return {"const": not cond["const"]}
    op = cond.get("op")
    if op in ("and", "or"):
        return {"op": "or" if op == "and" else "and", "terms": [negate(t) for t in cond["terms"]]}
    if op in NEG_CMP:
        return {**cond, "op": NEG_CMP[op]}
    return {"not": cond}


def condition(obj) -> dict | None:
    """A CullNode's Variable as `{var, op, value}` / `{op: and/or, terms}} /
    `{const}` -- the shape `extract_spawn_layout.py`'s spawn-layout.json
    uses, generalized (see the module docstring) for two patterns the
    simpler spawn-screen conditions never needed."""
    if not isinstance(obj, meme.Obj):
        return None
    if obj.cls == "BoolData":
        if not obj.name:
            return {"const": bool(obj["Value"])}
        return {"var": obj.name, "op": "eq", "value": True}
    if obj.cls in ("IntData", "FloatData") and obj.name:
        return {"var": obj.name, "op": "ne", "value": 0, "note": "inferred nonzero-as-truthy, see notes"}
    if obj.cls == "NotData":
        return negate(condition(obj["Data"]))
    if obj.cls in ("AndData", "OrData"):
        terms = [condition(obj["Data 1"]), condition(obj["Data 2"])]
        return {"op": "and" if obj.cls == "AndData" else "or", "terms": [t for t in terms if t]}
    ops = {"EqualData": "eq", "NotEqualData": "ne", "LessData": "lt", "LessEqualData": "le"}
    if obj.cls in ops:
        a, b = obj["Data 1"], obj["Data 2"]
        op = ops[obj.cls]
        if not named(a) and named(b):
            # The tool that authored this graph sometimes writes the
            # literal first (`5 <= Weapon/NumberOfItems`); there is no
            # GreaterData/GreaterEqualData class anywhere in the corpus, so
            # flip rather than emit a condition with no variable in it.
            a, b = b, a
            op = FLIP_CMP[op]
        value = {"var": b.name} if isinstance(b, meme.Obj) and b.name else default_value(b)
        return {"var": a.name, "op": op, "value": value}
    return None


def resolve_color(obj) -> list[float] | None:
    if not isinstance(obj, meme.Obj):
        return None
    if obj.cls == "ColorEffect":
        return [obj["Red"], obj["Green"], obj["Blue"], obj["Alpha"]]
    if obj.cls == "VariableColorEffect":
        return [v if (v := default_value(obj[k])) is not None else 1.0
                for k in ("Red", "Green", "Blue", "Alpha")]
    if obj.cls == "BfMultiplyColorEffect2":
        a = default_value(obj["Alpha"])
        return [1.0, 1.0, 1.0, a if a is not None else 1.0]
    return None


def mul_color(a: list[float], b: list[float]) -> list[float]:
    return [round(x * y, 4) for x, y in zip(a, b)]


def resolve_rotation(obj) -> dict | None:
    """A `RotateEffect`/`RotateAroundCoordinateEffect`'s angle binding --
    only the turret-icon body currently carries one. Units (radians vs.
    degrees), sign and (for the coordinate form) the pivot point are not
    resolved here (see NOTES); this only carries the binding through."""
    if not isinstance(obj, meme.Obj) or obj.cls not in ("RotateEffect", "RotateAroundCoordinateEffect"):
        return None
    angle, angle_var = default_value(obj["Angle"]), named(obj["Angle"])
    mult, mult_var = default_value(obj["Angle multiplyer"]), named(obj["Angle multiplyer"])
    rot: dict = {}
    if angle is not None:
        rot["angle"] = angle
    if angle_var:
        rot["angleVar"] = angle_var
    if mult is not None:
        rot["angleMultiplier"] = mult
    if mult_var:
        rot["angleMultiplierVar"] = mult_var
    if obj.cls == "RotateAroundCoordinateEffect":
        rot["pivot"] = [default_value(obj["X"]), default_value(obj["Y"])]
    return rot or None


# ---------------------------------------------------------------- flattening

class Flattener:
    """Walks a node list the way the renderer does -- see
    `extract_spawn_layout.Flattener` for the base model (CullNode gates,
    EffectNode colours, TransformNode moves the origin, SplitNode branches);
    extended here with the node types the in-game HUD uses that the spawn
    screen never does: BfTransformNode (a data-bound offset, used only to
    place a vehicle seat dot), BfVariablePictureFillNode[2] (a two-state
    gauge) and BfCrosshairNode."""

    def __init__(self, lexicon: dict[str, str] | None = None):
        self.lexicon = lexicon or {}
        self.elements: list[dict] = []

    def run(self, nodes, ox=0.0, oy=0.0, rect=None, color=None, when=None, posvar=None,
            tag=None, on_enter=None, rotation=None) -> None:
        color = color or [1.0, 1.0, 1.0, 1.0]
        when = list(when or [])
        rect = rect or [0, 0, *VIRTUAL]
        for node in nodes:
            if on_enter is not None:
                seen = on_enter(node)
                if seen is not None:
                    tag = seen
            cls = node.cls
            if cls == "CullNode":
                cond = condition(node["Variable"])
                if cond:
                    when.append(cond)
            elif cls == "EffectNode":
                c = resolve_color(node["Effect"])
                if c:
                    color = mul_color(color, c)
                r = resolve_rotation(node["Effect"])
                if r:
                    rotation = r
            elif cls == "TransformNode":
                x, y, w, h = ox + node["X"], oy + node["Y"], node["Width"], node["Height"]
                self.run(node.children(), x, y, [x, y, w, h], color, when, posvar, tag, on_enter, rotation)
            elif cls == "BfTransformNode":
                xv, xvar = default_value(node["X"]), named(node["X"])
                yv, yvar = default_value(node["Y"]), named(node["Y"])
                x, y = ox + (xv or 0), oy + (yv or 0)
                w, h = node["Width"], node["Height"]
                pv = {"x": xvar, "xDefault": xv, "y": yvar, "yDefault": yv}
                self.run(node.children(), x, y, [x, y, w, h], color, when, pv, tag, on_enter, rotation)
            elif cls == "SplitNode":
                self.run(node.children(), ox, oy, rect, color, when, posvar, tag, on_enter, rotation)
            elif cls == "PictureNode":
                self.emit_picture(node, rect, color, when, tag, rotation)
            elif cls in ("VariablePictureNode", "BfVariablePictureNode"):
                self.emit_variable_picture(node, rect, color, when, tag, rotation)
            elif cls in ("BfVariablePictureFillNode", "BfVariablePictureFillNode2"):
                self.emit_fill_picture(node, rect, color, when, tag)
            elif cls == "TextNode":
                self.emit_text(node, rect, color, when, tag)
            elif cls == "BfOccupiedVehicleNode":
                self.emit_occupied_seat(node, rect, when, posvar, tag)
            elif cls == "BfCrosshairNode":
                self.emit_crosshair(node, rect, color, when, tag)
            else:
                self.run(node.children(), ox, oy, rect, color, when, posvar, tag, on_enter, rotation)

    def leaf(self, kind, rect, color, when, tag=None, **extra) -> dict:
        el = {"kind": kind, "rect": [round(v, 2) for v in rect]}
        if any(c.get("const") is False for c in when):
            return el  # switched off in the data; nothing ever draws it
        when = [c for c in when if "const" not in c]
        if color != [1.0, 1.0, 1.0, 1.0]:
            el["color"] = [round(c, 4) for c in color]
        if when:
            el["when"] = when
        el.update(extra)
        if tag is not None:
            # Internal-only: a caller's on_enter hook can mark "which
            # structural branch is this" (e.g. vehicleAmmo's primary vs.
            # secondary side) for elements that carry no variable name
            # saying so themselves (a shared backdrop picture, a heat bar
            # bound to the same Overheat/OverHeat both sides use). Stripped
            # in decode_hud() once it has done its job of sorting elements
            # into groups.
            el["_tag"] = tag
        self.elements.append(el)
        return el

    def emit_picture(self, node, rect, color, when, tag=None, rotation=None) -> None:
        name = node["Picture"]
        if not name:
            # An empty picture is a solid quad in the current colour.
            self.leaf("fill", rect, color, when, tag)
            return
        extra = {"texture": texture_key(name)}
        if rotation:
            extra["rotation"] = rotation
        self.leaf("picture", rect, color, when, tag, **extra)

    def emit_variable_picture(self, node, rect, color, when, tag=None, rotation=None) -> None:
        src = node["First part"] if node.cls == "VariablePictureNode" else node["picture str"]
        default = default_value(src)
        extra: dict = {}
        if default:
            extra["texture"] = texture_key(default)
        var = named(src)
        if var:
            extra["var"] = var
        if node.cls == "BfVariablePictureNode":
            rv = named(node.get("redraw"))
            if rv:
                extra["redrawVar"] = rv
        if rotation:
            extra["rotation"] = rotation
        self.leaf("variable-picture", rect, color, when, tag, **extra)

    def _bound(self, field):
        """A fill-picture field that is either a plain literal (str/int,
        from BfVariablePictureFillNode's PSTR/INT) or a Data object (from
        BfVariablePictureFillNode2) -- (value, varname)."""
        if isinstance(field, meme.Obj):
            return default_value(field), named(field)
        return field, None

    def emit_fill_picture(self, node, rect, color, when, tag=None) -> None:
        pic, pic_var = self._bound(node["Picture"])
        fill, fill_var = self._bound(node["Fill picture"])
        value, value_var = self._bound(node["Variable"])
        maxv, maxv_var = self._bound(node["Maximum value"])
        size, size_var = self._bound(node["Size"])
        extra: dict = {}
        if pic:
            extra["picture"] = texture_key(pic)
        if pic_var:
            extra["pictureVar"] = pic_var
        if fill:
            extra["fillPicture"] = texture_key(fill)
        if fill_var:
            extra["fillPictureVar"] = fill_var
        if value is not None:
            extra["value"] = value
        if value_var:
            extra["valueVar"] = value_var
        if maxv is not None:
            extra["max"] = maxv
        if maxv_var:
            extra["maxVar"] = maxv_var
        if size is not None:
            extra["size"] = size
        if size_var:
            extra["sizeVar"] = size_var
        extra["horizontalAlign"] = bool(node["Horizontal align"])
        extra["fillOrder"] = bool(node["Fill order"])
        self.leaf("fill-picture", rect, color, when, tag, **extra)

    def emit_text(self, node, rect, color, when, tag=None) -> None:
        src, style = node["String"], node["Style"]
        font = font_id(style["Font handle"]) if isinstance(style, meme.Obj) else "standard6"
        extra: dict = {"font": font, "align": align_of(style)}
        if isinstance(src, meme.Obj) and src.cls == "BfLocaleStringData":
            key = default_value(src["String Id"])
            extra["key"] = key
            extra["text"] = self.lexicon.get(key, key)
        elif isinstance(src, meme.Obj):
            val = default_value(src)
            extra["text"] = "" if val is None else str(val)
            if src.name:
                extra["var"] = src.name
        self.leaf("text", rect, color, when, tag, **extra)

    def emit_occupied_seat(self, node, rect, when, posvar, tag=None) -> None:
        extra: dict = {"position": node["Position"], "drawDebugPic": bool(node["Draw debug pic"])}
        if posvar:
            extra["posVar"] = {"x": posvar.get("x"), "y": posvar.get("y")}
        data = node.get("BfOccupiedVehicleData")
        if isinstance(data, meme.Obj) and data.name:
            extra["dataRef"] = data.name
        self.leaf("occupied-seat", rect, [1.0, 1.0, 1.0, 1.0], when, tag, **extra)

    def emit_crosshair(self, node, rect, color, when, tag=None) -> None:
        extra: dict = {}
        for label, key in (("radius", "Radius"), ("thickness", "Thickness"),
                           ("outlineThickness", "outline thickness"),
                           ("deviation", "Deviation")):
            v, var = default_value(node[key]), named(node[key])
            if v is not None:
                extra[label] = v
            if var:
                extra[f"{label}Var"] = var
        col, outline = node["color"], node["outline"]
        # Named crosshairColor/outlineColor, not color/outline: `color` on
        # every other kind of leaf is the ambient EffectNode tint (usually
        # the default [1,1,1,1] and left out), a different thing from the
        # BfCrosshairNode's own two colour fields -- reusing "color" here
        # would collide with that key on the very same element.
        if isinstance(col, meme.Obj):
            extra["crosshairColor"] = [col["Red"], col["Green"], col["Blue"], col["Alpha"]]
        if isinstance(outline, meme.Obj):
            extra["outlineColor"] = [outline["Red"], outline["Green"], outline["Blue"], outline["Alpha"]]
        self.leaf("crosshair", rect, color, when, tag, **extra)


# ------------------------------------------------------------ finding a top

def leading_culls(top: meme.Obj) -> list[tuple[str, str]]:
    """The ("is"|"not", variable name) of the CullNodes stacked at the very
    front of a top-level entry's own child list -- the in-game HUD ANDs
    these together as the whole group's gate (e.g. soldierAmmo needs
    Soldier/ShowSoldierIcon AND Weapon/ShowWeaponIcon AND NOT
    Vehicle/ShowVehicleIcon, three CullNodes in a row)."""
    names: list[tuple[str, str]] = []
    for kid in top.children():
        if kid.cls != "CullNode":
            break
        v = kid["Variable"]
        if isinstance(v, meme.Obj) and v.cls == "NotData" and isinstance(v["Data"], meme.Obj) and v["Data"].name:
            names.append(("not", v["Data"].name))
        elif isinstance(v, meme.Obj) and v.name:
            names.append(("is", v.name))
        else:
            names.append(("?", ""))
    return names


def find_top(root: meme.Obj, signature: list[tuple[str, str]], rect,
             strict: bool = True) -> tuple[meme.Obj, bool]:
    """The one top-level entry (`root.chain()`) whose leading CullNode
    signature and own rect match exactly, and whether it took the relaxed
    path below.

    The signature/rect pairs in `RAW_TOPS` were read off vanilla, where
    several entries share a signature and are told apart only by their rect
    (`vehiclePanel` and `vehicleAmmo` both cull on `Vehicle/ShowVehicleIcon`),
    so both halves have to match and anything else raises rather than guess.

    `strict=False` -- a mod's own menu/InGame -- allows two relaxations, and
    only two:

    * nothing matches signature *and* rect but exactly one entry in the file
      carries that signature: that entry is taken and the second return value
      is True, so a mod that moved a widget decodes at the position it moved
      it to. Eve of Destruction moves the weapon bar this way.
    * no entry carries the signature at all: `None`, meaning the mod dropped
      that widget. EoD has no `ShowFlagIcon` group -- no CTF flag icon --
      and an empty group is the honest reading of that.

    Anything still ambiguous raises, so a mod that restructured the file
    fails loudly instead of producing a layout that is wrong in a way nobody
    would notice until it drew.
    """
    matches = []
    by_signature = []
    for top in root.chain():
        if leading_culls(top) != signature:
            continue
        by_signature.append(top)
        got = (top.fields.get("X"), top.fields.get("Y"),
               top.fields.get("Width"), top.fields.get("Height"))
        if got == rect:
            matches.append(top)
    if len(matches) == 1:
        return matches[0], False
    if not strict and not matches:
        if len(by_signature) == 1:
            return by_signature[0], True
        if not by_signature:
            return None, False
    raise SystemExit(f"expected exactly one menu/InGame top-level entry for "
                     f"signature={signature} rect={rect}, found {len(matches)}"
                     + ("" if strict else
                        f" ({len(by_signature)} entries carry that signature)"))


def flatten(tops: list[meme.Obj], lexicon: dict[str, str], on_enter=None) -> list[dict]:
    flat = Flattener(lexicon)
    flat.run(list(tops), on_enter=on_enter)
    return flat.elements


def bounding_rect(elements: list[dict]) -> list[float]:
    if not elements:
        return [0, 0, 0, 0]
    x0 = min(e["rect"][0] for e in elements)
    y0 = min(e["rect"][1] for e in elements)
    x1 = max(e["rect"][0] + e["rect"][2] for e in elements)
    y1 = max(e["rect"][1] + e["rect"][3] for e in elements)
    return [round(x0, 2), round(y0, 2), round(x1 - x0, 2), round(y1 - y0, 2)]


def tag_ammo_side(node: meme.Obj) -> str | None:
    """vehicleAmmo's primary and secondary panels are two structurally
    identical `TransformNode(*, *, 53, 51)` blocks -- three, in fact: the
    single-weapon-icon layout shows one at the group's own origin (X=90);
    the dual-weapon-icon layout shows two, offset X=-110 (primary) and
    X=10 (secondary) from its own origin. Some of their content carries no
    variable name saying which side it is on (the shared backdrop picture;
    the heat-bar variant, which the secondary side binds to the same
    Overheat/OverHeat the primary side does), so the split has to be
    structural, not a search for "Secondary" in a variable name."""
    if node.cls == "TransformNode" and node.fields.get("Width") == 53 and node.fields.get("Height") == 51:
        return "secondary" if node.fields.get("X") == 10 else "primary"
    return None


def untagged(elements: list[dict]) -> list[dict]:
    for el in elements:
        el.pop("_tag", None)
    return elements


# --------------------------------------------------------------- top layout

# (top-level key -> (leading-cull signature, own rect)), from the real
# menu/InGame graph (see the tools this file's commit was built with under
# scratch/f2/ -- explore.py's top-level dump, dumpsub2.py's per-top dumps).
# A SplitNode top has no X/Y/Width/Height of its own, hence the None rect.
RAW_TOPS: dict[str, tuple[list[tuple[str, str]], tuple]] = {
    "soldierIcon":     ([("is", "Soldier/ShowSoldierIcon")], (90.0, 525.0, 64.0, 64.0)),
    "soldierAmmo":     ([("is", "Soldier/ShowSoldierIcon"), ("is", "Weapon/ShowWeaponIcon"),
                        ("not", "Vehicle/ShowVehicleIcon")], (600.0, 505.0, 233.0, 83.0)),
    "vehiclePanel":    ([("is", "Vehicle/ShowVehicleIcon")], (192.0, 452.0, 161.0, 130.0)),
    "vehicleAmmo":     ([("is", "Vehicle/ShowVehicleIcon")], (600.0, 505.0, 233.0, 83.0)),
    "vehicleTurret":   ([("is", "Vehicle/ShowVehicleIcon"), ("is", "Vehicle/ShowTurretIcon")],
                        (400.0, 540.0, 64.0, 64.0)),
    "vehiclePlayers":  ([("is", "Vehicle/ShowVehiclePlayers"), ("is", "Vehicle/ShowVehicleIcon")],
                        (196.0, 496.0, 256.0, 128.0)),
    "weaponBar":       ([("is", "Weapon/SelectingWeapon")], (210.0, 525.0, 512.0, 64.0)),
    "hitIndicator":    ([("is", "HitFromDir/HitFromDir")], (None, None, None, None)),
    "crosshair":       ([("is", "CrossHair/ShowCrossHair"), ("not", "Submarine/ShowPeriscope")],
                        (None, None, None, None)),
    "supplyCtf":       ([], (720.0, 230.0, 64.0, 64.0)),
    "supplyParachute": ([("is", "ShowParachute")], (720.0, 372.0, 64.0, 64.0)),
    "supplyRepair":    ([("is", "ShowRepairIcon")], (720.0, 372.0, 64.0, 64.0)),
    "supplyHeal":      ([("is", "ShowHealIcon")], (720.0, 302.0, 64.0, 64.0)),
    "supplyMine":       ([("is", "ShowMineIcon")], (None, None, None, None)),
    "supplyReload":    ([("is", "ShowReloadIcon")], (720.0, 442.0, 64.0, 64.0)),
    "supplyFlag":       ([("is", "ShowFlagIcon")], (None, None, None, None)),
    "supplyNonTakeable": ([("is", "ShowNonTakeableFlagIcon")], (None, None, None, None)),
    # The ticket counter. It is a top-level entry of menu/InGame like every
    # other widget here -- gated by `ShowTicket`, not by `Kit/ShowKit` -- so
    # the game draws it both on the spawn screen and over the live world.
    # `extract_spawn_layout.py` already decodes this same top for the spawn
    # screen; decoding it here as well is what lets `hud.js`'s generic painter
    # draw it in-game with no code of its own, the way every other group in
    # this file works.
    "tickets":          ([("is", "ShowTicket")], (620.0, 4.0, 256.0, 32.0)),
    # The combat-area warning. Its leading cull is a comparison rather than a
    # bool -- `0 < Outside/OutsideTime`, a LessData with no symbol of its own,
    # which `leading_culls` reports as the anonymous ("?", "") -- so the rect
    # is what picks it out. `flatten` still records the real condition, so the
    # painter culls the group whenever the countdown is not running.
    "outside":          ([("?", "")], (310.0, 174.0, 230.0, 40.0)),
}

SUPPLY_KEYS = ("supplyCtf", "supplyParachute", "supplyRepair", "supplyHeal",
               "supplyMine", "supplyReload", "supplyFlag", "supplyNonTakeable")

#: The last note above describes truthfully a run that read vanilla's own
#: menu/InGame, and a run that read a mod's not at all, so the latter
#: replaces it. It turns on *whose archive answered*, not on which `--mod`
#: was asked for: Road to Rome and Secret Weapons ship no menu/InGame of
#: their own, so their HUD layout is vanilla's file with vanilla's note and
#: comes out byte-identical -- which is what lets `extract_hud_mods.py` leave
#: `hud-layout.json` out of their packs entirely.
MOD_NOTE = (
    "Read from a mod's menu chain, nearest child first. The top-level "
    "entries are located by their leading CullNode signature and their own "
    "rect, both derived from vanilla; a mod that kept menu/InGame's "
    "structure decodes through the same finder, and one that restructured it "
    "makes find_top fail loudly rather than guess. extract_hud_mods.py then "
    "leaves hud-layout.json out of that mod's pack and the viewer falls back "
    "to the vanilla one."
)


def notes_for(owner: str) -> list[str]:
    """`owner` is the mod in the chain whose menu.rfa held `menu/InGame`."""
    if owner.lower() == "bf1942":
        return NOTES
    return NOTES[:-1] + [MOD_NOTE]


def decode_hud(ingame: bytes, lexicon: dict[str, str],
               source: str = SOURCE, notes: list[str] | None = None,
               strict: bool = True) -> dict:
    root, reader = meme.load(ingame)
    raw: dict[str, list[dict]] = {}
    moved: list[str] = []
    absent: list[str] = []
    for key, (sig, rect) in RAW_TOPS.items():
        top, relaxed = find_top(root, sig, rect, strict)
        if top is None:
            absent.append(key)
            raw[key] = []
            continue
        if relaxed:
            moved.append(key)
        on_enter = tag_ammo_side if key == "vehicleAmmo" else None
        raw[key] = flatten([top], lexicon, on_enter=on_enter)

    panel = raw["vehiclePanel"]
    vehicle_ammo = raw["vehicleAmmo"]
    groups = {
        "soldierIcon": raw["soldierIcon"],
        "soldierAmmo": raw["soldierAmmo"],
        "vehicleIcon": ([e for e in panel if e["kind"] == "variable-picture"] + raw["vehicleTurret"]),
        "vehicleHealth": [e for e in panel if e["kind"] == "fill-picture"],
        "vehicleSeats": [e for e in panel if e["kind"] == "occupied-seat"] + raw["vehiclePlayers"],
        "primaryAmmo": untagged([e for e in vehicle_ammo if e.get("_tag") != "secondary"]),
        "secondaryAmmo": untagged([e for e in vehicle_ammo if e.get("_tag") == "secondary"]),
        "supplyIcon": [e for key in SUPPLY_KEYS for e in raw[key]],
        "hitIndicator": raw["hitIndicator"],
        "weaponBar": raw["weaponBar"],
        "crosshair": raw["crosshair"],
        "tickets": raw["tickets"],
        "outside": raw["outside"],
    }

    out_groups = {}
    fonts: set[str] = set()
    for key, elements in groups.items():
        out_groups[key] = {"rect": bounding_rect(elements), "elements": elements}
        fonts.update(el["font"] for el in elements if el["kind"] == "text")

    all_notes = list(NOTES if notes is None else notes)
    if moved:
        all_notes.append(
            "Located by CullNode signature alone, because this mod's "
            "menu/InGame places them somewhere other than vanilla does, and "
            "nothing else in the file carries their signature: "
            + ", ".join(moved) + ".")
    if absent:
        all_notes.append(
            "Not in this mod's menu/InGame at all -- no entry carries the "
            "signature -- so the group is empty and nothing draws for it: "
            + ", ".join(absent) + ".")
    return {
        "virtual": list(VIRTUAL),
        "source": source,
        "fonts": sorted(fonts),
        "notes": all_notes,
        "groups": out_groups,
    }


# -------------------------------------------------------------------- main

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--game-dir", type=Path, default=DEFAULT_GAME_DIR)
    parser.add_argument("--mod", default="bf1942",
                        help="mod whose menu chain to read (default: bf1942)")
    parser.add_argument("--out", type=Path, default=None,
                        help="output directory (default: the mod's own pack dir)")
    parser.add_argument("--force", action="store_true", help="re-encode font atlases")
    args = parser.parse_args()

    game_dir = args.game_dir.expanduser()
    sources = MenuSources(mod_chain(game_dir, args.mod))
    out = args.out or hud_dir_for(sources.mod_id)
    lexicon = load_chain_lexicon(sources.lexicon_paths)

    with sources.open_menu() as menu:
        entry = next(e for e in menu.entries if e.lower() == "menu/ingame")
        ingame = menu.read(entry)
        owner = menu.owner(entry)
    hud = decode_hud(ingame, lexicon,
                     f"menu/InGame (MemeFile 2.0) in "
                     f"Mods/{owner}/Archives/menu.rfa",
                     notes_for(owner), strict=owner.lower() == "bf1942")
    with sources.open_font() as fonts:
        hud["fontFiles"] = extract_fonts(fonts, font_handles(hud),
                                         out / "fonts", args.force)
    out.mkdir(parents=True, exist_ok=True)
    (out / "hud-layout.json").write_text(json.dumps(hud, indent=1) + "\n")
    counts = ", ".join(f"{k}={len(v['elements'])}" for k, v in hud["groups"].items())
    print(f"{sources.mod_id}: {sum(len(v['elements']) for v in hud['groups'].values())} "
          f"elements ({counts}), {len(hud['fontFiles'])} fonts -> {out}")


if __name__ == "__main__":
    main()
