"""A bot-driven hull wedged on a prop the vehicle map does not show
(features/browser-play-feedback-2026-11-06 #5, "Bots not driving tanks").

On Wake Island a Chi-ha's front-left corner caught a steel barrel at the
Airfield's supply depot and the hull held full throttle there for 146 s. The
obstruction handling was soldier-sized: the touched-object rule ran on foot
only, the obstructed flag planted a 1.5 m circle a metre along the turret's
look (inside a 3 m hull), each re-plan reset the stalled-tick count so the
401-tick path failure never came, and the route's first point lay ahead, so
`actionStatusDecision` drove forward into the barrel for good.

`viewer/bot-route.js` now has a hull touch rule fed by `drive.hullContacts`
(`trackHullContact`, an INVENTION like the soldier rule), a hull-sized
obstructed circle, the obstruction count kept across the viewer's own
re-plans for a hull so the 401-tick failure comes (`ObstructionDetection::
update` 0x08532b00, `getNewIntermediatePathPos` 0x0852ab60; `initPathfinding`
0x0852a0d0 zeroes it only for a new path), and a back-out point the
re-planned route starts at.

`SyntheticWedgeTests` runs everywhere: the pieces on their own and a toy hull
driven by the real executor. `WakeWedgeTests` puts a Sherman where the
Chi-ha wedged on the real Wake bake; the extracted maps tree is untracked, so
it looks in `$BF42_VIEWER_ASSETS`, this checkout's `viewer/` and the main
checkout's, and skips when Wake is in none of them.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bot_ai import MODULES, THREE_PACKAGE  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "bot_hull_wedge_harness.mjs"
WAKE_HARNESS = Path(__file__).resolve().parent / "sim_hull_wedge_harness.mjs"


def run_harness() -> dict:
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
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def find_wake_assets() -> Path | None:
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
        if (c / "maps" / "wake" / "scene.glb").exists() and (c / "maps" / "_shared" / "vehicle-ai.json").exists() \
                and (c / "models" / "Sherman.glb").exists():
            return c
    return None


class SyntheticWedgeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_held_wall_contact_plants_a_hull_sized_circle_on_it(self) -> None:
        r = self.results["touch"]
        # CONTACT_TICKS (10) of the hold, then one circle of the hull's 3 m
        # radius plus the 1.5 m stand-in object radius, on the contact.
        self.assertEqual(r["plantedAt"], 9)
        self.assertEqual(r["obstacles"], [[101.7, -103.4, 4.5]])
        self.assertTrue(r["failed"])
        self.assertTrue(r["backOut"])

    def test_the_rule_wants_a_wall_the_hull_pushes_into_while_held(self) -> None:
        for case in ("touchFloor", "touchBehind", "touchMoving", "touchIdle"):
            with self.subTest(case=case):
                r = self.results[case]
                self.assertIsNone(r["plantedAt"])
                self.assertEqual(r["obstacles"], [])
                self.assertFalse(r["failed"])

    def test_a_covered_contact_does_not_fail_the_route_again(self) -> None:
        r = self.results["touchAgain"]
        self.assertEqual(r["planted"], 1)
        self.assertEqual(r["again"], 0)
        self.assertEqual(r["circles"], 1)
        self.assertFalse(r["failed"])

    def test_the_hull_obstructed_circle_is_hull_sized_past_its_front(self) -> None:
        # Heading -z: the circle is 4 m (R + 1) ahead along the hull, whatever
        # the turret looks at, and 4.5 m (R + 1.5) across.
        r = self.results["obstructedAhead"]
        self.assertEqual(len(r["obstacles"]), 1)
        dx, dz, radius = r["obstacles"][0]
        self.assertAlmostEqual(dx, 0.0, places=2)
        self.assertAlmostEqual(dz, -4.0, places=2)
        self.assertEqual(radius, 4.5)
        self.assertTrue(r["failed"])
        self.assertTrue(r["backOut"])
        # Reversing, it is planted astern.
        self.assertAlmostEqual(self.results["obstructedReversing"]["obstacles"][0][1], 4.0, places=2)
        # Running fine across paint no point traces over: re-plan only.
        moving = self.results["obstructedMoving"]
        self.assertEqual(moving["obstacles"], [])
        self.assertTrue(moving["failed"])
        self.assertFalse(moving["backOut"])

    def test_a_soldiers_obstructed_circle_is_unchanged(self) -> None:
        r = self.results["obstructedSoldier"]
        self.assertEqual(r["obstacles"], [[11.0, 10.0, 1.5]])
        self.assertTrue(r["failed"])

    def test_a_hull_replan_keeps_the_count_and_fails_at_401(self) -> None:
        hull = self.results["countsHull"]
        # 401 ticks of the hold fail the path (the counter is not reset by the
        # obstructed flag's re-plan at 150).
        self.assertEqual(hull["failedAt"], 400)
        self.assertGreaterEqual(hull["replans"], 2)
        # A soldier's re-plan resets it, so his never fails: as before.
        self.assertIsNone(self.results["countsSoldier"]["failedAt"])
        # A new path for its own reasons (here the goal moved) starts it
        # again, as `initPathfinding` zeroes it.
        self.assertEqual(self.results["countsGoalMove"], {"before": 100, "after": 0})

    def test_the_replanned_route_backs_out_of_the_circle_first(self) -> None:
        r = self.results["backOut"]
        self.assertLess(r["behind"], 0.0, "the first point is astern of the hull")
        self.assertGreaterEqual(r["clearOfCircle"], 4.5)
        self.assertTrue(r["steersAtIt"])
        self.assertTrue(r["keptInside"], "not popped inside the hull's 3 m radius")
        self.assertTrue(r["droppedOnceClear"])
        self.assertEqual(r["resolvedStart"], r["first"])
        # Only a wedge asks for one.
        self.assertIsNone(r["noBackOutAsked"])

    def test_the_decision_backs_out_from_inside_a_circle(self) -> None:
        r = self.results["decisionInside"]
        self.assertEqual(r["state"], 8)
        self.assertEqual(r["drive"], -1)

    def test_a_hull_wedged_on_a_barrel_gets_free_and_arrives(self) -> None:
        r = self.results["toyWedge"]
        self.assertGreater(r["touchedTicks"], 0, "the straight line does put the corner on the barrel")
        self.assertEqual(r["circles"], 1)
        self.assertEqual(r["circleR"], 4.5)
        self.assertIsNotNone(r["arrivedAt"], f"never arrived: ended at {r['end']}")
        self.assertLess(r["arrivedAt"], 30.0)
        # Never held at full throttle against it for long.
        self.assertLess(r["maxPressed"], 3.0)


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class WakeWedgeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        assets = find_wake_assets()
        if assets is None:
            raise unittest.SkipTest("no extracted Wake Island (set BF42_VIEWER_ASSETS)")
        proc = subprocess.run(["node", str(WAKE_HARNESS), str(assets)], capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_a_hull_pressed_on_the_depot_barrel_leaves_within_15_s(self) -> None:
        r = self.results["pressed"]
        self.assertTrue(r["mounted"])
        self.assertEqual(r["wedgedAt"], 0.03)
        self.assertGreaterEqual(r["contactCircles"], 1)
        self.assertIsNotNone(r["leftAt"], "still on the barrel after 40 s")
        self.assertLess(r["leftAt"], 15.0)
        self.assertGreater(r["at40"]["away"], 20.0)
        self.assertLess(r["maxPressed"], 5.0)

    def test_a_hull_on_its_approach_drives_on_past(self) -> None:
        r = self.results["approach"]
        self.assertGreater(r["at40"]["away"], 20.0)
        self.assertLess(r["maxPressed"], 5.0)


if __name__ == "__main__":
    unittest.main()
