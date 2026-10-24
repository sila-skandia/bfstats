"""`viewer/support-calls.js`: a teammate's call for a medic or an engineer.

The client raises it from the shout handler (`RADIO_LOCAL_MEDIC` 40,
`RADIO_LOCAL_NEED_REPAIRS` 54) only for a listener on foot with the matching
kit, keeps it only from his own side, drops it after 25 s, and draws the
caller's map marker as `map_medic` / `map_engineer` while the listener is on
foot with that kit (ledger HUD-26).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).resolve().parent / "support_calls_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "support-calls.js", work / "support-calls.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SupportCallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_medic_call_marks_the_caller_for_the_local_medic(self) -> None:
        o = self.out
        self.assertEqual("medic", o["raised"])
        self.assertEqual("medic", o["pulse"])
        self.assertEqual("map_medic", o["sprite"])
        self.assertIsNone(o["spriteSeated"])
        self.assertIsNone(o["spriteEngineer"])

    def test_it_lasts_twenty_five_seconds(self) -> None:
        self.assertEqual("medic", self.out["at124"])
        self.assertIsNone(self.out["at125"])

    def test_only_a_teammate_to_a_listener_on_foot_with_the_kit(self) -> None:
        for key in ("enemy", "wrongKit", "seated", "other"):
            self.assertIsNone(self.out[key], key)

    def test_need_repairs_is_the_engineers_and_medic_wins_a_tie(self) -> None:
        self.assertEqual("engineer", self.out["repairs"])
        self.assertEqual("map_engineer", self.out["repairsSprite"])
        self.assertEqual("medic", self.out["bothPulse"])

    def test_the_kit_order(self) -> None:
        self.assertEqual([0, 3, 4, None], self.out["kits"])


if __name__ == "__main__":
    unittest.main()
