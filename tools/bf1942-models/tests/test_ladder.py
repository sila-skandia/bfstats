"""`viewer/ladder-climb.js` + the climb path through `viewer/soldier.js` under
node (Gap 16, `features/ladder-climbing/README.md`).

Same pattern as `test_gait_select.py` -- one node run, many assertions -- with
`tests/ladder_harness.mjs` driving the real `Soldier` against a fake collider
whose duck-typed minimum is exactly what the body reads: `surfaceHeight`,
`waterLevel` and the ladder index. No static index, no page, no three.js, so
the whole climb law runs under plain node.

What this file pins:

* the engine's own standoff (0.48 m from `getLadderClosestPosition`
  0x08280b40) and the placeholder climb rate (2.5 m/s, chosen because
  `updateClimbing` 0x08280f10 is a no-op and no engine number exists);
* the grab law -- forward into the ladder takes it, two metres off the axis
  does not, a world with no ladder index never grabs;
* the hang (no input, no motion), the top exit (through the ladder, onto the
  deck side) and the bottom exit (feet back on the ground);
* the jump release (the queued impulse fires the tick the climb tears off)
  and the dead body falling out of the climb.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from math import pi

ROOT = Path(__file__).resolve().parents[1]
MODULES = [
    ROOT / "viewer" / "ladder-climb.js",
    ROOT / "viewer" / "soldier.js",
    ROOT / "viewer" / "spawn-flags.js",
    ROOT / "viewer" / "physics.js",
    ROOT / "viewer" / "walking-body.js",
    ROOT / "viewer" / "soldier-resolve.js",
    ROOT / "viewer" / "soldier-pose.js",
    ROOT / "viewer" / "soldier-locomotion.js",
    ROOT / "viewer" / "point-body.js",
    ROOT / "viewer" / "fixed-step.js",
    ROOT / "viewer" / "parachute.js",
    ROOT / "viewer" / "swim.js",
    ROOT / "viewer" / "spawn-safety.js",
]
HARNESS = Path(__file__).resolve().parent / "ladder_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        (work / "viewer").mkdir()
        for module in MODULES:
            shutil.copyfile(module, work / "viewer" / module.name)
        (work / "tests").mkdir()
        shutil.copyfile(HARNESS, work / "tests" / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "tests" / "harness.mjs")],
            capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LadderConstantsTests(unittest.TestCase):
    """The two numbers the feature doc names, read from the module itself."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_climb_rate_is_the_documented_placeholder(self) -> None:
        # `updateClimbing` 0x08280f10 is a literal no-op: the engine's climb
        # motion is animation root-motion and carries no speed constant to
        # copy. 2.5 m/s is the placeholder, declared in exactly one place.
        self.assertEqual(2.5, self.results["constants"]["climb"])

    def test_the_standoff_is_the_engines_own(self) -> None:
        # `getLadderClosestPosition` 0x08280b40: the fixed -0.48 m the snapped
        # soldier stands off the ladder plane, in metres, sign by convention.
        self.assertEqual(0.48, self.results["constants"]["standoff"])


class LadderClimbLawTests(unittest.TestCase):
    """The climb state end to end against the fake collider."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_walking_forward_into_the_ladder_grabs_and_snaps(self) -> None:
        snap = self.results["snap"]
        self.assertTrue(snap["active"])
        self.assertEqual("Ladder_10m", snap["name"])
        # The snap is the engine's standoff: 0.48 m off the axis on the side
        # he approached from (the soldier parked 0.8 m out at +x, face +x).
        self.assertAlmostEqual(0.48, snap["standoffDist"], places=3)
        # Facing the ladder: forward (-1, 0, 0) is yaw -pi/2.
        self.assertAlmostEqual(-pi / 2, snap["yaw"], places=3)

    def test_the_climb_moves_at_the_constant_rate(self) -> None:
        rate = self.results["rate"]
        # Two independent one-second windows on the same climb: the rate is
        # constant (the engine's is animation-driven; ours is the
        # documented placeholder), and the placeholder is the rate.
        self.assertAlmostEqual(2.5, rate["rise1"], places=1)
        self.assertAlmostEqual(2.5, rate["rise2"], places=1)

    def test_zero_input_hangs_without_motion_or_release(self) -> None:
        hang = self.results["hang"]
        self.assertAlmostEqual(hang["during"], hang["after"], places=9)
        self.assertTrue(hang["stillActive"])

    def test_the_top_exit_steps_through_the_ladder_onto_the_deck_side(self) -> None:
        top = self.results["topExit"]
        self.assertFalse(top["active"])
        # Feet at the ladder's top (10 m), stepped LADDER_TOP_STEP = 0.4 m
        # through the ladder to the far side (x = 2 - 0.4 = 1.6).
        self.assertAlmostEqual(10.0, top["y"], places=1)
        self.assertAlmostEqual(1.6, top["x"], places=1)
        self.assertAlmostEqual(0.4, top["inwardStep"], places=1)

    def test_the_bottom_exit_lands_back_on_the_ground(self) -> None:
        out = self.results["bottomExit"]
        self.assertFalse(out["atExit"]["active"])
        self.assertAlmostEqual(0.0, out["atExit"]["y"], places=1)
        self.assertTrue(out["settled"]["grounded"])
        self.assertAlmostEqual(0.0, out["settled"]["y"], places=1)

    def test_jump_tears_the_climb_off_and_the_leap_fires(self) -> None:
        out = self.results["jumpOff"]
        self.assertFalse(out["atLeap"]["active"])
        # The queued impulse fired on the tick the ordinary body step resumed.
        self.assertGreater(out["atLeap"]["vy"], 0.0)
        # He came down from a 2.5 m climb without dying of it.
        self.assertLess(out["yAfter"], out["yAt"])

    def test_a_dead_body_falls_out_of_the_climb(self) -> None:
        out = self.results["deadDrop"]
        self.assertFalse(out["active"])
        self.assertLess(out["y"], out["yAt"])

    def test_two_metres_off_the_axis_is_out_of_reach(self) -> None:
        self.assertFalse(self.results["tooFar"]["active"])

    def test_a_world_without_a_ladder_index_never_grabs(self) -> None:
        self.assertFalse(self.results["noLadders"]["active"])

    def test_stepping_backwards_off_a_deck_takes_the_ladder_downward(self) -> None:
        out = self.results["backGrab"]
        grab = out["grab"]
        # The backward grab only takes beside the top rungs, at the top of the
        # climb line; the snap still lands on the engine's standoff.
        self.assertTrue(grab["active"])
        self.assertAlmostEqual(1.0, grab["t"], places=1)
        self.assertAlmostEqual(0.48, grab["standoffDist"], places=3)
        # And the descent covers the ladder back down to the ground.
        self.assertFalse(out["finished"]["active"])
        self.assertAlmostEqual(0.0, out["finished"]["y"], places=1)


if __name__ == "__main__":
    unittest.main()
