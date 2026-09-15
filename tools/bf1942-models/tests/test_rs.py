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
        # The parser reads `alphaTestRef` as the cutoff it is. Keeping it out
        # of the *material* is a separate decision, made by `add_material`:
        # `additive` is tested before `alpha_cutoff`, so a flash stays BLEND
        # whatever cutoff its shader declares.
        self.assertEqual(0.7, shader.alpha_test)

    def test_plain_transparency_is_not_additive(self) -> None:
        shaders = rs.parse(
            'shader "Material4" { transparent true; texture "texture/x"; }')
        self.assertFalse(rs.lookup(shaders, "Material4").additive)

    def test_lighting_false_marks_the_surface_as_its_own_light(self) -> None:
        # Verbatim from TLight_m1.rs, the tracer streak: unlit and additive.
        shaders = rs.parse(
            """
subshader "Tlight_m1_Material1" "StandardMesh/Default" {
  lighting false;
  transparent true;
  blendSrc sourceAlpha;
  blendDest one;
  depthWrite false;
  alphaTestRef 0.7;
  texture "texture/tracklight_s";
}
"""
        )
        shader = rs.lookup(shaders, "Tlight_m1_Material1")
        self.assertFalse(shader.lighting)
        self.assertTrue(shader.additive)

    def test_lighting_defaults_true_and_specular_does_not_clear_it(self) -> None:
        # `lightingSpecular` starts with the same eight characters; a sloppy
        # pattern would read its value as `lighting`'s and unlit the mesh.
        shaders = rs.parse(
            """
subshader "tracklight_m1_Material0" "StandardMesh/Default" {
  lighting true;
  lightingSpecular true;
  materialDiffuse 1 1 1;
  texture "texture/tracklight_o";
}
"""
        )
        self.assertTrue(rs.lookup(shaders, "tracklight_m1_Material0").lighting)
        # And a shader that says nothing is lit, which is the common case.
        silent = rs.parse('shader "Material4" { texture "texture/x"; }')
        self.assertTrue(rs.lookup(silent, "Material4").lighting)

    def test_alpha_test_ref_is_the_other_spelling(self) -> None:
        # `standardMesh/*.rs` writes the D3D reference value on its own and
        # leaves the comparison implied. Missing it is how a scout helmet's
        # foliage net became a solid sheet: the block never says
        # `transparent true` either, so there was nothing else to key off.
        shaders = rs.parse(
            """
subshader "Brit_Scouthelm_m1_Material1" "StandardMesh/Default" {
  alphaTestRef 0.7;
  texture "texture/brit_scouthelm";
}
"""
        )
        self.assertEqual(
            rs.lookup(shaders, "Brit_Scouthelm_m1_Material1").alpha_test, 0.7)

    def test_operator_spelling_still_wins_over_ref(self) -> None:
        # A block carrying both is the explicit form plus a leftover; the
        # operator spelling is the one with the comparison in it.
        shaders = rs.parse(
            'shader "M" { alphaTest greater 0.8; alphaTestRef 0.2; }')
        self.assertEqual(rs.lookup(shaders, "M").alpha_test, 0.8)

    def test_texture_fade_is_read(self) -> None:
        # The darkness plane in every building doorway: vanilla declares
        # `textureFade true` on 69 shaders, all of them texture/black_o.
        # Exported without the flag it renders as an opaque black door.
        shaders = rs.parse(
            """
subshader "pacificfarm1_m1_Material4" "StandardMesh/Default" {
  lighting true;
  textureFade true;
  texture "texture/black_o";
}
"""
        )
        shader = rs.lookup(shaders, "Material4")
        self.assertTrue(shader.texture_fade)
        self.assertFalse(rs.parse('shader "M" { texture "texture/x"; }')
                         ["m"].texture_fade)


if __name__ == "__main__":
    unittest.main()
