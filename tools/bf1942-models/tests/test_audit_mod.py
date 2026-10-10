"""`audit_mod.py`: the adversarial audit finds the defects it was written for.

Each test builds a small tree in a temp directory with exactly one planted
defect and asserts the audit names it by cause. No game archives are needed:
the glb-only half of every sub-audit runs without them.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import audit_mod as A  # noqa: E402
from bf42 import gltf  # noqa: E402

NAN = float("nan")
TRI = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]


def glb_with(uvs, material_texture=True, positions=TRI):
    """A one-triangle glb whose material has (or lacks) a texture."""
    b = gltf.GlbBuilder()
    tex = b.add_image_png(b"x", "texture/a.dds") if material_texture else None
    mat = b.add_material("m", texture=tex)
    # NaN is written through `_vec2_accessor`'s sanitiser, so patch the bytes
    # after the fact when a test wants a NaN in the file.
    mesh = b.add_mesh("m", [gltf.Primitive(
        positions=list(positions), indices=[0, 1, 2], uvs=list(uvs), material=mat)])
    node = b.add_node(gltf.Node("n", mesh=mesh))
    return b.build([node])


def with_nan(data: bytes, vertex: int = 1) -> bytes:
    """Overwrite one vertex's UV in the first VEC2 accessor with NaN."""
    n = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + n])
    acc = next(a for a in doc["accessors"] if a["type"] == "VEC2")
    view = doc["bufferViews"][acc["bufferView"]]
    blob_at = 20 + n + 8
    o = blob_at + view.get("byteOffset", 0) + acc.get("byteOffset", 0) + vertex * 8
    out = bytearray(data)
    struct.pack_into("<ff", out, o, NAN, NAN)
    return bytes(out)


def png(width, height, rgba):
    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))
    raw = b"".join(b"\x00" + bytes(rgba) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


class ImageTests(unittest.TestCase):
    def check(self, width, height, rgba):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "t.png"
            p.write_bytes(png(width, height, rgba))
            return A.classify_image(p)

    def test_opaque_white_magenta_and_one_pixel_are_named(self):
        self.assertEqual("texture-opaque-white", self.check(8, 8, (255, 255, 255, 255))[0])
        self.assertEqual("texture-magenta", self.check(8, 8, (255, 0, 255, 255))[0])
        self.assertEqual("texture-1x1", self.check(1, 1, (10, 20, 30, 255))[0])

    def test_a_white_mask_with_alpha_and_a_real_texture_pass(self):
        self.assertIsNone(self.check(8, 8, (255, 255, 255, 128)))
        self.assertIsNone(self.check(8, 8, (90, 120, 60, 255)))

    def test_a_missing_file_is_named(self):
        self.assertEqual("texture-file-missing",
                         A.classify_image(Path("/nonexistent/x.webp"))[0])


class UvTests(unittest.TestCase):
    def verdict(self, data):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "m.glb"
            p.write_bytes(data)
            doc, blob = A.read_glb(p, with_bin=True)
        return A.uv_degenerate(doc, blob, doc["meshes"][0]["primitives"][0])

    def test_a_nan_on_a_drawn_triangle_is_visible(self):
        data = with_nan(glb_with([(0, 0), (1, 0), (0, 1)]))
        self.assertEqual("nan-visible", self.verdict(data))

    def test_a_nan_on_a_zero_area_triangle_is_degenerate(self):
        flat = [(0, 0, 0), (1, 0, 0), (2, 0, 0)]
        data = with_nan(glb_with([(0, 0), (1, 0), (0, 1)], positions=flat))
        self.assertEqual("nan-degenerate", self.verdict(data))

    def test_constant_uvs_and_clean_uvs(self):
        self.assertEqual("constant", self.verdict(
            glb_with([(0.5, 0.5)] * 4, positions=TRI + [(1, 1, 0)])))
        self.assertIsNone(self.verdict(glb_with([(0, 0), (1, 0), (0, 1)])))


class TreeFixture:
    def __enter__(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "models").mkdir()
        (self.root / "maps").mkdir()
        return self

    def __exit__(self, *exc):
        self.tmp.cleanup()

    def tree(self, levels=()):
        return A.Tree("t", self.root / "models", self.root / "maps",
                      self.root / "textures", list(levels))


class PlacementTests(unittest.TestCase):
    def level(self, fx, scene_extra, nodes):
        d = fx.root / "maps" / "lv"
        d.mkdir(parents=True)
        (d / "terrain").mkdir()
        dim = 8
        row = b"".join(b"\x00\x00\x00" for _ in range(dim))   # flat at 0 m
        raw = b"".join(b"\x00" + row for _ in range(dim))
        def chunk(tag, payload):
            return (struct.pack(">I", len(payload)) + tag + payload
                    + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))
        (d / "terrain" / "heightmap.png").write_bytes(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", dim, dim, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
        scene = {"level": "lv", "worldSize": 32.0, "waterLevel": -50.0,
                 "heightmap": {"image": "terrain/heightmap.png", "dim": dim,
                               "spacing": 4.0, "heightUnits": 100.0},
                 "objectSpawns": [], "soldierSpawns": [], "controlPoints": []}
        scene.update(scene_extra)
        (d / "scene.json").write_text(json.dumps(scene))
        b = gltf.GlbBuilder()
        mesh = b.add_mesh("box", [gltf.Primitive(
            positions=[(-1, 0, -1), (1, 0, -1), (0, 2, 1)], indices=[0, 1, 2])])
        roots = [b.add_node(gltf.Node(name, translation=pos, mesh=mesh,
                                      extras={"templateKind": "SimpleObject"}))
                 for name, pos in nodes]
        (d / "scene.glb").write_bytes(b.build(roots))

    def run_audit(self, scene_extra, nodes):
        with TreeFixture() as fx:
            self.level(fx, scene_extra, nodes)
            return A.audit_placement(fx.tree(["lv"]), A.Game(""), {})

    def test_a_static_in_the_air_a_stacked_duplicate_and_one_outside(self):
        found = self.run_audit({}, [
            # Refractor coordinates: the builder mirrors z into the glb
            ("floater", (16, 40.0, 16)),       # 40 m up, nothing under it
            ("twin", (8, 0.0, 8)), ("twin", (8, 0.0, 8)),
            ("far", (500, 0.0, 8)),
            ("fine", (24, 0.0, 24))])
        causes = {(f.cause, f.subject) for f in found}
        self.assertIn(("static-floating", "floater"), causes)
        self.assertIn(("object-stacked-duplicate", "twin"), causes)
        self.assertIn(("object-outside-world", "far"), causes)
        self.assertFalse([f for f in found if f.subject == "fine"])

    def test_a_static_resting_on_another_is_supported(self):
        found = self.run_audit({}, [("mid", (16, 3.5, 16)),
                                    ("roof", (16, 7.0, 16))])
        self.assertFalse([f for f in found if f.cause == "static-floating"])


class SoundFileTests(unittest.TestCase):
    def test_a_layer_whose_sample_is_not_in_the_tree_is_named(self):
        with TreeFixture() as fx:
            shared = fx.root / "maps" / "_shared"
            (shared / "sounds").mkdir(parents=True)
            (shared / "sounds" / "ok.mp3").write_bytes(b"x")
            (shared / "vehicle-sounds.json").write_text(json.dumps({"vehicles": [
                {"template": "T", "layers": [
                    {"file": "../_shared/sounds/ok.mp3"},
                    {"file": "../_shared/sounds/gone.mp3"}], "weapons": []}]}))
            found = A.audit_sound(fx.tree(), A.Game(""), {})
        self.assertEqual(["layer-file-missing"], [f.cause for f in found])
        self.assertIn("gone.mp3", found[0].detail)


class AuthoredPositionTests(unittest.TestCase):
    class _Arc:
        entries = {"bf1942/levels/Lv/StaticObjects.con": 1,
                   "bf1942/levels/Lv/Other.txt": 1}

        def read(self, en):
            return (b"Object.create crate\r\n"
                    b"Object.absolutePosition 351.48/253.492/1443.32\r\n"
                    b"rem Object.absolutePosition 10/20/30\r\n")

    def test_scripts_positions_are_keyed_by_scene_xz_and_rem_is_skipped(self):
        got = A.authored_positions(self._Arc())
        self.assertEqual({(351.5, 1443.3)}, set(got))
        x, y, src = got[(351.5, 1443.3)]
        self.assertAlmostEqual(253.492, y)
        self.assertEqual("StaticObjects.con:2", src)


class ReportTests(unittest.TestCase):
    def test_only_findings_outside_accepted_fail_the_run(self):
        ok = [A.Finding("textures", "uv-constant", "x.glb")]
        bad = [A.Finding("textures", "uv-nan-visible", "x.glb")]
        import contextlib
        import io
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(0, A.report(ok, {}, ["textures"]))
            self.assertEqual(1, A.report(bad, {}, ["textures"]))


if __name__ == "__main__":
    unittest.main()
