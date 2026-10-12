"""The capture flag beneath the minimap (`viewer/ticket-feed.js`
`feedFlagIconVars`), by the client's rule: ledger HUD-15, read at BF1942.exe
0x0046c3db. Driven headless by `capture_flag_icon_harness.mjs`.

The feed used to raise the flag for a neutral point only, so taking a flag
back from the other side showed nothing.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("capture_flag_icon_harness.mjs")


class CaptureFlagIconTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    def shown(self, case: str) -> bool:
        return self.results[case]["ShowFlagIcon"]

    def test_a_neutral_point_raises_it(self) -> None:
        self.assertIs(True, self.shown("neutral"))

    def test_a_point_the_other_side_holds_raises_it(self) -> None:
        self.assertIs(True, self.shown("enemy"))

    def test_it_is_raised_from_a_hull_too(self) -> None:
        self.assertIs(True, self.shown("enemyMounted"))

    def test_the_players_own_point_raises_nothing(self) -> None:
        self.assertIs(False, self.shown("own"))

    def test_a_point_the_map_fixes_raises_nothing(self) -> None:
        self.assertIs(False, self.shown("enemyFixed"))

    def test_outside_every_radius_it_is_down(self) -> None:
        self.assertIs(False, self.shown("outside"))

    def test_the_radius_is_measured_in_three_dimensions(self) -> None:
        self.assertIs(False, self.shown("above"))

    def test_a_dead_player_and_one_not_in_the_world_see_nothing(self) -> None:
        self.assertIs(False, self.shown("dead"))
        self.assertIs(False, self.shown("notInWorld"))

    def test_the_non_takeable_and_ctf_leaves_are_fed_false(self) -> None:
        for case, got in self.results.items():
            with self.subTest(case=case):
                self.assertIs(False, got["ShowNonTakeableFlagIcon"])
                self.assertIs(False, got["AxisFlagIcon"])
                self.assertIs(False, got["AlliedFlagIcon"])


if __name__ == "__main__":
    unittest.main()
