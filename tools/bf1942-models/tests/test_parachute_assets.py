"""The parachute's shared assets: the body clips, the canopy, and the merge.

Three things this pins, each of which was a real gap rather than a refinement:

* **A one-shot must not be baked with a loop's keyframe layout.** The canopy's
  `ParachuteOpen` is 21 frames of a chute coming out of a pack; wrapping its
  last key back to frame 0 puts the fully open canopy one 1/21 step from the
  stowed one and snaps it shut at the end of every pass. `c_AsmPlayOnce` is
  the state's own word and `timeline_tracks` now reads it.

* **`Ub_ParachuteIdle` does not exist**, and the exporter has to say so rather
  than quietly bake five families instead of six. The engine's glide has no
  upper-body state at all: `Ub_ParachuteOpen` declares
  `addTransitionWhenDone Ub_StandAim`, so the torso goes back to the weapon's
  own aim as the canopy finishes.

* **A subset run must merge `gaits.json`, not overwrite it.** `models.json`
  lost every entry and every thumbnail to exactly this once.
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

from bf42 import animstates, baf, con as con_mod, ske  # noqa: E402
from test_pose import pack_ske, pack_skn  # noqa: E402
from test_gaits import pack_baf_frames  # noqa: E402
from test_stances import FakePool, QUAT_ID, pos_words  # noqa: E402
import extract_pose  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def moving(name: str, heights: list[float]):
    return (name, [(QUAT_ID, pos_words(0.0, 0.0, h)) for h in heights])


LOWER3 = [moving("Bip01", [0.9, 0.95, 0.92]),
          moving("Bip01 Pelvis", [0.10, 0.11, 0.12])]
UPPER3 = [moving("Bip01 Spine", [0.20, 0.21, 0.22])]


def soldier_skeleton() -> ske.Skeleton:
    return ske.parse(pack_ske([
        ("Bip01", -1, IDENTITY, (0.0, 0.0, 0.9)),
        ("Bip01 Pelvis", 0, IDENTITY, (0.0, 0.1, 0.0)),
        ("Bip01 Spine", 1, IDENTITY, (0.0, 0.2, 0.0)),
    ]), "s.ske")


# The parachute states, as `AnimationStatesParachute.con` declares them: the
# two `c_AsmLooping` ones, the four `c_AsmPlayOnce` ones, and no
# `Ub_ParachuteIdle` anywhere.
PARA_STATES: dict[str, tuple[str, float, str, str | None]] = {
    "Lb_ParachuteFall": ("p/fall_lower.baf", 1.0, "c_AsmLooping", None),
    "Ub_ParachuteFall": ("p/fall_upper.baf", 1.0, "c_AsmLooping", None),
    "Lb_ParachuteOpen": ("p/open_lower.baf", 0.6, "c_AsmPlayOnce",
                         "Lb_ParachuteIdle"),
    "Ub_ParachuteOpen": ("p/open_upper.baf", 0.6, "c_AsmPlayOnce",
                         "Ub_StandAim"),
    "Lb_ParachuteIdle": ("p/glide_lower.baf", 1.0, "c_AsmLooping", None),
    "Lb_ParachuteHitGround": ("p/ground_lower.baf", 2.0, "c_AsmPlayOnce",
                              "Lb_Stand"),
    "Ub_ParachuteHitGround": ("p/ground_upper.baf", 2.0, "c_AsmPlayOnce",
                              "Ub_StandAim"),
    "Lb_ParachuteDie": ("p/die_lower.baf", 0.9, "c_AsmPlayOnce", None),
    "Ub_ParachuteDie": ("p/die_upper.baf", 0.9, "c_AsmPlayOnce", None),
    "Lb_ParachuteDeadHitGround": ("p/deadground_lower.baf", 1.0,
                                  "c_AsmPlayOnce", None),
    "Ub_ParachuteDeadHitGround": ("p/deadground_upper.baf", 1.0,
                                  "c_AsmPlayOnce", None),
}

PARA_FILES = {
    path: pack_baf_frames(UPPER3 if "upper" in path else LOWER3)
    for path, _speed, _loop, _ret in PARA_STATES.values()
}


def para_machine(states=None) -> animstates.StateMachine:
    machine = animstates.StateMachine()
    for name, (path, speed, loop, ret) in (states or PARA_STATES).items():
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(path, speed, loop))
        state.return_to = ret
        machine.states[name.lower()] = state
    return machine


class LoopFlagTests(unittest.TestCase):
    def test_the_state_s_own_word_decides_whether_a_clip_loops(self) -> None:
        loops = animstates.ClipRef("x.baf", 1.0, "c_AsmLooping").loops
        once = animstates.ClipRef("x.baf", 1.0, "c_AsmPlayOnce").loops
        self.assertTrue(loops)
        self.assertFalse(once)
        # The scripts write it three ways; a mod's `true` is one of them.
        self.assertTrue(animstates.ClipRef("x.baf", 1.0, "1").loops)
        self.assertTrue(animstates.ClipRef("x.baf", 1.0, " TRUE ").loops)
        self.assertFalse(animstates.ClipRef("x.baf", 1.0, "0").loops)
        self.assertFalse(animstates.ClipRef("x.baf", 1.0, "").loops)


class TimelineLayoutTests(unittest.TestCase):
    def frames(self):
        return extract_pose.clip_timeline(
            baf.parse(PARA_FILES["p/open_lower.baf"], "o"), 0.6,
            soldier_skeleton())

    def test_a_loop_wraps_back_to_frame_zero_at_the_period(self) -> None:
        frames, period = self.frames()
        tracks = extract_pose.timeline_tracks(
            frames, period, {"bip01": 1}, loop=True)

        _node, times, values = tracks[0]
        self.assertEqual(4, len(times))          # 3 frames + the wrap
        self.assertAlmostEqual(period, times[-1], places=6)
        self.assertEqual(values[0], values[-1])

    def test_a_one_shot_ends_on_its_last_frame(self) -> None:
        frames, period = self.frames()
        tracks = extract_pose.timeline_tracks(
            frames, period, {"bip01": 1}, loop=False)

        _node, times, values = tracks[0]
        # No wrap key: 3 frames span 2 intervals over the same period, so the
        # last key is the clip's last frame and not a snap back to the first.
        self.assertEqual(3, len(times))
        self.assertAlmostEqual(period, times[-1], places=6)
        self.assertNotEqual(values[0], values[-1])
        self.assertAlmostEqual(-0.92, values[-1][1][2], places=3)

    def test_the_default_is_a_loop_so_nothing_else_moves(self) -> None:
        frames, period = self.frames()
        self.assertEqual(
            extract_pose.timeline_tracks(frames, period, {"bip01": 1}),
            extract_pose.timeline_tracks(frames, period, {"bip01": 1},
                                         loop=True))

    def test_a_single_frame_clip_is_a_two_key_constant(self) -> None:
        frames, _period = self.frames()
        tracks = extract_pose.timeline_tracks(
            frames[:1], 0.25, {"bip01": 1}, loop=False)
        _node, times, values = tracks[0]
        self.assertEqual((0.0, 0.25), times)
        self.assertEqual(values[0], values[1])


class ParachuteClipBundleTests(unittest.TestCase):
    def export(self, out: Path, machine=None) -> dict:
        return extract_pose.export_parachute_clips(
            machine or para_machine(), FakePool(PARA_FILES),
            soldier_skeleton(), out)

    def bundle(self, path: Path) -> dict:
        blob = path.read_bytes()
        length, = struct.unpack_from("<I", blob, 12)
        return json.loads(blob[20:20 + length])

    def test_every_clip_is_named_after_the_engine_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out)
            doc = self.bundle(out / "gaits" / "parachute.gait.glb")

            # `viewer/parachute.js`'s PARA_CLIPS names these states; the clip
            # names are the same strings, so no translation table exists.
            self.assertEqual(
                ["Lb_ParachuteFall", "Ub_ParachuteFall", "Lb_ParachuteOpen",
                 "Ub_ParachuteOpen", "Lb_ParachuteIdle",
                 "Lb_ParachuteHitGround", "Ub_ParachuteHitGround",
                 "Lb_ParachuteDie", "Ub_ParachuteDie",
                 "Lb_ParachuteDeadHitGround", "Ub_ParachuteDeadHitGround"],
                [a["name"] for a in doc["animations"]])
            self.assertEqual("gaits/parachute.gait.glb", result["asset"])

    def test_the_bundle_is_clips_over_joints_with_no_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "parachute.gait.glb")

            self.assertNotIn("meshes", doc)
            self.assertNotIn("materials", doc)
            self.assertEqual(3, len(doc["nodes"]))

    def test_the_missing_glide_torso_is_reported_as_an_absence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self.export(Path(tmp))

            # Not an error and not silence: the engine has no such state, and
            # the glide's torso is `Ub_StandAim` by `Ub_ParachuteOpen`'s own
            # `addTransitionWhenDone`.
            self.assertEqual({"Ub_ParachuteIdle": "no such animation state"},
                             result["absent"])
            self.assertEqual({}, result["errors"])
            self.assertNotIn("Ub_ParachuteIdle", result["clips"])
            self.assertEqual("Ub_StandAim",
                             result["clips"]["Ub_ParachuteOpen"]["returnTo"])

    def test_the_bundle_names_the_clip_that_stands_in_for_the_glide_torso(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "parachute.gait.glb")
            self.assertEqual("stand.upper", doc["extras"]["glideUpper"])

    def test_each_state_s_loop_flag_and_period_ride_out_in_the_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = self.export(Path(tmp))

            glide = result["clips"]["Lb_ParachuteIdle"]
            opening = result["clips"]["Lb_ParachuteOpen"]
            self.assertTrue(glide["loop"])
            self.assertFalse(opening["loop"])
            # 1/|speed|, the engine's own clip span (ledger ANIM-1).
            self.assertAlmostEqual(1.0, glide["period"], places=4)
            self.assertAlmostEqual(1 / 0.6, opening["period"], places=4)
            self.assertAlmostEqual(0.5, result["clips"][
                "Lb_ParachuteHitGround"]["period"], places=4)

    def test_a_one_shot_state_is_baked_without_a_wrap_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "parachute.gait.glb")
            counts = {}
            for anim in doc["animations"]:
                sampler = anim["samplers"][0]
                counts[anim["name"]] = doc["accessors"][sampler["input"]]["count"]

            # Three frames: a loop ships four keys, a one-shot three.
            self.assertEqual(4, counts["Lb_ParachuteIdle"])
            self.assertEqual(4, counts["Lb_ParachuteFall"])
            self.assertEqual(3, counts["Lb_ParachuteOpen"])
            self.assertEqual(3, counts["Lb_ParachuteDie"])

    def test_an_unreadable_clip_is_an_error_not_an_absence(self) -> None:
        files = dict(PARA_FILES)
        files["p/die_lower.baf"] = b"\x21garbage"
        with tempfile.TemporaryDirectory() as tmp:
            result = extract_pose.export_parachute_clips(
                para_machine(), FakePool(files), soldier_skeleton(), Path(tmp))

            self.assertIn("Lb_ParachuteDie", result["errors"])
            self.assertIn("unparseable", result["errors"]["Lb_ParachuteDie"])
            self.assertNotIn("Lb_ParachuteDie", result["absent"])
            self.assertIn("Lb_ParachuteOpen", result["clips"])

    def test_a_mod_with_no_parachute_states_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.export(out, animstates.StateMachine())

            self.assertIsNone(result["asset"])
            self.assertEqual(len(extract_pose.PARACHUTE_STATES),
                             len(result["absent"]))
            self.assertFalse((out / "gaits").exists())


# -- the canopy ------------------------------------------------------------- #

CANOPY_SKE = pack_ske([
    ("Bone01", -1, IDENTITY, (0.0, 0.14, 0.0)),
    ("Bone02", 0, IDENTITY, (0.0, 1.01, 0.0)),
    ("Bone03", 1, IDENTITY, (0.0, 8.58, 0.0)),
])
CANOPY_SKN = pack_skn(
    [((0.0, 0.0, 0.0), [(0, 1.0, (0.0, 0.0, 0.0))]),
     ((1.0, 0.0, 0.0), [(1, 1.0, (0.0, 0.0, 0.0))]),
     ((0.0, 1.0, 0.0), [(2, 1.0, (0.0, 0.0, 0.0))])],
    ["Bone01", "Bone02", "Bone03"])


CANOPY_BONES3 = [moving("Bone01", [0.0, 0.0, 0.0]),
                 moving("Bone02", [1.0, 5.0, 9.0]),
                 moving("Bone03", [1.0, 5.0, 9.0])]

CANOPY_STATES = {
    "OpenParachute": ("p/canopy_open.baf", 0.4, "c_AsmPlayOnce",
                      "IdleParachute"),
    "IdleParachute": ("p/canopy_idle.baf", 0.5, "c_AsmLooping", None),
}
CANOPY_FILES = {
    "p/canopy_open.baf": pack_baf_frames(CANOPY_BONES3),
    "p/canopy_idle.baf": pack_baf_frames(CANOPY_BONES3),
    "animations/Parachute.ske": CANOPY_SKE,
    "animations/Parachute.skn": CANOPY_SKN,
}


class CanopyExportTests(unittest.TestCase):
    """The canopy's shape is the real reader's business (`test_pose.py` covers
    `build_skinned_part`); what this pins is the two clips, the attach offset,
    and the refusal to write half a file."""

    def library(self, with_soldier: bool = True) -> con_mod.ObjectLibrary:
        library = con_mod.ObjectLibrary()
        text = [
            "ObjectTemplate.create AnimatedBundle Parachute",
            "ObjectTemplate.geometry Parachute",
            "ObjectTemplate.setSkeleton animations/Parachute.ske",
        ]
        if with_soldier:
            text += [
                "ObjectTemplate.create BFSoldier TestSoldier",
                "ObjectTemplate.setSkeleton animations/UsSoldier.ske",
                "ObjectTemplate.addTemplate Parachute",
                "ObjectTemplate.setPosition 0/0.3/0",
            ]
        library.add_con("Objects/Soldiers/Common/Objects.con", "\n".join(text))
        return library

    def test_a_template_with_no_skeleton_reports_and_writes_nothing(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con("Objects/x.con",
                        "ObjectTemplate.create AnimatedBundle Parachute\n")
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = extract_pose.export_canopy(
                extract_pose.animstates.StateMachine(), FakePool(CANOPY_FILES),
                FakePool({}), FakePool({}), library, out)

            self.assertIsNone(result["asset"])
            self.assertIn("Parachute", result["errors"])
            self.assertFalse((out / "gaits").exists())

    def test_the_attach_offset_is_read_off_a_soldier_not_written_down(self) -> None:
        library = self.library()
        soldier = library.object("TestSoldier")
        offsets = [ref.position for ref in soldier.children
                   if ref.template.lower() == "parachute"]
        self.assertEqual([(0.0, 0.3, 0.0)], offsets)

    def test_the_states_are_the_ones_setisparachuting_drives(self) -> None:
        # PARA-5: the child at +0x26c is driven to "OpenParachute", whose
        # `addTransitionWhenDone` is "IdleParachute".
        self.assertEqual([("open", "OpenParachute"), ("idle", "IdleParachute")],
                         list(extract_pose.CANOPY_STATES))


class GaitsManifestMergeTests(unittest.TestCase):
    def test_a_subset_run_keeps_what_it_did_not_produce(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            extract_pose.write_gaits_manifest(out, {
                "lower": "gaits/lower.gait.glb",
                "grips": {"Colt": "gaits/Colt.gait.glb",
                          "No4": "gaits/No4.gait.glb"},
                "weaponGrip": {"Colt": "Colt", "K98": "No4"},
            })
            merged = extract_pose.write_gaits_manifest(out, {
                "parachute": "gaits/parachute.gait.glb",
                "canopy": "gaits/parachute.canopy.glb",
            })

            # This is the models.json lesson: a targeted pass adds its keys and
            # deletes nothing.
            self.assertEqual("gaits/lower.gait.glb", merged["lower"])
            self.assertEqual({"Colt": "gaits/Colt.gait.glb",
                              "No4": "gaits/No4.gait.glb"}, merged["grips"])
            self.assertEqual({"Colt": "Colt", "K98": "No4"},
                             merged["weaponGrip"])
            self.assertEqual("gaits/parachute.gait.glb", merged["parachute"])
            self.assertEqual(merged,
                             json.loads((out / "gaits" / "gaits.json").read_text()))

    def test_dict_keys_merge_key_by_key_rather_than_replacing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            extract_pose.write_gaits_manifest(
                out, {"grips": {"Colt": "a", "No4": "b"}})
            merged = extract_pose.write_gaits_manifest(
                out, {"grips": {"Colt": "c"}})

            self.assertEqual({"Colt": "c", "No4": "b"}, merged["grips"])

    def test_an_unreadable_manifest_is_replaced_not_raised(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "gaits").mkdir(parents=True)
            (out / "gaits" / "gaits.json").write_text("{not json")

            merged = extract_pose.write_gaits_manifest(out, {"lower": "x"})
            self.assertEqual({"lower": "x"}, merged)


class SharedTimelineTests(unittest.TestCase):
    """The stances ship as timelines beside the gaits, not only as stills.

    `Lb_Stand` is 18 frames of `3PStandLower.baf` at 0.8 and `Ub_StandAim<W>`
    18 frames of `3PStandAimUpper<W>.baf` at the same rate — a 1.25 s breath.
    The pose files bake frame 0 of it as a constant, which is a statue; the
    sidecars now carry the whole thing, and every family is a lower/upper pair,
    which is what lets the parachute glide put `Lb_ParachuteIdle` legs under a
    `stand.upper` torso the way the engine does.
    """

    STATES = {
        "Lb_RunForward": ("a/run_lower.baf", 1.6),
        "Ub_RunForwardColt": ("a/run_upper.baf", 1.6),
        "Lb_WalkForward": ("a/walk_lower.baf", 1.0),
        "Ub_WalkForwardColt": ("a/walk_upper.baf", 1.0),
        "Lb_CrouchForward": ("a/cwalk_lower.baf", 1.0),
        "Ub_CrouchForwardColt": ("a/cwalk_upper.baf", 1.0),
        "Lb_LieForward": ("a/crawl_lower.baf", 1.0),
        "Ub_LieForwardColt": ("a/crawl_upper.baf", 1.0),
        "Lb_Stand": ("a/stand_lower.baf", 0.8),
        "Ub_StandAimColt": ("a/stand_upper.baf", 0.8),
        "Lb_Crouch": ("a/crouch_lower.baf", 0.8),
        "Ub_CrouchColt": ("a/crouch_upper.baf", 0.8),
        "Lb_Lie": ("a/lie_lower.baf", 1.0),
        "Ub_LieColt": ("a/lie_upper.baf", 1.0),
    }

    def machine(self, states=None) -> animstates.StateMachine:
        machine = animstates.StateMachine()
        for name, (path, speed) in (states or self.STATES).items():
            state = animstates.State(name)
            state.clips.append(animstates.ClipRef(path, speed, "1"))
            machine.states[name.lower()] = state
        return machine

    def files(self) -> dict[str, bytes]:
        return {path: pack_baf_frames(UPPER3 if "upper" in path else LOWER3)
                for path, _speed in self.STATES.values()}

    def bundle(self, path: Path) -> dict:
        blob = path.read_bytes()
        length, = struct.unpack_from("<I", blob, 12)
        return json.loads(blob[20:20 + length])

    def test_the_seven_families_are_the_four_gaits_and_the_three_stances(self) -> None:
        self.assertEqual(
            ["run", "walk", "crouchwalk", "crawl", "stand", "crouch", "lie"],
            [key for key, _lo, _up in extract_pose.SHARED_TIMELINES])

    def test_both_bundles_carry_a_stance_half_for_every_stance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            extract_pose.export_gait_clips(
                self.machine(), FakePool(self.files()), soldier_skeleton(),
                ["Colt"], out)

            lower = self.bundle(out / "gaits" / "lower.gait.glb")
            upper = self.bundle(out / "gaits" / "a.gait.glb")
            self.assertEqual(
                ["run.lower", "walk.lower", "crouchwalk.lower", "crawl.lower",
                 "stand.lower", "crouch.lower", "lie.lower"],
                [a["name"] for a in lower["animations"]])
            self.assertEqual(
                ["run.upper", "walk.upper", "crouchwalk.upper", "crawl.upper",
                 "stand.upper", "crouch.upper", "lie.upper"],
                [a["name"] for a in upper["animations"]])

    def test_a_stance_timeline_is_a_timeline_and_not_a_constant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            extract_pose.export_gait_clips(
                self.machine(), FakePool(self.files()), soldier_skeleton(),
                ["Colt"], out)
            doc = self.bundle(out / "gaits" / "lower.gait.glb")
            stand = next(a for a in doc["animations"]
                         if a["name"] == "stand.lower")
            count = doc["accessors"][stand["samplers"][0]["input"]]["count"]

            # Three fixture frames plus the loop's wrap key. The old path
            # sampled one frame and wrote two identical keys.
            self.assertEqual(4, count)

    def test_the_periods_are_each_state_s_own_one_over_speed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            extract_pose.export_gait_clips(
                self.machine(), FakePool(self.files()), soldier_skeleton(),
                ["Colt"], out)
            meta = self.bundle(out / "gaits" / "lower.gait.glb")["extras"]["gaits"]

            self.assertAlmostEqual(0.625, meta["run"]["period"], places=4)
            self.assertAlmostEqual(1.25, meta["stand"]["period"], places=4)
            self.assertAlmostEqual(1.25, meta["crouch"]["period"], places=4)
            self.assertAlmostEqual(1.0, meta["lie"]["period"], places=4)

    def test_a_mod_missing_a_stance_state_still_ships_the_gaits(self) -> None:
        states = {k: v for k, v in self.STATES.items() if k != "Lb_Lie"}
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            manifest = extract_pose.export_gait_clips(
                self.machine(states), FakePool(self.files()),
                soldier_skeleton(), ["Colt"], out)

            self.assertIn("Lb_Lie", manifest["errors"]["lie"])
            names = [a["name"] for a in
                     self.bundle(out / "gaits" / "lower.gait.glb")["animations"]]
            self.assertNotIn("lie.lower", names)
            self.assertIn("stand.lower", names)
            self.assertIn("run.lower", names)


if __name__ == "__main__":
    unittest.main()
