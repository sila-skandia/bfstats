"""A bot-driven hull shuffling in a pocket (features/bot-map-generation/
hull-steering.md, cause 1).

FH's and FHSW's Pegasus park their one drivable land hull, a RedTractor,
nose-in to a pocket six metres wide with its first route point behind it.
`actionStatusDecision` drives it ahead (state 9) while the run ahead beats
the 5 m turn radius and backs it (state 8) while it does not; across that
line it shuffles, each pedal change a second or more of the wheeled
drivetrain braking its revs through zero, and the hull hardly moves. The
obstruction count counted a forward throttle only, so every reverse tick
zeroed it and the hull's escape (the obstructed circle and the back-out
route) never came: 578 s of a 600 s match on FHSW's Pegasus, all of both
levels' hull-stuck time in seed 1.

`viewer/bot-route.js` now counts a hull's throttle either way
(`trackObstruction`, INVENTION like the rule it corrects) and plants the
hull's obstructed circle at the end its map gives the shorter run
(`onObstructed`), so a hull nosed into a pocket is backed out of it.

Once out of the pocket the same tractor met cause 2 (`HullBounceTests`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "bot_hull_shuffle_harness.mjs"
BOUNCE_HARNESS = Path(__file__).resolve().parent / "bot_hull_bounce_harness.mjs"


def run_harness(harness: Path = HARNESS) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            if not source.exists():
                raise unittest.SkipTest(f"{source.name} is not in the tree")
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(harness, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HullShuffleTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_hull_held_with_its_pedal_changing_sign_is_counted(self) -> None:
        # The flag at 150 counted ticks and the path failure at 401, the same
        # as a hull held at full throttle ahead.
        self.assertEqual(self.results["countHull"], {"flaggedAt": 150, "failedAt": 400})

    def test_a_soldier_count_is_unchanged(self) -> None:
        # His throttle is zero on the reverse half: those ticks reset it.
        self.assertEqual(self.results["countSoldier"], {"flaggedAt": None, "failedAt": None})

    def test_the_circle_goes_where_the_map_run_is_short(self) -> None:
        # Nosed into the pocket, the circle is ahead (4 m along the heading,
        # west) whichever pedal the flag fell on.
        for case in ("flagPocketReversing", "flagPocketForward"):
            with self.subTest(case=case):
                r = self.results[case]
                self.assertEqual(r["obstacles"], [[-4.0, 0.0, 4.5]])
                self.assertTrue(r["backOut"])
        # On open ground the pedal still decides: reversing, astern.
        self.assertEqual(self.results["flagOpenReversing"]["obstacles"], [[4.0, 0.0, 4.5]])

    def test_the_tractor_leaves_its_pocket_and_arrives(self) -> None:
        r = self.results["pocket"]
        self.assertIsNotNone(r["leftPocketAt"], f"still in the pocket at {r['end']}")
        self.assertIsNotNone(r["arrivedAt"], f"never arrived: ended at {r['end']}")
        self.assertLess(r["arrivedAt"], 75.0)
        self.assertGreaterEqual(r["circles"], 1)


class HullBounceTests(unittest.TestCase):
    """Cause 2: a hull pressed on a wall the map leaves open bounces on it,
    its velocity 0.5 to 2 m/s while it stays put, and the count and the
    touch rule (both "under 1 m/s") were zeroed every second or two. They
    now read `hullTravelSpeed`: the lower of the velocity and the ground
    covered over the last second (INVENTION, the soldier's `travelSpeed`
    counterpart)."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(BOUNCE_HARNESS)

    def test_the_travel_speed_is_the_ground_covered(self) -> None:
        r = self.results["speed"]
        self.assertEqual(r["first"], 0.7, "the body's speed until the window fills")
        self.assertEqual(r["atWindow"], 0.0)
        self.assertEqual(r["last"], 0.0)
        self.assertEqual(r["moving"], 3.0, "a hull under way reads its speed")
        self.assertEqual(r["fresh"], 1.8, "a new seat starts afresh")

    def test_a_bouncing_hull_is_counted_and_touched(self) -> None:
        self.assertEqual(self.results["pressedVelocity"], {"flaggedAt": None, "touchedAt": None})
        r = self.results["pressedTravel"]
        self.assertIsNotNone(r["flaggedAt"])
        self.assertLess(r["flaggedAt"], 200)
        self.assertIsNotNone(r["touchedAt"])
        self.assertLess(r["touchedAt"], 60)

    def test_a_back_out_point_astern_is_reversed_to(self) -> None:
        # Cause 3: the hull reverses straight to its back-out point when it
        # lies astern (the angle is state 8's, -asin(n . dir)); a point ahead,
        # or a plain route point, is the turn in the box's as before.
        r = self.results["backOut"]
        self.assertEqual(r["drive"], -1)
        self.assertAlmostEqual(abs(r["angle"]), 0.201, places=2)
        self.assertIsNone(r["ahead"])
        self.assertIsNone(r["plain"])

    def test_a_hull_walled_in_by_its_own_circles_forgets_them(self) -> None:
        # Cause 4: one failure keeps them (the route stays shut); the second
        # in a row drops the hull's four and keeps the predicted and the
        # soldier-sized circle, and the route opens.
        self.assertEqual(self.results["walledOnce"], {"left": 6, "route": False})
        self.assertEqual(self.results["walledTwice"], {"left": 2, "route": True})

    def test_a_goal_the_map_cannot_reach_is_approached_by_a_hull(self) -> None:
        # Cause 5: the painted coarse layer has no path across the wall; with
        # `nearest` it ends at the region nearest the goal on the start's
        # side (west of the wall at x 60), and only a hull's route asks so.
        r = self.results["nearest"]
        self.assertIsNone(r["plain"])
        self.assertTrue(r["short"])
        self.assertLess(r["end"][0], 60.0)
        self.assertGreater(r["end"][0], 40.0)
        self.assertTrue(r["hullRoute"])
        self.assertFalse(r["soldierRoute"])

    def test_a_hull_on_a_wall_the_map_does_not_show_gets_round_it(self) -> None:
        r = self.results["toyWall"]
        self.assertGreater(r["ticksOnWall"], 0, "the straight line does meet the wall")
        self.assertGreaterEqual(r["circles"], 1)
        self.assertIsNotNone(r["arrivedAt"], f"never arrived: ended at {r['end']}")
        self.assertLess(r["arrivedAt"], 40.0)
        self.assertLess(r["heldMax"], 5.0)


if __name__ == "__main__":
    unittest.main()
