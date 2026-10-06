"""The viewer's land drives against the real game's, on Desert Combat's glbs.

`tests/ground_handling_harness.mjs` gives each hull the input retail's hull
had. A car is replayed through twenty full-lock episodes the lab recorded
with bots at AI LOD 0. The replay uses the recorded throttle servo and
steered-wheel angle, tick by tick (`fixtures/dc_lock_episodes.json.gz`). A
tank is driven by the AI's own tank law at its `aiTemplatePlugIn.maxSpeed`,
and turned on the spot at full throttle and full lock.

Why the inputs matter: every retail full-lock episode at speed in the four
LOD 0 rounds has the throttle released. The car slows from 13 to 2 m/s in
about 1.3 s. The "99 deg/s and a spin" once quoted against the DPV came from
a test that held full throttle through the lock, an input no recording
covers. The lab's tank "top speeds" (T-72 11.2, M1A1 14.1 m/s) are the AI
holding its maxSpeed (12, 15), not the drivetrain's ceiling, which is 14.89
for all four tanks here. See features/viewer-ground-hull-collision/README.md,
"Handling against the lab's LOD 0 rounds".

The retail side of the lock comparison is computed in the harness from the
fixture's own samples, with `lab/dc_truth.py`'s estimator applied the same
way to both. The tank numbers are the lab's own, from
features/desert-combat-parity/lab-ground-truth.md and the recorded engines'
revs and gears.

The extracted trees are untracked, so the test looks for them in
`$BF42_VIEWER_ASSETS`, then this checkout's `viewer/`, then the main
checkout's, and skips when there is none.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "ground_handling_harness.mjs"


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
        if (c / "models" / "mods" / "desertcombat" / "DesertPatrolVehicle.glb").exists() and \
                (c / "maps" / "mods" / "desertcombat" / "_shared" / "collision-meshes.json").exists():
            return c
    return None


ASSETS = find_assets()


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipIf(ASSETS is None, "no extracted Desert Combat models tree (set BF42_VIEWER_ASSETS)")
class GroundHandlingTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS), str(ASSETS)], capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    # --- cars: the recorded full locks -------------------------------------------

    def test_every_episode_is_replayed(self) -> None:
        lock = self.results["lock"]
        self.assertEqual({"DesertPatrolVehicle", "Humvee", "Humvee_Tow", "BRDM2", "Technical_Recoilless"}, set(lock))
        for tmpl, row in lock.items():
            self.assertEqual(4, row["episodes"], tmpl)
            self.assertGreater(row["samples"], 100, tmpl)

    def test_the_turn_rate_is_retails_on_retails_inputs(self) -> None:
        # Median yaw rate over the lock, same estimator on both sides. The
        # DPV, Humvee and Humvee_TOW land within 10%. The BRDM-2 and the
        # Technical turn about a quarter slower than retail's, mostly in the
        # 2 m/s crawl a bot holds once the lock has bled the speed off (open,
        # see the README).
        for tmpl, row in self.results["lock"].items():
            with self.subTest(tmpl):
                ratio = row["viewerYaw"] / row["retailYaw"]
                self.assertGreater(ratio, 0.65, row)
                self.assertLess(ratio, 1.35, row)

    def test_nothing_spins_on_retails_inputs(self) -> None:
        # The quoted spin-out: the fastest the viewer turns any of these cars
        # in a recorded lock is no faster than retail did, with margin. That
        # covers the DPV, whose origin sits 0.94 m ahead of its rear axle.
        for tmpl, row in self.results["lock"].items():
            with self.subTest(tmpl):
                self.assertLess(row["viewerYawMax"], 1.2 * row["retailYawMax"], row)
                self.assertLess(row["viewerYawMax"], 90.0, row)

    def test_the_slip_is_retails_on_retails_inputs(self) -> None:
        # The angle between where the hull points and where it goes. For four
        # of the five it lands within 3.5 degrees. The Humvee_TOW's 35-degree
        # lock slips 26 degrees in retail's 2 m/s crawl, which is its
        # kinematic value: the pivot is the rear axle, 2.5 m behind the
        # origin. The viewer slips about 15 degrees there (open).
        for tmpl, row in self.results["lock"].items():
            with self.subTest(tmpl):
                if tmpl == "Humvee_Tow":
                    self.assertGreater(row["viewerSlip"], 0.5 * row["retailSlip"], row)
                else:
                    self.assertLess(abs(row["viewerSlip"] - row["retailSlip"]), 3.5, row)

    # --- tanks: the AI's own law ------------------------------------------------

    def test_a_bot_tank_cruises_at_retails_speed(self) -> None:
        # Lab, LOD 0, level full throttle: T-72 p95 11.19 / max 11.29 m/s, in
        # fifth at revs 0.755. M1A1 p95 13.56 / p99 14.10 / max 14.15, in fifth
        # at revs 0.947. BMP-2 14.88, M2A3 14.86. The AI-45 law holds a hull
        # just under its maxSpeed (T-72 12, M1A1 15). The BMP-2's 17 and the
        # M2A3's 20 are above the drivetrain's ceiling.
        cruise = self.results["cruise"]
        self.assertAlmostEqual(11.2, cruise["T72"]["speed"], delta=0.4)
        self.assertEqual(5, cruise["T72"]["gear"])
        self.assertAlmostEqual(0.755, cruise["T72"]["revs"], delta=0.05)
        self.assertAlmostEqual(14.1, cruise["M1A1"]["speed"], delta=0.4)
        self.assertAlmostEqual(0.947, cruise["M1A1"]["revs"], delta=0.05)
        self.assertGreater(cruise["BMP2"]["speed"], 14.7)
        self.assertGreater(cruise["M2A3"]["speed"], 14.7)

    def test_a_bot_tank_holds_its_heading(self) -> None:
        # The AI law steers on the yaw rate at unit gain. On the footprint's
        # inertia the loop went period-2: the steer flipped every tick, and a
        # bot Sherman crawled at 8 m/s.
        for name, row in self.results["cruise"].items():
            with self.subTest(name):
                self.assertLess(row["meanSteer"], 0.005, row)

    def test_the_ceiling_is_the_drivetrains_for_every_tank(self) -> None:
        # `setDifferential 4`, five gears and a c_ETTank's +-1 clamp give
        # 14.894 m/s for all four. The T-72's extra EngineDummyGrip springs
        # cost nothing: addFriction returns at 0x0825b75b / 0x0825c669 before
        # any friction, resistance or sample in the mean.
        for name, row in self.results["cruise"].items():
            with self.subTest(name):
                self.assertAlmostEqual(14.894, row["fullThrottle"], delta=0.02)

    def test_critical_damage_stops_a_land_drivetrain(self) -> None:
        # PHY-14: 0x14 from `Armor::status` clears and latches every Engine's
        # running byte under the PCO, and a land drive reads it
        # (`Engine::handleUpdate` holds its revs at 0). Driven at full
        # throttle through the page's seat tick, a critical Humvee or T-72
        # stops where it is. A re-boarding does not restart it. Out of
        # critical, the occupied engine runs again.
        for name, row in self.results["critical"].items():
            with self.subTest(name):
                self.assertTrue(row["wasCritical"])
                self.assertTrue(row["driving"]["running"])
                self.assertGreater(row["driving"]["speed"], 10.0)
                self.assertFalse(row["crippled"]["running"])
                self.assertEqual(0.0, row["crippled"]["revs"])
                self.assertLess(abs(row["crippled"]["speed"]), 0.2)
                self.assertFalse(row["reboarded"])
                self.assertTrue(row["recovered"]["running"])
                self.assertGreater(row["recovered"]["speed"], 10.0)

    def test_the_krupp_tops_out_on_its_own_drag(self) -> None:
        # XPack2's Krupp authors `drag 15` on 2,500 kg. Under the engine's box
        # law (PHY-4) that drag is quadratic over its 3.23 m^2 frontal ellipse:
        # on sand it settles at 19.0 m/s, about 68 km/h, below the gearbox's
        # 31.3 m/s ceiling. The sphere law it ran before let it reach 30.0.
        k = self.results["krupp"]
        if k is None:
            self.skipTest("no XPack2 tree")
        self.assertEqual(15, k["drag"])
        self.assertAlmostEqual(19.0, k["top"], delta=0.6)
        self.assertGreater(k["ceiling"], 30.0)

    def test_a_tank_turns_on_the_spot_at_retails_rate(self) -> None:
        # Lab, LOD 0, 0.5-2 m/s, yaw rate p90 / p99 / max (deg/s):
        # T-72 56.8 / 78.1 / 83.6, M1A1 54.9 / 79.6 / 84.0,
        # BMP-2 57.9 / 85.8 / 95.1, M2A3 58.5 / 82.5 / 85.1. A bot's turn on the
        # spot is full lock with the throttle held while it is slow.
        envelope = {"T72": (56.8, 83.6), "M1A1": (54.9, 84.0), "BMP2": (57.9, 95.1), "M2A3": (58.5, 85.1)}
        for name, (p90, top) in envelope.items():
            with self.subTest(name):
                rate = self.results["pivot"][name]["yawRate"]
                self.assertGreater(rate, p90)
                self.assertLess(rate, 1.2 * top)


if __name__ == "__main__":
    unittest.main()
