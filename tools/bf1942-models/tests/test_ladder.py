"""`viewer/ladder-climb.js` + the climb path through `viewer/soldier.js` under
node (Gap 16, `features/ladder-climbing/README.md`, ledger LADDER-1..5).

Same pattern as `test_gait_select.py` -- one node run, many assertions -- with
`tests/ladder_harness.mjs` driving the real `Soldier` against a fake collider
whose duck-typed minimum is exactly what the body reads: `surfaceHeight`,
`waterLevel` and the ladder index. No static index, no page, no three.js, so
the whole climb law runs under plain node. The harness ladder is built the
way a level builds one, through `ladderRecord`, 20 m tall with its origin at
its middle and its +z (the deck side) along world -x.

What this file pins, all of it `BFSoldier::handleClimbAction` 0x08281080,
`getLadderClosestPosition` 0x08280b40 and `stopClimbing` 0x08281ca0:

* the grab: forward held, touching, and either below the ladder's origin
  facing its +z (no position written) or above it facing its -z (dropped
  2.0 m); no backward press, no sideways approach, nothing level with or
  above the origin from the -z side, nothing under 0.48 m of water;
* the snap: the -z face at 0.48 m, across the rungs where the clamp puts him,
  facing +z;
* the climb: 4.2 m/s up and 2.8 down at the full ramp (the standing row of
  `directionalSpeed` times the climb states' `setSpeed 0.7`), a third with
  the walk key, the direction his look picks, the hang;
* the ends, against his origin and the ladder's box: the top 0.8 m under its
  top lifts him 2.0 m and a metre through the ladder onto the deck, the
  bottom lets go with his feet 0.6 m over its bottom, climbing down 0.5 m
  under water lets go; a jump press lets go without a leap, and so does
  death.
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
    ROOT / "viewer" / "rocket-pack.js",
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
    """The engine's numbers, read from the module itself."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_climb_rate_is_the_engines_movement_law(self) -> None:
        # `handlePlayerInput` sets the climber's velocity along the ladder's
        # up axis (`setPositionalSpeed`, 0x08274ccd) from the ordinary forward
        # command: the standing row of `directionalSpeed` (6 forward, 4 not)
        # times the lower state's `setSpeed`, 0.7 for every climb state in
        # `AnimationStatesClimb.con`. It used to be a 2.5 m/s placeholder.
        constants = self.results["constants"]
        self.assertAlmostEqual(0.7, constants["stateSpeed"], places=9)
        self.assertAlmostEqual(4.2, constants["climb"], places=9)
        self.assertAlmostEqual(2.8, constants["descent"], places=9)

    def test_the_standoff_is_the_engines_own(self) -> None:
        # `getLadderClosestPosition` 0x08280b40: the climber is put at -0.48 on
        # the ladder's own z (the immediate at 0x08280e18).
        self.assertEqual(0.48, self.results["constants"]["standoff"])

    def test_the_record_carries_the_ladders_own_frame(self) -> None:
        # The origin is the node's, the box runs 10 m either side of it, and
        # the ladder's +z is the node's glTF -z (the exporter mirrors
        # Refractor's z): world -x for the harness's yawed node.
        record = self.results["record"]
        self.assertEqual([2, 10, 0], record["origin"])
        for got, want in zip(record["plusZ"], [-1, 0, 0]):
            self.assertAlmostEqual(want, got, places=9)
        self.assertAlmostEqual(-10.0, record["yMin"], places=9)
        self.assertAlmostEqual(10.0, record["yMax"], places=9)
        self.assertAlmostEqual(-0.3, record["xMin"], places=9)
        self.assertAlmostEqual(0.3, record["xMax"], places=9)


class LadderGrabTests(unittest.TestCase):
    """`handleClimbAction`'s grab and the snap that follows it."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_walking_forward_into_the_ladder_grabs_and_snaps(self) -> None:
        snap = self.results["snap"]
        self.assertTrue(snap["active"])
        self.assertEqual("Ladder_20m", snap["name"])
        # The -z face: 0.48 m off the ladder's plane (x = 2) on its -z side.
        self.assertAlmostEqual(2.48, snap["x"], places=6)
        # Across the rungs the clamp's crossed bounds put him on a 0.6 m
        # ladder 0.1 m off its middle, never on it (0x08280dd5-0x08280dfb).
        self.assertAlmostEqual(0.1, abs(snap["z"]), places=6)
        # Facing the ladder's +z, world -x: yaw -pi/2.
        self.assertAlmostEqual(-pi / 2, snap["yaw"], places=6)

    def test_the_grab_keeps_his_height(self) -> None:
        # The below arm writes no position (0x082818f4) and the snap keeps his
        # coordinate up the ladder: from the ground and from a platform 3 m
        # up he stays at his height, bar the one tick of climbing that rides
        # the grab's own tick (0x0828125b onward) from a standing ramp.
        grab = self.results["grabHeight"]
        self.assertTrue(grab["ground"]["active"])
        self.assertLess(abs(grab["ground"]["y"]), 0.01)
        self.assertTrue(grab["platform"]["active"])
        self.assertLess(abs(grab["platform"]["y"] - 3.0), 0.01)
        self.assertAlmostEqual(0.15, grab["platform"]["t"], places=2)

    def test_walking_forward_off_the_deck_takes_the_ladder_down(self) -> None:
        # The above arm: his origin over the ladder's and his forward against
        # its +z (`< -0.8`, 0x08281817). Dropped 2.0 m (0x0828192e) before
        # the snap, put on the -z face and turned to face the ladder; looking
        # down, W takes him down it to the bottom exit and the ground.
        top = self.results["topGrab"]
        grab = top["grab"]
        self.assertTrue(grab["active"])
        self.assertLess(abs(grab["drop"] - 2.0), 0.01)
        self.assertAlmostEqual(2.48, grab["x"], places=6)
        self.assertAlmostEqual(-pi / 2, grab["yaw"], places=6)
        self.assertEqual("bottom", top["exit"]["kind"])
        self.assertTrue(top["settled"]["grounded"])
        self.assertAlmostEqual(0.0, top["settled"]["y"], places=3)

    def test_a_backward_press_at_the_top_never_grabs(self) -> None:
        # The engine takes a ladder only with forward held (0x082811b6-
        # 0x082811c5). The page used to take it on a backward press beside
        # the top rungs.
        self.assertFalse(self.results["noBackGrab"]["took"])

    def test_facing_along_the_ladder_does_not_grab(self) -> None:
        # `dot > 0.8` against the ladder's +z (0x082817ed): at its foot but
        # facing along it, W walks past.
        self.assertFalse(self.results["sideways"]["took"])

    def test_above_the_ladders_origin_on_its_climbing_side_does_not_grab(self) -> None:
        # The below arm wants the ladder's origin over his; facing its +z he
        # cannot take the above arm either.
        self.assertFalse(self.results["aboveOrigin"]["took"])

    def test_walking_away_from_it_on_its_deck_side_does_not_grab(self) -> None:
        # The page's touch: the engine's is his hull meeting the ladder's, so
        # the page asks that he be on the side he faces it from. Half a metre
        # off its +z side, facing +z, W walks him away; the old reach took him
        # and put him through the ladder.
        self.assertFalse(self.results["walkingAway"]["took"])

    def test_two_metres_off_the_face_is_out_of_reach(self) -> None:
        self.assertFalse(self.results["tooFar"]["active"])

    def test_a_world_without_a_ladder_index_never_grabs(self) -> None:
        self.assertFalse(self.results["noLadders"]["active"])


class LadderClimbTests(unittest.TestCase):
    """The motion: the rate, the direction, the hang."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_climb_rises_at_the_engines_rate(self) -> None:
        rate = self.results["rate"]
        self.assertTrue(rate["active"])
        # The second second is all full ramp: 4.2 m. The first loses the
        # ramp's 0.212 s (PHY-6) from a standing start.
        self.assertAlmostEqual(4.2, rate["rise2"], places=6)
        self.assertLess(rate["rise1"], rate["rise2"])
        self.assertGreater(rate["rise1"], 3.7)

    def test_the_descent_and_the_walk_key(self) -> None:
        rates = self.results["rates"]
        self.assertTrue(rates["active"])
        self.assertAlmostEqual(2.8, rates["down"], places=6)
        self.assertAlmostEqual(1.4, rates["walkUp"], places=6)

    def test_the_look_picks_the_way(self) -> None:
        # A held throttle becomes the sign of his aim pitch (+0x284,
        # 0x08281382-0x082813aa): W looking down descends, S looking up climbs.
        look = self.results["look"]
        self.assertTrue(look["active"])
        self.assertLess(look["wDown"], -2.0)
        self.assertGreater(look["sUp"], 3.0)

    def test_zero_input_hangs_once_the_ramp_has_run_down(self) -> None:
        hang = self.results["hang"]
        self.assertAlmostEqual(hang["a"], hang["b"], places=9)
        self.assertTrue(hang["stillActive"])


class LadderExitTests(unittest.TestCase):
    """The ends against his origin and the ladder's box, and letting go."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_top_lifts_him_through_the_ladder_onto_the_deck(self) -> None:
        # Climbing up, he lets go where his origin passes the box's top less
        # 0.8 (0x0828163a): origin 19.2, feet 18.2. `stopClimbing` lifts him
        # 2.0 m (0x08281efa) and a metre along +z (0x08282002-0x08282027),
        # from -0.48 to +0.52: feet at 20.2 (plus the last tick's climb),
        # x = 2 - 0.52 = 1.48, over the deck, which he then stands on.
        top = self.results["topExit"]
        self.assertFalse(top["active"])
        exit_ = top["exit"]
        self.assertEqual("top", exit_["kind"])
        self.assertTrue(exit_["lifted"])
        self.assertGreaterEqual(exit_["y"], 20.2 - 1e-6)
        self.assertLess(exit_["y"], 20.2 + 4.2 / 60 + 1e-6)
        self.assertAlmostEqual(1.48, exit_["x"], places=6)
        self.assertTrue(top["settled"]["grounded"])
        self.assertAlmostEqual(20.0, top["settled"]["y"], places=3)

    def test_the_bottom_lets_go_with_his_feet_0_6_over_the_box(self) -> None:
        # Climbing down, his origin under the box's bottom plus 1.6
        # (0x0828154e): his feet under 0.6. No lift; he drops to the ground.
        out = self.results["bottomExit"]
        exit_ = out["exit"]
        self.assertEqual("bottom", exit_["kind"])
        self.assertFalse(exit_["lifted"])
        self.assertLess(exit_["y"], 0.6)
        self.assertGreater(exit_["y"], 0.6 - 2.8 / 60 - 1e-6)
        self.assertTrue(out["settled"]["grounded"])
        self.assertAlmostEqual(0.0, out["settled"]["y"], places=3)

    def test_climbing_down_into_water_lets_go(self) -> None:
        # The grab refuses an origin 0.48 m or more under water (0x082817b0);
        # climbing down lets go 0.5 m under it (0x0828160a): water at 5, so
        # his feet under 3.5.
        water = self.results["water"]
        self.assertTrue(water["refused"])
        self.assertTrue(water["took"])
        self.assertEqual("water", water["exit"]["kind"])
        self.assertLess(water["exit"]["y"], 3.5)
        self.assertGreater(water["exit"]["y"], 3.5 - 2.8 / 60 - 1e-6)

    def test_a_swimmer_takes_a_net_and_stops_swimming(self) -> None:
        # The swim pins his origin 0.4 m under the surface (swim.js), under
        # the grab's 0.48, so a swimmer takes a ladder over the water; the
        # grab's `Lb/Ub_ClimbLadder1` (0x08281835, 0x08281871) replace the
        # swim states, so he is no longer swimming. The page used to refuse
        # any swimmer.
        swimmer = self.results["swimmer"]
        self.assertTrue(swimmer["before"]["swimming"])
        self.assertTrue(swimmer["active"])
        self.assertFalse(swimmer["swimming"])
        self.assertLess(abs(swimmer["y"] - swimmer["before"]["y"]), 0.01)

    def test_a_jump_press_lets_go_without_a_leap(self) -> None:
        # `c_PIAction` on the ladder is `stopClimbing`, and the action is
        # written back as 0.0 (0x08281219): no jump. What is left is the
        # climb's own velocity less the push (0x08281ecc) and a tick of
        # gravity, under the 4.2 m/s he climbed at; the page's old leap came
        # out over it.
        out = self.results["jumpOff"]
        at = out["atLetGo"]
        self.assertFalse(at["active"])
        self.assertEqual("jump", at["exit"]["kind"])
        self.assertLess(at["vy"], 4.2)
        self.assertAlmostEqual(0.0, out["yAfter"], places=3)

    def test_a_dead_body_lets_go_and_falls(self) -> None:
        out = self.results["deadDrop"]
        self.assertFalse(out["active"])
        self.assertEqual("dead", out["exit"]["kind"])
        self.assertTrue(out["stillOff"])
        self.assertLess(out["y"], out["yAt"])


if __name__ == "__main__":
    unittest.main()
