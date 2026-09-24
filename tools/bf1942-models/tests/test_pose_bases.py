"""`viewer/pose-bases.js`: a soldier's pose glbs come from the active mod's
tree, then vanilla's.

A mod's extraction writes only the soldier/weapon pairs it adds; the ones it
inherits are vanilla's files. Looked up in the mod tree alone, every bot
holding an inherited pair had no body on a mod level (Anzio's Americans,
every bot on Telemark). Driven headless by `pose_bases_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "viewer" / "pose-bases.js"
HARNESS = Path(__file__).with_name("pose_bases_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(MODULE, work / "pose-bases.js")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PoseBasesTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_mod_tree_comes_first_then_vanilla(self) -> None:
        self.assertEqual(["models/mods/xpack1", "models"], self.r["bases"]["mod"])
        self.assertEqual(["models"], self.r["bases"]["vanilla"])
        self.assertEqual(["models"], self.r["bases"]["unset"])
        self.assertEqual(["models/mods/xpack2/poses/GermanSoldier__K98.pose.glb?t=1",
                          "models/poses/GermanSoldier__K98.pose.glb?t=1"], self.r["urls"])

    def test_an_inherited_pair_falls_back_to_vanilla(self) -> None:
        f = self.r["fallsBack"]
        self.assertEqual("models/poses/USSoldier__Thompson.pose.glb", f["got"])
        self.assertEqual(["models/mods/xpack1/poses/USSoldier__Thompson.pose.glb",
                          "models/poses/USSoldier__Thompson.pose.glb"], f["asked"])

    def test_the_mod_s_own_pair_wins_and_vanilla_is_not_asked(self) -> None:
        m = self.r["modFirst"]
        self.assertEqual("models/mods/xpack1/poses/ItalianSoldier__Breda.pose.glb", m["got"])
        self.assertEqual(1, len(m["asked"]))

    def test_nothing_anywhere_rejects_after_both(self) -> None:
        self.assertEqual(2, self.r["none"]["asked"])
        self.assertIn("404", self.r["none"]["rejected"])


if __name__ == "__main__":
    unittest.main()
