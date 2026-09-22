"""The swim clip bundle: `gaits/swim.gait.glb` and its one manifest key.

Three things this pins, each read out of the game rather than chosen:

* **The entry and the exit are the same clip.** `Lb_StartSwim` and `Lb_EndSwim`
  both name `3PSwimStartLower.baf`; the exit plays it at a **negative** speed
  (-3.2) and `clip_timeline` reverses the frames, so the exit is a timeline of
  its own rather than a renderer running an action backwards.

* **The shipped entry speed is not the one in `AnimationStatesSwim.con`.** That
  file writes 3.6; `animations/3pAnimationsTweaking.con` re-declares
  `set3pAnimationSpeed Lb_StartSwim 2.60` over it. Reading the parsed machine is
  what picks the override up, and the period is `1/|speed|` (ledger ANIM-1), not
  a function of the frame count.

* **A subset run merges `gaits.json`.** One key, `swim`, and the 23 grip bundles
  plus the parachute's three keys are left exactly as they were. `models.json`
  lost every entry and every thumbnail to the opposite of this once.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates  # noqa: E402
from test_gaits import pack_baf_frames  # noqa: E402
from test_stances import FakePool, QUAT_ID, pos_words  # noqa: E402
from test_parachute_assets import soldier_skeleton  # noqa: E402
import extract_pose  # noqa: E402


def moving(name: str, heights: list[float]):
    return (name, [(QUAT_ID, pos_words(0.0, 0.0, h)) for h in heights])


LOWER3 = [moving("Bip01", [0.9, 0.95, 0.92]),
          moving("Bip01 Pelvis", [0.10, 0.11, 0.12])]
UPPER3 = [moving("Bip01 Spine", [0.20, 0.21, 0.22])]

# The swim states as the machine ends up with them: the tweaking file's 2.60 for
# the entry, -3.2 for the exit, the two 1.0 strokes, the 0.4 float, the 0.6
# death. Every lower one carries `c_AsmHideWeapon` and `c_AsmIsSwimming`.
SWIM_STATES: dict[str, tuple[str, float, str, str | None]] = {
    "Lb_StartSwim": ("s/start_lower.baf", 2.6, "c_AsmPlayOnce", "Lb_SwimForward"),
    "Ub_StartSwim": ("s/start_upper.baf", 2.6, "c_AsmPlayOnce", "Ub_SwimForward"),
    "Lb_Floating": ("s/float_lower.baf", 0.4, "c_AsmLooping", "Lb_Floating"),
    "Ub_Floating": ("s/float_upper.baf", 0.4, "c_AsmLooping", "Ub_Floating"),
    "Lb_SwimForward": ("s/fwd_lower.baf", 1.0, "c_AsmLooping", "Lb_Floating"),
    "Ub_SwimForward": ("s/fwd_upper.baf", 1.0, "c_AsmLooping", "Ub_Floating"),
    "Lb_SwimBackward": ("s/back_lower.baf", 1.0, "c_AsmLooping", "Lb_Floating"),
    "Ub_SwimBackward": ("s/back_upper.baf", 1.0, "c_AsmLooping", "Ub_Floating"),
    "Lb_EndSwim": ("s/start_lower.baf", -3.2, "c_AsmPlayOnce", "Lb_Stand"),
    "Ub_EndSwim": ("s/start_upper.baf", -3.2, "c_AsmPlayOnce", "Ub_Stand"),
    "Lb_DieSwim": ("s/die_lower.baf", 0.6, "c_AsmPlayOnce", None),
    "Ub_DieSwim": ("s/die_upper.baf", 0.6, "c_AsmPlayOnce", None),
}

SWIM_FILES = {
    path: pack_baf_frames(UPPER3 if "upper" in path else LOWER3)
    for path, _speed, _loop, _ret in SWIM_STATES.values()
}


def swim_machine(states=None) -> animstates.StateMachine:
    machine = animstates.StateMachine()
    for name, (path, speed, loop, ret) in (states or SWIM_STATES).items():
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(path, speed, loop))
        state.return_to = ret
        machine.states[name.lower()] = state
    return machine


class SwimClipBundleTests(unittest.TestCase):
    def export(self, out: Path, machine=None) -> dict:
        return extract_pose.export_swim_clips(
            machine or swim_machine(), FakePool(SWIM_FILES),
            soldier_skeleton(), out)

    def bundle(self, path: Path) -> dict:
        blob = path.read_bytes()
        length, = struct.unpack_from("<I", blob, 12)
        return json.loads(blob[20:20 + length])

    def test_all_twelve_states_are_baked_under_their_own_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = self.bundle(out / "gaits" / "swim.gait.glb")

            # `viewer/swim.js`'s SWIM_CLIPS names these states; the clip names are
            # the same strings, so there is no translation table.
            self.assertEqual(list(extract_pose.SWIM_STATES),
                             [a["name"] for a in doc["animations"]])
            self.assertEqual("gaits/swim.gait.glb", result["asset"])
            self.assertEqual({}, result["absent"])
            self.assertEqual({}, result["errors"])

    def test_the_bundle_is_clips_over_joints_with_no_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "swim.gait.glb")

            self.assertNotIn("meshes", doc)
            self.assertNotIn("materials", doc)
            self.assertEqual(3, len(doc["nodes"]))

    def test_the_bundle_says_the_weapon_is_stowed(self) -> None:
        # Every lower swim state declares `setFlag c_AsmHideWeapon`, and
        # `BFSoldier::enableItem` (`0x082784af`) obeys it. The bundle carries the
        # fact so a renderer does not have to be told.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "swim.gait.glb")
            self.assertTrue(doc["extras"]["hidesWeapon"])

    def test_the_exit_is_the_entry_clip_at_a_negative_speed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self.export(Path(tmp))

            entry = result["clips"]["Lb_StartSwim"]
            exit_ = result["clips"]["Lb_EndSwim"]
            self.assertEqual(entry["clip"], exit_["clip"])
            self.assertEqual(2.6, entry["speed"])
            self.assertEqual(-3.2, exit_["speed"])
            # 1/|speed| both ways (ledger ANIM-1), so the exit is the faster of
            # the two and neither depends on the eight frames they share.
            self.assertAlmostEqual(1 / 2.6, entry["period"], places=4)
            self.assertAlmostEqual(1 / 3.2, exit_["period"], places=4)
            self.assertEqual("Lb_SwimForward", entry["returnTo"])
            self.assertEqual("Lb_Stand", exit_["returnTo"])

    def test_the_loops_and_the_one_shots_are_the_states_own_words(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = self.bundle(out / "gaits" / "swim.gait.glb")
            counts = {}
            for anim in doc["animations"]:
                sampler = anim["samplers"][0]
                counts[anim["name"]] = doc["accessors"][sampler["input"]]["count"]

            self.assertTrue(result["clips"]["Lb_Floating"]["loop"])
            self.assertTrue(result["clips"]["Lb_SwimForward"]["loop"])
            self.assertFalse(result["clips"]["Lb_StartSwim"]["loop"])
            self.assertFalse(result["clips"]["Lb_DieSwim"]["loop"])
            # Three frames: a loop ships four keys, a one-shot three.
            self.assertEqual(4, counts["Lb_Floating"])
            self.assertEqual(3, counts["Lb_StartSwim"])
            self.assertEqual(3, counts["Lb_EndSwim"])
            self.assertEqual(3, counts["Lb_DieSwim"])

    def test_the_death_pair_is_in_the_same_bundle(self) -> None:
        # `AnimationStatesDie.con`, not the swim file -- but selected by
        # `handleDamage`'s `c_AsmIsSwimming` test (`0x08270c63`), so it belongs
        # with the swim clips and not with the standing deaths.
        with tempfile.TemporaryDirectory() as tmp:
            result = self.export(Path(tmp))
            self.assertIn("Lb_DieSwim", result["clips"])
            self.assertIn("Ub_DieSwim", result["clips"])
            self.assertAlmostEqual(1 / 0.6,
                                   result["clips"]["Lb_DieSwim"]["period"],
                                   places=4)

    def test_an_unreadable_clip_is_an_error_not_an_absence(self) -> None:
        files = dict(SWIM_FILES)
        files["s/die_lower.baf"] = b"\x21garbage"
        with tempfile.TemporaryDirectory() as tmp:
            result = extract_pose.export_swim_clips(
                swim_machine(), FakePool(files), soldier_skeleton(), Path(tmp))

            self.assertIn("Lb_DieSwim", result["errors"])
            self.assertIn("unparseable", result["errors"]["Lb_DieSwim"])
            self.assertNotIn("Lb_DieSwim", result["absent"])
            self.assertIn("Lb_StartSwim", result["clips"])

    def test_a_mod_with_no_swim_states_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out, animstates.StateMachine())

            self.assertIsNone(result["asset"])
            self.assertEqual(len(extract_pose.SWIM_STATES),
                             len(result["absent"]))
            self.assertFalse((out / "gaits").exists())


class SwimManifestMergeTests(unittest.TestCase):
    def test_a_swim_run_keeps_the_grips_and_the_parachute(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "gaits").mkdir(parents=True)
            (out / "gaits" / "gaits.json").write_text(json.dumps({
                "lower": "gaits/lower.gait.glb",
                "grips": {"Thompson": "gaits/Thompson.gait.glb"},
                "parachute": "gaits/parachute.gait.glb",
                "canopy": "gaits/parachute.canopy.glb",
                "canopyAttach": [0.0, 0.3, 0.0],
            }))
            extract_pose.write_gaits_manifest(out, {"swim": "gaits/swim.gait.glb"})

            manifest = json.loads((out / "gaits" / "gaits.json").read_text())
            self.assertEqual("gaits/swim.gait.glb", manifest["swim"])
            self.assertEqual({"Thompson": "gaits/Thompson.gait.glb"},
                             manifest["grips"])
            self.assertEqual("gaits/parachute.gait.glb", manifest["parachute"])
            self.assertEqual([0.0, 0.3, 0.0], manifest["canopyAttach"])


if __name__ == "__main__":
    unittest.main()
