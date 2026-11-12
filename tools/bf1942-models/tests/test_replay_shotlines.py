"""A round replay's shot lines: the engine's game.drawDebug for every round.

The owner's asks (2026-11-01): "we're not talking about tracers are we, but
more of a debug style that draws these lines", and "lets try our best to
originate the traces from the muzzle of the weapon". Retail keeps a line from
where each round left the barrel to where it struck, green when it did
damage (ledger IMP-9). A server recording's own collisions (`i`) draw as the
game would have; a client recording's rounds draw with the Accuracy
rebuild's verdict, a hit to where it met its victim, a miss to where the
page's own round struck, from the drawn gun's muzzle once it has fired.

Then (2026-11-12), having seen the spotlight's tracers: "I like the tracers,
I feel like we could use that style to replace the shot lines we already
have". Each line is now a tracer (replay-tracers.js): the round flies from
the muzzle at its gun's speed, leaves its line and flashes where it ended.
Run under node through `replay_shotlines_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_shotlines_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayShotLineTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_server_recordings_collisions_are_the_lines(self) -> None:
        # BF1942's +Z is the page's -Z; green for the one that did damage.
        self.assertEqual(self.results["server"], [
            {"a": [1, 2, -3], "b": [11, 2, -3], "hit": True},
            {"a": [1, 2, -3], "b": [1, 2, -53], "hit": False},
        ])
        self.assertEqual(self.results["serverDrawn"], 4)

    def test_lines_fade_out_and_a_seek_draws_its_own(self) -> None:
        self.assertEqual(self.results["serverFaded"], 0)
        self.assertEqual(self.results["serverAfterSeek"], 2)

    def test_a_hit_goes_to_its_victim_from_the_muzzle(self) -> None:
        hit = self.results["client"]["lines"][0]
        self.assertEqual(hit, {"a": [0.1, 1.5, -0.7], "b": [0, 1.6, -30], "hit": True, "muzzle": True})

    def test_a_miss_waits_for_where_its_own_round_struck(self) -> None:
        self.assertEqual(self.results["client"]["firstCount"], 1)
        lines = self.results["client"]["lines"]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[1], {"a": [0, 1.6, 0], "b": [25, 1.6, 0], "hit": False, "muzzle": False})


    def test_a_round_flies_as_a_tracer_at_its_guns_speed(self) -> None:
        flight = self.results["flight"]
        # 30 m at the table's 300 m/s.
        self.assertAlmostEqual(flight["span"], 0.1, places=6)
        # In the air: its streak and its head.
        self.assertEqual(flight["inAir"], {"lines": 1, "heads": 1})
        # Landed: the line it left, and the flash where it ended.
        self.assertEqual(flight["landed"], {"lines": 1, "heads": 1})
        self.assertEqual(flight["later"], {"lines": 1, "heads": 0})
        self.assertEqual(flight["gone"], {"lines": 0, "heads": 0})

    def test_a_projectile_finds_its_guns_speed(self) -> None:
        self.assertEqual(self.results["flight"]["bulletSpeed"], 300)
        self.assertEqual(self.results["flight"]["unknownSpeed"], 400)


if __name__ == "__main__":
    unittest.main()
