"""`bf42/recipe.py`: the split pose format, and that it loses nothing.

A recipe is a pose glb's own numbers in another container — the joint nodes'
static transforms, the stance clips' channel values, the weapon's grip
transform — so the test that matters is the round trip. Build a pose with the
same `GlbBuilder` calls the extractor makes, build the recipe from the same
locals and frames, read both back, and require every number a viewer draws to
agree. `check_recipe.py` runs the same comparison against the published tree,
where the glb is real; this one runs everywhere, with no game install and no
`viewer/models`.

The rest pins the conversion itself: the Z-mirrored translation and quaternion
`gltf.Node` and `add_animation` write, the canonical bone keys, the key layout
of a looping and a one-shot timeline, and the joint tree a rig is built from.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import check_recipe  # noqa: E402
from bf42 import gltf, recipe, ske  # noqa: E402
from extract_pose import joint_nodes_of, timeline_tracks  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
Z90 = ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))


def skeleton(*bones: tuple[str, int]) -> ske.Skeleton:
    return ske.Skeleton([
        ske.Bone(name=name, parent=parent,
                 rotation=IDENTITY if parent < 0 else Z90,
                 translation=(0.1 * (i + 1), 0.2, 0.3))
        for i, (name, parent) in enumerate(bones)
    ])


THREE_BONES = skeleton(("Bip01", -1), ("Bip01 Pelvis", 0), ("Bip01 Spine", 1))


def close(a, b) -> bool:
    return abs(a - b) <= 3e-6 + 1e-5 * max(abs(a), abs(b))


class TrsTests(unittest.TestCase):
    """The conversion, which is the whole of the format's fidelity."""

    def test_an_identity_transform_is_the_identity(self) -> None:
        self.assertEqual([0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
                         recipe.trs((IDENTITY, (0.0, 0.0, 0.0))))

    def test_the_translation_is_z_mirrored(self) -> None:
        # `build()` writes `[x, y, -z]` of the Refractor translation, so a
        # recipe has to hold the same triple or a viewer assigning it straight
        # onto a node lands the body mirrored.
        self.assertEqual([0.0, 0.0, 0.0, 1.0, 1.0, 2.0, -3.0],
                         recipe.trs((IDENTITY, (1.0, 2.0, 3.0))))

    def test_the_quaternion_is_the_gltf_conversion(self) -> None:
        rotation = ((0.0, 1.0, 0.0), (-1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        want = [round(v, 6) for v in gltf.quat_from_matrix(rotation)]
        self.assertEqual(want, recipe.trs((rotation, (0.0, 0.0, 0.0)))[:4])

    def test_a_negative_zero_comes_back_as_zero(self) -> None:
        # `-0.0` serialises as `-0.0`, which reads as a difference in a diff of
        # two runs that are the same file.
        self.assertEqual(0.0, recipe.trs((IDENTITY, (0.0, 0.0, -0.0)))[6])

    def test_the_value_is_rounded_to_six_places(self) -> None:
        self.assertEqual(0.123457, recipe.trs((IDENTITY, (0.1234567, 0.0, 0.0)))[4])


class JointKeyTests(unittest.TestCase):
    """Bone keys, and which bones a recipe names."""

    def test_keys_are_canonical_bone_names(self) -> None:
        # `Bip01_Pelvis` in a `.con` and `Bip01 Pelvis` in the `.ske` are one
        # bone, and the pose code has always addressed them that way.
        out = recipe.joints_of({"bip01 pelvis": (IDENTITY, (1.0, 0.0, 0.0))},
                               {"bip01 pelvis"})
        self.assertEqual(["bip01 pelvis"], list(out))

    def test_only_the_named_bones_are_written(self) -> None:
        out = recipe.joints_of(
            {"bip01 pelvis": (IDENTITY, (0.0, 0.0, 0.0)),
             "bip01 spine": (IDENTITY, (0.0, 0.0, 0.0))},
            {"bip01 spine"})
        self.assertEqual(["bip01 spine"], list(out))


class StillClipTests(unittest.TestCase):
    def test_a_still_is_one_value_per_bone(self) -> None:
        clip = recipe.still_clip({"bip01": (IDENTITY, (1.0, 0.0, 0.0))}, {"bip01"})
        self.assertEqual({"still": {"bip01": [0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0]}},
                         clip)


class TimelineClipTests(unittest.TestCase):
    """The key layout `timeline_tracks` uses, and for the same reasons."""

    def frames(self, count: int) -> list[dict]:
        return [{"bip01": (IDENTITY, (0.1 * i, 0.0, 0.0))} for i in range(count)]

    def test_a_looping_clip_gets_n_plus_one_keys_over_its_period(self) -> None:
        clip = recipe.timeline_clip(self.frames(4), 0.5, {"bip01"})
        self.assertEqual([0.0, 0.125, 0.25, 0.375, 0.5], clip["times"])
        self.assertEqual(5, len(clip["bones"]["bip01"]))
        # The last key repeats frame 0, so a three.js LoopRepeat action seams.
        self.assertEqual(clip["bones"]["bip01"][0], clip["bones"]["bip01"][4])

    def test_a_one_shot_spans_n_minus_one_intervals(self) -> None:
        clip = recipe.timeline_clip(self.frames(4), 0.5, {"bip01"}, loop=False)
        self.assertEqual([0.0, 0.166667, 0.333333, 0.5], clip["times"])
        self.assertEqual(4, len(clip["bones"]["bip01"]))

    def test_a_single_frame_still_spans_the_period(self) -> None:
        clip = recipe.timeline_clip(self.frames(1), 0.8, {"bip01"})
        self.assertEqual([0.0, 0.8], clip["times"])
        self.assertEqual(clip["bones"]["bip01"][0], clip["bones"]["bip01"][1])

    def test_the_keys_are_hemisphere_aligned(self) -> None:
        # `add_animation` flips a key whose quaternion took the other branch,
        # so a recipe has to hold the flipped one or the two files interpolate
        # differently across the same boundary.
        rts = [(IDENTITY, (0.0, 0.0, 0.0)), (IDENTITY, (1.0, 0.0, 0.0))]
        clip = recipe.timeline_clip([{"b": rt} for rt in rts], 1.0, {"b"})
        quats = gltf._hemisphere_align([gltf.quat_from_matrix(IDENTITY)] * 2)
        self.assertEqual(list(quats[0]), clip["bones"]["b"][0][:4])
        self.assertEqual(list(quats[1]), clip["bones"]["b"][1][:4])


class JointNodesTests(unittest.TestCase):
    """The tree a rig is built from — the same one a pose glb carries."""

    def build(self, locals_map):
        builder = gltf.GlbBuilder()
        joints, roots = joint_nodes_of(builder, THREE_BONES, locals_map)
        return builder, joints, roots

    def test_a_bone_the_locals_leave_alone_holds_its_ske_rest(self) -> None:
        builder, joints, roots = self.build({})
        node = builder._nodes[joints["bip01 pelvis"]]
        bone = THREE_BONES.bones[1]
        self.assertEqual(bone.translation, node.translation)
        self.assertEqual(gltf.quat_from_matrix(bone.rotation), node.rotation)
        self.assertEqual(3, len(joints))

    def test_the_locals_win_where_they_name_a_bone(self) -> None:
        builder, joints, _roots = self.build({"bip01 spine": (IDENTITY,
                                                              (9.0, 8.0, 7.0))})
        self.assertEqual((9.0, 8.0, 7.0), builder._nodes[joints["bip01 spine"]].translation)

    def test_every_bone_is_marked_a_joint(self) -> None:
        builder, joints, _roots = self.build({})
        for node in joints.values():
            self.assertTrue(builder._nodes[node].extras["joint"])

    def test_the_parent_chain_is_wired_and_the_roots_come_back(self) -> None:
        builder, joints, roots = self.build({})
        self.assertEqual([joints["bip01"]], roots)
        self.assertEqual([joints["bip01 pelvis"]], builder._nodes[joints["bip01"]].children)
        self.assertEqual([joints["bip01 spine"]],
                         builder._nodes[joints["bip01 pelvis"]].children)


class RecipeMatchesGlbTests(unittest.TestCase):
    """The round trip: the same pose, written both ways, read back and compared.

    This is the contract the viewer relies on — a recipe's numbers ARE the
    glb's — exercised through the real builder and the real reader, with no
    game install and no published tree.
    """

    def setUp(self) -> None:
        self.locals_map = {
            "bip01": (Z90, (0.0, 0.0, 0.0)),
            "bip01 pelvis": (IDENTITY, (0.05, 0.0, -0.02)),
        }
        # The union of every stance's bones, which is the rule `export_pose`
        # follows: a bone a stance leaves alone holds its `.ske` rest.
        self.animated = sorted({"bip01", "bip01 pelvis", "bip01 spine"})
        rest = {ske.canonical(b.name): (b.rotation, b.translation)
                for b in THREE_BONES.bones}
        self.stills = {
            "stand": {n: self.locals_map.get(n, rest[n]) for n in self.animated},
            "crouch": {n: rest[n] for n in self.animated},
        }
        self.frames = [{"bip01": (IDENTITY, (0.1 * i, 0.0, 0.0)),
                        "bip01 pelvis": (Z90, (0.0, 0.0, 0.0))}
                       for i in range(4)]
        self.period = 0.5

        builder = gltf.GlbBuilder()
        joints, roots = joint_nodes_of(builder, THREE_BONES, self.locals_map)
        for key, effective in self.stills.items():
            builder.add_animation(
                key, [(joints[n], (0.0, 1.0), [effective[n], effective[n]])
                      for n in self.animated])
        builder.add_animation("seat.lower",
                              timeline_tracks(self.frames, self.period, joints))
        self.root_rotation = list(gltf.quat_from_ypr(180.0, -90.0, 0.0))
        root = builder.add_node(gltf.Node(
            name="USSoldier in Ub_SitInVehicle", rotation=self.root_rotation,
            children=roots, extras={"soldier": "USSoldier"}))
        self.state = check_recipe.glb_state(
            check_recipe.parse_glb(builder.build([root])))

        attach = (Z90, (0.076, 0.027, -0.0314))
        attach_trs = recipe.trs(attach)
        self.doc = recipe.document(
            kind="weapon", soldier="USSoldier", pose="K98",
            rig=recipe.rig_rel("USSoldier"),
            root={"name": "USSoldier holding K98", "q": self.root_rotation},
            joints=recipe.joints_of(self.locals_map, joints),
            clips={key: recipe.still_clip(effective, self.animated)
                   for key, effective in self.stills.items()}
                  | {"seat.lower": recipe.timeline_clip(
                      self.frames, self.period, joints)},
            weapon="K98",
            attach={"bone": recipe.WELD_BONE, "q": attach_trs[:4],
                    "t": attach_trs[4:]},
        )

    def test_the_joint_transforms_agree(self) -> None:
        for bone, values in self.doc["joints"].items():
            want = self.state["joints"][bone]
            for a, b in zip(values, want):
                self.assertTrue(close(a, b), f"{bone}: {values} != {want}")

    def test_the_still_clips_agree(self) -> None:
        for name, clip in self.doc["clips"].items():
            if "still" not in clip:
                continue
            for bone, values in clip["still"].items():
                want = self.state["clips"][name]["bones"][bone][0]
                for a, b in zip(values, want):
                    self.assertTrue(close(a, b),
                                    f"{name}.{bone}: {values} != {want}")

    def test_the_timeline_agrees_key_for_key(self) -> None:
        clip = self.doc["clips"]["seat.lower"]
        want = self.state["clips"]["seat.lower"]
        self.assertEqual(len(want["times"]), len(clip["times"]))
        for a, b in zip(clip["times"], want["times"]):
            self.assertTrue(close(a, b))
        for bone, keys in clip["bones"].items():
            self.assertEqual(len(want["bones"][bone]), len(keys))
            for got, expected in zip(keys, want["bones"][bone]):
                for a, b in zip(got, expected):
                    self.assertTrue(close(a, b),
                                    f"{bone}: {got} != {expected}")

    def test_the_root_and_the_attach_agree(self) -> None:
        self.assertEqual(self.root_rotation, self.state["root"])
        grip = recipe.trs(((Z90), (0.076, 0.027, -0.0314)))
        self.assertEqual(grip, self.doc["attach"]["q"] + self.doc["attach"]["t"])


class DocumentTests(unittest.TestCase):
    def document(self, **fields) -> dict:
        return recipe.document(kind="weapon", soldier="USSoldier", pose="K98",
                               rig=recipe.rig_rel("USSoldier"),
                               root={"name": "r", "q": [0.0, 0.0, 0.0, 1.0]},
                               joints={}, clips={"stand": {"still": {}}},
                               **fields)

    def test_the_format_is_declared_and_the_clips_are_named_in_order(self) -> None:
        doc = self.document(weapon="K98")
        self.assertEqual(recipe.FORMAT, doc["format"])
        self.assertEqual(["stand"], doc["clipNames"])

    def test_a_field_the_pose_does_not_have_is_left_out(self) -> None:
        # `--gaits none` has no gait assets and a seat pose has no weapon; an
        # absent key and a null one read the same, and the absent one is
        # smaller.
        doc = self.document(weapon=None, gaitAssets=None, state="StandAim")
        self.assertNotIn("weapon", doc)
        self.assertNotIn("gaitAssets", doc)
        self.assertNotIn("attach", doc)
        self.assertEqual("StandAim", doc["state"])

    def test_a_weapon_pose_carries_its_attachment(self) -> None:
        doc = self.document(weapon="K98", attach={"bone": "Bip01 R Hand"})
        self.assertEqual("Bip01 R Hand", doc["attach"]["bone"])

    def test_the_rig_and_the_recipe_live_where_the_viewer_looks(self) -> None:
        self.assertEqual("rigs/USSoldier.rig.glb", recipe.rig_rel("USSoldier"))
        self.assertEqual("USSoldier__K98.pose.json",
                         recipe.recipe_rel("USSoldier", "K98"))

    def test_the_weld_bone_is_the_hand_every_weapon_skeleton_is_rooted_at(self) -> None:
        self.assertEqual("Bip01 R Hand", recipe.WELD_BONE)


if __name__ == "__main__":
    unittest.main()
