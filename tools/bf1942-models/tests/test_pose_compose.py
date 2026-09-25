"""`viewer/pose-compose.js`: a split pose put back together.

A pose used to be one self-contained `<Soldier>__<Pose>.pose.glb` -- the
soldier's body, face and hands, skinned, plus the weapon and a few KB of pose.
2.8 GB of trees, in which one body is stored once per pose it is ever drawn in.
`extract_pose.py --split` writes it as three documents instead (a rig per
soldier, a weapon glb that already exists, a recipe per pose) and this module
is what a viewer reads them with.

The tests here drive the composition outside a browser: a rig built out of
three.js objects, a weapon, and a recipe, handed to the real `compose` path
through a stub loader and a stub `fetch`. They assert the three things the
split can get wrong --

* the recipe's numbers land on the rig's own nodes, and the skin follows the
  bones that were moved rather than the cached rig's;
* the weapon hangs off the hand bone at the recipe's transform, marked so a
  figure's disposal leaves the shared weapon geometry alone;
* the clips bind by node name through a real `AnimationMixer`, which is what
  every consumer of `gltf.animations` does with them.

-- and the one thing that makes the whole feature worth having: a second pose
of the same soldier reuses the rig document instead of fetching it again.

The equality of a recipe against the glb it came from is a different test:
`check_recipe.py` asserts it against a published tree, and
`tests/test_pose_recipe.py` asserts it against the builder.
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
HARNESS = Path(__file__).with_name("pose_compose_harness.mjs")

# What `pose-compose.js` imports, copied in under their own names -- the files
# under test are the files the page loads. `three` is the vendored module,
# stood up as a package the way `tests/test_mouse_input.py` does it.
MODULES = {
    "pose-compose.js": VIEWER / "pose-compose.js",
    "pose-bases.js": VIEWER / "pose-bases.js",
    "skeleton-hit.js": VIEWER / "skeleton-hit.js",
    "vendor/utils/SkeletonUtils.js": VIEWER / "vendor" / "utils" / "SkeletonUtils.js",
    "node_modules/three/three.module.js": VIEWER / "vendor" / "three.module.js",
}
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


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
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class PoseComposeTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    # --- what a joint is ----------------------------------------------------

    def test_only_a_node_the_extractor_called_a_joint_is_a_joint(self) -> None:
        # A weapon node can share a name with a skeleton bone; only the marked
        # ones are joints, which is what `extract_pose.py`'s extras say.
        self.assertEqual(["bip01", "bip01 pelvis", "bip01 r hand"], self.r["jointNodes"])

    def test_the_page_hides_effects_and_collision_and_unculls_the_skin(self) -> None:
        # The pose glbs were exported with no effects and no collision, so a
        # pose never carried them. The standalone weapon glb is the same export
        # the model pages use, and it does -- so one rule hides them on both
        # paths rather than letting a muzzle flash hang off every rifle.
        self.assertEqual({"effect": False, "collision": False, "body": True},
                         self.r["hidden"])
        self.assertEqual({"before": True, "after": False}, self.r["culling"])

    def test_a_bone_resolves_whatever_the_data_spells_it(self) -> None:
        self.assertEqual({"underscore": "Bip01 Pelvis", "lower": "Bip01 Pelvis",
                          "missing": None}, self.r["bones"])

    # --- the recipe's numbers ----------------------------------------------

    def test_the_joints_land_on_the_rig_s_own_nodes(self) -> None:
        j = self.r["joints"]
        self.assertEqual([0.5, 0.5, 0.5, 0.5], j["root"])
        self.assertEqual([0, 0.25, 0], j["rootPosition"])
        self.assertEqual([0, 0.28, 0], j["pelvisPosition"])
        # A bone the recipe does not name keeps the rig's rest transform.
        self.assertEqual([0.1, 0.4, 0.2], j["handPosition"])

    def test_a_still_clip_is_two_keys_of_the_same_value(self) -> None:
        # Which is how the pose glb writes `stand`/`crouch`/`lie`, and why a
        # crossfade between two of them is a crossfade between two poses. A
        # track whose values are shorter than its times spins the mixer.
        clips = {c["name"]: c for c in self.r["clips"]}
        self.assertEqual(["stand", "crouch", "fire"], [c["name"] for c in self.r["clips"]])
        self.assertEqual(1, clips["stand"]["duration"])
        self.assertEqual(2, clips["stand"]["tracks"])
        self.assertEqual("Bip01.quaternion", clips["stand"]["firstTrack"])

    def test_a_timeline_clip_carries_the_recipe_s_own_times(self) -> None:
        clips = {c["name"]: c for c in self.r["clips"]}
        self.assertEqual(0.5, clips["fire"]["duration"])
        self.assertEqual(["Bip01 R Hand"], clips["fire"]["bones"])

    def test_the_clips_drive_the_skeleton_through_a_real_mixer(self) -> None:
        # The binding is by node name, which is what lets a gait sidecar's clip
        # -- tracks that name bones too -- drive this skeleton as it always has.
        still = self.r["stillPlayed"]
        self.assertEqual([0.5, 0.5, 0.5, 0.5], still["quaternion"])
        self.assertEqual([0, 0.25, 0], still["position"])
        self.assertEqual(1, still["weight"])

    def test_a_timeline_interpolates_between_its_keys(self) -> None:
        t = self.r["timeline"]
        self.assertEqual([0, 0, 0, 1], t["atZero"])
        # Slerp halfway between the two keys of the recipe.
        self.assertEqual([0, 0, 0.382684, 0.92388], t["atHalf"])
        self.assertEqual([0, 0, 0.707107, 0.707107], t["atEnd"])

    # --- the grafted weapon -------------------------------------------------

    def test_a_graft_is_marked_so_a_disposal_leaves_it_alone(self) -> None:
        # The weapon's geometry belongs to the page's cached weapon glb and is
        # shared with every other soldier holding it.
        g = self.r["graft"]
        self.assertTrue(g["wrapper"])
        self.assertTrue(g["inner"])
        self.assertFalse(g["bone"])
        self.assertEqual(1, g["removed"])
        self.assertTrue(g["detached"])
        self.assertFalse(g["stillAttached"])

    # --- composition --------------------------------------------------------

    def test_a_composed_pose_is_the_scene_the_glb_used_to_be(self) -> None:
        c = self.r["composed"]
        self.assertEqual("USSoldier holding K98", c["root"])
        self.assertEqual([0.707107, 0, 0, 0.707107], c["pitched"])
        self.assertEqual([0.5, 0.5, 0.5, 0.5], c["joints"])
        self.assertEqual(["stand", "crouch", "fire"], c["clips"])
        self.assertEqual("K98", c["weaponName"])
        self.assertFalse(c["muzzleVisible"])
        # The joints that were moved are the ones the skin follows.
        self.assertTrue(c["skinRebound"])
        # ...and they are the composed clone's, not the cached rig's.
        self.assertTrue(c["distinctFromCache"])

    def test_the_result_carries_the_extras_a_pose_glb_carried(self) -> None:
        # `pose-motion.js` reads `userData.gaits` and `userData.gaitClips`, and
        # an older manifest is allowed to fall back to `gltf.userData.gaitAssets`.
        u = self.r["composed"]["userData"]
        self.assertEqual("USSoldier", u["soldier"])
        self.assertEqual("K98", u["weapon"])
        self.assertEqual({"run": {"lowerClip": "a", "upperClip": "b"}}, u["gaits"])
        self.assertEqual("gaits/lower.gait.glb", u["gaitAssets"]["lower"])
        self.assertEqual(["stand", "crouch", "fire"], u["stanceClips"])

    def test_the_root_node_keeps_the_pose_s_own_extras(self) -> None:
        # A weapon pose glb's root node carried `weapon` and `state` beside
        # `soldier`; `arms-rig.js` is one reader that reaches for
        # `scene.userData` rather than `gltf.userData`.
        self.assertEqual({"weapon": "K98", "soldier": "USSoldier", "state": None},
                         self.r["composed"]["rootUserData"])

    def test_the_weapon_hangs_off_the_hand_at_the_recipe_s_transform(self) -> None:
        g = self.r["composed"]["graft"]
        self.assertTrue(g["found"])
        self.assertEqual("Bip01 R Hand", g["parent"])
        self.assertEqual("Bip01 R Hand", g["weldBone"])
        self.assertEqual("K98", g["weapon"])
        self.assertEqual([0.02, 0.03, 0.04], g["position"])
        self.assertEqual([0, 0, 0, 1], g["quaternion"])
        # The weapon's own scene, cloned under the wrapper.
        self.assertEqual("K98", g["child"])

    # --- the point of the split ---------------------------------------------

    def test_a_second_pose_of_one_soldier_reuses_the_rig(self) -> None:
        s = self.r["sibling"]
        self.assertTrue(s["got"])
        self.assertTrue(s["ownScene"])
        self.assertEqual(1, s["rigLoads"])
        self.assertEqual(1, s["weaponLoads"])
        self.assertEqual(["models/poses/USSoldier__K98.pose.json",
                          "models/poses/USSoldier__M1Garand.pose.json"], s["fetched"])

    def test_one_pair_is_composed_once_and_cloned_by_the_caller(self) -> None:
        self.assertEqual({"samePromise": True, "sameScene": True}, self.r["cached"])

    # --- trees without recipes ----------------------------------------------

    def test_a_tree_with_no_recipe_still_loads_its_pose_glb(self) -> None:
        f = self.r["fallback"]
        self.assertEqual("USSoldier", f["got"])
        self.assertEqual("Thompson", f["userData"]["weapon"])

    def test_a_json_that_is_not_a_recipe_is_refused(self) -> None:
        # The gate is `format`, so any other `.pose.json` in the tree -- or a
        # 404 page that parses -- cannot be mistaken for one.
        self.assertEqual("USSoldier", self.r["fallback"]["notARecipe"])

    def test_an_uncached_composer_builds_a_scene_every_call(self) -> None:
        # For a caller that disposes what it stages (`poses.html`,
        # `controls-preview.js`): nothing it frees is still wanted.
        u = self.r["uncached"]
        self.assertTrue(u["distinct"])
        self.assertTrue(u["ownScenes"])
        self.assertTrue(u["otherComposer"])


if __name__ == "__main__":
    unittest.main()
