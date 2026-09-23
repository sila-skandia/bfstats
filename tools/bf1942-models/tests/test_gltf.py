from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def unpack_glb(data: bytes) -> tuple[dict, bytes]:
    json_length, json_type = struct.unpack_from("<II", data, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(data[20:20 + json_length])
    binary_offset = 20 + json_length
    binary_length, binary_type = struct.unpack_from("<II", data, binary_offset)
    assert binary_type == 0x004E4942
    blob = data[binary_offset + 8:binary_offset + 8 + binary_length]
    return doc, blob


def accessor_floats(doc: dict, blob: bytes, index: int) -> list[float]:
    accessor = doc["accessors"][index]
    view = doc["bufferViews"][accessor["bufferView"]]
    per = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[accessor["type"]]
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return list(struct.unpack_from(
        f"<{accessor['count'] * per}f", blob, offset))


class AnimationEmissionTests(unittest.TestCase):
    """Stance clips: constant keyframes over joint nodes, exported in the
    same Refractor-to-glTF conversion the static node transforms get, so a
    clip whose values equal the node's transform is a render no-op."""

    def _build(self) -> tuple[dict, bytes]:
        builder = gltf.GlbBuilder()
        yaw90 = ((0.0, 0.0, 1.0), (0.0, 1.0, 0.0), (-1.0, 0.0, 0.0))
        node = builder.add_node(gltf.Node(
            "Bip01", translation=(1.0, 2.0, 3.0),
            rotation=gltf.quat_from_matrix(yaw90)))
        builder.add_animation("crouch", [
            (node, (0.0, 1.0),
             [(yaw90, (1.0, 2.0, 3.0)), (yaw90, (1.0, 2.0, 3.0))]),
        ])
        return unpack_glb(builder.build([node]))

    def test_animation_names_channels_and_paths(self) -> None:
        doc, _blob = self._build()

        animations = doc["animations"]
        self.assertEqual(["crouch"], [a["name"] for a in animations])
        targets = [(c["target"]["node"], c["target"]["path"])
                   for c in animations[0]["channels"]]
        self.assertEqual([(0, "rotation"), (0, "translation")], targets)
        for sampler in animations[0]["samplers"]:
            self.assertEqual("LINEAR", sampler["interpolation"])

    def test_input_accessor_has_min_max_and_the_times(self) -> None:
        doc, blob = self._build()

        sampler = doc["animations"][0]["samplers"][0]
        accessor = doc["accessors"][sampler["input"]]
        self.assertEqual([0.0], accessor["min"])
        self.assertEqual([1.0], accessor["max"])
        self.assertEqual([0.0, 1.0], accessor_floats(doc, blob, sampler["input"]))

    def test_keyframes_match_the_static_node_transform_exactly(self) -> None:
        # The whole backwards-compatibility story: node transform and clip
        # value are the same pose, so both must export identically.
        doc, blob = self._build()

        node = doc["nodes"][0]
        rot_sampler, pos_sampler = doc["animations"][0]["samplers"]
        rotations = accessor_floats(doc, blob, rot_sampler["output"])
        positions = accessor_floats(doc, blob, pos_sampler["output"])
        for frame in (0, 1):
            for got, want in zip(rotations[frame * 4:frame * 4 + 4],
                                 node["rotation"]):
                self.assertAlmostEqual(want, got, places=6)
            for got, want in zip(positions[frame * 3:frame * 3 + 3],
                                 node["translation"]):
                self.assertAlmostEqual(want, got, places=6)

    def test_translation_z_is_mirrored_like_node_translations(self) -> None:
        doc, blob = self._build()

        pos_sampler = doc["animations"][0]["samplers"][1]
        positions = accessor_floats(doc, blob, pos_sampler["output"])
        self.assertAlmostEqual(-3.0, positions[2], places=6)

    def test_no_animations_key_when_none_added(self) -> None:
        builder = gltf.GlbBuilder()
        node = builder.add_node(gltf.Node("solo"))
        doc, _blob = unpack_glb(builder.build([node]))
        self.assertNotIn("animations", doc)


class MaterialExtrasTests(unittest.TestCase):
    """Material extras flags: additive, textureFade, envmap."""

    def test_envmap_flag_in_extras(self) -> None:
        builder = gltf.GlbBuilder()
        texture_idx = builder.add_image_png(b"PNG", name="test.png")
        mat_idx = builder.add_material(
            name="zero_canopy_m1_Material0",
            texture=texture_idx,
            double_sided=True,
            envmap=True,
        )
        node_idx = builder.add_node(gltf.Node("test"))
        doc, _blob = unpack_glb(builder.build([node_idx]))

        material = doc["materials"][mat_idx]
        self.assertEqual("zero_canopy_m1_Material0", material["name"])
        self.assertTrue(material["doubleSided"])
        self.assertIn("extras", material)
        self.assertTrue(material["extras"]["envmap"])

    def test_envmap_false_omits_extras(self) -> None:
        builder = gltf.GlbBuilder()
        texture_idx = builder.add_image_png(b"PNG", name="test.png")
        mat_idx = builder.add_material(
            name="standard_material",
            texture=texture_idx,
            envmap=False,
        )
        node_idx = builder.add_node(gltf.Node("test"))
        doc, _blob = unpack_glb(builder.build([node_idx]))

        material = doc["materials"][mat_idx]
        self.assertNotIn("extras", material)

    def test_additive_and_texture_fade_coexist_with_envmap(self) -> None:
        builder = gltf.GlbBuilder()
        texture_idx = builder.add_image_png(b"PNG", name="test.png")
        # Test additive + envmap together (though unlikely in practice)
        mat_idx = builder.add_material(
            name="multi_extras",
            texture=texture_idx,
            additive=True,
            envmap=True,
        )
        node_idx = builder.add_node(gltf.Node("test"))
        doc, _blob = unpack_glb(builder.build([node_idx]))

        material = doc["materials"][mat_idx]
        self.assertIn("extras", material)
        self.assertTrue(material["extras"]["additive"])
        self.assertTrue(material["extras"]["envmap"])

    def test_envmap_keeps_blend(self) -> None:
        # `1p_Willy_Hul_M1_Material1` verbatim: `transparent true; envmap true;`
        # on the katy_window_I windscreen. Exported without BLEND the dirty
        # glass paints solid over the road.
        builder = gltf.GlbBuilder()
        texture_idx = builder.add_image_png(b"PNG", name="katy_window_I.png")
        mat_idx = builder.add_material(
            name="1p_Willy_Hul_M1_Material1",
            texture=texture_idx,
            blend=True,
            envmap=True,
        )
        node_idx = builder.add_node(gltf.Node("test"))
        doc, _blob = unpack_glb(builder.build([node_idx]))

        material = doc["materials"][mat_idx]
        self.assertEqual("BLEND", material["alphaMode"])
        self.assertTrue(material["extras"]["envmap"])

    def test_envmap_keeps_mask(self) -> None:
        builder = gltf.GlbBuilder()
        texture_idx = builder.add_image_png(b"PNG", name="test.png")
        mat_idx = builder.add_material(
            name="cutout_with_envmap",
            texture=texture_idx,
            alpha_cutoff=0.5,
            envmap=True,
        )
        node_idx = builder.add_node(gltf.Node("test"))
        doc, _blob = unpack_glb(builder.build([node_idx]))

        material = doc["materials"][mat_idx]
        self.assertEqual("MASK", material["alphaMode"])
        self.assertEqual(0.5, material["alphaCutoff"])
        self.assertTrue(material["extras"]["envmap"])

    def test_envmap_alone_stays_opaque(self) -> None:
        builder = gltf.GlbBuilder()
        texture_idx = builder.add_image_png(b"PNG", name="test.png")
        mat_idx = builder.add_material(
            name="1p_yak9_M1_Material0", texture=texture_idx, envmap=True)
        node_idx = builder.add_node(gltf.Node("test"))
        doc, _blob = unpack_glb(builder.build([node_idx]))
        self.assertNotIn("alphaMode", doc["materials"][mat_idx])


if __name__ == "__main__":
    unittest.main()
