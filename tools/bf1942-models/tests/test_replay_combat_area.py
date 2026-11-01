"""The combat area in a round replay (features/replay-feature-sweep-2026-11-01
entry 6): the followed player's out-of-area warning and countdown, worked out
from where the recording has the object he controls, and the deaths it caused
labelled as desertions. The law is the page's own `combat-area.js` (ledger
CA-2..CA-8); `viewer/replay-combat-area.js` runs it over a recording.

Run under node through `replay_combat_area_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_combat_area_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayCombatAreaTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_plate_is_down_inside_and_for_the_first_second_out(self) -> None:
        runner = self.r["runner"]
        self.assertEqual(0, runner["3"]["countdown"])
        self.assertEqual(0, runner["9.9"]["countdown"])
        # Out at 10 s: the first whole second is what raises it (CA-8).
        self.assertEqual(0, runner["10.5"]["countdown"])
        self.assertFalse(runner["10.5"]["damaging"])

    def test_the_countdown_is_the_allowance_less_the_whole_seconds_out(self) -> None:
        runner = self.r["runner"]
        self.assertEqual(9, runner["11.2"]["countdown"])
        self.assertEqual(5, runner["15"]["countdown"])
        self.assertEqual(1, runner["19.9"]["countdown"])

    def test_past_the_allowance_he_bleeds_and_the_plate_goes_down(self) -> None:
        runner = self.r["runner"]
        for t in ("20.2", "23.5"):
            self.assertTrue(runner[t]["damaging"])
            self.assertEqual(0, runner[t]["countdown"])
            # The accumulator is written back to the allowance (CA-3).
            self.assertEqual(10, runner[t]["outsideFor"])

    def test_coming_back_in_zeroes_it_and_going_out_again_starts_over(self) -> None:
        dodger = self.r["dodger"]
        self.assertEqual(8, dodger["12.5"]["countdown"])
        self.assertEqual(0, dodger["15.5"]["countdown"])
        self.assertEqual(9, dodger["18.5"]["countdown"])
        self.assertEqual(0, dodger["21"]["countdown"])

    def test_the_out_of_bounds_material_counts_as_outside_inside_the_box(self) -> None:
        dodger = self.r["dodger"]
        self.assertEqual(9, dodger["23.5"]["countdown"])
        self.assertEqual(6, dodger["26.5"]["countdown"])

    def test_a_seek_and_frame_by_frame_playback_agree(self) -> None:
        self.assertEqual(0, self.r["carryMismatchCount"], self.r["carryMismatches"])

    def test_only_a_killerless_death_past_the_allowance_is_a_desertion(self) -> None:
        des = self.r["desertions"]
        # pid 5 died 4 s out: no desertion. pid 4 was killed by pid 3: none.
        self.assertEqual([3], [d["victim"] for d in des])
        self.assertAlmostEqual(14.0, des[0]["outsideFor"], delta=0.1)

    def test_a_level_that_bounds_nothing_shows_nothing(self) -> None:
        self.assertEqual(0, self.r["inactive"]["countdown"])

    def test_the_hud_gets_the_nodes_own_text_and_is_taken_down_after(self) -> None:
        v = self.r["vars"]
        self.assertEqual(7, v["Outside/OutsideTime"])
        self.assertEqual("Warning! You are leaving the combat area! Desserters will be shot!", v["Outside/OutsideText"])
        self.assertEqual(0, self.r["cleared"])

    def test_the_setlevel_nametag_caps_are_kept(self) -> None:
        self.assertEqual({"near": 50, "scope": 300}, self.r["nameTags"])


if __name__ == "__main__":
    unittest.main()
