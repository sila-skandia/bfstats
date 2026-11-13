"""A cover's portals and the soldier's throw through one (ledger AI-116, SM-16).

`getAttackPortal` 0x085a28c0 reads `AIObjectCover::getPortalCount`, which is the
PortalMesh at the tail of the cover's StandardMesh: the portals of the 95
vanilla `.sm` files that carry them. The exporter keeps each as a plane
(`extract_vehicle_ai.py portal_plane`); `viewer/bot-portal.js` ports the key,
the firing position, the look-at point and the portal passing.
"""

# watches: nothing
# (the harness is a fixed file; scripts/select_model_tests.py)

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extract_vehicle_ai as eva  # noqa: E402


class PortalPlaneTests(unittest.TestCase):
    def test_a_door_facing_minus_z(self):
        # cross(p2 - p0, p1 - p0) of a counter-clockwise door in x-y is -z.
        plane = eva.portal_plane([(0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0)])
        self.assertEqual([1.0, 1.0, 0.0, 0.0, 0.0, -1.0, -1.0, 1.0, 0, 2], plane)

    def test_the_other_winding_faces_the_other_way(self):
        plane = eva.portal_plane([(0, 0, 0), (0, 2, 0), (2, 2, 0), (2, 0, 0)])
        self.assertEqual(1.0, plane[5])

    def test_the_extents_run_along_the_horizontal_axis_of_the_plane(self):
        # A polygon off-centre of its mean vertex: left reaches -2, right 1.
        plane = eva.portal_plane([(0, 0, 0), (3, 0, 0), (3, 1, 0), (0, 1, 0)])
        self.assertEqual(-1.5, plane[6])
        self.assertEqual(1.5, plane[7])

    def test_a_degenerate_polygon_has_a_zero_normal(self):
        plane = eva.portal_plane([(0, 0, 0), (1, 0, 0), (2, 0, 0)])
        self.assertEqual([0.0, 0.0, 0.0], plane[3:6])


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class PortalViewerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        proc = subprocess.run(["node", str(ROOT / "tests" / "bot_portal_harness.mjs")],
                              capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_the_plane_goes_through_the_page_frame(self):
        self.assertEqual([1, 1, 0], self.out["world"]["centre"])
        self.assertEqual([0, 0, 1], self.out["world"]["normal"])

    def test_the_key_picks_the_portal_near_the_bot_and_the_target(self):
        self.assertEqual(1, self.out["pick"])
        self.assertEqual(-1, self.out["none"])
        self.assertEqual(0, self.out["tie"])           # the first of equal keys

    def test_a_lopsided_span_raises_the_key(self):
        self.assertEqual(1, self.out["lopsided"])      # extentR + extentL = 4

    def test_state_three_weight(self):
        for got, p in zip(self.out["weight"], (1, 2, 4)):
            self.assertAlmostEqual(1 - 1 / (2 * p * p + 1), got, places=6)

    def test_the_firing_position_stands_between_min_and_max_range(self):
        self.assertAlmostEqual(15.0, self.out["firing"]["position"][2], places=3)
        self.assertEqual([0, 0, -1], self.out["firing"]["direction"])
        self.assertIsNone(self.out["refused"])
        self.assertEqual([1, 0, -100], self.out["look"])

    def test_the_advance_weights(self):
        w = self.out["advanceWeights"]
        self.assertAlmostEqual(0.3, w["five"][0], places=6)        # 0x086c030c
        self.assertAlmostEqual(0.15, w["five"][1], places=6)       # / the count of state 5
        self.assertAlmostEqual(0.4, w["six"][0], places=6)         # 0x086c4f70
        self.assertAlmostEqual(0.1, w["six"][1], places=6)
        self.assertAlmostEqual(0.9, w["seven"][0], places=6)       # 1 - 1 / (v^2 + 1)
        self.assertAlmostEqual(0.45, w["seven"][1], places=6)      # n6 > 0: / n7
        self.assertEqual(None, w["seven"][2])                      # / 0 is infinity (JSON null)

    def test_the_advance_choice_takes_the_first_state_that_beats_its_roll(self):
        c = self.out["advanceChoice"]
        self.assertEqual(7, c["lowRollSeven"])    # the table's order: 7, 6, 5
        self.assertEqual(6, c["highRollSix"])     # nothing wins: the first eligible stands
        self.assertEqual(5, c["roll35"])
        self.assertEqual(6, c["sixOverFive"])
        self.assertEqual(0, c["none"])

    def test_a_move_stops_inside_half_of_its_radius(self):
        r = self.out["advanceRadius"]
        self.assertEqual(2.0, r[0])                # getMaxPathPosRemovalDistance + getRadius
        self.assertEqual(1.0, r[1])                # BAPConPosition(point, 0.5 r), 0x085a7e48
        self.assertAlmostEqual(0.745, r[2], places=5)
        self.assertEqual([1, 0, 1, 0, 0, 2, 0, 1], self.out["counts"])

    def test_walking_through_a_door_is_inside_and_back_is_out(self):
        self.assertEqual([-1, -1, 7, -1], self.out["inside"])
        self.assertEqual([-1, -1], self.out["missesWall"])


if __name__ == "__main__":
    unittest.main()


def _viewer():
    return ROOT / "viewer"


import os  # noqa: E402


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
@unittest.skipUnless(os.environ.get("BF42_PORTAL_AI") and (_viewer() / "maps" / "liberation_of_caen" / "scene.glb").exists(),
                     "needs maps/liberation_of_caen and $BF42_PORTAL_AI (a vehicle-ai.json with coverPortalPlanes)")
class PortalMatchTests(unittest.TestCase):
    """A thrower in the headless runner walks to the firing position of a portal of the
    house the target has walked into (state 3), on a real level."""

    def test_the_thrower_goes_to_the_portals_firing_position(self):
        env = dict(os.environ, OUT="18", COVER_INDEX="1")
        proc = subprocess.run(["node", str(ROOT / "tests" / "sim_portal_harness.mjs"), str(_viewer() / "maps"),
                               str(_viewer() / "models"), "liberation_of_caen", os.environ["BF42_PORTAL_AI"]],
                              capture_output=True, text=True, timeout=600, env=env)
        self.assertEqual(0, proc.returncode, proc.stderr[-500:])
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertTrue(out["targetInside"])
        self.assertEqual([3], out["states"])
        self.assertTrue(out["goalInFront"])
        self.assertTrue(out["moveDone"])
        # The move ends inside 0.5 r of the point (r = 2 for a soldier on the page's stand-ins).
        self.assertLess(out["finalToGoal"], 1.0)

    @unittest.skipUnless(os.environ.get("GRENADE_GLB"), "needs $GRENADE_GLB (a weapon glb with a thrown FireArms)")
    def test_the_grenade_is_thrown_from_the_firing_position(self):
        env = dict(os.environ, OUT="18", COVER_INDEX="1")
        proc = subprocess.run(["node", str(ROOT / "tests" / "sim_portal_harness.mjs"), str(_viewer() / "maps"),
                               str(_viewer() / "models"), "liberation_of_caen", os.environ["BF42_PORTAL_AI"]],
                              capture_output=True, text=True, timeout=600, env=env)
        self.assertEqual(0, proc.returncode, proc.stderr[-500:])
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        self.assertTrue(out["weaponData"])
        self.assertEqual(1, out["shots"])
        self.assertLess(out["threwFromGoal"], 1.0)

    def test_the_advance_states_walk_to_the_portal_and_through_it(self):
        env = dict(os.environ, OUT="18", COVER_INDEX="1", ADVANCE="1")
        proc = subprocess.run(["node", str(ROOT / "tests" / "sim_portal_harness.mjs"), str(_viewer() / "maps"),
                               str(_viewer() / "models"), "liberation_of_caen", os.environ["BF42_PORTAL_AI"]],
                              capture_output=True, text=True, timeout=600, env=env)
        self.assertEqual(0, proc.returncode, proc.stderr[-500:])
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        # No throw to make and the target in a house: 6 walks to the firing
        # position out in front of the door, 5 closes in on the target.
        six = out["advanceOutside"]["6"]
        self.assertEqual(["InfanteryMoveTo"], six["plan"])
        self.assertGreater(six["frontOfPortal"], 5.0)
        # 0.5 (0.99 max(0.5, 1.063 - 0.1) + 1.0): the soldier's box (AI-197).
        self.assertAlmostEqual(0.5 * (0.99 * (math.hypot(0.4, 0.9, 0.4) - 0.1) + 1.0), six["arrive"], places=5)
        self.assertEqual(["InfanteryMoveToObject", "MouseTurretAimAt"], out["advanceOutside"]["5"]["plan"])
        # The thrower inside the house: 7 walks to just behind the portal.
        self.assertTrue(out["thrower7Inside"])
        seven = out["advanceInside"]["7"]
        self.assertEqual(60, seven["n"])
        self.assertLess(seven["frontOfPortal"], 0)
        self.assertLess(seven["toPortal"], 3.0)
