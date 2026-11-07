"""The arsenal ASMR's firing range (scripts/shorts-range.mjs,
features/replay-shorts "The arsenal"): one gun cut out of a real recording,
so the replay draws it where it stood, firing as it fired, alone."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "shorts_range_harness.mjs"


class ShortsRangeTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_only_the_chosen_object_is_kept(self) -> None:
        # The Sherman beside it, the players, the score and the chat are gone.
        self.assertEqual(self.r["objects"], [7])
        self.assertNotIn("p", self.r["kinds"])
        self.assertNotIn("chat", self.r["kinds"])
        self.assertEqual(self.r["roster"], [])

    def test_only_its_chosen_weapon_in_the_window_fires(self) -> None:
        # Its cannon and its coax outside the window stay silent.
        self.assertEqual(self.r["shots"], [[20, "TigerCoax"]])

    def test_its_samples_run_from_a_lead_before_the_window(self) -> None:
        self.assertEqual(self.r["samples"], list(range(13, 27)))

    def test_the_level_and_the_end_are_kept(self) -> None:
        self.assertEqual(self.r["kinds"]["h"], 1)
        self.assertEqual(self.r["kinds"]["e"], 2)  # setLevel and its createObject
        self.assertEqual(self.r["end"], {"k": "end", "t": 27})


if __name__ == "__main__":
    unittest.main()
