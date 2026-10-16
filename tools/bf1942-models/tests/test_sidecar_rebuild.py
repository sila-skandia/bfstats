"""A sidecar recording, rebuilt from its review log, replays a vehicle round.

The fixture is a live Wake Island round: a player drives an M3A1, mans its
.50 (a nested PlayerControlObject, netId 674 + 1, with no createObject of its
own), then takes a Chi-ha and kills the M3A1 with two shells. The laws:

* the seat gets no k:"o" of its own, so the viewer resolves it to the hull's
  seat 1 (rootOf) instead of a life with no transform (the gunner used to be
  put back where he got in);
* the hull stays drawn while only its seat is in the server's scope;
* the .50's rounds and the Chi-ha's shells are k:"f" rows, from the FireArms
  round counter's steps down;
* the hull's hit points reach the viewer as k:"a", down to 0 (its wreck).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "sidecar_rebuild_harness.mjs"


class SidecarRebuildTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_seat_resolves_to_its_hull(self) -> None:
        self.assertEqual(self.r["seatObjects"], 0)
        self.assertEqual(self.r["gunner"], {"nid": 675, "root": 674, "seat": 1})
        self.assertEqual(self.r["driver"], {"nid": 674, "root": 674, "seat": 0})
        self.assertIn({"pid": 0, "seat": 1}, self.r["crewWhileGunning"])

    def test_unnamed_recording_is_named(self) -> None:
        # A sidecar run without --names wrote blank templates, and the replay
        # drew nothing at all; the rebuild names them from the level's map.
        u = self.r["unnamed"]
        self.assertTrue(u["anim"])
        self.assertEqual(u["blankCreates"], 0)
        self.assertEqual(u["apcTmpl"], "M3A1")

    def test_hull_drawn_while_gunning(self) -> None:
        self.assertTrue(self.r["apcShownWhileGunning"])

    def test_rounds(self) -> None:
        # The .50's counter runs 501 -> 497 and jumps back to 501: a round
        # for every step down and none for the rise. A client recording of
        # the same kind of burst (a Zero's guns, 901 -> 895 -> 901, Wake
        # 2026-10-16) has five rounds for five steps down and two rises;
        # counting the rises read 29 here and put a phantom shell in a
        # Sherman's gun.
        self.assertEqual(self.r["mgRounds"], 24)
        self.assertEqual(len(self.r["shellRounds"]), 2)
        self.assertEqual(self.r["shellRounds"][0]["pid"], 0)

    def test_on_foot_between_hulls(self) -> None:
        # The server sends no control for getting out; the rebuild hands the
        # player back his soldier, so the viewer draws him running to the tank.
        self.assertEqual(self.r["onFoot"]["nid"], 707)
        self.assertEqual(self.r["inTank"]["nid"], 620)

    def test_shell_timing(self) -> None:
        # The Chi-ha's counter steps at 104.27 s and 109.42 s, one round
        # interval (1 / roundOfFire 0.35) after each shell; the M3A1's hit
        # points drop at 101.72 s (27.5 m away) and 106.72 s (14 m) at 80 m/s.
        times = [s["t"] for s in self.r["shellRounds"]]
        self.assertAlmostEqual(times[0], 101.41, delta=0.05)
        self.assertAlmostEqual(times[1], 106.56, delta=0.05)
        self.assertEqual([s["pid"] for s in self.r["shellRounds"]], [0, 0])

    def test_hull_destroyed(self) -> None:
        self.assertGreater(self.r["apcHpBefore"], 0)
        self.assertEqual(self.r["apcHpAfter"], 0)


if __name__ == "__main__":
    unittest.main()
