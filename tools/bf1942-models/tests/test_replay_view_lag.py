"""`replay-bodies.js` `ReplaySoldiers.update` and `replay-recording.js`
`shooterViewLag`: through a followed player's eyes, the others on foot are
drawn as his client drew them.

Why this exists. Retail's server judges a round against a soldier on foot
where he stood `min(shooter's ping, 0.2 s) + collisionLatency (0.1 s)` before
the hit (`BFSoldier::getLatencyPosition`, lnxded 0x08271c00; battle-schools
infantry.md A6), so a recorded impact lies on the target's path that far back.
The replay drew every man at the server's time: in q8uwcxrjcg (Berlin) a
strafing man ran 0.68 m (median, 162 hits) ahead of the hits the shooter's
crosshair put on him, and the owner saw the hits land beside him.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_view_lag_harness.mjs"
TICK = 1 / 30


class ReplayViewLagTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def test_the_lag_is_ping_plus_collision_latency_plus_a_sample(self) -> None:
        self.assertAlmostEqual(self.r["lag"], 0.034 + 0.1 + TICK, places=4)

    def test_in_his_eyes_the_man_on_foot_is_drawn_behind_and_he_is_not(self) -> None:
        self.assertEqual(self.r["pov"]["0"], 0)
        self.assertAlmostEqual(self.r["pov"]["1"], 0.034 + 0.1 + TICK, places=3)

    def test_a_man_in_a_seat_is_where_his_hull_is(self) -> None:
        self.assertEqual(self.r["pov"]["2"], 0)

    def test_orbiting_the_followed_player_is_his_view_too(self) -> None:
        self.assertEqual(self.r["orbit"], self.r["pov"])

    def test_the_free_camera_and_a_rig_draw_the_server_time(self) -> None:
        for case in ("free", "rig"):
            self.assertEqual(set(self.r[case].values()), {0}, case)

    def test_the_lag_is_the_followed_players_ping(self) -> None:
        self.assertAlmostEqual(self.r["followOther"]["0"], 0.022 + 0.1 + TICK, places=3)
        self.assertEqual(self.r["followOther"]["1"], 0)

    def test_the_ping_is_capped_at_two_tenths(self) -> None:
        self.assertAlmostEqual(self.r["highPing"]["1"], 0.2 + 0.1 + TICK, places=3)

    def test_a_player_with_no_ping_draws_the_server_time(self) -> None:
        self.assertEqual(set(self.r["bot"].values()), {0})

    def test_across_a_boarding_he_is_drawn_at_the_server_time(self) -> None:
        self.assertEqual(self.r["boarding"]["1"], 0)


if __name__ == "__main__":
    unittest.main()
