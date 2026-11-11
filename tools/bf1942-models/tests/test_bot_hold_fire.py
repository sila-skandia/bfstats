"""The bots' hold-fire for a teammate in the line and their give-up on a unit
they cannot reach, driven headless by `bot_hold_fire_harness.mjs`.

Both are INVENTIONs (features/bot-map-generation/hold-fire.md). The engine
has no hold-fire (ledger FF-7) and no give-up (AI-140): a retail bot fires
through a friend in its line, and builds the same Change plan for a unit it
cannot reach for as long as it wants it.

* `friendly-fire.js` `friendInLine`: a living teammate's body (a vertical
  axis, feet to the stance's top) within `HOLD_FIRE.radius` of the line from
  the muzzle to the target's aim point, nearer than the target by
  `clearOfTarget`, within `reach`.
* `bot-plans.js` `execTrigger` / `holdFireFor`: the trigger stays up while one
  is there and goes down the tick the line clears; on foot, after `stepAfter`
  s of holding, a strafe away from the friend for `stepSeconds`.
* `bot-mount.js` `execEnterVehicle` / `UNIT_VETO`: a Change walk that gains
  no metre on the seat in `patience` s, or whose route has failed `failures`
  times, vetoes the unit's hull for that bot for `seconds`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("bot_hold_fire_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HoldFireTubeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_tube_is_a_body_wide_and_bounded(self) -> None:
        t = self.results["tube"]
        self.assertEqual(0.6, t["radius"])
        self.assertEqual(100, t["reach"])
        # The page logged victims 46 to 64 m down the line on The_Maze.
        self.assertEqual("a", t["farInReach"]["id"])

    def test_a_friend_in_the_tube_is_found(self) -> None:
        t = self.results["tube"]
        self.assertEqual("a", t["inTube"]["id"])
        self.assertAlmostEqual(5.0, t["inTube"]["along"], places=2)
        self.assertEqual("a", t["offByHalf"]["id"])
        self.assertEqual("a", t["justInFrontOfTarget"]["id"])
        # A body overlapping the muzzle (the page logged victims 0.2 m off it).
        self.assertEqual("a", t["atTheMuzzle"]["id"])

    def test_a_friend_beside_the_line_or_beyond_the_target_is_not(self) -> None:
        t = self.results["tube"]
        for case in ("beside", "beyondTarget", "atTarget", "behindShooter", "proneUnderLine", "pastReach"):
            self.assertIsNone(t[case], case)

    def test_the_nearest_friend_and_its_side(self) -> None:
        t = self.results["tube"]
        self.assertEqual("near", t["nearestOfTwo"]["id"])
        self.assertEqual(1, t["plusX"]["side"])
        self.assertEqual(-1, t["minusX"]["side"])


class HoldFireTriggerTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_friend_in_the_line_holds_the_round(self) -> None:
        t = self.results["trigger"]
        self.assertTrue(t["clear"])
        self.assertFalse(t["friendInLine"])

    def test_a_friend_beside_or_beyond_does_not(self) -> None:
        t = self.results["trigger"]
        self.assertTrue(t["friendBeside"])
        self.assertTrue(t["friendBeyond"])
        self.assertTrue(t["enemyInLine"])

    def test_it_can_be_turned_off_for_engine_parity(self) -> None:
        self.assertTrue(self.results["trigger"]["holdFireOff"])

    def test_the_round_goes_the_tick_the_line_clears(self) -> None:
        c = self.results["trigger"]["clearsThenFires"]
        self.assertFalse(c["held"])
        self.assertTrue(c["after"])
        self.assertIsNone(c["stateAfter"])

    def test_heals_and_throws_are_never_held(self) -> None:
        t = self.results["trigger"]
        self.assertFalse(t["healFriend"])
        self.assertFalse(t["healingWeapon"])
        self.assertFalse(t["thrown"])

    def test_the_bot_steps_aside_after_holding_and_keeps_holding(self) -> None:
        s = self.results["step"]
        seq = s["seq"]
        self.assertTrue(all(not x["firing"] for x in seq))
        before = [x for x in seq if x["t"] < s["stepAfter"]]
        during = [x for x in seq if s["stepAfter"] <= x["t"] < s["stepAfter"] + s["stepSeconds"]]
        self.assertTrue(all(x["strafe"] == 0 for x in before))
        # The friend is at -x; a soldier's strafe +1 runs toward -x looking down +z.
        self.assertTrue(during and all(x["strafe"] == -1 for x in during))
        self.assertEqual(1, s["steps"])


class UnitVetoTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_unit_out_of_reach_with_no_progress_is_vetoed_after_patience(self) -> None:
        v = self.results["veto"]
        self.assertEqual(20, v["patience"])
        self.assertEqual(v["patience"], v["standingVetoAt"])
        self.assertTrue(v["planDropped"])

    def test_the_veto_covers_the_hull_and_times_out(self) -> None:
        v = self.results["veto"]
        self.assertTrue(v["vetoedJustAfter"])
        self.assertTrue(v["vetoedBeforeTimeout"])
        self.assertFalse(v["vetoedAfterTimeout"])
        self.assertTrue(v["otherSeatOfHull"])

    def test_a_bot_gaining_on_the_unit_is_not_vetoed(self) -> None:
        self.assertIsNone(self.results["veto"]["walkingIn"]["vetoAt"])

    def test_a_failed_route_vetoes_at_once(self) -> None:
        self.assertEqual(4, self.results["veto"]["routeFailedVetoAt"])


if __name__ == "__main__":
    unittest.main()
