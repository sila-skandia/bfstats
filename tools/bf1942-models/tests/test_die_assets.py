"""The death clip bundle: `gaits/die.gait.glb` and its one manifest key.

What this pins, each read out of the game rather than chosen:

* **Every state `handleDamage` can reach is baked under its own name**, the
  twenty `extract_pose.DIE_STATES`, so `viewer/soldier-death.js`'s `DIE_CLIPS`
  and `DIE_IN_VEHICLE_UPPER` are the only table. The test reads the JS table
  back out of the file and holds the two lists against each other.

* **None of them loops.** The stand, crouch, lie, head, slow and by-vehicle
  states write `0` as `addAnimation`'s third word and the in-vehicle and
  hit-ground ones `c_AsmPlayOnce`; neither is a loop, so the corpse holds the
  last frame instead of getting up and falling again.

* **A subset run merges `gaits.json`.** One key, `die`, and every other key is
  left as it was.
"""

from __future__ import annotations

import json
import re
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates  # noqa: E402
from test_gaits import pack_baf_frames  # noqa: E402
from test_stances import FakePool  # noqa: E402
from test_parachute_assets import soldier_skeleton  # noqa: E402
from test_swim_assets import LOWER3, UPPER3  # noqa: E402
import extract_pose  # noqa: E402

VIEWER = Path(__file__).resolve().parents[1] / "viewer"

# The states as `AnimationStatesDie.con` + `3pAnimationsTweaking.con` leave
# them: 0.6 for the stand, crouch and by-vehicle deaths, 0.4 for the lie, 0.45
# for the head shot, 0.35 for the slow fall, 1.0 in the vehicle and on the
# ground.
SPEEDS = {"DieChestStand": 0.6, "DieBackStand": 0.6, "DieChestCrouch": 0.6,
          "DieBackCrouch": 0.6, "DieLie": 0.4, "DieHead": 0.45, "DieSlow": 0.35,
          "DieByVehicle": 0.6, "DieInVehicle": 1.0, "DieHitGround": 1.0}
LOOP_WORD = {"DieInVehicle": "c_AsmPlayOnce", "DieHitGround": "c_AsmPlayOnce"}


def die_machine() -> tuple[animstates.StateMachine, dict[str, bytes]]:
    machine = animstates.StateMachine()
    files: dict[str, bytes] = {}
    for name in extract_pose.DIE_STATES:
        half, base = name[:3], name[3:]
        path = f"d/{base}_{half.lower().rstrip('_')}.baf"
        files[path] = pack_baf_frames(UPPER3 if half == "Ub_" else LOWER3)
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(path, SPEEDS[base],
                                              LOOP_WORD.get(base, "0")))
        machine.states[name.lower()] = state
    return machine, files


def bundle(path: Path) -> dict:
    blob = path.read_bytes()
    length, = struct.unpack_from("<I", blob, 12)
    return json.loads(blob[20:20 + length])


def js_state_names() -> list[str]:
    """Every engine state name `soldier-death.js` asks the bundle for."""
    text = (VIEWER / "soldier-death.js").read_text()
    return re.findall(r"'((?:Lb|Ub)_Die\w+)'", text)


class DieClipBundleTests(unittest.TestCase):
    def export(self, out: Path) -> dict:
        machine, files = die_machine()
        return extract_pose.export_die_clips(
            machine, FakePool(files), soldier_skeleton(), out)

    def test_every_death_state_is_baked_under_its_own_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = bundle(out / "gaits" / "die.gait.glb")
            self.assertEqual(list(extract_pose.DIE_STATES),
                             [a["name"] for a in doc["animations"]])
            self.assertEqual("gaits/die.gait.glb", result["asset"])
            self.assertEqual({}, result["absent"])
            self.assertEqual({}, result["errors"])
            self.assertTrue(doc["extras"]["hidesWeapon"])

    def test_the_viewer_asks_for_exactly_the_baked_states(self) -> None:
        # One table: every name the viewer plays is baked, and every baked name
        # but `Lb_DieInVehicle` -- which `handleDamage` never enters -- is played.
        asked = set(js_state_names())
        baked = set(extract_pose.DIE_STATES)
        self.assertEqual(set(), asked - baked)
        self.assertEqual({"Lb_DieInVehicle"}, baked - asked)

    def test_no_death_loops(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = bundle(out / "gaits" / "die.gait.glb")
            for name, meta in result["clips"].items():
                self.assertFalse(meta["loop"], name)
            # Three frames: a loop ships four keys, a one-shot three.
            for anim in doc["animations"]:
                sampler = anim["samplers"][0]
                self.assertEqual(3, doc["accessors"][sampler["input"]]["count"],
                                 anim["name"])

    def test_the_period_is_the_tweaked_speed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clips = self.export(Path(tmp))["clips"]
            self.assertAlmostEqual(1 / 0.35, clips["Lb_DieSlow"]["period"], places=4)
            self.assertAlmostEqual(1 / 0.45, clips["Ub_DieHead"]["period"], places=4)
            self.assertAlmostEqual(1.0, clips["Ub_DieInVehicle"]["period"], places=4)

    def test_a_mod_with_no_death_states_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = extract_pose.export_die_clips(
                animstates.StateMachine(), FakePool({}), soldier_skeleton(), out)
            self.assertIsNone(result["asset"])
            self.assertEqual(len(extract_pose.DIE_STATES), len(result["absent"]))
            self.assertFalse((out / "gaits").exists())


class SoldierBodyTableTests(unittest.TestCase):
    """`setSkeletonCollisionBone` and `timeToLiveAfterDeath` off the soldier
    template, into `gaits.json`'s `soldierBody`."""

    CON = """ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.timeToLiveAfterDeath 10
ObjectTemplate.setSkeletonCollisionBone Bip01_Head 0.02 2 40
ObjectTemplate.setSkeletonCollisionBone Bip01_Spine2 0.08 -0.45 41
rem ObjectTemplate.setSkeletonCollisionBone Bip01_L_Foot 9 9 9
ObjectTemplate.setSkeletonCollisionBone Bip01_Head 0.03 2 40
"""

    def library(self):
        from bf42 import con as con_mod
        library = con_mod.ObjectLibrary()
        library.add_con("objects/soldiers/test/objects.con", self.CON)
        return library

    def test_the_capsules_parse_in_declaration_order(self) -> None:
        template = self.library().object("TestSoldier")
        # A re-declared bone keeps its first place with the latest numbers;
        # a `rem` line is not a command.
        self.assertEqual(
            [{"bone": "Bip01_Head", "distSq": 0.03, "stretch": 2.0, "material": 40},
             {"bone": "Bip01_Spine2", "distSq": 0.08, "stretch": -0.45, "material": 41}],
            template.collision_bones)
        self.assertEqual(10.0, template.time_to_live_after_death)

    def test_the_table_rides_out_in_the_manifest(self) -> None:
        machine, files = die_machine()
        library = self.library()
        original = extract_pose.read_skeleton
        extract_pose.read_skeleton = lambda _pool, _path: soldier_skeleton()
        library.object("TestSoldier").skeleton = "animations/UsSoldier.ske"
        try:
            with tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                summary = extract_pose.write_die_assets(
                    machine, FakePool(files), library, ["TestSoldier"], out)
                manifest = json.loads((out / "gaits" / "gaits.json").read_text())
        finally:
            extract_pose.read_skeleton = original
        self.assertEqual("gaits/die.gait.glb", manifest["die"])
        self.assertEqual(summary["soldierBody"], manifest["soldierBody"])
        self.assertEqual(10.0, manifest["soldierBody"]["timeToLiveAfterDeath"])
        self.assertEqual(2, len(manifest["soldierBody"]["collisionBones"]))


class DieManifestMergeTests(unittest.TestCase):
    def test_a_die_run_keeps_every_other_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "gaits").mkdir()
            before = {"lower": "gaits/lower.gait.glb",
                      "grips": {"Colt": "gaits/Colt.gait.glb"},
                      "swim": "gaits/swim.gait.glb"}
            (out / "gaits" / "gaits.json").write_text(json.dumps(before))
            merged = extract_pose.write_gaits_manifest(
                out, {"die": "gaits/die.gait.glb"})
            self.assertEqual({**before, "die": "gaits/die.gait.glb"}, merged)


if __name__ == "__main__":
    unittest.main()
