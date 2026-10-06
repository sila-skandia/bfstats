"""A placed object's name across a room: its node index in `scene.glb`.

The room server stamps the file's own index on its tree
(`server/glb-scene.mjs`), and the page stamps the same on GLTFLoader's tree
(`viewer/level-nodes.js`), by walking the file's node tree beside the loaded
one. GLTFLoader's own `parser.associations` cannot be used: it clones a mesh
per use and the clones share one mapping object, so every Stationary_mg42 on
Aberdeen read one index and the page found no copy of three of the room's
guns. `tests/level_nodes_harness.mjs` loads real levels both ways and checks
every index names the same placement on both sides.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "level_nodes_harness.mjs"
LEVELS = ["aberdeen", "wake"]


class LevelNodeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        have = [lvl for lvl in LEVELS if (VIEWER / "maps" / lvl / "scene.glb").exists()]
        if not have:
            raise unittest.SkipTest("no level bakes in viewer/maps")
        proc = subprocess.run(["node", str(HARNESS), str(VIEWER), *have],
                              capture_output=True, text=True, timeout=900)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_every_node_is_stamped_once(self) -> None:
        for level, r in self.results.items():
            self.assertEqual(r["nodes"], r["stamped"], level)
            self.assertEqual(0, r["duplicates"], level)

    def test_both_sides_name_the_same_placement(self) -> None:
        for level, r in self.results.items():
            self.assertEqual(r["nodes"], r["compared"], level)
            self.assertEqual(0, r["nameMismatch"], level)
            self.assertEqual(0, r["placeMismatch"], level)
            self.assertGreater(r["guns"], 0, level)
            self.assertEqual(0, r["gunsApart"], level)

    def test_the_loaders_associations_would_have_doubled_up(self) -> None:
        # The reason for the walk: on every level with a mesh used twice the
        # loader's mapping names two objects with one index.
        self.assertTrue(any(r["associationDuplicates"] > 0 for r in self.results.values()))


if __name__ == "__main__":
    unittest.main()
