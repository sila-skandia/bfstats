from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import rs  # noqa: E402


class RenderShaderTests(unittest.TestCase):
    def test_object_shader_uses_first_texture_stage_and_bare_suffix(self) -> None:
        shaders = rs.parse(
            """
shader "Material4" {
  twosided true;
  technique {
    pass {
      stage { texture "texture/sherBO_f"; }
      stage { texture "texture/sherBO_detail"; }
    }
  }
}
"""
        )

        shader = rs.lookup(shaders, "Sherman_TrackL_M1_Material4")

        self.assertEqual("texture/sherBO_f", shader.base_texture)
        self.assertEqual(
            ["texture/sherBO_f", "texture/sherBO_detail"],
            shader.textures,
        )
        self.assertTrue(shader.twosided)

    def test_standard_mesh_subshader_matches_full_material_name(self) -> None:
        shaders = rs.parse(
            """
subshader "Sherman_Hull_M1_Material0" "StandardMesh/Default" {
  texture "texture\\sherma_I";
  transparent true;
  alphaTest greater 0.5;
  cullMode none;
}
"""
        )

        shader = rs.lookup(shaders, "Sherman_Hull_M1_Material0")

        self.assertEqual("texture/sherma_I", shader.base_texture)
        self.assertTrue(shader.transparent)
        self.assertTrue(shader.twosided)
        self.assertEqual(0.5, shader.alpha_test)

    def test_additive_blend_pair_is_recognised(self) -> None:
        # Verbatim from MuzzHeavy_m1.rs: the muzzle-flash mesh adds its light.
        shaders = rs.parse(
            """
subshader "MuzzHeavy_m1_Material0" "StandardMesh/Default" {
  transparent true;
  blendSrc sourceAlpha;
  blendDest one;
  twosided true;
  depthWrite false;
  alphaTestRef 0.7;
  texture "texture/MuzzHeavy_o";
}
"""
        )
        shader = rs.lookup(shaders, "MuzzHeavy_m1_Material0")
        self.assertEqual("sourceAlpha", shader.blend_src)
        self.assertEqual("one", shader.blend_dest)
        self.assertTrue(shader.additive)
        # alphaTestRef is not alphaTest: no cutoff may be inferred from it.
        self.assertIsNone(shader.alpha_test)

    def test_plain_transparency_is_not_additive(self) -> None:
        shaders = rs.parse(
            'shader "Material4" { transparent true; texture "texture/x"; }')
        self.assertFalse(rs.lookup(shaders, "Material4").additive)


if __name__ == "__main__":
    unittest.main()
