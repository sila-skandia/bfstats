"""A ship's deck spawn follows that ship, not the landing craft at her stern.

Reported from the map viewer on Midway and Omaha Beach: a soldier spawned on a
destroyer's fantail fell straight into the sea, while her bow point stood on
deck. `rebaseDeckSpawns` carries each baked deck point from the pad pose to the
hull's draft, and it picked the hull by nearest origin. The Fletcher's stern
spawns (3/5/-43.699) are 4 m from the LCVP her stern spawner launches
(7.2/0.3/-43.699) and 44 m from her own origin, so they took the LCVP's float
(-2.18 m) instead of hers (-0.21 m) and came out 0.68 m under the fantail. The
Hatsuzukis did the same off their Daihatsus by -8.04 m. A `SpawnPoint` is a
child of its ship (`BFSpawnPoint::spawn` 0x08163d70), so the host is the hull
the spawn names, and never a launched craft.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "deck_spawn_host_harness.mjs"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not (VIEWER / "hull-bodies.js").exists():
        raise unittest.SkipTest("hull-bodies.js is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        # hull-bodies.js reaches most of the body world; copy every module.
        for source in VIEWER.glob("*.js"):
            shutil.copyfile(source, work / source.name)
        three = work / "node_modules" / "three"
        three.mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js", three / "three.module.js")
        (three / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        result = subprocess.run(["node", "harness.mjs"], cwd=work,
                                capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise AssertionError(result.stderr[-4000:])
        return json.loads(result.stdout.strip().splitlines()[-1])


class DeckSpawnHostTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = run_harness()

    def test_the_two_hulls_float_differently(self):
        # The fixture only means something if the LCVP's draft is not hers.
        self.assertGreater(abs(self.out["lcvpDrop"] - self.out["fletcherDrop"]), 1.0)

    def test_every_deck_spawn_rides_the_fletcher(self):
        for name, drop in self.out["spawnDrop"].items():
            with self.subTest(spawn=name):
                self.assertAlmostEqual(drop, self.out["fletcherDrop"], places=2)
                self.assertLess(self.out["spawnSlide"][name], 0.01)


if __name__ == "__main__":
    unittest.main()
