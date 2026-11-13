"""The live page's death camera, `viewer/death-camera.js`: retail's
`FreeCamera::updateDeathCamera` type 1 and `followNextPlayer`, run under node
by `death_camera_harness.mjs`."""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("death_camera_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "death-camera.js", work / "death-camera.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DeathCameraTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_shot_rises_one_to_thirty_metres_in_three_seconds_and_holds(self) -> None:
        # lnxded 0x081b0350: eye.y = P.y + sin(t / 3 * 3.14 * 0.5) * 29 + 1
        # (3.0f 0x86c08c8, 3.14 0x86c5298, 29 0x86c52a8, 1 0x86c52b0).
        s = self.r["shot"]
        self.assertEqual([10, 6, -3], s["t0"]["eye"])
        self.assertAlmostEqual(5 + math.sin(1.5 / 3 * 3.14 * 0.5) * 29 + 1, s["t1_5"]["eye"][1], places=3)
        self.assertAlmostEqual(35.0, s["t3"]["eye"][1], places=3)
        self.assertEqual(s["t3"], s["t7"])
        # The up axis turns at 0.5 rad/s (0x86b05e8), the engine's
        # (cos, 0, sin) with the page's z negated.
        self.assertEqual([1, 0, 0], s["t0"]["up"])
        self.assertAlmostEqual(math.cos(0.75), s["t1_5"]["up"][0], places=4)
        self.assertAlmostEqual(-math.sin(0.75), s["t1_5"]["up"][2], places=4)
        # `handleUpdate`: never under the terrain plus 1 m.
        self.assertEqual(21, self.r["floored"][1])

    def test_follow_next_player_takes_living_human_teammates_only(self) -> None:
        # `followNextPlayer` 0x081b0150: team +0x7c, alive +0x79, not
        # `getIsAIPlayer` (BFPlayer vt+0x5c = 0x08056120), not himself.
        n = self.r["next"]
        self.assertEqual(4, n["none"])
        self.assertEqual(6, n["after4"])
        self.assertEqual(4, n["after6"])
        self.assertEqual(6, n["backwards"])
        self.assertEqual(-1, n["botsOnly"])

    def test_past_ten_seconds_it_rides_and_a_death_restarts_the_shot(self) -> None:
        ride = self.r["ride"]
        self.assertEqual([None, None, 4, None], ride["ids"])
        self.assertEqual(0.0, ride["t"])
        self.assertEqual({"x": 40, "y": 2, "z": 7}, ride["at"])
        self.assertEqual(-1, ride["followed"])
        self.assertIsNone(self.r["sp"])

    def test_the_toggle_walks_teammates_and_sets_the_clock_to_ten(self) -> None:
        t = self.r["toggle"]
        self.assertEqual({"found": True, "followed": 4, "t": 10, "second": 6}, t)
        self.assertEqual({"riding": "CHASE CAMERA Pat[50%]", "toggle": "C TO TOGGLE BETWEEN PLAYERS"},
                         self.r["lines"])

    def test_the_live_page_draws_it_and_the_replay_keeps_its_own(self) -> None:
        view = (VIEWER / "soldier-view.js").read_text()
        self.assertIn("deathCamView(dt);", view)
        self.assertIn("createDeathCamera(", (VIEWER / "local-player.js").read_text())
        self.assertNotIn("death-camera.js", (VIEWER / "replay-camera.js").read_text())


    def test_the_radio_strip_is_down_while_the_player_is_not_alive(self) -> None:
        # `BfMenu::updateHud` (Mac client): with `BFPlayer+0x89` clear the
        # HudManager's Radio (`+0x2c`) gets vt+0x18 (`Radio::hide` 0x0043b0dc)
        # with the Soldier, Vehicle and Weapon groups; only the living branch
        # shows it. Dead, the TIME TO SPAWN plate has the top centre alone.
        comms = (VIEWER / "comms.js").read_text()
        self.assertIn("const radioUp = radioShown && !page.deployActive?.() && (page.localAlive?.() ?? true);", comms)
        page = (VIEWER / "map.html").read_text()
        self.assertIn("localAlive: () => !!(localPlayer.soldierArmor && !localPlayer.soldierDead", page)


if __name__ == "__main__":
    unittest.main()
