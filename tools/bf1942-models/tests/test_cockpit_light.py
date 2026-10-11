"""A first-person cockpit interior is lit at the brightness retail measures.

The owner (2026-10-11, the Secret Weapons round on Raid on Agheila): the
Flettner's interior is 1.5 to 2 times brighter than the retail game's. It had
been drawn flat, the texture at x1.0 (`unlitCockpit`), on the theory that the
level's light is baked into what it draws. It is not: a cockpit is a lit
StandardMesh (`Flettner_Cockpit_M1.rs`: `lighting true`, `envmap true`).

`shadeCockpit` hands the interior to `bindDynamicShading` with the level's
ambient + global ambient (the tint both retail captures show) and diffuse,
scaled by k = min(1, 0.87 * animatedMeshAmbient / mean(ambient + global)), the
level-dependent magnitude the Wake Corsair's dash (0.93) and the Agheila
Flettner's interior (0.71) measure (ledger DL-5, a calibration). It also gives
a blended material its depth writes back unless the level's `depthWriteOff`
lists it (DL-8): the Ilyushin's whole interior is `transparent true`, and with
depth writes off its instrument panel was painted over by the cowl behind it.

This pins the numbers, read back out of the program the pass builds, that a
hull outside is untouched, that a scene.json without the terms falls back, and
the cases that must not be shaded.

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

    def test_the_floor_is_ambient_plus_global_scaled_by_k(self) -> None:
        # Agheila: (0.25, 0.24, 0.26), k = 0.87 * 0.2 / 0.25 = 0.696. The
        # retail Flettner's shaded floor, 0.178 / 0.171 / 0.185.
        for got, want in zip(self.results["lit"]["floor"], [0.174, 0.167, 0.181]):
            self.assertAlmostEqual(got, want, places=3)
        r, g, b = self.results["lit"]["floor"]
        self.assertAlmostEqual(g / r, 0.24 / 0.25, places=2, msg="the tint is ambient + global's")
        self.assertAlmostEqual(b / r, 0.26 / 0.25, places=2)

    def test_the_sun_is_diffuse_scaled_by_the_same_k(self) -> None:
        for got, want in zip(self.results["lit"]["sun"], [0.2436, 0.2227, 0.1253]):
            self.assertAlmostEqual(got, want, places=3)

    def test_a_face_the_sun_misses_is_about_0_35_of_the_texture(self) -> None:
        # 2 * floor: retail's 0.36 / 0.34 / 0.37 on the Flettner's top plate.
        for got, want in zip(self.results["lit"]["away"], [0.36, 0.344, 0.371]):
            self.assertAlmostEqual(got, want, delta=0.02)

    def test_a_face_square_to_the_sun_is_warm(self) -> None:
        r, g, b = self.results["lit"]["toward"]
        self.assertGreater(r, g)
        self.assertGreater(g, b, "the sun's warmth, not the ambient's grey")

    def test_the_hull_outside_keeps_the_fixed_function_terms(self) -> None:
        self.assertEqual(self.results["hull"]["floor"], [0.25, 0.24, 0.26])
        self.assertEqual(self.results["hull"]["sun"], [0.35, 0.32, 0.18])

    def test_a_scene_without_the_animated_term_falls_back(self) -> None:
        self.assertEqual(self.results["stale"]["floor"], [0.25, 0.24, 0.26])
        self.assertEqual(self.results["stale"]["sun"], [0.35, 0.32, 0.18])

    def test_wake_is_nearly_the_fixed_function_floor(self) -> None:
        # k = 0.87 * 0.25 / 0.23 = 0.946; the Corsair dash reads 0.93.
        floor = self.results["wake"]["floor"]
        for got, want in zip(floor, [0.24 * 0.946, 0.22 * 0.946, 0.23 * 0.946]):
            self.assertAlmostEqual(got, want, places=2)

    def test_a_level_whose_animated_term_is_high_is_the_fixed_function(self) -> None:
        # Iwo Jima: 0.87 * 0.3 / 0.2 > 1, k is clamped to 1.
        iwo = self.results["iwo"]
        self.assertEqual(iwo["floor"], [0.218, 0.19, 0.22])
        self.assertEqual(iwo["sun"], [0.4, 0.38, 0.25])

    def test_the_levels_own_numbers_drive_it(self) -> None:
        # ambient 0.05 + global 0.10 = 0.15, animated 0.15: k = 0.87, sun
        # straight down, diffuse 0.2: an upward normal is 0.87 * 2 * 0.35.
        for v in self.results["dark"]["away"]:
            self.assertAlmostEqual(v, 0.87 * 0.7, places=2)

    def test_a_blended_material_writes_depth_unless_the_level_lists_it(self) -> None:
        depth = self.results["depth"]
        self.assertTrue(depth["blended"], "the Ilyushin's interior: transparent true, no depthWrite line")
        self.assertFalse(depth["listed"], "a material that declares depthWrite false")
        self.assertTrue(depth["opaque"])
        self.assertFalse(depth["faded"], "a textureFade plane is not touched")
        self.assertFalse(self.results["depthStale"], "no list: left as loaded")

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
