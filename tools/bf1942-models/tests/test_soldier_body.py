"""The soldier's AI body, read on lnxded (ledger AI-197): the first geometry's
`BodyCollision` hull, radius 1.0, smallest radius sqrt(0.4^2 + 0.9^2 + 0.4^2),
sphere offset 0.1, and the path removal distance made from them."""
from __future__ import annotations

import json
import math
import subprocess
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


class SoldierBodyTests(unittest.TestCase):
    def test_the_body_constants_are_the_hull_boxs(self) -> None:
        code = ("import * as s from './bot-sense.js'; import {pathRadius} from './bot-decision.js';"
                "console.log(JSON.stringify([s.SOLDIER_RADIUS, s.SOLDIER_SMALLEST_RADIUS,"
                "s.SOLDIER_SPHERE_OFFSET, s.SOLDIER_PATH_REMOVAL, pathRadius({vehicle:null})]))")
        out = subprocess.run(["node", "--input-type=module", "-e", code], cwd=VIEWER,
                             capture_output=True, text=True, check=True).stdout
        radius, smallest, offset, removal, bot = json.loads(out.strip().splitlines()[-1])
        self.assertEqual(1.0, radius)                         # 0x083af2fb
        self.assertAlmostEqual(math.sqrt(0.16 + 0.81 + 0.16), smallest, places=6)   # 0x083809f0 +0x1c
        self.assertEqual(0.1, offset)                         # the box centre (0, -0.1, 0)
        self.assertAlmostEqual(0.99 * (smallest - 0.1), removal, places=6)          # 0x0852b780
        self.assertEqual(removal, bot)


class LastLegTests(unittest.TestCase):
    def test_the_last_leg_takes_the_moves_radius_and_the_rest_the_draw(self) -> None:
        # `updateLocalPath` 0x08527120 (AI-191): the last leg's box is BotMain+0x5c, the
        # waypoint walk's radius, 0.0 for every other foot move; other legs 10 + rand 14,
        # the largest obstacle, plus 1; a hull keeps the draw.
        code = ("import {legSearchRadius} from './bot-route.js';"
                "const foot = (wp, ob = []) => ({vehicle: null, obstacles: ob, _pathFailures: 0,"
                " _routeOwner: wp === null ? {} : {waypointObject: {radius: wp}}});"
                "const r0 = () => 0, r1 = () => 1;"
                "console.log(JSON.stringify([legSearchRadius(foot(37), true), legSearchRadius(foot(null), true),"
                "legSearchRadius(foot(37), false, r0), legSearchRadius(foot(37), false, r1),"
                "legSearchRadius(foot(37, [{r: 30}]), false, r0),"
                "legSearchRadius({...foot(37), vehicle: {}}, true, r0)]))")
        out = subprocess.run(["node", "--input-type=module", "-e", code], cwd=VIEWER,
                             capture_output=True, text=True, check=True).stdout
        self.assertEqual([37, 0, 11, 25, 31, 11], json.loads(out.strip().splitlines()[-1]))


if __name__ == "__main__":
    unittest.main()
