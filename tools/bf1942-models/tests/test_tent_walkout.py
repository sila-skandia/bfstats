"""A soldier spawned inside FHSW's BigTent walks out through its door.

Operation Spring Awakening's axis_base1_spawn2 stands the soldier 1 m inside
the tent at the Axis base. The tent's soldier collision is double-walled (a
face each way on every wall), so from inside the engine's one-sided narrow
phase (collision-response.md 5.5; `checkFaceAndEdgeCollision` 0x08374880
wants the probe's start in front of the face) meets the canvas as surely as
from outside: the lab's sidecar soldier, walking at a horse behind the tent,
spent minutes inside it (runs 20261028-003918 and -015422). Its door is open,
and the lab's server walked him out through it in 2.5 s (run
20261028-020859). The page does the same; this holds it to it
(`tests/tent_walkout_harness.mjs`, `tests/fixtures/bigtent_m1_col1.json`;
features/fhsweurope-extraction/README.md, "Three reports from Operation
Spring Awakening").
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tests.test_soldier import MODULES  # noqa: E402

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "tent_walkout_harness.mjs"
FIXTURE = HERE / "fixtures" / "bigtent_m1_col1.json"


class TentWalkoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "package.json").write_text('{"type": "module"}')
            for module in MODULES:
                shutil.copy(module, work / module.name)
            shutil.copy(HARNESS, work / HARNESS.name)
            proc = subprocess.run(["node", str(work / HARNESS.name), str(FIXTURE)],
                                  capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_spawn_stands_him_inside_the_tent(self) -> None:
        x, _, z = self.r["spawnLocal"]
        self.assertLess(abs(x), 3.0)
        self.assertLess(abs(z), 2.7)

    def test_he_walks_out_through_the_door(self) -> None:
        x, _, z = self.r["outThroughDoor"]
        self.assertLess(z, -5.0, self.r["outThroughDoor"])
        self.assertLess(abs(x), 1.0)

    def test_the_canvas_holds_him_from_inside(self) -> None:
        """Every wall has an inward face: walking at the back or a side wall
        leaves him inside, as the lab's server left the sidecar."""
        for wall in ("back", "left", "right"):
            x, _, z = self.r[wall]
            self.assertLess(abs(x), 3.3, (wall, self.r[wall]))
            self.assertLess(abs(z), 3.2, (wall, self.r[wall]))


if __name__ == "__main__":
    unittest.main()
