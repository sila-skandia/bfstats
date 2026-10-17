"""A BF42++ server's statics on the page (viewer/server-statics.js).

A bf42++ server can create, move, turn and delete statics with its own game
events, and keep a level's StaticObjects.con out with a SpecialGame 2 ahead of
the SetLevel (bf42plus src/bf/gameevent.cpp:158-236). Both change the world
the player collides with, so the page plays them as a bf42++ client does: a
server static is a clone of the level's own placement of that template (or
the model tree's glb), with its hulls in the collision index; the file's
statics are the scene roots the bake wrote for them, found by the bake's
order and `scene.json` `objects.placed`. features/udp-sidecar/wire.md section
30 has the protocol.
"""

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "server_statics_harness.mjs"
_cache = None


def run_harness() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    _cache = json.loads(proc.stdout)
    return _cache


class StaticObjectsConTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_the_file_statics_are_the_roots_after_the_environment(self):
        m = self.r["mark"]
        self.assertEqual(m["marked"], 3)
        self.assertEqual(m["stamped"], ["stecrate1_M1", "sandbag_2m_m1", "stecrate1_M1_1"])

    def test_prune_takes_them_and_their_hulls_out_and_restore_puts_them_back(self):
        m = self.r["mark"]
        self.assertEqual(m["pruned"], 3)
        self.assertNotIn("stecrate1_M1", m["after"])
        # the mode script's static stays: bf42++ skips only StaticObjects.con
        self.assertIn("Telemark_turbine", m["after"])
        self.assertEqual(m["disabled"], [0, 1, 2])
        self.assertEqual((m["restored"], m["disabledAfter"], m["back"]), (3, [], 12))

    def test_a_scene_that_does_not_read_is_left_alone(self):
        self.assertEqual(self.r["badLayout"], {"tooMany": -1, "noCount": -1})

    def test_real_bakes_read(self):
        real = self.r["real"]
        if not real:
            self.skipTest("no level bakes under viewer/maps on this machine")
        for level, v in real.items():
            self.assertEqual(v["marked"], v["placed"], level)


class ReconcileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_harness()

    def test_ops(self):
        # 1 unchanged (template case-blind), 2 moved, 3 gone, 4 made again
        self.assertEqual(self.r["reconcile"], {"create": [4], "pose": [2], "remove": [3, 4]})

    def test_pose_mirrors_z(self):
        self.assertEqual(self.r["pose"]["position"], [1, 2, -3])
        self.assertEqual(self.r["pose"]["quaternion"], [0, -0.7071, 0, 0.7071])


class FlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.f = run_harness()["flow"]

    def test_switch_off_and_creates(self):
        s = self.f["step1"]
        self.assertTrue(s["off"])
        # the file's statics are out; the server's two stand, cloned from them
        self.assertEqual(s["rootNames"][-2:], ["stecrate1_M1", "sandbag_2m_m1"])
        self.assertNotIn("stecrate1_M1_1", s["rootNames"])
        self.assertEqual(s["crate"]["pos"], [100, 5, -200])
        self.assertEqual(s["crate"]["q"], [0, -0.7071, 0, 0.7071])
        self.assertTrue(s["crate"]["hullHidden"])
        self.assertEqual(s["bag"], [0, 0, 0])          # no transform: the template's origin
        self.assertEqual(s["unknown"], 1)              # a template the page cannot name
        self.assertEqual(s["owners"], ["stecrate1_M1", "sandbag_2m_m1"])

    def test_move_keeps_the_turn_and_scale_does_nothing(self):
        s = self.f["step2"]
        self.assertEqual(s["pos"], [110, 6, -210])
        self.assertEqual(s["q"], [0, -0.7071, 0, 0.7071])
        self.assertEqual(s["scale"], [1, 1, 1])
        self.assertEqual(s["moved"], [110, 6, -210])  # the collider follows

    def test_rotate_keeps_the_position(self):
        s = self.f["step3"]
        self.assertEqual(s["pos"], [110, 6, -210])
        self.assertEqual(s["q"], [0, -1, 0, 0])

    def test_an_id_made_again_replaces_its_object(self):
        s = self.f["step4"]
        self.assertTrue(s["replaced"])
        self.assertTrue(s["oldGone"])
        self.assertEqual(s["pos"], [1, 1, -1])

    def test_delete(self):
        s = self.f["step5"]
        self.assertEqual(s["have"], [8, 9])
        self.assertEqual(s["inRoot"], 1)

    def test_a_load_without_the_switch_brings_the_file_back(self):
        s = self.f["step6"]
        self.assertFalse(s["off"])
        self.assertEqual(s["have"], [])
        self.assertEqual(s["statics"], 3)
        self.assertEqual(s["enabled"], 3)


if __name__ == "__main__":
    unittest.main()
