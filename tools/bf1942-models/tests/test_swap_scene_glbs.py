from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import swap_scene_glbs as s  # noqa: E402


def glb(uris: list[str], marker: bytes) -> bytes:
    doc = json.dumps({"asset": {"version": "2.0"}, "images": [{"uri": u} for u in uris]}).encode()
    doc += b" " * (-len(doc) % 4)
    return (b"glTF" + struct.pack("<II", 2, 20 + len(doc)) + struct.pack("<I", len(doc))
            + b"JSON" + doc + marker)


class SwapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.scratch = root / "mesh" / "maps" / "mods" / "xpack2"
        self.tree = root / "viewer" / "maps" / "mods" / "xpack2"
        self.store, self.scratch_store = root / "viewer" / "textures", root / "mesh" / "textures"
        for d in (self.scratch / "essen", self.scratch / "truk", self.tree / "essen",
                  self.tree / "truk", self.store, self.scratch_store):
            d.mkdir(parents=True)
        (self.tree / "essen" / "scene.json").write_text('{"patched": true}')
        for level, mark in (("essen", b"old1"), ("truk", b"old2")):
            (self.tree / level / "scene.glb").write_bytes(glb([], mark))
            (self.tree / level / "scene.glb.gz").write_bytes(b"gz" + mark)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def bake(self, level: str, uris: list[str], marker: bytes) -> None:
        (self.scratch / level / "scene.glb").write_bytes(glb(uris, marker))
        (self.scratch / level / "scene.glb.gz").write_bytes(b"gz" + marker)
        (self.scratch / level / "scene.json").write_text('{"fresh": true}')

    def test_only_the_glb_and_its_gz_move_and_the_old_one_is_kept(self) -> None:
        tex = "../../../../textures/aa/t.webp"
        (self.scratch_store / "aa").mkdir()
        (self.scratch_store / "aa" / "t.webp").write_bytes(b"w")
        self.bake("essen", [tex], b"new1")
        self.bake("truk", [], b"old2")   # identical glb: left alone
        link = self.tree / "essen" / "mirror.glb"
        link.hardlink_to(self.tree / "essen" / "scene.glb")
        backup = Path(self.tmp.name) / "bk"

        dry = s.swap(self.scratch, self.tree, self.store, self.scratch_store)
        self.assertEqual(["essen"], dry["swapped"])
        self.assertFalse((self.store / "aa" / "t.webp").exists())

        s.swap(self.scratch, self.tree, self.store, self.scratch_store, apply=True, backup=backup)
        self.assertEqual(b"new1", (self.tree / "essen" / "scene.glb").read_bytes()[-4:])
        self.assertEqual(b"gznew1", (self.tree / "essen" / "scene.glb.gz").read_bytes())
        self.assertEqual(b"new1", link.read_bytes()[-4:], "through the inode")
        self.assertEqual('{"patched": true}', (self.tree / "essen" / "scene.json").read_text())
        self.assertTrue((self.store / "aa" / "t.webp").is_file())
        self.assertEqual(b"old1", (backup / "essen" / "scene.glb").read_bytes()[-4:])

    def test_a_glb_naming_a_texture_nobody_has_is_not_installed(self) -> None:
        self.bake("essen", ["../../../../textures/zz/gone.webp"], b"new1")
        out = s.swap(self.scratch, self.tree, self.store, self.scratch_store, apply=True)
        self.assertEqual([], out["swapped"])
        self.assertEqual(["essen: zz/gone.webp"], out["texturesNowhere"])
        self.assertEqual(b"old1", (self.tree / "essen" / "scene.glb").read_bytes()[-4:])


if __name__ == "__main__":
    unittest.main()
