"""A first-person cockpit interior is lit by the level's animated-mesh terms.

The owner (2026-10-11, the Secret Weapons round on Raid on Agheila): the
Flettner's interior is 1.5 to 2 times brighter than the retail game's. It had
been drawn flat, the texture at x1.0 (`unlitCockpit`), on the theory that the
level's light is baked into what it draws. It is not: a cockpit is a lit
StandardMesh (`Flettner_Cockpit_M1.rs`: `lighting true`, `envmap true`).

Two retail captures (the Flettner on Raid on Agheila, a Zero on Iwo Jima) say
the terms are `renderer.animatedMeshAmbientColor` and
`renderer.animatedMeshDiffuseFactor` times `diffuseColor`, not the
fixed-function `ambientColor + globalAmbientColor` and `diffuseColor` every
hull outside takes (ledger DL-5, DL-6):

    MODULATE2X(TEXTURE, clamp01(animatedAmbient + factor * diffuse * N.L))

`shadeCockpit` hands the interior to `bindDynamicShading` with those two terms.
This pins the numbers that gives on Agheila and Iwo Jima, read back out of the
program the pass builds, that a hull outside is untouched, that a scene.json
without the terms falls back, and the three cases that must not be shaded.

Run under node through `cockpit_light_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "cockpit_light_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CockpitLightTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_lit_interior_takes_the_dynamic_mesh_pass(self) -> None:
        lit = self.results["lit"]
        self.assertEqual(lit["kind"], "MeshBasicMaterial")
        self.assertFalse(lit["standardLeft"])
        self.assertTrue(lit["parsed"], "the engine combine is in the program")
        self.assertIn("bf-dynamic-lit", lit["key"])

    def test_the_floor_is_the_animated_ambient_not_ambient_plus_global(self) -> None:
        # Agheila declares animatedMeshAmbientColor 0.2; ambient + global is 0.25.
        self.assertEqual(self.results["lit"]["floor"], [0.2, 0.2, 0.2])

    def test_the_sun_is_diffuse_times_the_animated_factor(self) -> None:
        # diffuse 0.35 / 0.32 / 0.18 times animatedMeshDiffuseFactor 0.75
        for got, want in zip(self.results["lit"]["sun"], [0.2625, 0.24, 0.135]):
            self.assertAlmostEqual(got, want, places=3)

    def test_a_face_the_sun_misses_is_0_4_of_the_texture(self) -> None:
        # 2 * 0.2: the 0.35 to 0.4 the retail Flettner interior measures where
        # the fixed-function terms give 0.5 and the old unlit rule 1.0.
        for got in self.results["lit"]["away"]:
            self.assertAlmostEqual(got, 0.4, places=2)

    def test_a_face_square_to_the_sun_is_warm(self) -> None:
        r, g, b = self.results["lit"]["toward"]
        self.assertAlmostEqual(r, 2 * (0.2 + 0.2625), places=2)
        self.assertGreater(r, g)
        self.assertGreater(g, b, "the sun's warmth, not the ambient's grey")

    def test_the_hull_outside_keeps_the_fixed_function_terms(self) -> None:
        self.assertEqual(self.results["hull"]["floor"], [0.25, 0.24, 0.26])
        self.assertEqual(self.results["hull"]["sun"], [0.35, 0.32, 0.18])

    def test_a_scene_without_the_animated_terms_falls_back(self) -> None:
        self.assertEqual(self.results["stale"]["floor"], [0.25, 0.24, 0.26])
        self.assertEqual(self.results["stale"]["sun"], [0.35, 0.32, 0.18])

    def test_iwo_jima_is_a_different_floor(self) -> None:
        iwo = self.results["iwo"]
        self.assertEqual(iwo["floor"], [0.3, 0.3, 0.3])
        self.assertEqual(iwo["sun"], [0.4, 0.38, 0.25])
        # an upward face: sun at 36 degrees, N.L 0.5867
        self.assertAlmostEqual(iwo["up"][0], 2 * (0.3 + 0.4 * 0.5867), places=2)

    def test_the_levels_own_numbers_drive_it(self) -> None:
        # animated 0.15, sun straight down, diffuse 0.2: an upward normal is
        # 2 * (0.15 + 0.2) = 0.7.
        for v in self.results["dark"]["away"]:
            self.assertAlmostEqual(v, 0.7, places=3)

    def test_a_lighting_false_material_is_left_unlit(self) -> None:
        self.assertTrue(self.results["unlit"]["same"])

    def test_an_additive_glow_stays_unlit_and_additive(self) -> None:
        add = self.results["additive"]
        self.assertTrue(add["additive"])
        self.assertFalse(add["depthWrite"])
        self.assertTrue(add["mark"])
        self.assertFalse(add["lit"])

    def test_a_material_list_is_converted_entry_by_entry(self) -> None:
        lst = self.results["list"]
        self.assertTrue(lst["isArray"])
        self.assertEqual(lst["first"], "MeshBasicMaterial")
        self.assertTrue(lst["second"])

    def test_the_real_flettner_interior_declares_envmap_and_is_lit(self) -> None:
        flettner = self.results["flettner"]
        if flettner is None:
            self.skipTest("Flettner.cockpit.glb is not in the asset tree")
        self.assertEqual(flettner["envmap"], [True])
        self.assertEqual(flettner["unlitExt"], [False], "lighting true: not exported unlit")


if __name__ == "__main__":
    unittest.main()
