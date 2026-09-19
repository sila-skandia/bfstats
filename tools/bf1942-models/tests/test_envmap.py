"""`viewer/envmap.js` -- the `envmap true` stage, driven headless by
`envmap_harness.mjs`.

The module is deliberately free of `three`: it is the two predicates that
decide whether a material binds, plus the GLSL text that reproduces texture
stage 1 of `StandardMeshSubShader_applyRenderState` (0x005bf690, branch
0x005bfa80-0x005bfdc4). So the file the page loads is the file tested here,
byte for byte, with no WebGL and no assets.

The engine facts these tests pin, all read out of the retail client:

  * the reflection vector is D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR (0x30000,
    written at 0x005bfaf7), i.e. CAMERA space, not world space;
  * stage 1's colour op is D3DTOP_BLENDCURRENTALPHA (0x10, 0x005bfcc6) with
    Arg1 = D3DTA_CURRENT (0x005bfce1) and Arg2 = D3DTA_TEXTURE (0x005bfcf2),
    which is `Arg1 * A + Arg2 * (1 - A)`;
  * A is the alpha out of stage 0, and stage 0's alpha op is set once for the
    whole StandardMesh path at 0x005c0201 to
    SELECTARG1(D3DTA_TEXTURE) -- so A is the diffuse texture's own alpha and
    the reflection strength is `1 - alpha`, per texel, with no constant
    anywhere in the stage;
  * the whole branch is gated on the level cubemap being loaded
    (`ctx+0x18 != NULL`, 0x005bfa8b), so a level that ships no faces draws its
    envmap materials plain.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("envmap_harness.mjs")
MODULES = {"envmap.js": VIEWER / "envmap.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class EnvmapModuleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # ---- which materials bind -------------------------------------------

    def test_only_the_exporters_flag_binds(self) -> None:
        wants = self.results["wants"]
        self.assertTrue(wants["flagged"])
        self.assertFalse(wants["unflagged"])
        self.assertFalse(wants["noUserData"])
        self.assertFalse(wants["nullMaterial"])
        self.assertFalse(wants["explicitFalse"])

    # ---- the level cubemap ----------------------------------------------

    def test_six_faces_resolve_against_the_level_directory(self) -> None:
        faces = self.results["faces"]
        self.assertEqual([
            "maps/wake/sky/px.png", "maps/wake/sky/nx.png",
            "maps/wake/sky/py.png", "maps/wake/sky/ny.png",
            "maps/wake/sky/pz.png", "maps/wake/sky/nz.png",
        ], faces["six"])
        self.assertEqual("sky/px.png", faces["sixNoBase"][0])

    def test_anything_short_of_six_faces_is_not_a_cube(self) -> None:
        # The engine's own gate is `ctx+0x18 != NULL` (0x005bfa8b): the cube
        # is there or it is not. Five faces, a blank entry, a missing key and
        # a bare string all have to answer None rather than half-bind.
        faces = self.results["faces"]
        for key in ("five", "nullFaces", "missingKey", "blankEntry", "notAnArray"):
            with self.subTest(key):
                self.assertIsNone(faces[key])

    # ---- the stage itself -------------------------------------------------

    def test_the_reflection_vector_is_built_in_camera_space(self) -> None:
        # D3DTSS_TCI_CAMERASPACEREFLECTIONVECTOR. `normalMatrix` is three's
        # inverse-transpose of the model-VIEW upper 3x3 and `modelViewMatrix *
        # position` is the view-space point, which is the frame D3D's own
        # generator works in. A world-space reflection would be a different,
        # world-stable mirror -- not what the engine draws, and not what
        # BF1942's camera-locked chrome sheen looks like.
        glsl = self.results["glsl"]
        self.assertTrue(glsl["vertexUsesNormalMatrix"])
        self.assertTrue(glsl["vertexUsesModelView"])
        self.assertTrue(glsl["vertexHasNoWorldMatrix"])
        self.assertTrue(glsl["fragReflects"])
        self.assertTrue(glsl["fragSamplesCube"])

    def test_the_combine_is_blendcurrentalpha_over_the_cube(self) -> None:
        # GLSL `mix(x, y, a)` is `x*(1-a) + y*a`. D3DTOP_BLENDCURRENTALPHA is
        # `Arg1*A + Arg2*(1-A)` with Arg1 = CURRENT (the lit base) and
        # Arg2 = TEXTURE (the cube), so the cube must be mix's FIRST argument
        # and the base its second. Swapping them inverts the whole feature:
        # matte paint would mirror and glass would go flat.
        glsl = self.results["glsl"]
        self.assertTrue(glsl["fragMixesBaseOverCube"])

    def test_the_blend_factor_is_the_diffuse_textures_own_alpha(self) -> None:
        # Stage 0's alpha op, set at 0x005c0201, is SELECTARG1(D3DTA_TEXTURE).
        # After three's <map_fragment> that value lives in `diffuseColor.a`.
        # There is no reflectivity constant to choose.
        glsl = self.results["glsl"]
        self.assertEqual(
            "diffuseColor.rgb = bfEnvmapStage( diffuseColor.rgb, diffuseColor.a );",
            glsl["apply"])
        self.assertEqual(
            "outCol.rgb = bfEnvmapStage( outCol.rgb, texel.a );",
            glsl["applyCustom"])

    def test_the_srgb_helpers_are_emitted_exactly_once(self) -> None:
        # map.html's dynamic-shading pass already defines bfToSrgb/bfFromSrgb
        # in the same shader; a second definition will not compile. index.html
        # has no such pass, so the module has to supply them there.
        glsl = self.results["glsl"]
        self.assertEqual(0, glsl["helpersOmittedWhenHost"])
        self.assertEqual(1, glsl["helpersEmittedWhenAlone"])

    def test_the_varyings_are_declared_in_both_shader_halves(self) -> None:
        glsl = self.results["glsl"]
        self.assertTrue(glsl["varyingsInVertex"])
        self.assertTrue(glsl["varyingsInFragment"])
        self.assertTrue(glsl["fragDeclaresSampler"])

    # ---- the readout ------------------------------------------------------

    def test_reflectivity_is_one_minus_alpha_and_flat_alpha_is_matte(self) -> None:
        # Measured on the re-extracted glbs: `militable_m1_Material0` and
        # `stebarrel1_m1_Material0` on Wake declare `envmap true` but ship a
        # flat 255 alpha, so the engine reflects nothing on them either. That
        # is the correct result, not a failed binding, and the browser's
        # readout has to be able to say so.
        r = self.results["reflectivity"]
        self.assertEqual({"min": 0.0, "max": 0.0}, r["flat"])
        self.assertAlmostEqual(0.0, r["canopy"]["min"], places=6)
        self.assertAlmostEqual((255 - 120) / 255, r["canopy"]["max"], places=6)
        self.assertEqual({"min": 1.0, "max": 1.0}, r["mirror"])

    def test_an_unmeasurable_texture_answers_none(self) -> None:
        r = self.results["reflectivity"]
        self.assertIsNone(r["empty"])
        self.assertIsNone(r["wrongLength"])
        self.assertIsNone(r["nullIn"])


if __name__ == "__main__":
    unittest.main()
