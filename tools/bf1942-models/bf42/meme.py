"""Reader for the Refractor menu-system `MemeFile 2.0` node graphs.

`menu/InGame`, `menu/MainMenu` and the other extensionless entries in
`menu.rfa` are serialized `dice::meme::*` object graphs: the in-game HUD,
the spawn interface, the scoreboard and every front-end page. The engine
reads them with `dice::meme::ClassIStream`, and this module mirrors what that
reader does, byte for byte, as established against BF1942.exe (sha256
60c9452d...cd3699; addresses in `features/bf1942-engine-reference/`):

Header (`FUN_007f7dc0`)
    u8-length strings, back to back, until an empty one. The first is
    `MemeFile 2.0`. The rest is the symbol table: class names and node /
    variable names, referenced from the stream as 1-based u16 indices
    (`FUN_007f7ef0`; index 0 is the empty string). The table is written by
    the ostream in first-use order and the file loader keeps it in the same
    slots, so index 1 is always the root's class.

Root
    u16 class index, then that class's fields (`FUN_007ed220`).

Object pointer frame (`FUN_007ed4f0` reads, `FUN_007ecea0` writes)
    u32 size    bytes from the start of this field to the end of the fields
    u16 name    symbol index, 0 for anonymous
    u16 class   symbol index, 0 for "no class"
    fields      the class's `read` (vtable +0x30), see SCHEMAS
    A NULL pointer is written as size 8, name 0, class 0. A name with no
    class is a reference to an object already registered under that name
    (or to another `menu/<name>` file). After the fields the reader seeks
    to `start + size`, so trailing fields a schema does not know are
    skipped safely — but every node's *first* field is its "Next node"
    sibling pointer (`FUN_007ec100`), so a node's frame contains all of its
    later siblings and that field must be read before skipping.

Primitives (ClassIStream vtable slots, 0x00947288)
    +0x1c int (same bytes as +0x3c)    +0x24 ushort   2 bytes
    +0x34 float    4 bytes IEEE        +0x38 bool     1 byte
    +0x3c int      4 bytes             +0x40 string   u32 length + bytes
    +0x44 wstring  u32 length + UTF-16LE
    +0x4c picture  u8 length + bytes   +0x50 font     u8 length + bytes
    +0x54 sound    u8 length + bytes
    +0x58 object frames, repeated with no count until the *enclosing* frame
          ends (`ActionListAction`'s "Action list")
    +0x5c enum whose width the call chooses: 1 byte for every class's own
          "Event type", 4 for `ButtonEvent`'s "Button type" — the two known
          call sites of a single shared slot (0x007f7060 forwards through
          `this+8` without picking the width itself, so this is recorded
          per field below, not derived)
    +0x60..+0x88   object pointer frame (node, data, effect, style, action,
                   function, node list — a list is its first node, the
                   rest hang off "Next node"; +0x78 additionally takes a
                   computed-default callback, same bytes on the wire)
"""

from __future__ import annotations

import struct
from dataclasses import dataclass, field
from typing import Any

MAGIC = "MemeFile 2.0"

# Field kinds. Each schema is the ordered list of fields the class's read
# method consumes after the Node base (which is `next` for every *Node
# class, and nothing for data / effect / style / action objects).
F32, BOOL, INT, STR, WSTR, PSTR, EVENT = "f32", "bool", "int", "str", "wstr", "pstr", "event"
OBJ = "obj"  # any object pointer frame (node, data, effect, style, action)
# MEME-11: ClassIStream +0x5c is one shared "enum" primitive whose width the
# *call site* picks, not the slot — 1 byte for every class's own "Event type"
# (TypeEvent, ButtonEvent, AnyKeyEvent all verified against the client), 4 for
# ButtonEvent/ExtendedButtonEvent's "Button type" (`EVENT` above, unchanged).
EVENT8 = "event8"
# ActionListAction's "Action list": +0x58 reads OBJ frames back to back, no
# count, until the *enclosing* object's own frame ends.
OBJ_LIST = "obj_list"

# class name (without the dice::meme:: prefix) -> [(label, kind), ...]
# Labels are the strings the engine passes to the stream; `pstr` covers
# the picture / font / sound handles, which share the u8-length encoding.
SCHEMAS: dict[str, list[tuple[str, str]]] = {
    "Object": [],
    "Node": [("Next node", OBJ)],
    "NameNode": [("Next node", OBJ)],
    "ClipNode": [("Next node", OBJ)],
    "BfLocaleNode": [("Next node", OBJ), ("Locale", OBJ)],
    "TransformNode": [("Next node", OBJ), ("X", F32), ("Y", F32),
                      ("Width", F32), ("Height", F32), ("Transformed node", OBJ)],
    "BfTransformNode": [("Next node", OBJ), ("X", OBJ), ("Y", OBJ),
                        ("Width", F32), ("Height", F32), ("Transformed node", OBJ)],
    "BfTransformNodeSize": [("Next node", OBJ), ("Width", OBJ), ("Height", OBJ),
                            ("X", F32), ("Y", F32), ("Transformed node", OBJ)],
    "TranslateNode": [("Next node", OBJ), ("X", OBJ), ("Y", OBJ)],
    "SplitNode": [("Next node", OBJ), ("Split node", OBJ)],
    "CullNode": [("Next node", OBJ), ("Variable", OBJ), ("In time", F32), ("Out time", F32)],
    "EffectNode": [("Next node", OBJ), ("Effect", OBJ)],
    "VariableEffectNode": [("Next node", OBJ), ("Effect", OBJ), ("Effect level", OBJ)],
    "PictureNode": [("Next node", OBJ), ("Picture", PSTR)],
    "VariablePictureNode": [("Next node", OBJ), ("First part", OBJ),
                            ("Middle part", OBJ), ("Last part", OBJ)],
    "BfVariablePictureNode": [("Next node", OBJ), ("picture str", OBJ), ("redraw", OBJ)],
    "BfScrollPictureNode": [("Next node", OBJ), ("Scroll picture", PSTR), ("Variable", OBJ),
                            ("Maximum value", OBJ), ("Y offset", INT), ("Size", INT),
                            ("Var size", OBJ), ("Maintain value", OBJ), ("From bottom", BOOL)],
    "BfVariablePictureFillNode": [("Next node", OBJ), ("Picture", PSTR), ("Fill picture", PSTR),
                                  ("Variable", OBJ), ("Maximum value", OBJ), ("Size", INT),
                                  ("Horizontal align", BOOL), ("Fill order", BOOL)],
    "BfVariablePictureFillNode2": [("Next node", OBJ), ("Picture", OBJ), ("Fill picture", OBJ),
                                   ("Variable", OBJ), ("Maximum value", OBJ), ("Size", OBJ),
                                   ("Horizontal align", BOOL), ("Fill order", BOOL)],
    "TextNode": [("Next node", OBJ), ("String", OBJ), ("Style", OBJ)],
    "BfTextNode": [("Next node", OBJ), ("String", OBJ), ("Style", OBJ), ("Color", OBJ)],
    "BfButtonNode": [("Next node", OBJ), ("Picture", PSTR), ("Mouse over picture", PSTR),
                     ("Action", OBJ), ("Width", F32), ("Height", F32)],
    "ActionNode": [("Next node", OBJ), ("Action", OBJ)],
    "TimeoutActionNode": [("Next node", OBJ), ("Action", OBJ), ("Timeout time", F32)],
    # MEME-11: both end with an "Event" object frame the old schema lacked
    # (verified: meme_CullEventActionNode__read 0x007e3a80,
    # meme_CullVariableAndEventActionNode__read 0x007e3bf0).
    "CullEventActionNode": [("Next node", OBJ), ("Action", OBJ), ("Event", OBJ)],
    "CullVariableActionNode": [("Next node", OBJ), ("Action", OBJ), ("Variable", OBJ)],
    "CullVariableAndEventActionNode": [("Next node", OBJ), ("Action", OBJ),
                                       ("Variable", OBJ), ("Event", OBJ)],
    "BfVariableTimeoutActionNode": [("Next node", OBJ), ("Action", OBJ), ("Timeout time", OBJ)],
    "BfVariableTimeoutActionNode2": [("Next node", OBJ), ("Action", OBJ),
                                     ("Current time", OBJ), ("Timeout time", OBJ)],
    "BfAddSubNextEffectNode": [("Next node", OBJ), ("Value", OBJ), ("End value", OBJ),
                               ("Start time", OBJ), ("Start percentage", OBJ), ("End time", OBJ),
                               ("Delay", OBJ), ("Loop", OBJ), ("Next action", OBJ), ("Reset", OBJ)],
    "BfOccupiedVehicleNode": [("Next node", OBJ), ("Position", INT), ("Draw debug pic", BOOL),
                              ("BfOccupiedVehicleData", OBJ)],
    "BfCrosshairNode": [("Next node", OBJ), ("Radius", OBJ), ("Thickness", OBJ),
                        ("outline thickness", OBJ), ("Deviation", OBJ), ("color", OBJ),
                        ("outline", OBJ)],
    "BfEditNode": [("Next node", OBJ), ("Font", PSTR), ("String", OBJ),
                   ("Max characters", INT), ("Select action", OBJ), ("Editbox data", OBJ),
                   ("Focus", BOOL)],
    # MEME-11 named `BfNewListBoxNode` as short by a constant 57 bytes wherever
    # it is used. Its own read (client 0x007cfeb0, reached from the class-name
    # string 0x0093cbac -> registrar 0x007cfd05 -> ClassInfo vtable 0x0093ca64
    # -> createInstance 0x007d4160 -> ctor 0x007d1200 -> object vtable
    # 0x0093cde8 +0x30) carries fourteen more fields after "Border or not":
    # four background-colour floats, the scrollbar width, four frame-colour
    # floats, four select-colour floats, a "Show tooltip" bool and the
    # scrollbar's offset from the border. 4*4 + 4 + 4*4 + 4*4 + 1 + 4 = 57.
    # The two faces the class then loads by name ("Outlands_2.dif" and
    # "Outlands_2_inv.dif", 0x007cff9a) are hard-coded, not on the wire.
    "BfNewListBoxNode": [("Next node", OBJ), ("Listbox data", OBJ), ("Font", PSTR),
                         ("Select action", OBJ), ("Focus action", OBJ), ("Step sound", PSTR),
                         ("Select sound", PSTR), ("Failed select sound", PSTR),
                         ("Row height", F32), ("IsSelectable", BOOL), ("Border or not", BOOL),
                         ("Background color red", F32), ("Background color green", F32),
                         ("Background color blue", F32), ("Background color alpha", F32),
                         ("Scrollbar width", F32),
                         ("Frame color red", F32), ("Frame color green", F32),
                         ("Frame color blue", F32), ("Frame color alpha", F32),
                         ("Select color red", F32), ("Select color green", F32),
                         ("Select color blue", F32), ("Select color alpha", F32),
                         ("Show tooltip", BOOL), ("Scrollbar offset from border", F32)],
    # The four classes the Singleplayer pages use that had no schema at all.
    # Same route as above; `read` addresses in the comments.
    # BfEditNodeInt 0x007dfff0 (vtable 0x0093f770): the numeric edit box in the
    # skirmish difficulty panel. "Int" and "Font" are label pointers
    # (0x0091973c, 0x0093cdcc), not fields of their own.
    "BfEditNodeInt": [("Next node", OBJ), ("Font", PSTR), ("Int", OBJ), ("String", OBJ),
                      ("Min value (-1 = no limit)", INT), ("Max value (-1 = no limit)", INT),
                      ("Select action", OBJ), ("Editbox data", OBJ), ("Focus", BOOL)],
    # BfSliderNode 0x007d7250 (vtable 0x0093d880) and BfFixedSliderNode
    # 0x007d73a0 (vtable 0x0093d798) differ only by the trailing "Interval".
    # "Cursor node" comes through +0x84, the node-pointer slot.
    "BfSliderNode": [("Next node", OBJ), ("Cursor node", OBJ), ("Data", OBJ),
                     ("Minimum value", F32), ("Maximum value", F32), ("Number visible", F32)],
    "BfFixedSliderNode": [("Next node", OBJ), ("Cursor node", OBJ), ("Data", OBJ),
                          ("Minimum value", F32), ("Maximum value", F32),
                          ("Number visible", F32), ("Interval", F32)],
    # BfAddSubEffectNode 0x007d54d0 (vtable 0x0093d1f0) is the page-transition
    # tweener: eight data pointers, all through +0x6c. It is the sibling of
    # BfAddSubNextEffectNode below, which ends with Loop / Next action / Reset
    # where this one ends with Up / Go (labels 0x0093d07c, 0x0093d078).
    "BfAddSubEffectNode": [("Next node", OBJ), ("Value", OBJ), ("End value", OBJ),
                           ("Start time", OBJ), ("Start percentage", OBJ), ("End time", OBJ),
                           ("Delay", OBJ), ("Up", OBJ), ("Go", OBJ)],
    # Data
    "BoolData": [("Value", BOOL)],
    "IntData": [("Value", INT)],
    "FloatData": [("Value", F32)],
    "StringData": [("String", STR)],
    "WstringData": [("Wstring", WSTR)],
    "BfLocaleData": [("Valid", OBJ)],
    "BfLocaleStringData": [("Locale", OBJ), ("Valid", OBJ), ("String Id", OBJ)],
    "NotData": [("Data", OBJ)],
    "EqualData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "NotEqualData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "LessData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "LessEqualData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "AndData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "OrData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "AddData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "SubData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "MulData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "DivData": [("Data 1", OBJ), ("Data 2", OBJ)],
    "BfColorData": [("Red", F32), ("Green", F32), ("Blue", F32), ("Alpha", F32)],
    "BfListBoxData": [("Create new action", OBJ), ("Create new string", OBJ), ("Profile name", OBJ)],
    "BfOccupiedVehicleData": [],
    "BfEditData": [],
    # Effects
    "ColorEffect": [("Red", F32), ("Green", F32), ("Blue", F32), ("Alpha", F32)],
    "VariableColorEffect": [("Red", OBJ), ("Green", OBJ), ("Blue", OBJ), ("Alpha", OBJ)],
    "AlphaFadeEffect": [],
    "BfMultiplyColorEffect2": [("Alpha", OBJ)],
    "RotateEffect": [("Angle", OBJ), ("Angle multiplyer", OBJ)],
    "RotateAroundCoordinateEffect": [("X", OBJ), ("Y", OBJ), ("Angle", OBJ),
                                     ("Angle multiplyer", OBJ)],
    # Styles: every one is Style::read = the font handle.
    "Style": [("Font handle", PSTR)],
    "BfStyle": [("Font handle", PSTR)],
    "BfStyle2": [("Font handle", PSTR)],
    "CenterAlignedStyle": [("Font handle", PSTR)],
    "RightAlignedStyle": [("Font handle", PSTR)],
    "BfOutlineStyle": [("Font handle", PSTR)],
    "BfLeftOutlineStyle": [("Font handle", PSTR)],
    # Actions and events
    "ToggleVariableAction": [("Variable", OBJ)],
    "SetVariableAction": [("Variable", OBJ), ("Value", OBJ)],
    "SetStringAction": [("Variable", OBJ), ("Value", OBJ)],
    "SplitAction": [("Action 1", OBJ), ("Action 2", OBJ)],
    # MEME-11: CallFunctionAction has a second field, "Result data", that the
    # old schema lacked (verified: its own read, client 0x007e4450 — the
    # trivial Action read, then "Function" at +0x74, then "Result data" at
    # +0x6c). `Function` itself has none: its read is the shared no-op stub
    # 0x007f8570, so a call is identified only by the name of the Function
    # object it references.
    "CallFunctionAction": [("Function", OBJ), ("Result data", OBJ)],
    "ActionFunction": [("Action", OBJ)],
    "Function": [],
    # ActionListAction (verified: 0x007f0ab0) is the trivial Action read, then
    # a run of Action frames with no count, through +0x58, until this
    # object's own frame ends — the menu's most common wrapper (3,547 uses).
    "ActionListAction": [("Actions", OBJ_LIST)],
    # SetPathAction (verified: 0x007e6e50) is the page transition every mod
    # uses (543 uses): a source and destination node (each with an engine
    # computed default when absent from the stream), four timing floats and
    # a bool for which node paints over the other.
    "SetPathAction": [("Path node", OBJ), ("Destination node", OBJ),
                      ("In time", F32), ("Out time", F32),
                      ("In wait time", F32), ("Out wait time", F32),
                      ("Paint outnode over innode", BOOL)],
    # RemoveEventAction (verified: shares the trivial no-op stub 0x007f8570
    # with Action/Function/Data) carries no fields of its own.
    "RemoveEventAction": [],
    # MEME-11 bug: the "Event type" of every *Event class is 1 byte on the
    # wire (EVENT8); ButtonEvent's/ExtendedButtonEvent's "Button type" alone
    # is the 4-byte EVENT. Both share one ClassIStream slot (+0x5c) whose
    # width the call site chooses — meme.py used to read all of it as 4.
    "TypeEvent": [("Input index", INT), ("Event type", EVENT8)],
    "ButtonEvent": [("Input index", INT), ("Event type", EVENT8), ("Button type", EVENT)],
    # AnyKeyEvent and ExtendedButtonEvent (verified: 0x007e18f0, 0x007e1700 —
    # both read out with ButtonEvent while tracing MEME-11's Event-type bug).
    "AnyKeyEvent": [("Input index", INT), ("Event type", EVENT8)],
    "ExtendedButtonEvent": [("Input index", INT), ("Event type", EVENT8),
                            ("Button type", EVENT), ("Repeat count", INT)],
    # BfNavigationButtonNode (verified: 0x007d9db0) is a three-state tab or
    # row selector, not a BfButtonNode: three picture handles, an action, a
    # mouse-over flag, an index, three more object fields tracking the live
    # mouse-over/click state, then width and height read last (the client
    # reads them after the state fields even though they sit earlier in the
    # object's own memory layout — the wire order below is the call order).
    "BfNavigationButtonNode": [("Next node", OBJ), ("Picture", PSTR),
                               ("Mouse over picture", PSTR), ("Clicked picture", PSTR),
                               ("Action", OBJ), ("MouseOver button", BOOL), ("Index", INT),
                               ("Current mouseover index", OBJ), ("Current clicked index", OBJ),
                               ("MouseOver active", OBJ), ("Width", F32), ("Height", F32)],
    # IndexDataData (verified: 0x007ef4b0) is the element of "Data" a
    # navigation button's "Current mouseover index" (or similar) selects.
    "IndexDataData": [("Data", OBJ), ("Index", OBJ)],
}


@dataclass
class Obj:
    """One serialized object. `fields` keeps the schema order; `name` is the
    symbol the engine registers the object under, if any."""
    cls: str
    name: str = ""
    fields: dict[str, Any] = field(default_factory=dict)
    offset: int = 0
    size: int = 0

    def __getitem__(self, key: str) -> Any:
        return self.fields[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self.fields.get(key, default)

    @property
    def is_node(self) -> bool:
        return self.cls.endswith("Node")

    def chain(self) -> list["Obj"]:
        """This node and everything after it on its "Next node" list."""
        out: list[Obj] = []
        node: Any = self
        while isinstance(node, Obj):
            out.append(node)
            node = node.fields.get("Next node")
        return out

    def children(self) -> list["Obj"]:
        """The node's own child list, walked along the sibling chain."""
        first = self.fields.get("Transformed node") or self.fields.get("Split node")
        return first.chain() if isinstance(first, Obj) else []

    def walk(self):
        """Depth-first over this node's subtree (children only, not data)."""
        yield self
        for child in self.children():
            yield from child.walk()


@dataclass
class Ref:
    """A named reference with no class: the object registered under `name`
    earlier in the stream, or another `menu/<name>` file."""
    name: str


class MemeReader:
    def __init__(self, data: bytes, strict: bool = False):
        self.data = data
        self.pos = 0
        self.table: list[str] = []
        self.strict = strict
        self.warnings: list[str] = []
        self.named: dict[str, Obj] = {}

    # -- primitives ---------------------------------------------------------
    def u8(self) -> int:
        v = self.data[self.pos]
        self.pos += 1
        return v

    def u16(self) -> int:
        v = struct.unpack_from("<H", self.data, self.pos)[0]
        self.pos += 2
        return v

    def u32(self) -> int:
        v = struct.unpack_from("<I", self.data, self.pos)[0]
        self.pos += 4
        return v

    def f32(self) -> float:
        v = struct.unpack_from("<f", self.data, self.pos)[0]
        self.pos += 4
        return v

    def pstr(self) -> str:
        n = self.u8()
        s = self.data[self.pos:self.pos + n].decode("latin-1")
        self.pos += n
        return s

    def lstr(self) -> str:
        n = self.u32()
        s = self.data[self.pos:self.pos + n].decode("latin-1")
        self.pos += n
        return s

    def wstr(self) -> str:
        n = self.u32()
        s = self.data[self.pos:self.pos + 2 * n].decode("utf-16-le", "replace")
        self.pos += 2 * n
        return s

    def sym(self) -> str:
        i = self.u16()
        if i == 0:
            return ""
        return self.table[i]

    # -- structure ----------------------------------------------------------
    def read_header(self) -> None:
        self.table = [""]  # index 0 is the empty string
        first = self.pstr()
        if first != MAGIC:
            raise ValueError(f"not a MemeFile 2.0 stream: {first!r}")
        self.table.append(first)
        while True:
            s = self.pstr()
            if not s:
                break
            self.table.append(s)
        # `MemeFile 2.0` occupies slot 1 in the on-disk table only as the
        # version string; the writer's registry starts after it, so the
        # first class name is index 1. Drop the magic to line the two up.
        del self.table[1]

    def read_root(self) -> Obj:
        self.read_header()
        cls = self.sym()
        obj = Obj(cls=self._short(cls), offset=self.pos)
        self.read_fields(obj, self.pos, len(self.data))
        return obj

    @staticmethod
    def _short(cls: str) -> str:
        return cls[12:] if cls.startswith("dice::meme::") else cls

    def read_obj(self) -> Obj | Ref | None:
        start = self.pos
        size = self.u32()
        end = start + size
        name = self.sym()
        cls = self.sym()
        if not cls:
            self.pos = end
            return Ref(name) if name else None
        obj = Obj(cls=self._short(cls), name=name, offset=start, size=size)
        if name:
            self.named[name] = obj
        self.read_fields(obj, self.pos, end)
        return obj

    def read_fields(self, obj: Obj, start: int, end: int) -> None:
        schema = SCHEMAS.get(obj.cls)
        if schema is None:
            # Unknown class: every *Node starts with its sibling pointer,
            # which we must follow or lose the rest of the list.
            schema = SCHEMAS["Node"] if obj.is_node else []
            self.warnings.append(f"no schema for {obj.cls} at {start}")
        for label, kind in schema:
            # OBJ_LIST reads however many frames remain - zero is a valid,
            # common answer (an ActionListAction with nothing in it yet) -
            # so it runs even when a truncated/older-format frame has
            # already left no room for anything else in the schema.
            if self.pos >= end and kind != OBJ_LIST:
                break
            if kind == OBJ:
                obj.fields[label] = self.read_obj()
            elif kind == OBJ_LIST:
                # +0x58: object frames back to back, no count, until this
                # object's own frame ends (ActionListAction's "Action list").
                items = []
                while self.pos < end:
                    items.append(self.read_obj())
                obj.fields[label] = items
            elif kind == F32:
                obj.fields[label] = self.f32()
            elif kind == BOOL:
                obj.fields[label] = bool(self.u8())
            elif kind in (INT, EVENT):
                obj.fields[label] = self.u32()
            elif kind == EVENT8:
                obj.fields[label] = self.u8()
            elif kind == STR:
                obj.fields[label] = self.lstr()
            elif kind == WSTR:
                obj.fields[label] = self.wstr()
            elif kind == PSTR:
                obj.fields[label] = self.pstr()
            else:
                raise ValueError(kind)
        if self.pos != end:
            msg = (f"{obj.cls} at {start}: read {self.pos - start} of {end - start} bytes")
            if self.strict and self.pos > end:
                raise ValueError(msg)
            self.warnings.append(msg)
        self.pos = end


def load(data: bytes, strict: bool = False) -> tuple[Obj, MemeReader]:
    reader = MemeReader(data, strict=strict)
    return reader.read_root(), reader


def walk_all(root: Obj):
    """Every node in the file: the root's sibling chain and their subtrees.
    The root is the head of a list, not a container."""
    for top in root.chain():
        yield from top.walk()


def find(root: Obj, name: str) -> Obj | None:
    for node in walk_all(root):
        if node.name == name:
            return node
    return None
