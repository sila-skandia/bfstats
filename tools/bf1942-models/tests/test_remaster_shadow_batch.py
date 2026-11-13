"""Remaster mode's moving shadow casters, one batch a cascade
(viewer/remaster-shadow-batch.js; features/remaster-browser, "Fewer objects").

A Sherman is 74 caster meshes, and three's WebGPU renderer handled each as an
object of its own in every cascade it fell in: three tanks near the eye on
El Alamein were 400 of a frame's 990 objects. The sentence these tests defend:

    every rigid, opaque moving caster is an instance of one batch only the
    sun's shadow cameras see, at the part's own world matrix each frame, shown
    exactly where the part would have cast, and a batch out of room is
    replaced, never resized.

The harness runs the module as it is against three's own `BatchedMesh`
(three.core has no GPU in it).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
VIEWER = HERE.parent / "viewer"
HARNESS = HERE / "remaster_shadow_batch_harness.mjs"


@unittest.skipUnless(shutil.which("node"), "node is not installed")
class ShadowBatchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        out = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def test_a_rigid_opaque_mesh_is_an_instance_and_nothing_else_is(self) -> None:
        b = self.r["batchable"]
        self.assertTrue(b["solid"])
        # Two opaque materials are still one shape to a shadow.
        self.assertTrue(b["twoMaterials"])
        # A cut-out casts its texture's shape, a blend nothing, bones are not
        # a matrix, and a material that moves its vertices moves its shadow.
        for kind in ("cut", "blend", "movesItsVertices", "skinned", "morphed", "oneCutOfTwo", "group", "nothing"):
            self.assertFalse(b[kind], kind)

    def test_the_parts_are_taken_and_stop_casting_for_themselves(self) -> None:
        t = self.r["taken"]
        self.assertEqual(3, t["taken"])
        self.assertEqual([0, 1, 2, -1], t["ids"])
        self.assertEqual([False, False, False], t["meshesStopCasting"])
        self.assertTrue(t["skinnedStillCasts"])
        self.assertEqual(0, t["againIsNothing"])

    def test_only_the_shadow_cameras_see_the_batch(self) -> None:
        t = self.r["taken"]
        self.assertTrue(t["name"])
        self.assertEqual(1 << 1, t["layer"])
        self.assertTrue(t["casts"])
        self.assertTrue(t["inRoot"])
        # Each cascade draws the instances inside its own box, not three's
        # one test of the whole batch.
        self.assertFalse(t["culledByThree"])
        self.assertTrue(t["perInstanceCull"])
        # And the renderer's caster flagging leaves it alone.
        self.assertTrue(t["skippedByTheCasterFlagging"])

    def test_an_instance_is_at_its_parts_own_world_matrix(self) -> None:
        self.assertEqual({"shown": 3, "hull": True, "wheel": True, "gun": True}, self.r["synced"])

    def test_the_shadow_follows_a_turret_that_turns_on_a_tank_that_drives(self) -> None:
        f = self.r["follows"]
        self.assertTrue(f["gun"])
        # 3 m ahead of a turret turned 1.1 rad, on a tank driven 7 m on.
        self.assertEqual([109.67, -38.64], f["gunAt"])
        self.assertTrue(f["uploaded"])

    def test_a_still_scene_sends_nothing_to_the_gpu(self) -> None:
        self.assertFalse(self.r["still"]["uploaded"])

    def test_an_instance_is_shown_exactly_where_its_part_would_have_cast(self) -> None:
        s = self.r["shown"]   # hull, wheel, gun
        self.assertEqual([True, True, False], s["turretHidden"])
        self.assertEqual([True, False, True], s["wheelOutOfReach"])
        self.assertEqual([False, True, True], s["hullProxied"])
        self.assertEqual([False, False, False], s["tankGone"])
        self.assertEqual([True, True, True], s["back"])

    def test_a_part_that_left_gives_its_instance_to_the_next(self) -> None:
        self.assertEqual({"count": 3, "idCleared": True, "reused": True, "sameBatch": True}, self.r["removed"])

    def test_a_new_level_lets_everything_go(self) -> None:
        self.assertEqual({"mesh": True, "count": 0, "ids": [None, None], "gone": True}, self.r["reset"])

    def test_a_batch_out_of_room_is_replaced_not_resized(self) -> None:
        g = self.r["grown"]
        self.assertTrue(g["newBatch"])
        self.assertTrue(g["oldGone"])
        self.assertTrue(g["newTextures"])
        self.assertEqual(1, g["oneInRoot"])
        self.assertEqual([1, 2], g["builds"])
        self.assertEqual([True, True, True], g["room"])
        self.assertEqual(5, g["count"])
        self.assertEqual([0, 1, 2, 3, 4], g["ids"])
        self.assertTrue(g["everyPartWhereItIs"])
        self.assertTrue(g["everyPartShown"])
        self.assertEqual(2, g["geometries"])
        self.assertTrue(g["sameBatchWithRoom"])


class WiringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.batch = (VIEWER / "remaster-shadow-batch.js").read_text()
        cls.renderer = (VIEWER / "remaster-renderer.js").read_text()
        cls.foliage = (VIEWER / "remaster-foliage.js").read_text()

    def test_the_module_never_resizes_a_batch_in_place(self) -> None:
        # three's resize swaps the instance textures under a cascade's
        # compiled draw, which went on reading the old ones: no shadows.
        code = re.sub(r"//.*|/\*.*?\*/", "", self.batch, flags=re.S)
        self.assertNotIn("setInstanceCount", code)
        self.assertNotIn("setGeometrySize", code)

    def test_the_instances_are_synced_once_a_frame_before_the_first_cascade(self) -> None:
        self.assertIn("if (!batchSynced) { batchSynced = true; shadowBatch.sync(scene); }", self.renderer)
        self.assertIn("batchSynced = false;", self.renderer)

    def test_a_batched_part_never_casts_for_itself_as_well(self) -> None:
        self.assertIn("const batched = k.batchId >= 0 && tune.shadowBatch;", self.renderer)
        self.assertIn("k.obj.castShadow = on && !batched;", self.renderer)

    def test_a_static_keeps_its_proxy(self) -> None:
        self.assertIn("if (k.proxied && !isVehicle(k.obj)) { k.batchId = -1; continue; }", self.renderer)

    def test_a_level_starts_with_an_empty_batch(self) -> None:
        self.assertIn("shadowBatch.reset();", self.renderer)

    def test_the_last_levels_casters_go_with_it(self) -> None:
        # Its root leaves the scene with every mesh still under it: a caster
        # is judged by what it hangs from at the top, not by its own parent.
        loaded = self.renderer[self.renderer.index("levelLoaded(extras, root) {"):]
        prune = loaded.index("if (top === scene) continue;")
        self.assertLess(prune, loaded.index("proxies.build(casters"))
        self.assertLess(prune, loaded.index("shadowBatch.reset();"))
        self.assertIn("casters[i].obj.userData.rmShadow = false;", loaded)

    def test_a_tree_card_and_a_fading_tree_part_are_one_draw_each(self) -> None:
        # three draws a blended two-sided material twice, as two objects.
        self.assertIn("material.forceSinglePass = true;", self.foliage)
        self.assertIn("to.forceSinglePass = true;", self.foliage)


if __name__ == "__main__":
    unittest.main()
