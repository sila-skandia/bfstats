"""A vehicle hull's decoded facing points the way it drives.

The fixture is a live M3A1 drive on Wake Island from the sidecar's review log.
The wire's yaw is mirrored relative to the replayer's frame; soldier-ghost.mjs
flips it and ghost/pco.mjs must too, or every vehicle drives sideways or
backwards in the replay.
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _wrap(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


class VehicleHeadingTest(unittest.TestCase):
    def test_hull_yaw_matches_travel(self) -> None:
        out = subprocess.run(
            ["node", str(ROOT / "tests/sidecar_vehicle_heading_harness.mjs"),
             str(ROOT / "tests/fixtures/sidecar_m3a1_drive.ndjson.gz")],
            check=True, capture_output=True, text=True).stdout
        pairs = json.loads(out)
        self.assertGreater(len(pairs), 10)
        errs = sorted(abs(_wrap(m - y)) for m, y in pairs)
        self.assertLess(errs[len(errs) // 2], 5.0, errs)


if __name__ == "__main__":
    unittest.main()
