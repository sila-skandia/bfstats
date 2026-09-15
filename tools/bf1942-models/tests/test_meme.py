from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import meme  # noqa: E402

GAME_MENU = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods/bf1942/Archives/menu.rfa"


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


if __name__ == "__main__":
    unittest.main()
