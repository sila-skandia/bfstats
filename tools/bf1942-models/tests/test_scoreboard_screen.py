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


if __name__ == "__main__":
    unittest.main()
