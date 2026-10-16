"""`viewer/scoreboard-screen.js`'s roster, driven headless by
`scoreboard_screen_harness.mjs`: the local player's row names his kit's own
class, the way a bot's row already did (audit item S)."""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("scoreboard_screen_harness.mjs")
MODULES = ("scoreboard-screen.js", "scoreboard.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LocalRowClassTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.kit = run_harness()

    def test_the_kits_own_class_not_the_row_name(self) -> None:
        self.assertEqual("Assault", self.kit["heavyAssaultInTheMedicRow"])
        self.assertEqual("Engineer", self.kit["specOpsInTheSixthRow"])

    def test_a_kit_picked_up_is_the_one_carried(self) -> None:
        self.assertEqual("Scout", self.kit["carried"])

    def test_without_the_file_the_row_name_stands(self) -> None:
        self.assertEqual("medic", self.kit["noLoadouts"])
        self.assertEqual("assault", self.kit["unknownKit"])

    def test_a_sidecar_roster_carries_the_servers_stats(self) -> None:
        rows = self.kit["sidecarRoster"]
        self.assertEqual([1, 2], [r["slot"] for r in rows])
        self.assertEqual({"score": 7, "kills": 2, "deaths": 1, "ping": 3}, rows[0]["stats"])
        self.assertEqual(4, rows[1]["stats"]["score"])

    def test_a_room_roster_carries_none(self) -> None:
        self.assertEqual([None, None], [r["stats"] for r in self.kit["roomRoster"]])

    def test_the_end_of_a_round_holds_the_board_up(self) -> None:
        held = self.kit["held"]
        self.assertTrue(held["openWhenHeld"])
        self.assertTrue(held["openAfterTabRelease"])
        self.assertFalse(held["openAfterLetGo"])
        self.assertFalse(held["fromSpawnWhenHeld"])


if __name__ == "__main__":
    unittest.main()
