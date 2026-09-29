"""A vehicle root finds its AI record by its own name first (`tests/bot_units_ai_of_harness.mjs`).

`bot-units.js` `aiOf` cut a trailing `_<digits>` before looking a node up,
to drop a placed copy's instance suffix. DC Final's `Howitzer_155` is a
template whose own name ends in digits, so it looked up `howitzer`, found no
record, and the gun never became a seat a bot could take.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_units_ai_of_harness.mjs"


class AiOfTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_a_template_whose_name_ends_in_digits(self) -> None:
        self.assertEqual("Howitzer_155", self.results["howitzer155"])

    def test_a_placed_copys_suffix_is_still_cut(self) -> None:
        self.assertEqual("Sherman", self.results["shermanCopy"])

    def test_a_seat_finds_its_hulls_record(self) -> None:
        self.assertEqual("Sherman", self.results["shermanSeat"])

    def test_no_record_is_null(self) -> None:
        self.assertIsNone(self.results["unknown"])


if __name__ == "__main__":
    unittest.main()
