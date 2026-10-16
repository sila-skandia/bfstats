"""The sidecar's recording agrees with the retail client's of the same round.

Fixtures: a Wake round recorded twice on 2026-10-16, by the sidecar (its event
rows and the review log's framed ghost records for the objects in play) and by
the owner's own client with bf42plus. sidecar/compare.mjs aligns the two on
shared events and scores every object both saw. The laws, each a defect the
comparison found:

* a hull's hit points are rangedBits(0, maxHitPoints) wide (a Hatsuzuki's 300
  read as 44 at 7 bits) and a fixed gun sends no flag bit (a Defgun's 50 read
  as 25);
* a hull's rotation is the wire quaternion's conjugate: negating y alone
  mirrored every pitch and roll (the Zero 26 deg off, its rounds 24 deg low);
* a round is a step down of the gun's counter, one per firing of a
  two-muzzle gun (a Zero's counter falls by 2), never a rise;
* a soldier's round is a rise in his state bits' counter (bits 8-10);
* every round carries the gun's name, muzzle and direction;
* a Daihatsu's outer ramp leaf turns on its inner one.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_compare_harness.mjs"


class SidecarCompareTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_no_mismatch(self) -> None:
        self.assertEqual(self.r["mismatches"], [])

    def test_hit_points(self) -> None:
        self.assertEqual(self.r["hp"]["defgun"][0], 50)
        self.assertEqual(self.r["hp"]["aa"][0], 100)
        self.assertEqual(self.r["hp"]["hatsuzuki"][0], 300)
        self.assertEqual(self.r["hp"]["daihatsu"][0], 150)

    def test_rotations(self) -> None:
        self.assertLess(self.r["zero"]["rotMed"], 5)
        self.assertLess(self.r["sherman"]["rotMed"], 5)

    def test_rounds(self) -> None:
        f = self.r["fires"]
        self.assertEqual(f["client"], 34)
        self.assertEqual(f["side"], 34)
        self.assertEqual(f["matched"], 34)
        self.assertEqual(f["sideWithDir"], 34)
        self.assertLess(f["dirMed"], 3)

    def test_ramp(self) -> None:
        self.assertTrue(all(e is not None and e < 3 for e in self.r["ramp"]))

    def test_events_and_names(self) -> None:
        self.assertEqual(self.r["events"]["matched"], self.r["events"]["client"])
        self.assertIn("Village", self.r["village"])


if __name__ == "__main__":
    unittest.main()
