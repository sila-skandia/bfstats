"""The locomotion timelines: whole `.baf` clips, at the engine's own rate.

The stance path (`test_stances.py`) samples one frame and writes a constant
clip. This is the other half — every frame, timed by the state's `speed`,
which `AnimationStateMachineInstance::updateState` treats as cycles per
second (ledger ANIM-1), so a clip's wall-clock period is `1 / |speed|` no
matter how many frames it holds.
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

from bf42 import animstates, gltf, ske  # noqa: E402
from test_pose import pack_ske  # noqa: E402
from test_stances import FakePool, QUAT_ID, pos_words  # noqa: E402
import extract_pose  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def pack_baf_frames(bones: list[tuple[str, list[tuple[tuple[int, int, int, int],
                                                      tuple[int, int, int]]]]],
                    ) -> bytes:
    """A version-3 clip of N frames per bone, every channel a literal run.

    One literal segment covers the whole channel: the control word's low byte
    is the run length and its high byte the segment's word count including
    itself, then one value word per frame.
    """
    frames = len(bones[0][1])
    out = bytearray()
    out += struct.pack("<IH", 3, len(bones))
    for name, _keys in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw)) + raw
    out += struct.pack("<IB", frames, 15)
    for _name, keys in bones:
        # `dataWords` sums the seven channels' payloads — control + values,
        # not counting each channel's own word-count field.
        out += struct.pack("<H", 7 * (1 + frames))
        for channel in range(7):
            values = [(key[0] + key[1])[channel] for key in keys]
            out += struct.pack("<H", 1 + frames)          # words that follow
            out += struct.pack("<H", ((frames + 1) << 8) | frames)   # literal run
            for value in values:
                out += struct.pack("<H", value & 0xFFFF)
    return bytes(out)


def moving_bone(name: str, heights: list[float]):
    return (name, [(QUAT_ID, pos_words(0.0, 0.0, h)) for h in heights])


# Three frames each, with a per-frame height so a test can name the frame.
LOWER = [moving_bone("Bip01", [0.90, 0.95, 0.92]),
         moving_bone("Bip01 Pelvis", [0.10, 0.11, 0.12])]
UPPER = [moving_bone("Bip01 Spine", [0.20, 0.21, 0.22])]

STATES = {
    "Lb_RunForward": ("anims/run_lower.baf", 1.6),
    "Ub_RunForwardColt": ("anims/run_upper_colt.baf", 1.6),
    "Lb_WalkForward": ("anims/walk_lower.baf", 1.0),
    "Ub_WalkForwardColt": ("anims/walk_upper_colt.baf", 1.0),
    "Lb_CrouchForward": ("anims/crouch_lower.baf", 1.0),
    "Ub_CrouchForwardColt": ("anims/crouch_upper_colt.baf", 1.0),
    "Lb_LieForward": ("anims/lie_lower.baf", 1.0),
    "Ub_LieForwardColt": ("anims/lie_upper_colt.baf", 1.0),
}

FILES = {
    "anims/run_lower.baf": pack_baf_frames(LOWER),
    "anims/run_upper_colt.baf": pack_baf_frames(UPPER),
    "anims/walk_lower.baf": pack_baf_frames(LOWER),
    "anims/walk_upper_colt.baf": pack_baf_frames(UPPER),
    "anims/crouch_lower.baf": pack_baf_frames(LOWER),
    "anims/crouch_upper_colt.baf": pack_baf_frames(UPPER),
    "anims/lie_lower.baf": pack_baf_frames(LOWER),
    "anims/lie_upper_colt.baf": pack_baf_frames(UPPER),
}


# The donor pattern: a second weapon whose four upper states name the *same*
# clip paths, which is what `copyState <new> <src> <donor3p>` produces and what
# the shared-asset layout collapses onto one bundle.
DONOR_STATES = {
    **STATES,
    "Ub_RunForwardK98": ("anims/run_upper_colt.baf", 1.6),
    "Ub_WalkForwardK98": ("anims/walk_upper_colt.baf", 1.0),
    "Ub_CrouchForwardK98": ("anims/crouch_upper_colt.baf", 1.0),
    "Ub_LieForwardK98": ("anims/lie_upper_colt.baf", 1.0),
}


def machine_with(states: dict[str, tuple[str, float]]) -> animstates.StateMachine:
    machine = animstates.StateMachine()
    for name, (clip_path, speed) in states.items():
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(clip_path, speed, "1"))
        machine.states[name.lower()] = state
    return machine


def skeleton() -> ske.Skeleton:
    return ske.parse(pack_ske([
        ("Bip01", -1, IDENTITY, (0.0, 0.0, 0.9)),
        ("Bip01 Pelvis", 0, IDENTITY, (0.0, 0.1, 0.0)),
        ("Bip01 Spine", 1, IDENTITY, (0.0, 0.2, 0.0)),
    ]), "s.ske")


class ClipTimelineTests(unittest.TestCase):
    def read(self, path: str):
        from bf42 import baf
        return baf.parse(FILES[path], path)

    def test_every_frame_survives_and_the_period_is_one_over_speed(self) -> None:
        frames, period = extract_pose.clip_timeline(
            self.read("anims/run_lower.baf"), 1.6, skeleton())

        self.assertEqual(3, len(frames))
        self.assertAlmostEqual(0.625, period, places=6)

    def test_frame_count_sets_resolution_not_duration(self) -> None:
        # The same clip at 1.0 lasts a second; at 1.6, 0.625 s. The engine's
        # phase is normalized, so frames per clip never enters the timing.
        _slow, slow_period = extract_pose.clip_timeline(
            self.read("anims/run_lower.baf"), 1.0, skeleton())
        _fast, fast_period = extract_pose.clip_timeline(
            self.read("anims/run_lower.baf"), 1.6, skeleton())

        self.assertAlmostEqual(1.0, slow_period, places=6)
        self.assertAlmostEqual(0.625, fast_period, places=6)

    def test_root_translations_are_clip_world_aligned_on_every_frame(self) -> None:
        frames, _period = extract_pose.clip_timeline(
            self.read("anims/run_lower.baf"), 1.6, skeleton())

        # ROOT_ALIGN is diag(-1, 1, -1), so the root's Z flips — on all three
        # frames, not just the one the stance path samples.
        self.assertAlmostEqual(-0.90, frames[0]["bip01"][1][2], places=3)
        self.assertAlmostEqual(-0.95, frames[1]["bip01"][1][2], places=3)
        self.assertAlmostEqual(-0.92, frames[2]["bip01"][1][2], places=3)
        # A non-root bone is left alone.
        self.assertAlmostEqual(0.11, frames[1]["bip01 pelvis"][1][2], places=3)

    def test_a_negative_speed_runs_the_phase_backwards(self) -> None:
        # `Lb_RunBackward` is the forward clip at -1.60: the same frames in
        # reverse, with frame 0 still the start of the cycle.
        frames, period = extract_pose.clip_timeline(
            self.read("anims/run_lower.baf"), -1.6, skeleton())

        self.assertAlmostEqual(0.625, period, places=6)
        self.assertAlmostEqual(-0.90, frames[0]["bip01"][1][2], places=3)
        self.assertAlmostEqual(-0.92, frames[1]["bip01"][1][2], places=3)
        self.assertAlmostEqual(-0.95, frames[2]["bip01"][1][2], places=3)


class TimelineTracksTests(unittest.TestCase):
    def tracks(self, period: float = 0.625):
        from bf42 import baf
        frames, _ = extract_pose.clip_timeline(
            baf.parse(FILES["anims/run_lower.baf"], "run"), 1.6, skeleton())
        return extract_pose.timeline_tracks(
            frames, period, {"bip01": 7, "bip01 pelvis": 8})

    def test_a_wrap_keyframe_closes_the_loop_at_exactly_the_period(self) -> None:
        tracks = self.tracks()

        self.assertEqual(2, len(tracks))
        for _node, times, values in tracks:
            self.assertEqual(4, len(times))          # 3 frames + the wrap
            self.assertEqual(4, len(values))
            self.assertAlmostEqual(0.0, times[0], places=6)
            self.assertAlmostEqual(0.625, times[-1], places=6)
            # The last key repeats the first, so a LoopRepeat action seams
            # the way the engine's `int(phase * N) % N` does.
            self.assertEqual(values[0], values[-1])

    def test_keyframes_are_evenly_spaced(self) -> None:
        _node, times, _values = self.tracks()[0]
        gaps = [round(b - a, 6) for a, b in zip(times, times[1:])]
        self.assertEqual([gaps[0]] * 3, gaps)

    def test_only_bones_the_skeleton_has_a_joint_node_for_are_emitted(self) -> None:
        from bf42 import baf
        frames, _ = extract_pose.clip_timeline(
            baf.parse(FILES["anims/run_lower.baf"], "run"), 1.6, skeleton())

        tracks = extract_pose.timeline_tracks(frames, 0.625, {"bip01": 7})
        self.assertEqual([7], [node for node, _t, _v in tracks])


class ResolveGaitTests(unittest.TestCase):
    def test_both_halves_resolve_with_their_own_rates(self) -> None:
        entry = extract_pose.resolve_gait(
            machine_with(STATES), FakePool(FILES), skeleton(), "Colt",
            "Lb_RunForward", "RunForward")

        self.assertNotIn("error", entry)
        self.assertEqual("anims/run_lower.baf", entry["lowerClip"])
        self.assertEqual("anims/run_upper_colt.baf", entry["upperClip"])
        self.assertEqual("Ub_RunForwardColt", entry["upperState"])
        self.assertEqual(1.6, entry["lowerSpeed"])
        self.assertEqual(3, entry["lowerFrames"])
        self.assertAlmostEqual(0.625, entry["lowerPeriod"], places=4)

    def test_the_halves_keep_independent_periods(self) -> None:
        # The engine runs two state machines with independent phases, so a
        # gait whose halves disagree on speed must not be forced onto one
        # period — `Lb_StrafeLeft` (1.30) against its 1.0 upper is real.
        states = dict(STATES)
        states["Ub_RunForwardColt"] = ("anims/run_upper_colt.baf", 1.0)

        entry = extract_pose.resolve_gait(
            machine_with(states), FakePool(FILES), skeleton(), "Colt",
            "Lb_RunForward", "RunForward")

        self.assertAlmostEqual(0.625, entry["lower"][1], places=6)
        self.assertAlmostEqual(1.0, entry["upper"][1], places=6)

    def test_a_missing_upper_state_is_reported_not_raised(self) -> None:
        states = {k: v for k, v in STATES.items() if k != "Ub_RunForwardColt"}

        entry = extract_pose.resolve_gait(
            machine_with(states), FakePool(FILES), skeleton(), "Colt",
            "Lb_RunForward", "RunForward")

        self.assertIn("Ub_RunForwardColt", entry["error"])

    def test_an_unreadable_clip_is_reported_not_raised(self) -> None:
        files = dict(FILES)
        files["anims/run_upper_colt.baf"] = b"\x21garbage"

        entry = extract_pose.resolve_gait(
            machine_with(STATES), FakePool(files), skeleton(), "Colt",
            "Lb_RunForward", "RunForward")

        self.assertIn("unreadable", entry["error"])


class CollectGaitsTests(unittest.TestCase):
    def test_every_declared_gait_is_attempted(self) -> None:
        gaits = extract_pose.collect_gaits(
            machine_with(STATES), FakePool(FILES), skeleton(), "Colt")

        self.assertEqual([key for key, _lo, _up in extract_pose.GAITS],
                         list(gaits))
        for entry in gaits.values():
            self.assertNotIn("error", entry)

    def test_a_gait_the_mod_lacks_records_its_error_and_the_rest_survive(self) -> None:
        states = {k: v for k, v in STATES.items() if not k.startswith("Lb_Lie")}

        gaits = extract_pose.collect_gaits(
            machine_with(states), FakePool(FILES), skeleton(), "Colt")

        self.assertIn("Lb_LieForward", gaits["crawl"]["error"])
        self.assertNotIn("error", gaits["run"])


class SharedGaitAssetTests(unittest.TestCase):
    """The dedup layout: clips live once, keyed by the grip the game files
    them under, and a pose only names the two files it needs."""

    def test_the_grip_is_the_clip_folder_not_the_weapon(self) -> None:
        # `copyState` makes a weapon play a donor's clips, and the donor's
        # folder is what the path carries — that folder is the shared asset's
        # name, so K98 and No4 resolve to one bundle rather than two copies.
        machine = machine_with(DONOR_STATES)
        self.assertEqual("anims", extract_pose.gait_grip(machine, "Colt"))
        self.assertEqual("anims", extract_pose.gait_grip(machine, "K98"))

    def test_a_weapon_with_no_gait_state_has_no_grip(self) -> None:
        machine = machine_with(
            {k: v for k, v in STATES.items() if not k.startswith("Ub_")})
        self.assertIsNone(extract_pose.gait_grip(machine, "Colt"))
        self.assertIsNone(extract_pose.gait_assets(machine, "Colt"))

    def test_a_pose_names_the_shared_lower_file_and_its_grip(self) -> None:
        assets = extract_pose.gait_assets(machine_with(STATES), "Colt")

        self.assertEqual("anims", assets["grip"])
        self.assertEqual("gaits/lower.gait.glb", assets["lower"])
        self.assertEqual("gaits/anims.gait.glb", assets["upper"])

    def test_metadata_resolves_without_decoding_any_frames(self) -> None:
        # The 224 pose files need the rates for their readout, but the frames
        # only once per grip, so the per-pair pass skips the alignment.
        entry = extract_pose.resolve_gait(
            machine_with(STATES), FakePool(FILES), skeleton(), "Colt",
            "Lb_RunForward", "RunForward", load_frames=False)

        self.assertNotIn("lower", entry)
        self.assertNotIn("upper", entry)
        self.assertEqual(3, entry["lowerFrames"])
        self.assertAlmostEqual(0.625, entry["lowerPeriod"], places=4)


class ExportGaitClipsTests(unittest.TestCase):
    def export(self, out: Path, weapons: list[str] | None = None) -> dict:
        return extract_pose.export_gait_clips(
            machine_with(DONOR_STATES), FakePool(FILES), skeleton(),
            weapons if weapons is not None else ["Colt"], out)

    def bundle(self, path: Path) -> dict:
        blob = path.read_bytes()
        length, = struct.unpack_from("<I", blob, 12)
        return json.loads(blob[20:20 + length])

    def test_the_lower_half_ships_once_for_every_weapon(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            manifest = self.export(out, ["Colt", "K98"])

            self.assertEqual("gaits/lower.gait.glb", manifest["lower"])
            # Two weapons, one grip (both resolve to the same clip folder),
            # so one upper bundle -- not one per weapon.
            self.assertEqual(1, len(manifest["grips"]))
            self.assertEqual({"Colt": "anims", "K98": "anims"},
                             manifest["weaponGrip"])
            self.assertEqual(
                1, len(list((out / "gaits").glob("*.gait.glb"))) - 1,
                "expected exactly one upper bundle beside the lower one")

    def test_a_bundle_is_clips_over_joints_with_no_geometry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "lower.gait.glb")

            # glTF gives every top-level array minItems 1, so a clips-only
            # file must omit `meshes` rather than ship an empty one.
            self.assertNotIn("meshes", doc)
            self.assertNotIn("materials", doc)
            self.assertEqual(3, len(doc["nodes"]))     # the whole skeleton
            self.assertEqual([key for key, _lo, _up in extract_pose.GAITS],
                             [a["name"].split(".")[0] for a in doc["animations"]])
            self.assertTrue(
                all(a["name"].endswith(".lower") for a in doc["animations"]))

    def test_channels_target_named_joints_so_a_pose_can_retarget(self) -> None:
        # Retargeting is by node name: three.js derives a track name from the
        # node a channel points at, then binds it against whatever root the
        # mixer holds. So the bundle's node names ARE the contract.
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            doc = self.bundle(out / "gaits" / "lower.gait.glb")
            names = [n["name"] for n in doc["nodes"]]

            targeted = {names[c["target"]["node"]]
                        for a in doc["animations"] for c in a["channels"]}
            self.assertEqual({"Bip01", "Bip01 Pelvis"}, targeted)
            self.assertEqual(len(names), len(set(names)),
                             "duplicate bone names would break name binding")

    def test_the_upper_bundle_records_which_weapons_share_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out, ["Colt", "K98"])
            doc = self.bundle(out / "gaits" / "anims.gait.glb")

            self.assertEqual("anims", doc["extras"]["grip"])
            self.assertEqual(["Colt", "K98"], doc["extras"]["weapons"])
            self.assertTrue(
                all(a["name"].endswith(".upper") for a in doc["animations"]))


class QuaternionKeyframeTests(unittest.TestCase):
    """`gltf.add_animation` must not hand a consumer a sign-flipped keyframe."""

    def test_consecutive_keys_stay_in_one_hemisphere(self) -> None:
        # Two rotations 180 degrees apart about Y: `quat_from_matrix` picks a
        # different branch for each, and the raw pair's dot is negative.
        builder = gltf.GlbBuilder()
        node = builder.add_node(gltf.Node(name="b"))
        turns = [gltf.rot_y(deg) for deg in (0.0, 120.0, 240.0, 360.0)]
        raw = [gltf.quat_from_matrix(m) for m in turns]
        self.assertLess(
            min(sum(a * b for a, b in zip(p, q)) for p, q in zip(raw, raw[1:])),
            0.0, "fixture no longer exercises a hemisphere flip")

        builder.add_animation(
            "spin", [(node, (0.0, 1.0, 2.0, 3.0), [(m, (0.0, 0.0, 0.0)) for m in turns])])

        aligned = gltf._hemisphere_align(raw)
        for previous, current in zip(aligned, aligned[1:]):
            self.assertGreaterEqual(
                sum(a * b for a, b in zip(previous, current)), 0.0)
        # Alignment negates, it does not re-rotate: each key still names the
        # same orientation it did before.
        for before, after in zip(raw, aligned):
            self.assertAlmostEqual(
                1.0, abs(sum(a * b for a, b in zip(before, after))), places=6)

    def test_a_constant_track_is_untouched(self) -> None:
        one = gltf.quat_from_matrix(gltf.rot_y(37.0))
        self.assertEqual([one, one, one], gltf._hemisphere_align([one, one, one]))


if __name__ == "__main__":
    unittest.main()
