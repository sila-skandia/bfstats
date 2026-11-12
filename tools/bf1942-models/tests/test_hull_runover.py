"""A hull driven into a soldier on foot pushes them clear, and above 8 m/s
of contact speed runs them over (`viewer/soldier-resolve.js` `pushOutOfHulls`,
`viewer/world-soldier-tick.js` `runOverTick`, `tests/hull_runover_harness.mjs`).

The owner's report (2026-11-12): a vehicle rolling over a soldier left them
stuck under its model with no way out. The page's soldier swept only their
own motion against the hulls; a hull that moved into them came on through,
and its two-sided faces then held them inside. Retail probes the soldier's 17
vertices from their origin one tick ago in the hull's moving frame against the
hull's faces, one-sided, and puts the whole correction on the soldier
(`ResponsePhysics::checkObjectVsObject` 0x08259690, COL-2, COL-6, COL-9); the
soldier-victim branch of `handleCollisionObjectVsObject` 0x081551c0 prices
the contact once a second per hull, nothing under 8 m/s (COL-3, COL-5).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "hull_runover_harness.mjs"
DAMAGE = Path(__file__).resolve().parents[1] / "viewer" / "maps" / "_shared" / "damage.json"


class HullRunOverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_a_hull_never_ends_up_over_a_standing_or_prone_soldier(self) -> None:
        for run in self.r["runs"]:
            with self.subTest(kind=run["kind"], speed=run["speed"], prone=run["prone"]):
                self.assertEqual(0, run["insideTicks"])
                # The engine's push is by the plane depth along the flattened
                # direction back to the start, so a slanted vertex is left a
                # hair in for a tick; never more than 2 cm.
                self.assertLessEqual(run["deepest"], 0.02)
                self.assertFalse(run["afterDrive"]["inside"])
                self.assertEqual(0, run["afterDrive"]["depth"])

    def test_the_soldier_is_pushed_ahead_of_the_nose(self) -> None:
        for run in self.r["runs"]:
            with self.subTest(kind=run["kind"], speed=run["speed"], prone=run["prone"]):
                half = 2.9 if run["kind"] == "tank" else 1.7
                # Stopped with its middle over their spot, the hull has them
                # in front of its nose, their 0.4 m reach clear of it.
                self.assertGreaterEqual(run["afterDrive"]["ahead"], half + 0.39)
                self.assertTrue(run["walkedOut"])
                # The nose (+x) did the pushing.
                self.assertEqual([1, 0, 0], run["firstNormal"])

    def test_a_soldier_already_under_a_parked_hull_walks_out(self) -> None:
        for p in self.r["parked"]:
            with self.subTest(kind=p["kind"]):
                self.assertFalse(p["inside"])
                self.assertEqual(0, p["depth"])
                self.assertGreater(p["z"], 3)
                self.assertEqual(0, p["y"])

    def test_a_hull_that_keeps_driving_carries_them_in_front(self) -> None:
        for s in self.r["shoved"]:
            with self.subTest(kind=s["kind"]):
                self.assertLessEqual(s["deepest"], 0.02)
                self.assertGreaterEqual(s["gapMin"], 0.38)
                self.assertGreater(s["carried"], 12)
                self.assertGreater(s["vx"], 1)

    def _priced(self, material: int, speed: float) -> float:
        d = json.loads(DAMAGE.read_text())
        mod = d["modifiers"][str(d["materials"][str(material)]["attGroup"])][str(d["materials"]["41"]["defGroup"])]
        return 0.5 * speed * speed * mod * d["materials"][str(material)]["damage"]

    def test_under_8_m_s_it_only_pushes(self) -> None:
        for w in self.r["world"]:
            if w["speed"] == 5:
                with self.subTest(kind=w["kind"]):
                    self.assertEqual(0, w["lost"])

    def test_over_8_m_s_it_runs_them_over_at_retails_price(self) -> None:
        by = {(w["kind"], w["speed"]): w for w in self.r["world"]}
        # Head on, the angle factor is 1 and V' is the hull's own speed:
        # 0.5 x V^2 x damageMod(hull, 41) x materialDamage(hull).
        tank9 = self._priced(50, 9)
        self.assertGreater(tank9, 20)
        self.assertLess(tank9, 30)
        self.assertAlmostEqual(tank9, by[("tank", 9)]["lost"], delta=1.0)
        self.assertFalse(by[("tank", 9)]["dead"])
        self.assertGreater(self._priced(45, 9), 30)
        for key in (("jeep", 9), ("tank", 12), ("jeep", 12)):
            with self.subTest(key=key):
                self.assertTrue(by[key]["dead"])

    def _credit(self, **kw) -> dict:
        for c in self.r["credit"]:
            if all(c[k] == v for k, v in {"driverTeam": 2, "driverLeftAgo": None,
                                          "victimLeftAgo": None, **kw}.items()):
                return c
        raise AssertionError(kw)

    def test_the_kill_is_the_drivers(self) -> None:
        # `handleCollisionObjectVsObject` 0x081551c0: the attacking hull's
        # PlayerControlObject's occupant, the player's id and team.
        c = self._credit()
        self.assertTrue(c["dead"])
        self.assertEqual(1, len(c["runs"]))
        run = c["runs"][0]
        self.assertEqual(("D", 2, True), (run["attacker"], run["attackerTeam"], run["killed"]))
        self.assertEqual(30, run["lost"])
        self.assertLess(c["depth"], 0.05)

    def test_a_teammate_run_over_standing_still_is_a_team_kill(self) -> None:
        # V0's same-team clause drops the credit only when the victim was the
        # faster along the contact; a man stood still is the driver's.
        run = self._credit(driverTeam=1)["runs"][0]
        self.assertEqual(("D", 1), (run["attacker"], run["attackerTeam"]))

    def test_an_empty_hull_credits_its_last_driver_for_2_s(self) -> None:
        # getLastOccupidePlayer while `2.0 > worldTime - lastTime` (0x08155fa6).
        self.assertEqual("D", self._credit(driverLeftAgo=1)["runs"][0]["attacker"])
        self.assertIsNone(self._credit(driverLeftAgo=3)["runs"][0]["attacker"])

    def test_the_hull_they_just_left_costs_them_nothing_for_2_s(self) -> None:
        # SEAT-33: `setExitedFromVehicle` 0x08277220, message 0x16 at 2.0 s.
        grace = self._credit(victimLeftAgo=1)
        self.assertEqual([], grace["runs"])
        self.assertEqual(30, grace["hp"])
        self.assertLess(grace["depth"], 0.05)
        after = self._credit(victimLeftAgo=3)
        self.assertTrue(after["dead"])
        self.assertEqual("D", after["runs"][0]["attacker"])


if __name__ == "__main__":
    unittest.main()
