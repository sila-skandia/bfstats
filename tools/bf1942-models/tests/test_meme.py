from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import meme  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
GAME_MENU = GAME_DIR / "Mods/bf1942/Archives/menu.rfa"


def installed_menu_archives() -> list[tuple[str, Path]]:
    """(mod name, archive path) for every `menu*.rfa` under every installed
    mod - base and patches both, the way MEME-11's "16 installed menu.rfa
    archives" / "230 pages" were counted."""
    from bf42.rfa import find_archives_dir

    out = []
    mods_dir = GAME_DIR / "Mods"
    if not mods_dir.is_dir():
        return out
    for mod_dir in sorted(mods_dir.iterdir()):
        if not mod_dir.is_dir():
            continue
        archives = find_archives_dir(mod_dir)
        if archives is None:
            continue
        for child in sorted(archives.iterdir()):
            if (child.is_file() and child.suffix.lower() == ".rfa"
                    and (child.stem.lower() == "menu" or child.stem.lower().startswith("menu_"))):
                out.append((mod_dir.name, child))
    return out


def installed_menu_pages() -> list[tuple[str, str, str, bytes]]:
    """(mod name, archive filename, entry name, data) for every extensionless
    entry across `installed_menu_archives()` whose content is a MemeFile 2.0
    stream (some extensionless entries in these archives are not - e.g. RTF
    text)."""
    from bf42.rfa import RfaArchive

    magic = bytes([len(meme.MAGIC)]) + meme.MAGIC.encode("latin-1")
    pages = []
    for mod_name, path in installed_menu_archives():
        with RfaArchive(path) as arch:
            for entry in arch.entries:
                if "." in entry.rsplit("/", 1)[-1]:
                    continue
                data = arch.read(entry)
                if data.startswith(magic):
                    pages.append((mod_name, path.name, entry, data))
    return pages


def pstr(s: str) -> bytes:
    return bytes([len(s)]) + s.encode("latin-1")


class Stream:
    """Writes a MemeFile the way `dice::meme::ClassOStream` does: symbols
    first-use numbered from 1, object frames sized from the size field."""

    def __init__(self) -> None:
        self.symbols: list[str] = []
        self.body = bytearray()

    def sym(self, name: str) -> bytes:
        if not name:
            return b"\0\0"
        if name not in self.symbols:
            self.symbols.append(name)
        return struct.pack("<H", self.symbols.index(name) + 1)

    def frame(self, name: str, cls: str, fields: bytes) -> bytes:
        inner = self.sym(name) + self.sym(cls) + fields
        return struct.pack("<I", 4 + len(inner)) + inner

    NULL = struct.pack("<IHH", 8, 0, 0)

    def file(self, root_cls: str, fields: bytes) -> bytes:
        root = self.sym(root_cls) + fields
        table = pstr("MemeFile 2.0") + b"".join(pstr(s) for s in self.symbols) + b"\0"
        return table + root


class FrameTests(unittest.TestCase):
    def test_transform_picture_round_trip(self) -> None:
        s = Stream()
        # The order matters: the writer numbers symbols as it meets them,
        # and fields are written before the frame that contains them.
        pic = s.frame("", "dice::meme::PictureNode",
                      Stream.NULL + pstr("Ingame/respawn/ingame_respawn_kits_top_256x128.tga"))
        xform = s.frame("Kit/Header", "dice::meme::TransformNode",
                        Stream.NULL + struct.pack("<4f", 0, 57, 256, 128) + pic)
        data = s.file("dice::meme::NameNode", xform)

        root, reader = meme.load(data, strict=True)
        self.assertEqual("NameNode", root.cls)
        node = root["Next node"]
        self.assertEqual("TransformNode", node.cls)
        self.assertEqual("Kit/Header", node.name)
        self.assertEqual((0, 57, 256, 128),
                         (node["X"], node["Y"], node["Width"], node["Height"]))
        self.assertIsNone(node["Next node"])
        [child] = node.children()
        self.assertEqual("PictureNode", child.cls)
        self.assertEqual("Ingame/respawn/ingame_respawn_kits_top_256x128.tga", child["Picture"])
        self.assertEqual(len(data), reader.pos)
        self.assertEqual([], reader.warnings)

    def test_named_reference_and_sibling_chain(self) -> None:
        s = Stream()
        second = s.frame("", "dice::meme::SplitNode", Stream.NULL + Stream.NULL)
        first = s.frame("", "dice::meme::SplitNode", second + Stream.NULL)
        # A name with no class is a reference to something registered earlier.
        locale = s.frame("Locale/Locale", "", b"")
        node = s.frame("", "dice::meme::BfLocaleNode", first + locale)
        root, _ = meme.load(s.file("dice::meme::NameNode", node), strict=True)

        loc = root["Next node"]
        self.assertEqual("BfLocaleNode", loc.cls)
        self.assertEqual(meme.Ref("Locale/Locale"), loc["Locale"])
        self.assertEqual(["SplitNode", "SplitNode"], [n.cls for n in loc["Next node"].chain()])

    def test_unknown_node_class_still_follows_its_sibling(self) -> None:
        s = Stream()
        tail = s.frame("", "dice::meme::PictureNode", Stream.NULL + pstr("x.tga"))
        odd = s.frame("", "dice::meme::MysteryNode", tail + b"\x01\x02\x03")
        root, reader = meme.load(s.file("dice::meme::NameNode", odd))
        self.assertEqual(["MysteryNode", "PictureNode"],
                         [n.cls for n in root["Next node"].chain()])
        self.assertTrue(any("no schema" in w for w in reader.warnings))

    def test_rejects_other_files(self) -> None:
        with self.assertRaises(ValueError):
            meme.load(pstr("RFA 2.0") + b"\0")


class MemeElevenTests(unittest.TestCase):
    """MEME-11: the event-type byte-width bug, and the ten classes whose
    field lists were unread. Each class here is exercised as the file's
    root, which puts its own frame's `end` at `len(data)` — the same
    boundary `read_fields` checks for every nested frame — so a wrong field
    width or a missing field shows up as leftover bytes or a warning exactly
    the way it would nested in a real page.
    """

    def test_event_type_is_one_byte_button_type_is_four(self) -> None:
        s = Stream()
        fields = struct.pack("<I", 7) + struct.pack("<B", 3) + struct.pack("<I", 9)
        data = s.file("dice::meme::ButtonEvent", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(7, root["Input index"])
        self.assertEqual(3, root["Event type"])
        self.assertEqual(9, root["Button type"])
        self.assertEqual(len(data), reader.pos)

    def test_any_key_event_is_input_index_and_one_byte_event_type(self) -> None:
        s = Stream()
        fields = struct.pack("<I", 2) + struct.pack("<B", 1)
        data = s.file("dice::meme::AnyKeyEvent", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual((2, 1), (root["Input index"], root["Event type"]))
        self.assertEqual(len(data), reader.pos)

    def test_extended_button_event_adds_a_trailing_repeat_count(self) -> None:
        s = Stream()
        fields = (struct.pack("<I", 1) + struct.pack("<B", 2) + struct.pack("<I", 3)
                  + struct.pack("<I", 4))
        data = s.file("dice::meme::ExtendedButtonEvent", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual((1, 2, 3, 4), (root["Input index"], root["Event type"],
                                        root["Button type"], root["Repeat count"]))
        self.assertEqual(len(data), reader.pos)

    def test_action_list_action_reads_every_action_with_no_count(self) -> None:
        s = Stream()
        one = s.frame("", "dice::meme::SetVariableAction", Stream.NULL + Stream.NULL)
        two = s.frame("", "dice::meme::CallFunctionAction", Stream.NULL + Stream.NULL)
        data = s.file("dice::meme::ActionListAction", one + two)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(["SetVariableAction", "CallFunctionAction"],
                         [a.cls for a in root["Actions"]])
        self.assertEqual(len(data), reader.pos)

    def test_action_list_action_can_be_empty(self) -> None:
        s = Stream()
        root, reader = meme.load(s.file("dice::meme::ActionListAction", b""), strict=True)

        self.assertEqual([], root["Actions"])
        self.assertEqual([], reader.warnings)

    def test_call_function_action_reads_result_data(self) -> None:
        s = Stream()
        fn = s.frame("Sound/PlayMenuOk", "", b"")  # a name-only reference
        data = s.file("dice::meme::CallFunctionAction", fn + Stream.NULL)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(meme.Ref("Sound/PlayMenuOk"), root["Function"])
        self.assertIsNone(root["Result data"])
        self.assertEqual(len(data), reader.pos)

    def test_cull_event_action_node_reads_trailing_event(self) -> None:
        s = Stream()
        event = s.frame("", "dice::meme::TypeEvent",
                        struct.pack("<I", 0) + struct.pack("<B", 5))
        data = s.file("dice::meme::CullEventActionNode", Stream.NULL + Stream.NULL + event)

        root, reader = meme.load(data, strict=True)

        self.assertEqual("TypeEvent", root["Event"].cls)
        self.assertEqual(5, root["Event"]["Event type"])
        self.assertEqual(len(data), reader.pos)

    def test_cull_variable_and_event_action_node_field_order(self) -> None:
        s = Stream()
        data = s.file("dice::meme::CullVariableAndEventActionNode",
                      Stream.NULL + Stream.NULL + Stream.NULL + Stream.NULL)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(["Next node", "Action", "Variable", "Event"], list(root.fields))
        self.assertEqual(len(data), reader.pos)

    def test_set_path_action_field_order_and_types(self) -> None:
        s = Stream()
        fields = (Stream.NULL + Stream.NULL
                  + struct.pack("<4f", 1.0, 0.5, 0.0, 0.25) + struct.pack("<B", 1))
        data = s.file("dice::meme::SetPathAction", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual((1.0, 0.5, 0.0, 0.25, True),
                         (root["In time"], root["Out time"], root["In wait time"],
                          root["Out wait time"], root["Paint outnode over innode"]))
        self.assertEqual(len(data), reader.pos)

    def test_remove_event_action_has_no_fields(self) -> None:
        s = Stream()
        root, reader = meme.load(s.file("dice::meme::RemoveEventAction", b""), strict=True)

        self.assertEqual({}, root.fields)
        self.assertEqual([], reader.warnings)

    def test_index_data_data_field_order(self) -> None:
        s = Stream()
        data = s.file("dice::meme::IndexDataData", Stream.NULL + Stream.NULL)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(["Data", "Index"], list(root.fields))
        self.assertEqual(len(data), reader.pos)

    def test_bf_navigation_button_node_field_order_and_types(self) -> None:
        s = Stream()
        fields = (
            Stream.NULL  # Next node
            + pstr("kits/tab_up.tga") + pstr("kits/tab_over.tga") + pstr("kits/tab_down.tga")
            + Stream.NULL  # Action
            + struct.pack("<B", 1)  # MouseOver button
            + struct.pack("<I", 2)  # Index
            + Stream.NULL + Stream.NULL + Stream.NULL  # the three live-state fields
            + struct.pack("<2f", 64.0, 32.0)  # Width, Height - read last
        )
        data = s.file("dice::meme::BfNavigationButtonNode", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual("kits/tab_up.tga", root["Picture"])
        self.assertEqual("kits/tab_down.tga", root["Clicked picture"])
        self.assertTrue(root["MouseOver button"])
        self.assertEqual(2, root["Index"])
        self.assertEqual((64.0, 32.0), (root["Width"], root["Height"]))
        self.assertEqual(len(data), reader.pos)


class SingleplayerClassTests(unittest.TestCase):
    """The five classes the Singleplayer pages need, settled the way MEME-11
    prescribes: the class-name string, its registrar, the ClassInfo vtable's
    +0x08 `createInstance`, the constructor it tail-calls, and that object's
    own vtable +0x30 `read`.

    | class | name string | registrar | ClassInfo vt | createInstance | ctor | object vt | read |
    |---|---|---|---|---|---|---|---|
    | BfNewListBoxNode | 0x0093cbac | 0x007cfd05 | 0x0093ca64 | 0x007d4160 | 0x007d1200 | 0x0093cde8 | 0x007cfeb0 |
    | BfEditNodeInt | 0x0093f850 | 0x007dfd85 | 0x0093f668 | 0x007dfd50 | 0x007df490 | 0x0093f770 | 0x007dfff0 |
    | BfSliderNode | 0x0093d860 | 0x007d7b75 | 0x0093d758 | 0x007d8230 | 0x007ea6d0 | 0x0093d880 | 0x007d7250 |
    | BfFixedSliderNode | 0x0093d948 | 0x007d7ee5 | 0x0093d778 | 0x007d7b00 | 0x007ea6d0 | 0x0093d798 | 0x007d73a0 |
    | BfAddSubEffectNode | 0x0093d380 | 0x007d6045 | 0x0093d170 | 0x007d5ff0 | 0x007d5f40 | 0x0093d1f0 | 0x007d54d0 |
    """

    #: Everything `BfNewListBoxNode::read` consumes after "Border or not".
    LISTBOX_TRAILER = [
        "Background color red", "Background color green",
        "Background color blue", "Background color alpha",
        "Scrollbar width",
        "Frame color red", "Frame color green", "Frame color blue", "Frame color alpha",
        "Select color red", "Select color green", "Select color blue", "Select color alpha",
        "Show tooltip", "Scrollbar offset from border",
    ]

    def test_bf_new_list_box_node_trailing_fields_are_exactly_57_bytes(self) -> None:
        # MEME-11 measured the shortfall as "a constant 57 bytes everywhere
        # it's used" without saying which fields they were. Fourteen floats
        # and one bool is the only reading of 0x007cfeb0 that adds up.
        schema = dict(meme.SCHEMAS["BfNewListBoxNode"])
        widths = {meme.F32: 4, meme.BOOL: 1}
        self.assertEqual(57, sum(widths[schema[label]] for label in self.LISTBOX_TRAILER))

    def test_bf_new_list_box_node_reads_its_whole_frame(self) -> None:
        s = Stream()
        fields = (
            Stream.NULL                                  # Next node
            + Stream.NULL                                # Listbox data
            + pstr("standard6.dif")                      # Font
            + Stream.NULL + Stream.NULL                  # Select action, Focus action
            + pstr("") + pstr("") + pstr("")             # the three sound handles
            + struct.pack("<f", 14.0)                    # Row height
            + struct.pack("<2B", 1, 0)                   # IsSelectable, Border or not
            + struct.pack("<4f", 0.1, 0.2, 0.3, 0.4)     # Background color
            + struct.pack("<f", 10.0)                    # Scrollbar width
            + struct.pack("<4f", 0.5, 0.6, 0.7, 0.8)     # Frame color
            + struct.pack("<4f", 0.9, 1.0, 0.0, 0.5)     # Select color
            + struct.pack("<B", 1)                       # Show tooltip
            + struct.pack("<f", 2.0)                     # Scrollbar offset from border
        )
        data = s.file("dice::meme::BfNewListBoxNode", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual("standard6.dif", root["Font"])
        self.assertEqual(14.0, root["Row height"])
        self.assertTrue(root["IsSelectable"])
        self.assertFalse(root["Border or not"])
        self.assertAlmostEqual(0.4, root["Background color alpha"], places=5)
        self.assertEqual(10.0, root["Scrollbar width"])
        self.assertAlmostEqual(0.9, root["Select color red"], places=5)
        self.assertTrue(root["Show tooltip"])
        self.assertEqual(2.0, root["Scrollbar offset from border"])
        self.assertEqual(len(data), reader.pos)
        self.assertEqual([], reader.warnings)

    def test_bf_new_list_box_node_without_the_trailer_is_57_bytes_short(self) -> None:
        # The bug as it was: the old eleven-field schema against the same
        # bytes leaves exactly the trailer unread.
        s = Stream()
        fields = (
            Stream.NULL + Stream.NULL + pstr("standard6.dif") + Stream.NULL + Stream.NULL
            + pstr("") + pstr("") + pstr("") + struct.pack("<f", 14.0)
            + struct.pack("<2B", 1, 0)
            + struct.pack("<4f", 0, 0, 0, 0) + struct.pack("<f", 10.0)
            + struct.pack("<4f", 0, 0, 0, 0) + struct.pack("<4f", 0, 0, 0, 0)
            + struct.pack("<B", 1) + struct.pack("<f", 2.0)
        )
        data = s.file("dice::meme::BfNewListBoxNode", fields)
        old = meme.SCHEMAS["BfNewListBoxNode"]
        try:
            meme.SCHEMAS["BfNewListBoxNode"] = old[:11]
            _, reader = meme.load(data)
        finally:
            meme.SCHEMAS["BfNewListBoxNode"] = old
        # `read_fields` seeks to the frame end either way, so the shortfall
        # shows up in the warning, which is where it showed up in the real
        # pages too ("BfNewListBoxNode at 3237: read 274 of 331 bytes").
        [warning] = reader.warnings
        read, total = (int(t) for t in warning.split("read ")[1].split(" bytes")[0].split(" of "))
        self.assertEqual(57, total - read)

    def test_bf_edit_node_int_field_order(self) -> None:
        s = Stream()
        fields = (Stream.NULL + pstr("standard6.dif") + Stream.NULL + Stream.NULL
                  + struct.pack("<2i", -1, 100) + Stream.NULL + Stream.NULL
                  + struct.pack("<B", 0))
        data = s.file("dice::meme::BfEditNodeInt", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(
            ["Next node", "Font", "Int", "String", "Min value (-1 = no limit)",
             "Max value (-1 = no limit)", "Select action", "Editbox data", "Focus"],
            list(root.fields))
        self.assertEqual("standard6.dif", root["Font"])
        self.assertEqual(100, root["Max value (-1 = no limit)"])
        self.assertFalse(root["Focus"])
        self.assertEqual(len(data), reader.pos)

    def test_bf_slider_node_field_order(self) -> None:
        s = Stream()
        fields = Stream.NULL + Stream.NULL + Stream.NULL + struct.pack("<3f", 0.0, 100.0, 10.0)
        data = s.file("dice::meme::BfSliderNode", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(["Next node", "Cursor node", "Data", "Minimum value",
                          "Maximum value", "Number visible"], list(root.fields))
        self.assertEqual((0.0, 100.0, 10.0), (root["Minimum value"], root["Maximum value"],
                                              root["Number visible"]))
        self.assertEqual(len(data), reader.pos)

    def test_bf_fixed_slider_node_adds_a_trailing_interval(self) -> None:
        s = Stream()
        fields = (Stream.NULL + Stream.NULL + Stream.NULL
                  + struct.pack("<4f", 0.0, 100.0, 10.0, 5.0))
        data = s.file("dice::meme::BfFixedSliderNode", fields)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(5.0, root["Interval"])
        self.assertEqual(len(data), reader.pos)

    def test_bf_add_sub_effect_node_ends_with_up_and_go(self) -> None:
        # The sibling class BfAddSubNextEffectNode ends Loop / Next action /
        # Reset; this one ends Up / Go, and is one field shorter.
        s = Stream()
        data = s.file("dice::meme::BfAddSubEffectNode", Stream.NULL * 9)

        root, reader = meme.load(data, strict=True)

        self.assertEqual(["Next node", "Value", "End value", "Start time",
                          "Start percentage", "End time", "Delay", "Up", "Go"],
                         list(root.fields))
        self.assertEqual(len(data), reader.pos)


@unittest.skipUnless(GAME_MENU.exists(), "needs the BF1942 install")
class SkirmishMenuTests(unittest.TestCase):
    """The real `menu/SkirmishMenu` - the Instant Battle screen. Before the
    five classes above it left 25 warnings; it now reads to the last byte."""

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        with RfaArchive(GAME_MENU) as arch:
            entry = next(e for e in arch.entries if e.lower() == "menu/skirmishmenu")
            cls.root, cls.reader = meme.load(arch.read(entry))

    def test_reads_to_the_last_byte_with_no_warnings(self) -> None:
        self.assertEqual(len(self.reader.data), self.reader.pos)
        self.assertEqual([], self.reader.warnings)

    def test_the_level_list_box_is_a_bf_new_list_box_node(self) -> None:
        box = next(n for n in meme.walk_all(self.root) if n.cls == "BfNewListBoxNode")
        self.assertEqual("Skirmish/SkirmishLevelsList", box["Listbox data"].name)
        self.assertEqual("standard6.dif", box["Font"])
        self.assertEqual(14.0, box["Row height"])
        self.assertTrue(box["IsSelectable"])
        # The trailing fields the fix added, as the shipped file sets them.
        self.assertFalse(box["Show tooltip"])
        self.assertEqual(0.0, box["Background color alpha"])

    def test_the_three_plates(self) -> None:
        plates = {n["Picture"] for n in meme.walk_all(self.root) if n.cls == "PictureNode"}
        self.assertIn("Menu/menu_creategame_karta_256x128.tga", plates)
        self.assertIn("Menu/menu_singlepl_levellist_256x256.tga", plates)
        self.assertIn("Menu/menu_campaign_team_256x128.tga", plates)


@unittest.skipUnless(GAME_MENU.exists(), "needs the BF1942 install")
class InGameTests(unittest.TestCase):
    """The real `menu/InGame`, against values the spawn screen shows."""

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        with RfaArchive(GAME_MENU) as arch:
            entry = next(e for e in arch.entries if e.lower() == "menu/ingame")
            cls.root, cls.reader = meme.load(arch.read(entry))

    def test_reads_to_the_last_byte(self) -> None:
        self.assertEqual(len(self.reader.data), self.reader.pos)

    def test_virtual_resolution_is_800x600(self) -> None:
        screen = next(n for n in self.root.chain() if n.cls == "TransformNode")
        self.assertEqual((0, 0, 800, 600),
                         (screen["X"], screen["Y"], screen["Width"], screen["Height"]))

    def test_kit_header_plate(self) -> None:
        for node in meme.walk_all(self.root):
            if node.cls == "PictureNode" and "kits_top" in node["Picture"]:
                break
        else:
            self.fail("kits_top picture not found")
        self.assertEqual("Ingame/respawn/ingame_respawn_kits_top_256x128.tga", node["Picture"])

    def test_named_nodes(self) -> None:
        icon = self.reader.named["Kit/Icons/KitIcon1"]
        self.assertEqual("StringData", icon.cls)
        self.assertEqual("kits/Icon_scout_axis_selected.tga", icon["String"])
        self.assertEqual("Trebuchet MS8.dif", self.reader.named["Style/InGameHeading"]["Font handle"])


@unittest.skipUnless(GAME_DIR.is_dir(), "needs the BF1942 install")
class MemeElevenSurveyTests(unittest.TestCase):
    """MEME-11's survey: every page in every installed mod's menu.rfa(s).

    The ledger's target is 228 of 230 pages reading to zero leftover bytes.
    This fix alone does not reach that - other classes this ledger row never
    named (BfCreditsNode, PathNode, BfCenterStyle, DataListData, DisableNode,
    BfBinkNode, PointerXData / PointerYData, BfSelectButtonNode,
    FloatRefData) are still unread and out of this row's and this track's
    scope. What these assertions pin down is narrower and load-bearing:
    nothing this fix touched has regressed, and the specific bug MEME-11
    describes (the Event-type width) is gone everywhere it appears, not just
    in the ten named classes.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.pages = installed_menu_pages()
        if not cls.pages:
            raise unittest.SkipTest("no menu.rfa pages found under the install")
        cls.results = []
        for mod_name, archive_name, entry, data in cls.pages:
            try:
                root, reader = meme.load(data)
            except Exception as exc:  # noqa: BLE001 - recorded, not raised
                cls.results.append((mod_name, archive_name, entry, None, exc))
            else:
                cls.results.append((mod_name, archive_name, entry, reader, None))

    # Classes/behaviour this track's MEME-11 fix is responsible for.
    OWNED = ("ActionListAction", "CallFunctionAction", "CullEventActionNode",
             "CullVariableAndEventActionNode", "SetPathAction", "BfNavigationButtonNode",
             "IndexDataData", "AnyKeyEvent", "ExtendedButtonEvent", "RemoveEventAction",
             "TypeEvent", "ButtonEvent",
             # Added with the Singleplayer pages (SingleplayerClassTests).
             "BfNewListBoxNode", "BfEditNodeInt", "BfSliderNode", "BfFixedSliderNode",
             "BfAddSubEffectNode")

    def test_no_page_desyncs_on_a_class_this_fix_owns(self) -> None:
        offenders = [
            (mod, archive, entry, w)
            for mod, archive, entry, reader, exc in self.results
            if reader is not None
            for w in reader.warnings
            if any(cls in w for cls in self.OWNED)
        ]
        self.assertEqual([], offenders)

    def test_only_the_two_known_open_pages_crash(self) -> None:
        # MEME-11: "menu/InternetMenu and menu/LocalMenu still desync near
        # BfTransformNodeSize, cause open" - this reader hits it as an
        # IndexError (a stream-desync-class symbol overrun) rather than a
        # graceful leftover-bytes warning; still open, not this fix's to
        # solve, but pinned here so a regression elsewhere is not mistaken
        # for it.
        crashed = [(mod, archive, entry, type(exc).__name__)
                  for mod, archive, entry, reader, exc in self.results if exc is not None]
        for mod, archive, entry, exc_name in crashed:
            self.assertIn(entry.rsplit("/", 1)[-1], ("InternetMenu", "LocalMenu"), (mod, archive, entry))
            self.assertEqual("IndexError", exc_name, (mod, archive, entry))

    def test_clean_page_count_has_not_regressed(self) -> None:
        # 11 of 230 before the MEME-11 fix, 80 of 230 after it, and 110 of
        # 230 once the five Singleplayer classes above were added (each
        # count measured directly by deleting the schemas again and
        # re-running this survey). A floor, not the exact count, so the test
        # does not chase whichever mods happen to be installed.
        clean = sum(1 for _, _, _, reader, exc in self.results
                   if exc is None and reader.pos == len(reader.data) and not reader.warnings)
        self.assertGreaterEqual(clean, 100)


if __name__ == "__main__":
    unittest.main()
