"""A craft a ship's spawner holds stands at the spawner plus its
`spawnOffset` (ledger AI-121; `tests/held_spawn_offset_harness.mjs`). FHSW's
carriers set 1.98 m up; held at the spawner itself, Midway's Wildcats sat in
the flight deck to their wings."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "held_spawn_offset_harness.mjs"


class HeldSpawnOffsetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_offset_lifts_the_held_craft(self) -> None:
        self.assertEqual([-1, 20.575, -20], self.r["wildcat"])

    def test_no_offset_is_the_spawner_itself(self) -> None:
        self.assertEqual([-1, 18.592, -20], self.r["corsair"])

    def test_z_is_mirrored_as_every_con_vector(self) -> None:
        self.assertEqual([-0.5, 18.592, -22], self.r["skewed"])


if __name__ == "__main__":
    unittest.main()
