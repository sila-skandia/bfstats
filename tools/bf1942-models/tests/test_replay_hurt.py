"""`replay-bodies.js` `ReplaySoldiers.hurt`: a replayed soldier's flinch, grunt
and view shake for a blow he lives through.

Why this exists. The flinch was entered only on a hit-point drop the page saw,
with its name read from the recorded state. On ku8gdc58b6 (Omaha) 17 of 109
recorded flinches had no drop to see -- no hit-point row for that soldier, or
only his first -- and were drawn as the run (audit_replay_states.mjs). The
recorded hit state is the engine's own verdict, so it starts the flinch
itself; the drop keeps the grunt and the shake, once a blow.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_hurt_harness.mjs"


class ReplayHurtTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.r = json.loads(proc.stdout)

    def kinds(self, case: str) -> list:
        return [e[0] for e in self.r[case]]

    def test_a_recorded_flinch_with_no_hit_points_is_drawn_with_its_grunt(self) -> None:
        self.assertEqual(self.kinds("noHp"), ["flinch", "grunt", "shake"])
        self.assertEqual(self.r["noHp"][0][2:], ["Ub_HitChestStand", True])
        self.assertAlmostEqual(self.r["noHp"][0][1], 1.0, delta=0.05)

    def test_a_drop_and_its_state_are_one_blow(self) -> None:
        self.assertEqual(self.kinds("dropAndState"), ["flinch", "grunt", "shake"])
        self.assertEqual(self.r["dropAndState"][0][2:], ["Ub_HitBackStand", True])

    def test_a_drop_with_no_hit_state_grunts_and_does_not_flinch(self) -> None:
        self.assertEqual(self.kinds("dropNoState"), ["grunt", "shake"])

    def test_a_seek_into_a_flinch_plays_nothing(self) -> None:
        self.assertEqual(self.r["seekedIn"], [])

    def test_a_file_without_body_states_flinches_on_the_drop(self) -> None:
        self.assertEqual(self.kinds("v3"), ["grunt", "shake", "flinch"])
        self.assertEqual(self.r["v3"][2][2:], ["Ub_HitChestStand", False])

    def test_nothing_while_paused(self) -> None:
        self.assertEqual(self.r["paused"], [])


if __name__ == "__main__":
    unittest.main()
