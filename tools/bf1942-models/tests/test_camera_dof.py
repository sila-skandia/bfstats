"""Which vehicle guns fire from the seat's camera (`viewer/camera-dof.js`),
driven headless by `camera_dof_harness.mjs`.

The rule is `FireArms::Fire`'s (lnxded 0x0828a090): with the template's
`fireInCameraDof` byte set (+0x264, tested at 0x0828a1c1) the round is launched
from the firing player's camera (`BFPlayer::getCamera` 0x08054ce0), otherwise
from the FireArms' own transform. The retail archives set it on the coaxial and
stationary MGs and never on a tank's main gun, so a coax lands under the
crosshair and a cannon lands where its barrel points.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("camera_dof_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CameraDofTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_coaxial_and_pintle_mgs_fire_from_the_camera(self) -> None:
        fires = self.results["fires"]
        self.assertTrue(fires["coaxBaked"])      # the level bake's `_1` suffix
        self.assertTrue(fires["coaxModel"])
        self.assertTrue(fires["shermanCoax"])
        self.assertTrue(fires["pintle"])
        self.assertTrue(fires["grantGun"])       # XPack1's one tank gun that does

    def test_main_guns_and_wing_guns_fire_from_their_barrels(self) -> None:
        fires = self.results["fires"]
        self.assertFalse(fires["t34Cannon"])
        self.assertFalse(fires["tigerCannon"])
        self.assertFalse(fires["shermanCannon"])
        self.assertFalse(fires["wingGuns"])
        self.assertFalse(fires["unnamed"])

    def test_an_exported_word_beats_the_table(self) -> None:
        fires = self.results["fires"]
        self.assertTrue(fires["declaredOn"])
        self.assertFalse(fires["declaredOff"])

    def test_the_camera_is_the_seat_that_owns_the_gun(self) -> None:
        camera = self.results["camera"]
        self.assertEqual("T34Camera", camera["coax"])
        self.assertEqual("T34Camera2", camera["hullMg"])
        self.assertIsNone(camera["orphan"])


if __name__ == "__main__":
    unittest.main()
