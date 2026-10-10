"""`viewer/terrain-tile-wrap.js`: which terrain colour maps are clamped.

A `TxCCxRR` tile's UVs run 0..1 over its patch and must not wrap (the engine
binds that stage with CLAMP, ledger TERR-12); a default-texture patch tiles its
small map four times and must keep REPEAT. Runs `node terrain_tile_wrap_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "terrain_tile_wrap_harness.mjs"
ROOT = Path(__file__).resolve().parents[1]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not (ROOT / "node_modules" / "three").exists():
        raise unittest.SkipTest("three is not installed under tools/bf1942-models")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TerrainTileWrapTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_tile_patch_spans_exactly_the_unit_square(self) -> None:
        self.assertAlmostEqual(self.results["tileExtent"], 1.0)
        self.assertFalse(self.results["tileRepeats"])

    def test_a_default_patch_tiles_its_map_four_times(self) -> None:
        self.assertAlmostEqual(self.results["fillExtent"], 4.0)
        self.assertTrue(self.results["fillRepeats"])

    def test_float_noise_at_one_is_still_a_tile(self) -> None:
        self.assertFalse(self.results["noisyTile"])

    def test_a_geometry_without_uvs_has_no_extent(self) -> None:
        self.assertEqual(self.results["noUv"], 0)

    def test_plan_clamps_tiles_and_clones_what_a_repeating_patch_shares(self) -> None:
        self.assertEqual(self.results["plan"], ["clamp", "clone", "keep", "keep", "keep"])


if __name__ == "__main__":
    unittest.main()
