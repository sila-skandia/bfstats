"""Remaster mode: a round fired from the eye is drawn leaving the gun's muzzle.

A seat's camera-fired MG (the M3A1's Browning on Wake) fires along the line
of sight at 900 m/s, so its streak points straight away from the gunner: a
dot at the crosshair. Closed onto the round's line over 40 m, the line from
the barrel lasted one frame, the frame its muzzle flash covers, and the
owner saw no rounds at all (2026-11-15). Now the tail is held on the muzzle
for `hold` seconds and closes onto the line over `fade`, and a beam of even
width runs from it to the round while it is bent, for the shooter's own gun
only: sized at a far gun, a bot's beam coming at the camera was a bar a
hundred pixels across.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_gunfire_layers import MODULES, THREE_PACKAGE  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "muzzle_bend_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MuzzleBendTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_tail_is_held_on_the_muzzle_then_closes_onto_the_line(self) -> None:
        own = self.results["own"]
        held = [f for f in own if f["age"] < 0.08]
        self.assertTrue(held)
        for f in held:
            self.assertLess(f["tailToMuzzle"], 0.05, f)
            self.assertTrue(f["bent"], f)
        # Past hold + fade it lies on the round's own line again.
        done = [f for f in own if f["age"] > 0.21 and f["live"]]
        self.assertTrue(done)
        for f in done:
            self.assertFalse(f["bent"], f)
            self.assertLess(f["offLine"], 0.01, f)

    def test_the_shooters_own_round_draws_a_beam_while_it_is_bent(self) -> None:
        own = self.results["own"]
        self.assertTrue(all(f["beam"] for f in own if f["age"] < 0.08))
        self.assertFalse(any(f["beam"] for f in own if not f["bent"]))

    def test_a_gun_far_from_the_eye_draws_no_beam(self) -> None:
        far = self.results["far"]
        self.assertTrue(any(f["bent"] for f in far))
        self.assertFalse(any(f["beam"] for f in far))


if __name__ == "__main__":
    unittest.main()
