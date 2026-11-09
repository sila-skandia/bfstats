"""BF1918's armoured train on its guide rails, driven headless by
`armoured_train_harness.mjs` (features/bf1918-armoured-train/README.md).

The locomotive (`ArmouredTrain_GILI`) is the real glb out of the bf1918 tree:
a `VCLand` hull pushed by a `c_ETPlane` (the propeller-sled drive), four road
springs and four `ArmouredTrain_GuideWheel` springs in `c_CGLandscape` and
`c_CGStaticObjects` (mask 3). The track is built as BF1918 builds one: the
visible embankment in `c_CGStaticObjects`, the invisible guide walls in no
group. Ledger COL-20, COL-21, COL-25.

Skips without the untracked bf1918 tree (`$BF42_VIEWER_ASSETS`, this
checkout's `viewer/`, or the main checkout's).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "armoured_train_harness.mjs"


def assets_dir() -> Path | None:
    tail = Path("models/mods/bf1918/ArmouredTrain_GILI.glb")
    candidates = [os.environ.get("BF42_VIEWER_ASSETS"), HERE.parent / "viewer",
                  Path.home() / "projects/skandia/bfstats/tools/bf1942-models/viewer"]
    for c in candidates:
        if c and (Path(c) / tail).exists():
            return Path(c)
    return None


class ArmouredTrainTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        assets = assets_dir()
        if assets is None:
            raise unittest.SkipTest("no bf1918 model tree")
        proc = subprocess.run(["node", str(HARNESS), str(assets)], capture_output=True,
                              text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)
        if "skipped" in cls.results:
            raise unittest.SkipTest(cls.results["skipped"])

    def test_the_guide_wheels_are_wheels_that_never_meet_the_terrain(self) -> None:
        r = self.results["railed"]
        # The plane engine on a land hull is the propeller-sled drive.
        self.assertEqual(r["kind"], "ground")
        # Four guide springs, kept as spring parts with the template's mask
        # (COL-20 dropped a c_CGLandscape part before).
        self.assertEqual(r["guideWheels"], 4)
        self.assertEqual(r["guideSpringParts"], 4)
        self.assertEqual(r["guideGroups"], [3, 3, 3, 3])
        # It stands on its road wheels on the embankment (0.72 m), not on its
        # guide wheels 0.3 m lower: 0.72 + 1.02 less the springs' sag.
        self.assertAlmostEqual(r["minY"], 1.716, delta=0.01)
        self.assertAlmostEqual(r["maxY"], 1.716, delta=0.01)

    def test_the_guide_walls_hold_it_round_the_bend(self) -> None:
        r = self.results["railed"]
        # The whole 60 m straight, 30 degree bend of 100 m and 60 m straight.
        self.assertGreater(r["lastOnTrack"], 15)
        # Within the walls' 4.5 cm clearance plus a spring's compression.
        self.assertLess(r["maxLateral"], 0.1)
        self.assertLess(r["maxHeading"], 3)
        self.assertGreater(r["guidePushes"], 50)
        # The walls push sideways, along their own normal: the spring has no
        # axis (physics.md section 6).
        self.assertLess(r["guidePushMaxNy"], 0.05)

    def test_a_train_off_centre_is_pushed_back_inside_the_walls(self) -> None:
        r = self.results["offset"]
        self.assertGreater(r["guidePushes"], 0)
        self.assertLess(r["maxLateral"], 0.05)

    def test_without_guide_walls_it_runs_straight_off_the_bend(self) -> None:
        r = self.results["unguided"]
        self.assertEqual(r["guidePushes"], 0)
        self.assertGreater(r["maxLateral"], 5)

    def test_the_visible_rails_share_a_group_with_the_guide_wheels(self) -> None:
        # In no group, the embankment's top is the first face the guide
        # wheel's probe crosses from the hull's origin, and the train rides
        # on its guide wheels' push, 0.28 m high (section 5.2 item 5).
        r = self.results["ungrouped"]
        self.assertGreater(r["guidePushMaxNy"], 0.9)
        self.assertGreater(r["minY"], 1.8)


if __name__ == "__main__":
    unittest.main()
