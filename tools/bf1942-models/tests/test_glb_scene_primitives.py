"""`server/glb-scene.mjs`: a room's level tree keeps every primitive of a
collision mesh (`tests/glb_scene_primitives_harness.mjs`)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "glb_scene_primitives_harness.mjs"


class GlbScenePrimitivesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_each_primitive_is_a_mesh(self) -> None:
        self.assertEqual(len(self.r["meshes"]), 2)

    def test_the_second_primitive_is_in_the_collision_index(self) -> None:
        # Read only primitive 0, the floor under the hangar's P-40 was lost.
        self.assertAlmostEqual(self.r["floorY"], 1.0, places=3)
        self.assertEqual(self.r["floorMaterial"], 85)


if __name__ == "__main__":
    unittest.main()
