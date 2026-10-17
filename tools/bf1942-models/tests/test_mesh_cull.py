"""Retail's LOD choice and small-mesh cull: `viewer/mesh-cull.js` against
`StandardMesh_selectLod` (client 0x005adfd0), and its use by
`viewer/level-statics.js` (`tests/mesh_cull_harness.mjs`).
`features/mesh-lod-chains/README.md`, "Retail's small-mesh cull"."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "mesh_cull_harness.mjs"


class MeshCullTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_small_one_lod_mesh_leaves_past_its_cull(self) -> None:
        # (0^2 + 2500) x 0.5 / (5 x 0.03) < d^2 - 0.25 past 91.29 m.
        self.assertAlmostEqual(self.r["propSize"], 10 / 3)
        self.assertEqual(self.r["propAt"], [0, -1])
        self.assertAlmostEqual(self.r["propCullM"], 91.2885, places=3)

    def test_a_cull_factor_brings_it_nearer(self) -> None:
        # Vanilla's Browning, `cullFactor 0.15`.
        self.assertAlmostEqual(self.r["browningCullM"], 40.828, places=3)

    def test_zoom_and_scale_take_it_further(self) -> None:
        self.assertAlmostEqual(self.r["lensFov"], 1.0)
        self.assertAlmostEqual(self.r["zoomFov"], 2.0)
        self.assertAlmostEqual(self.r["zoomCullM"], 129.100, places=3)
        self.assertAlmostEqual(self.r["scaledCullM"], 129.101, places=3)

    def test_a_large_mesh_swaps_past_its_radius_and_is_never_culled(self) -> None:
        self.assertEqual(self.r["bigAt"], [0, 1, 1])

    def test_a_small_chain_swaps_then_leaves(self) -> None:
        self.assertEqual(self.r["chainAt"], [0, 1, 1, -1])

    def test_the_spec_needs_the_key_and_a_standard_mesh(self) -> None:
        self.assertAlmostEqual(self.r["crateSpec"]["r"], 0.866025, places=5)
        self.assertEqual(self.r["crateSpec"]["cullFactor"], 0.15)
        self.assertIsNone(self.r["bushSpec"])
        self.assertIsNone(self.r["noKeySpec"])

    def test_the_statics_cull_only_the_small_one_lod_part(self) -> None:
        self.assertEqual(self.r["smallMeshes"], ["crate_m1"])
        self.assertEqual(self.r["near"], {"crate": True, "bottle": True, "bottleRung": False,
                                          "shed": True, "bush": True})
        self.assertFalse(self.r["past53"]["crate"])
        self.assertTrue(self.r["past53"]["bottle"])
        self.assertEqual((self.r["past274"]["bottle"], self.r["past274"]["bottleRung"]), (False, True))
        self.assertEqual((self.r["past289"]["bottle"], self.r["past289"]["bottleRung"]), (False, False))
        self.assertTrue(self.r["past289"]["shed"])
        self.assertTrue(self.r["past289"]["bush"])
        self.assertEqual(self.r["back"], self.r["near"])

    def test_a_level_without_the_key_keeps_the_distance_swap(self) -> None:
        self.assertEqual(self.r["oldFar"], {"part": False, "rung": True})


if __name__ == "__main__":
    unittest.main()
