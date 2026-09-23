"""The headless runner's vehicle path (`sim/stage.mjs`) on real levels.

Each recipe (`tests/sim_vehicles_harness.mjs`) loads a level the way the page
does and seats a bot with the page's own law: a tank's real drive in the body
world, its shell killing a frozen soldier, a fixed gun firing, a Spitfire
leaving the ground, a landing craft on the water map, a parked hull that stops
a ray on its pad and not after it has been driven off.

The extracted maps tree is untracked, so the test looks for it in
`$BF42_VIEWER_ASSETS`, then this checkout's `viewer/`, then the main
checkout's (a worktree's git common dir), and skips when there is none.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "sim_vehicles_harness.mjs"


def find_assets() -> Path | None:
    candidates: list[Path] = []
    if os.environ.get("BF42_VIEWER_ASSETS"):
        candidates.append(Path(os.environ["BF42_VIEWER_ASSETS"]))
    candidates.append(ROOT / "viewer")
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=ROOT,
                                capture_output=True, text=True, timeout=10).stdout.strip()
        if common:
            candidates.append(Path(common).parent / "tools" / "bf1942-models" / "viewer")
    except (OSError, subprocess.SubprocessError):
        pass
    for c in candidates:
        if (c / "maps" / "el_alamein" / "scene.glb").exists() and (c / "maps" / "_shared" / "vehicle-ai.json").exists():
            return c
    return None


ASSETS = find_assets()


def recipe(name: str) -> dict:
    proc = subprocess.run(["node", str(HARNESS), str(ASSETS), name], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"recipe {name} failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(ASSETS is None, "no extracted viewer/maps tree (set BF42_VIEWER_ASSETS)")
class SimVehicleTests(unittest.TestCase):
    def test_a_bot_drives_a_tank_on_its_real_drive(self) -> None:
        r = recipe("drive")
        self.assertEqual(r["driveClass"], "TrackedVehicle")
        self.assertTrue(r["adopted"], "the drive is adopted into the body world")
        self.assertGreater(r["parkedBodies"], 10, "the level's parked hulls are bodies")
        self.assertGreater(r["moved"], 20.0)
        self.assertLess(r["nodeOff"], 1e-6, "the hull's node is where its drive is")
        self.assertTrue(r["stillMounted"])
        self.assertEqual(recipe("drive")["trail"], r["trail"], "the same seed drives the same path")

    def test_a_tank_shell_kills_a_soldier_through_the_page_hit_path(self) -> None:
        r = recipe("gun")
        self.assertTrue(r["killed"], r)
        self.assertEqual(r["kill"]["killer"], "bot_1")
        self.assertRegex(r["kill"]["weapon"], r"^(round|splash) ShermanGunBarrel")
        self.assertGreaterEqual(r["rounds"], 1)
        self.assertTrue(any(f.startswith("Sherman:ShermanGunBarrel") for f in r["fired"]))

    def test_a_spitfire_takes_off_on_the_page_flight_model(self) -> None:
        r = recipe("air")
        self.assertEqual(r["driveClass"], "Aircraft")
        self.assertTrue(r["takeoff"], "a takeoff event")
        self.assertGreater(r["topAgl"], 20.0)
        self.assertTrue(r["stillMounted"])

    def test_a_landing_craft_sails_on_the_water_map(self) -> None:
        if not (ASSETS / "maps" / "wake" / "scene.glb").exists():
            self.skipTest("wake is not extracted")
        r = recipe("ship")
        self.assertEqual(r["template"], "Daihatsu")
        self.assertEqual(r["driveClass"], "Ship")
        self.assertTrue(r["landingCraft"])
        self.assertTrue(r["navWater"])
        self.assertGreater(r["moved"], 50.0)
        self.assertEqual(r["routeFailures"], 0)
        low, high = r["y"]
        self.assertLess(abs(low - r["waterLevel"]), 3.0, "afloat")
        self.assertLess(abs(high - r["waterLevel"]), 3.0, "afloat")


if __name__ == "__main__":
    unittest.main()
