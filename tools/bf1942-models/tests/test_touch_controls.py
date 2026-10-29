"""`viewer/touch-controls.js` with the DOM stubbed, driven by
`touch_controls_harness.mjs`: the minimap is the MAP button, SPAWN sits
against its edge and is Enter, PICKUP is a contextual pill, VIEW shows on
foot, and the MORE sheet is gone (features/mobile-four-finger-controls, "The
twentieth pass").
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("touch_controls_harness.mjs")
MODULES = ("touch-controls.js", "kit-icon.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class TouchControlsTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_every_button_acts_on_its_pointerdown_edge(self) -> None:
        self.assertTrue(self.r["noClickListeners"])

    def test_the_more_sheet_is_gone(self) -> None:
        self.assertTrue(self.r["moreGone"])
        page = (VIEWER / "map.html").read_text()
        for gone in ("mobile-more-btn", "mobile-more-sheet", "mobile-more-scrim",
                     "mobile-map-btn", "mobile-seats-btn", "mobile-view-btn"):
            self.assertNotIn(gone, page)
            self.assertNotIn(gone, (VIEWER / "map.css").read_text())

    def test_the_target_lies_over_the_minimap(self) -> None:
        self.assertTrue(self.r["hitShown"])
        self.assertEqual(self.r["hitRect"], ["764px", "30px", "100px", "100px"])
        self.assertTrue(self.r["hitRound"])
        # It follows the box as the map grows open.
        self.assertEqual(self.r["openHitRect"], ["482px", "382px"])

    def test_a_minimap_tap_is_the_map_alive_and_the_spawn_screen_dead(self) -> None:
        self.assertEqual(self.r["aliveMapTap"], ["c_PIMap"])
        self.assertEqual(self.r["deadMapTap"], ["c_GIInGameMenu"])

    def test_spawn_is_enter_outside_the_disk(self) -> None:
        self.assertTrue(self.r["spawnShown"])
        self.assertEqual(self.r["spawnTap"], ["c_GIInGameMenu"])
        self.assertTrue(self.r["spawnClearOfDisk"])
        self.assertTrue(self.r["spawnFootLevel"])
        self.assertTrue(self.r["openHidesSpawn"])
        self.assertTrue(self.r["deadSpawnShown"])
        self.assertTrue(self.r["pilotHidesSpawn"])
        self.assertTrue(self.r["noMinimapSpawn"])
        self.assertTrue(self.r["noMinimapHit"])

    def test_pickup_is_contextual_and_stacks_under_enter(self) -> None:
        self.assertTrue(self.r["pickupHiddenWithoutKit"])
        self.assertTrue(self.r["pickupShownWithKit"])
        self.assertEqual(self.r["kitPicked"], 1)
        self.assertTrue(self.r["enterStacked"])

    def test_the_camera_pill_shows_on_foot_with_two_views(self) -> None:
        self.assertTrue(self.r["footViewShown"])
        self.assertEqual(self.r["viewCycled"], 1)
        self.assertTrue(self.r["footViewHiddenSingle"])


if __name__ == "__main__":
    unittest.main()
