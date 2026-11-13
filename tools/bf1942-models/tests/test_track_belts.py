"""Track belts ride their bogies (gap 36 of the retail inverse audit).

`AnimatedBundle::updateAnimations` (lnxded `0x08266080`): when the bundle's
skeleton has as many bones as its template has `useAsBone` children
(`0x082661d5`-`0x082661e5`), bone k takes the identity rotation
(`0x0826651f`-`0x08266557`) and the relative position of the k-th such child
(`0x08266509`), then the skeleton is transformed (`0x08266321`).
`AnimatedBundleTemplate::useAsBone` (`0x082685a0`) only appends the 32-byte
BoneInfo naming the last `addTemplate`'s child, and `setBoneOriginOffset`
(`0x08268680`) writes that record's second vector; both vectors are read by
the editor's `buildSkin` (`0x082678f0`) alone, which wrote the shipped `.skn`
against bones named `bone%d` (`buildSkeleton` `0x08268360`).

Three layers: `bf42/con.py` keeps the two words, `bf42/assemble.py` bakes the
belt as a skinned mesh with one joint a bone (`_bind_belt`), and
`viewer/track-scroll.js` `followBogies` is the engine's loop.
"""

# The one folder scan below (`game_dir`) lists a game install's Archives, so
# the reference walk alone decides when this runs.
# watches: nothing

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from bf42 import assemble, skin  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "track_belts_harness.mjs"


def game_dir() -> Path | None:
    """An install holding vanilla's object and animation archives, or None."""
    candidates = [
        os.environ.get("BF1942_GAME_DIR"),
        Path.home() / ".wine/drive_c/EA Games/Battlefield 1942",
        Path.home() / ".cache/vimpact-game",
        Path.home() / "bf1942-game",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        archives = Path(candidate) / "Mods" / "bf1942" / "Archives"
        if archives.is_dir() and any(
                p.name.lower() == "animations.rfa" for p in archives.iterdir()):
            return Path(candidate)
    return None


GAME = game_dir()


class BoneWordsTests(unittest.TestCase):
    """`useAsBone` and `setBoneOriginOffset`, as the template setters keep them."""

    @classmethod
    def setUpClass(cls) -> None:
        lib = ObjectLibrary()
        # The Sherman's left belt, `Objects/Vehicles/Land/Sherman/Objects.con`.
        lib.add_con("objects/sherman.con", "\n".join([
            "ObjectTemplate.create AnimatedBundle ShermanTrackL",
            "ObjectTemplate.geometry Sherman_TrackL_M1",
            "ObjectTemplate.createSkeleton animations/shermanTrackL.ske",
            "ObjectTemplate.addTemplate ShermanWheelL1",
            "ObjectTemplate.setPosition -0.949/0.65/-2.599",
            "ObjectTemplate.setBoneOriginOffset 0/-9/0",
            "ObjectTemplate.addTemplate ShermanWheelL3Dummy",
            "ObjectTemplate.setPosition -0.999/0.12/2.05",
            "ObjectTemplate.useAsBone 0/-0.15/0.3",
            "ObjectTemplate.setBoneOriginOffset 0/-0.5/0",
            "ObjectTemplate.addTemplate ShermanWheelL3",
            "ObjectTemplate.setPosition -0.999/0.12/1.2",
            "ObjectTemplate.useAsBone 0/-0.15/0",
            "ObjectTemplate.addTemplate ShermanWheelL4",
            "ObjectTemplate.setPosition -1.099/0.8/1.15",
        ]))
        cls.children = lib.object("ShermanTrackL").children

    def test_use_as_bone_marks_the_child_just_added(self) -> None:
        self.assertEqual(
            [None, (0.0, -0.15, 0.3), (0.0, -0.15, 0.0), None],
            [child.use_as_bone for child in self.children])

    def test_bone_k_is_the_kth_marked_child(self) -> None:
        bones = [c.template for c in self.children if c.use_as_bone is not None]
        self.assertEqual(["ShermanWheelL3Dummy", "ShermanWheelL3"], bones)

    def test_origin_offset_writes_the_last_bone_only(self) -> None:
        # `0x08268680` writes the LAST BoneInfo: on a child with no bone of
        # its own it lands on an earlier record (or nowhere), never on it.
        self.assertEqual(
            [None, (0.0, -0.5, 0.0), None, None],
            [child.bone_origin_offset for child in self.children])


class BeltInfluenceTests(unittest.TestCase):
    """A `.skn` of `bone<N>` bones into JOINTS_0, WEIGHTS_0 and binds."""

    def setUp(self) -> None:
        inf = skin.Influence
        # The skin lists its bones in its own order; the NUMBER is the joint.
        self.numbers = [2, 0]
        self.skn = skin.Skin(
            vertices=[
                skin.SkinVertex((-1.245, 0.056, 1.473), (inf(0, 1.0, (-0.245, -0.214, 0.273)),)),
                skin.SkinVertex((-1.245, 0.057, 1.955), (inf(1, 1.0, (-0.245, -0.213, -0.095)),)),
                skin.SkinVertex((-1.0, 0.5, 1.6), (
                    inf(0, 0.75, (0.0, 0.23, 0.4)), inf(1, 0.25, (0.0, 0.23, -0.45)))),
            ],
            bones=["bone2", "bone0"])

    def test_joints_are_bone_numbers_and_weights_sum_to_one(self) -> None:
        binds: dict = {}
        positions = [v.rest for v in self.skn.vertices]
        joints, weights = assemble.belt_influences(positions, self.skn, self.numbers, binds)
        self.assertEqual((2, 0, 0, 0), joints[0])
        self.assertEqual((0, 0, 0, 0), joints[1])
        self.assertEqual((2, 0), joints[2][:2])
        self.assertEqual((0.75, 0.25, 0.0, 0.0), weights[2])
        for w in weights:
            self.assertAlmostEqual(1.0, sum(w))

    def test_a_bones_bind_is_rest_less_offset(self) -> None:
        binds: dict = {}
        positions = [v.rest for v in self.skn.vertices]
        assemble.belt_influences(positions, self.skn, self.numbers, binds)
        for found in binds[2]:
            for got, want in zip(found, (-1.0, 0.27, 1.2)):
                self.assertAlmostEqual(want, got, places=6)
        for found in binds[0]:
            for got, want in zip(found, (-1.0, 0.27, 2.05)):
                self.assertAlmostEqual(want, got, places=6)

    def test_a_vertex_the_skin_lacks_takes_its_nearest(self) -> None:
        binds: dict = {}
        joints, _ = assemble.belt_influences(
            [(-1.2, 0.06, 1.95)], self.skn, self.numbers, binds)
        self.assertEqual((0, 0, 0, 0), joints[0])


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    json_len = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    return doc, data[bin_start:]


def accessor(doc: dict, blob: bytes, index: int, fmt: str, width: int) -> list[tuple]:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    size = struct.calcsize(fmt)
    stride = view.get("byteStride", size)
    return [struct.unpack_from(fmt, blob, start + i * stride)[:width]
            for i in range(acc["count"])]


@unittest.skipUnless(GAME is not None, "needs the BF1942 install")
class BakedBeltTests(unittest.TestCase):
    """The Sherman and the Tiger as `extract_models.py` writes them."""

    docs: dict[str, tuple[dict, bytes]]
    reports: dict[str, dict]

    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.mkdtemp(prefix="track-belts-")
        proc = subprocess.run(
            [sys.executable, str(ROOT / "extract_models.py"), "Sherman", "Tiger",
             "--game-dir", str(GAME), "--mod", "bf1942", "--out", cls.tmp],
            capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise AssertionError(f"extract_models failed:\n{proc.stdout}\n{proc.stderr}")
        cls.docs = {name: read_glb(Path(cls.tmp) / f"{name}.glb")
                    for name in ("Sherman", "Tiger")}
        cls.reports = {name: json.loads((Path(cls.tmp) / f"{name}.report.json").read_text())
                       for name in ("Sherman", "Tiger")}

    @classmethod
    def tearDownClass(cls) -> None:
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def belt(self, model: str, name: str) -> tuple[dict, bytes, dict]:
        doc, blob = self.docs[model]
        node = next(n for n in doc["nodes"] if n["name"] == name)
        return doc, blob, node

    def test_each_belt_carries_a_skin_of_one_joint_a_bone(self) -> None:
        for model, name, bones in (("Sherman", "ShermanTrackL", 6), ("Sherman", "ShermanTrackR", 6),
                                   ("Tiger", "TigerTrackL", 8), ("Tiger", "TigerTrackR", 8)):
            doc, _blob, node = self.belt(model, name)
            self.assertEqual(bones, node["extras"]["trackBones"], name)
            joints = doc["skins"][node["skin"]]["joints"]
            self.assertEqual(bones, len(joints), name)
            self.assertEqual(list(range(bones)),
                             [doc["nodes"][j]["extras"]["trackBone"] for j in joints])
            # The joints are the belt's own children, beside the bogies.
            self.assertTrue(set(joints) <= set(node["children"]))

    def test_each_joint_has_one_bogie_among_the_belts_children(self) -> None:
        doc, _blob, node = self.belt("Sherman", "ShermanTrackL")
        bogies = {doc["nodes"][c]["extras"]["trackBogie"]: doc["nodes"][c]
                  for c in node["children"]
                  if "trackBogie" in (doc["nodes"][c].get("extras") or {})}
        self.assertEqual(list(range(6)), sorted(bogies))
        # The con's order: bone 0 is the first `useAsBone` child, the rear
        # dummy at z 2.05 (mirrored on the way to glTF), bone 1 the spring.
        self.assertEqual("ShermanWheelL3Dummy", bogies[0]["name"])
        self.assertEqual("ShermanWheelL3", bogies[1]["name"])
        self.assertEqual("ShermanWheelL3DummyMiddle", bogies[2]["name"])
        for got, want in zip(bogies[0]["translation"], (-0.999, 0.12, -2.05)):
            self.assertAlmostEqual(want, got, places=5)
        # The return rollers and the sprockets carry no bone.
        unmarked = [doc["nodes"][c]["name"] for c in node["children"]
                    if not (doc["nodes"][c].get("extras") or {}).keys()
                    & {"trackBogie", "trackBone"}]
        self.assertIn("ShermanWheelL4", unmarked)
        self.assertIn("ShermanWheelL1", unmarked)

    def test_a_joint_rests_at_the_skins_bind_not_at_its_spring(self) -> None:
        # The Sherman's `.skn` binds 0.15 m above the springs (0.12): the
        # `useAsBone 0/-0.15/0` of the day it was built. The con has since
        # been edited (bone 0 says z 0.3, the right belt's -1.45) and the
        # skin was not: the file's own bind is what the vertices were cut to.
        for name in ("ShermanTrackL", "ShermanTrackR"):
            doc, _blob, node = self.belt("Sherman", name)
            for j in doc["skins"][node["skin"]]["joints"]:
                self.assertAlmostEqual(0.27, doc["nodes"][j]["translation"][1], places=5)
        # The Tiger's `useAsBone 0/0/0`: bind and spring are one place.
        doc, _blob, node = self.belt("Tiger", "TigerTrackL")
        by_bone = {doc["nodes"][c]["extras"]["trackBogie"]: doc["nodes"][c]["translation"]
                   for c in node["children"]
                   if "trackBogie" in (doc["nodes"][c].get("extras") or {})}
        for j in doc["skins"][node["skin"]]["joints"]:
            joint = doc["nodes"][j]
            for got, want in zip(joint["translation"], by_bone[joint["extras"]["trackBone"]]):
                self.assertAlmostEqual(want, got, places=2)

    def test_inverse_binds_undo_the_rest_so_the_bind_pose_is_the_mesh(self) -> None:
        doc, blob, node = self.belt("Sherman", "ShermanTrackL")
        sk = doc["skins"][node["skin"]]
        matrices = accessor(doc, blob, sk["inverseBindMatrices"], "<16f", 16)
        for j, m in zip(sk["joints"], matrices):
            # Identity rotation: a bone never turns (`0x0826651f`).
            self.assertEqual((1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0), m[:12])
            for got, rest in zip(m[12:15], doc["nodes"][j]["translation"]):
                self.assertAlmostEqual(-rest, got, places=5)

    def test_every_belt_vertex_is_weighted_to_a_joint(self) -> None:
        for model, name, bones in (("Sherman", "ShermanTrackL", 6), ("Tiger", "TigerTrackR", 8)):
            doc, blob, node = self.belt(model, name)
            used: set[int] = set()
            for prim in doc["meshes"][node["mesh"]]["primitives"]:
                attrs = prim["attributes"]
                self.assertIn("JOINTS_0", attrs, name)
                joints = accessor(doc, blob, attrs["JOINTS_0"], "<4H", 4)
                weights = accessor(doc, blob, attrs["WEIGHTS_0"], "<4f", 4)
                self.assertEqual(doc["accessors"][attrs["POSITION"]]["count"], len(joints))
                for j, w in zip(joints, weights):
                    self.assertAlmostEqual(1.0, sum(w), places=5)
                    self.assertLess(max(j), bones)
                    used.add(j[0])
            # More than one bone holds vertices, or nothing could bend.
            self.assertGreater(len(used), 3, name)

    def test_a_vertex_is_bound_to_the_bogie_over_it(self) -> None:
        # Every belt vertex's bone is within the belt's own length of it along
        # the hull, and the bottom run's are the nearest bogie fore and aft.
        doc, blob, node = self.belt("Sherman", "ShermanTrackL")
        sk = doc["skins"][node["skin"]]
        rest_z = [doc["nodes"][j]["translation"][2] for j in sk["joints"]]
        worst = 0.0
        for prim in doc["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            positions = accessor(doc, blob, attrs["POSITION"], "<3f", 3)
            joints = accessor(doc, blob, attrs["JOINTS_0"], "<4H", 4)
            for p, j in zip(positions, joints):
                if p[1] > 0.2:
                    continue        # the bottom run only
                worst = max(worst, abs(p[2] - rest_z[j[0]]))
        self.assertLess(worst, 1.0)

    def test_the_report_says_which_belts_were_skinned(self) -> None:
        lines = self.reports["Sherman"]["skinnedParts"]
        self.assertIn("ShermanTrackL belt skinned to 6 of 6 bogies", lines)
        self.assertIn("ShermanTrackR belt skinned to 6 of 6 bogies", lines)
        self.assertIn("TigerTrackL belt skinned to 8 of 8 bogies",
                      self.reports["Tiger"]["skinnedParts"])

    def test_nothing_else_in_the_hull_gained_a_skin(self) -> None:
        doc, _blob = self.docs["Sherman"]
        self.assertEqual(["ShermanTrackL", "ShermanTrackR"],
                         [n["name"] for n in doc["nodes"] if "skin" in n])
        self.assertEqual(2, len(doc["skins"]))


class FollowBogiesTests(unittest.TestCase):
    """`viewer/track-scroll.js` `followBogies` under node."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_an_undriven_belt_is_the_mesh(self) -> None:
        for vertex in self.results["rest"]:
            self.assertEqual([-1.245, 0.056], vertex[:2])

    def test_a_joint_takes_its_bogies_position(self) -> None:
        self.assertEqual(6, self.results["posed"])
        for joint, lift in zip(self.results["joints"], self.results["lifts"]):
            self.assertEqual(-0.999, joint[0])
            self.assertAlmostEqual(0.12 + lift, joint[1], places=5)

    def test_a_joint_never_takes_the_wheels_spin(self) -> None:
        self.assertFalse(self.results["jointTurned"])

    def test_the_tread_under_a_bogie_rides_with_it(self) -> None:
        # vertex = mesh + (bogie - bind): the Sherman's bind is 0.15 m above
        # the spring, so the tread under a spring pushed up 0.15 m is where
        # the mesh has it, and each stretch moves by its own bogie's lift.
        for vertex, lift in zip(self.results["driven"], self.results["lifts"]):
            self.assertAlmostEqual(0.056 - 0.15 + lift, vertex[1], places=5)
        # Sideways it moves the millimetre the con's -0.999 is off the
        # skin's -1.0, as retail's does.
        for vertex in self.results["driven"]:
            self.assertAlmostEqual(-1.244, vertex[0], places=5)

    def test_the_load_time_bounds_are_measured_again(self) -> None:
        self.assertTrue(self.results["boundsCleared"])

    def test_it_follows_every_call(self) -> None:
        self.assertEqual(0.12, self.results["again"])

    def test_a_belt_baked_before_the_skin_is_left_alone(self) -> None:
        self.assertEqual(0, self.results["unskinned"])
        self.assertEqual([0, 0], self.results["nothing"])

    def test_a_bone_with_no_bogie_keeps_its_rest(self) -> None:
        self.assertEqual(5, self.results["partial"])
        self.assertEqual(0.27, self.results["orphan"])
        self.assertEqual([-1.245, 0.056, -0.3], self.results["partialDrawn"])


    def test_a_presented_hull_gets_its_belt_back_as_the_mesh(self) -> None:
        # `presentKinematic` draws a recorded hull's wheels at their authored
        # height (no spring travel is recorded): a belt following them there
        # would hang 0.15 m below the tread the recording drove on.
        self.assertEqual(0, self.results["restBeforePose"])
        self.assertEqual(6, self.results["restored"])
        self.assertEqual([0.27] * 6, self.results["restoredJoints"])
        self.assertEqual([0.056] * 6, self.results["restoredDrawn"])
        self.assertEqual(0, self.results["restAgain"])
        self.assertEqual([0, 0], self.results["restNothing"])


class DriveCallsTests(unittest.TestCase):
    """Both ground drives pose the belts where they integrate the springs."""

    def test_the_drives_follow_the_bogies_and_presenters_rest_them(self) -> None:
        for name in ("tracked-vehicle.js", "wheeled-vehicle.js"):
            source = (ROOT / "viewer" / name).read_text()
            apply = source.index("#applyWheels(sprung = true) {")
            body = source[apply:source.index("\n  }\n", apply)]
            self.assertIn("if (sprung) followBogies(this.node);", body, name)
            self.assertIn("else restBelts(this.node);", body, name)
            present = source.index("  presentKinematic(dt")
            presented = source[present:source.index("\n  }\n", present)]
            self.assertIn("this.#applyWheels(false);", presented, name)
            reset = source.index("\n  reset() {")
            self.assertIn("restBelts(this.node);",
                          source[reset:source.index("\n  }\n", reset)], name)


if __name__ == "__main__":
    unittest.main()
