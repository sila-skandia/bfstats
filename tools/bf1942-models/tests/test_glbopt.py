from __future__ import annotations

import io
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, glbopt  # noqa: E402


def png(pixels: bytes, size=(4, 4), mode="RGBA") -> bytes:
    out = io.BytesIO()
    Image.frombytes(mode, size, pixels).save(out, "PNG")
    return out.getvalue()


# A transparent texel carrying bled colour, which a lossy or non-`exact` encode drops.
CHECKER = bytes(v for i in range(16) for v in ((200, 10, 30, 0) if i % 3 == 0 else (i * 9, 255 - i, 40, 255)))
OPAQUE = bytes(v for i in range(16) for v in (i * 15, 90, 200, 255))


def textured_glb(images: list[tuple[bytes, str]]) -> bytes:
    builder = gltf.GlbBuilder()
    textures = [builder.add_image_png(data, name) for data, name in images]
    materials = [builder.add_material(f"m{i}", texture=t) for i, t in enumerate(textures)]
    prims = [gltf.Primitive(positions=[(0, 0, 0), (1, 0, 0), (0, 1, 0)],
                            normals=[(0, 0, 1)] * 3, uvs=[(0, 0), (1, 0), (0, 1)],
                            indices=[0, 1, 2], material=m) for m in materials]
    mesh = builder.add_mesh("quad", prims)
    root = builder.add_node(gltf.Node("root", mesh=mesh))
    return builder.build([root], extras={"level": "test"})


class ExternaliseImagesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.store = glbopt.TextureStore(self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def stored_pixels(self, glb_path: Path, doc: dict, index: int) -> Image.Image:
        glb_path.parent.mkdir(parents=True, exist_ok=True)  # `..` needs a real directory
        image = Image.open(glb_path.parent / doc["images"][index]["uri"])
        image.load()
        return image

    def test_images_move_to_the_store_with_every_texel_kept(self) -> None:
        data = textured_glb([(png(CHECKER), "texture/a.dds"), (png(OPAQUE), "texture/b.dds")])
        glb_path = self.root / "maps" / "level" / "scene.glb"
        out, result = glbopt.externalise_images(data, glb_path, self.store)
        doc, _ = glbopt.read_glb(out)

        self.assertTrue(result.changed)
        self.assertLess(len(out), len(data))
        self.assertEqual(["texture/a.dds", "texture/b.dds"], [i["name"] for i in doc["images"]])
        for image in doc["images"]:
            self.assertNotIn("bufferView", image)
            self.assertTrue(image["uri"].startswith("../../textures/"))
        a = self.stored_pixels(glb_path, doc, 0)
        self.assertEqual(CHECKER, a.convert("RGBA").tobytes())
        b = self.stored_pixels(glb_path, doc, 1)
        self.assertEqual(OPAQUE, b.convert("RGBA").tobytes())

    def test_textures_point_at_the_webp_through_the_extension(self) -> None:
        data = textured_glb([(png(CHECKER), "a")])
        out, _ = glbopt.externalise_images(data, self.root / "models" / "a.glb", self.store)
        doc, _ = glbopt.read_glb(out)
        self.assertEqual([{"sampler": 0, "extensions": {"EXT_texture_webp": {"source": 0}}}],
                         doc["textures"])
        self.assertIn("EXT_texture_webp", doc["extensionsUsed"])
        self.assertIn("EXT_texture_webp", doc["extensionsRequired"])

    def test_geometry_and_everything_else_is_unchanged(self) -> None:
        data = textured_glb([(png(CHECKER), "a"), (png(OPAQUE), "b")])
        out, _ = glbopt.externalise_images(data, self.root / "models" / "a.glb", self.store)
        before, old_blob = glbopt.read_glb(data)
        after, new_blob = glbopt.read_glb(out)
        for key in ("nodes", "meshes", "materials", "scenes", "extras", "samplers"):
            self.assertEqual(before.get(key), after.get(key), key)
        strip = lambda accessors: [{k: v for k, v in a.items() if k != "bufferView"} for a in accessors]
        self.assertEqual(strip(before["accessors"]), strip(after["accessors"]))
        image_views = {i["bufferView"] for i in before["images"]}
        kept = [v for n, v in enumerate(before["bufferViews"]) if n not in image_views]
        self.assertEqual(len(kept), len(after["bufferViews"]))
        for old, new in zip(kept, after["bufferViews"]):
            self.assertEqual(old_blob[old["byteOffset"]:old["byteOffset"] + old["byteLength"]],
                             new_blob[new["byteOffset"]:new["byteOffset"] + new["byteLength"]])

    def test_one_image_in_two_files_is_one_stored_file(self) -> None:
        data = textured_glb([(png(CHECKER), "a")])
        first, r1 = glbopt.externalise_images(data, self.root / "maps" / "x" / "scene.glb", self.store)
        second, r2 = glbopt.externalise_images(data, self.root / "models" / "mods" / "p" / "a.glb", self.store)
        self.assertEqual(r1.stored, r2.stored)
        self.assertEqual(1, len(r1.written))
        self.assertEqual([], r2.written)
        self.assertEqual(1, len(list(self.store.root.rglob("*.webp"))))

    def test_a_second_run_changes_nothing(self) -> None:
        data = textured_glb([(png(CHECKER), "a")])
        path = self.root / "models" / "a.glb"
        out, _ = glbopt.externalise_images(data, path, self.store)
        again, result = glbopt.externalise_images(out, path, self.store)
        self.assertFalse(result.changed)
        self.assertEqual(out, again)

    def test_a_stored_file_with_other_pixels_is_refused(self) -> None:
        data = textured_glb([(png(CHECKER), "a")])
        out, result = glbopt.externalise_images(data, self.root / "models" / "a.glb", self.store)
        self.store.path(result.stored[0]).write_bytes(glbopt.encode_webp(
            Image.frombytes("RGBA", (4, 4), OPAQUE)))
        with self.assertRaises(ValueError):
            glbopt.externalise_images(data, self.root / "models" / "b.glb", self.store)

    def test_a_glb_with_no_images_is_left_alone(self) -> None:
        builder = gltf.GlbBuilder()
        data = builder.build([builder.add_node(gltf.Node("root"))])
        out, result = glbopt.externalise_images(data, self.root / "models" / "a.glb", self.store)
        self.assertIs(out, data)
        self.assertFalse(result.changed)


if __name__ == "__main__":
    unittest.main()
