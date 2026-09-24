"""The rest of what a third-person soldier plays, beside his gaits.

The shared gait sidecars used to carry the seven locomotion and stance loops
and nothing else, so a soldier who dropped prone snapped from one loop to the
other. These pin what `extract_pose.export_gait_clips` now bakes beside them:

* **the stance transitions** in `gaits/lower.gait.glb`, under the engine's own
  state names (`Lb_StandToCrouch`, `Lb_RunStandToLie`, ...), which is how
  `BFSoldier::handlePlayerInput` (lnxded `0x08273c70`) enters them;
* **each grip's torso halves of them, its fire and its reload** in
  `gaits/<Grip>.gait.glb`, as `Ub_<family>` -- the `addTransitionItem` state
  the engine enters by name, with the weapon it appends dropped;
* **a backwards one-shot reversed end to end**: `updateState` (`0x0832b270`)
  starts a negative-rate `c_AsmPlayOnce` clip at phase 1.0, so `Lb_LieToCrouch`
  is `3PCrouch2LieLower.baf` from its last frame to its first;
* **what a renderer needs to play them the engine's way**, in each bundle's
  `extras.states` (rate, loop, morph factor, the state that follows) and in
  `gaits.json` `stateMachine` (the clipless torso transitions, and the weapons
  whose rate differs from the one their grip was baked at).

And that none of it disturbs the clips the bundles already carried.
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

from bf42 import animstates, baf, gltf  # noqa: E402
from test_gaits import (FILES as GAIT_FILES, STATES as GAIT_STATES,  # noqa: E402
                        pack_baf_frames, skeleton)
from test_stances import FakePool, QUAT_ID, pos_words  # noqa: E402
import extract_pose  # noqa: E402


def moving(name: str, heights: list[float]):
    return (name, [(QUAT_ID, pos_words(0.0, 0.0, h)) for h in heights])


# A crouch-to-lie clip whose root drops frame by frame, so a test can tell the
# forward pass from the backward one by the first key alone.
DROP = [moving("Bip01", [0.50, 0.40, 0.30, 0.20]),
        moving("Bip01 Pelvis", [0.10, 0.10, 0.10, 0.10])]
TORSO = [moving("Bip01 Spine", [0.20, 0.25, 0.30, 0.35])]
STILL_TORSO = [moving("Bip01 Spine", [0.20, 0.20, 0.20, 0.20])]

FILES = {
    **GAIT_FILES,
    "t/stand2crouch_lower.baf": pack_baf_frames(DROP),
    "t/crouch2lie_lower.baf": pack_baf_frames(DROP),
    "t/jump2lie_lower.baf": pack_baf_frames(DROP),
    "t/crouch2lie_upper_colt.baf": pack_baf_frames(TORSO),
    "t/jump2lie_upper_colt.baf": pack_baf_frames(TORSO),
    "t/fire_colt.baf": pack_baf_frames(TORSO),
    "t/liefire_colt.baf": pack_baf_frames(TORSO),
    "t/reload_colt.baf": pack_baf_frames(STILL_TORSO),
    "t/liereload_colt.baf": pack_baf_frames(TORSO),
}

# (clip, speed, looping word, morph, returnTo): the machine as the vanilla
# scripts and `3pAnimationsTweaking.con` leave it, cut down to one weapon and
# its donor.
LOWER_MOVES = {
    "Lb_StandToCrouch": ("t/stand2crouch_lower.baf", 12.0, "c_AsmPlayOnce", 2.0, "Lb_Crouch"),
    "Lb_CrouchToStand": ("t/stand2crouch_lower.baf", -10.0, "c_AsmPlayOnce", 2.0, "Lb_Stand"),
    "Lb_StandToLie": ("t/stand2crouch_lower.baf", 6.0, "c_AsmPlayOnce", 2.0, "Lb_CrouchToLie"),
    "Lb_CrouchToLie": ("t/crouch2lie_lower.baf", 1.6, "c_AsmPlayOnce", 4.0, "Lb_Lie"),
    "Lb_LieToCrouch": ("t/crouch2lie_lower.baf", -2.0, "c_AsmPlayOnce", 4.0, "Lb_Crouch"),
    "Lb_LieToStand": ("t/crouch2lie_lower.baf", -3.0, "c_AsmPlayOnce", 2.0, "Lb_CrouchToStand"),
    "Lb_RunStandToLie": ("t/jump2lie_lower.baf", 1.4, "c_AsmPlayOnce", 4.0, "Lb_Lie"),
}
UPPER_MOVES = {
    "Ub_CrouchToLie{w}": ("t/crouch2lie_upper_colt.baf", 1.6, "c_AsmPlayOnce", 4.0, "Ub_Lie{w}"),
    "Ub_LieToCrouch{w}": ("t/crouch2lie_upper_colt.baf", -2.0, "c_AsmPlayOnce", 4.0, "Ub_Crouch{w}"),
    "Ub_LieToStand{w}": ("t/crouch2lie_upper_colt.baf", -3.0, "c_AsmPlayOnce", 4.0, "Ub_CrouchToStand"),
    "Ub_RunStandToLie{w}": ("t/jump2lie_upper_colt.baf", 1.4, "c_AsmPlayOnce", 4.0, "Ub_Lie{w}"),
    "Ub_Fire{w}": ("t/fire_colt.baf", 2.43, "c_AsmPlayOnce", 10000.0, "_POSE_"),
    "Ub_LieFire{w}": ("t/liefire_colt.baf", 2.0, "c_AsmPlayOnce", 10000.0, "_POSE_"),
    "Ub_StandReload{w}": ("t/reload_colt.baf", 0.4, "c_AsmPlayOnce", 10000.0, "_POSE_"),
    "Ub_LieReload{w}": ("t/liereload_colt.baf", 0.4, "c_AsmPlayOnce", 10000.0, "_POSE_"),
    # Declared for every weapon by `copyToAllWeapons.inc`, with no file behind
    # it: a reload nobody draws.
    "Ub_FireEnd{w}": ("t/missing_fireend_colt.baf", 2.0, "c_AsmPlayOnce", 12.0, "_POSE_"),
}
CLIPLESS = {
    "Ub_StandToCrouch": (None, 2.0, "Ub_Crouch"),
    "Ub_CrouchToStand": (None, 2.0, "Ub_StandAim"),
    "Ub_StandToLie": ("t/stand2crouch_upper.baf", 2.0, "Ub_CrouchToLie"),
}


def machine() -> animstates.StateMachine:
    """The gaits of `test_gaits.py`, the Colt's actions, and its donor-sharing
    twin the WalterP38, which fires the Colt's clip at its own 2.0."""
    m = animstates.StateMachine()

    def add(name, clip, speed, looping, morph, then):
        state = animstates.State(name, morph_factor=morph, return_to=then)
        if clip:
            state.clips.append(animstates.ClipRef(clip, speed, looping))
        m.states[name.lower()] = state

    for name, (clip, speed) in GAIT_STATES.items():
        add(name, clip, speed, "1", 2.0 if name.startswith("Lb_") else 0.7, None)
    for name, (clip, speed) in GAIT_STATES.items():
        if name.endswith("Colt"):
            add(name.replace("Colt", "WalterP38"), clip, speed, "1", 0.7, None)
    for name, spec in LOWER_MOVES.items():
        add(name, *spec)
    for weapon, fire_speed in (("Colt", 2.43), ("WalterP38", 2.0)):
        for name, (clip, speed, looping, morph, then) in UPPER_MOVES.items():
            if name.startswith("Ub_Fire{"):
                speed = fire_speed
            add(name.format(w=weapon), clip, speed, looping, morph,
                then.format(w=weapon))
    for name, (clip, morph, then) in CLIPLESS.items():
        add(name, clip, 4.0, "c_AsmPlayOnce", morph, then)
    return m


def bundle(path: Path) -> dict:
    blob = path.read_bytes()
    length, = struct.unpack_from("<I", blob, 12)
    return json.loads(blob[20:20 + length])


def keyframes(path: Path, clip: str, node: str, channel: str):
    """One channel's (times, values) out of a written bundle."""
    blob = path.read_bytes()
    length, = struct.unpack_from("<I", blob, 12)
    doc = json.loads(blob[20:20 + length])
    binary = blob[20 + length + 8:]
    names = [n["name"] for n in doc["nodes"]]
    anim = next(a for a in doc["animations"] if a["name"] == clip)

    def read(index):
        acc = doc["accessors"][index]
        view = doc["bufferViews"][acc["bufferView"]]
        width = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[acc["type"]]
        flat = struct.unpack_from(f"<{acc['count'] * width}f", binary,
                                  view.get("byteOffset", 0) + acc.get("byteOffset", 0))
        return [flat[i * width:(i + 1) * width] for i in range(acc["count"])]

    for ch in anim["channels"]:
        if names[ch["target"]["node"]] == node and ch["target"]["path"] == channel:
            sampler = anim["samplers"][ch["sampler"]]
            return [t for (t,) in read(sampler["input"])], read(sampler["output"])
    raise KeyError((clip, node, channel))


class OneShotTimelineTests(unittest.TestCase):
    def frames(self, speed, loop):
        clip = baf.parse(FILES["t/crouch2lie_lower.baf"], "c2l")
        frames, period = extract_pose.clip_timeline(clip, speed, skeleton(), loop)
        return [round(f["bip01"][1][2], 3) for f in frames], period

    def test_a_forward_one_shot_keeps_its_order(self) -> None:
        heights, period = self.frames(1.6, loop=False)
        # ROOT_ALIGN flips the root's z, as for every clip.
        self.assertEqual([-0.5, -0.4, -0.3, -0.2], heights)
        self.assertAlmostEqual(0.625, period, places=6)

    def test_a_backwards_one_shot_runs_from_its_last_frame_to_its_first(self) -> None:
        # `updateState` puts a negative-rate one-shot at phase 1.0 on entry and
        # `AnimationState::update` leaves it below 0: last frame to first.
        heights, period = self.frames(-2.0, loop=False)
        self.assertEqual([-0.2, -0.3, -0.4, -0.5], heights)
        self.assertAlmostEqual(0.5, period, places=6)

    def test_a_backwards_loop_keeps_frame_zero_as_the_cycle_start(self) -> None:
        heights, _period = self.frames(-1.0, loop=True)
        self.assertEqual([-0.5, -0.2, -0.3, -0.4], heights)


class GenericStateTests(unittest.TestCase):
    def test_the_weapon_suffix_comes_off(self) -> None:
        self.assertEqual("Ub_Lie", extract_pose.generic_state("Ub_LieK98Sniper", "K98Sniper"))
        self.assertEqual("Ub_StandReload",
                         extract_pose.generic_state("Ub_StandReloadNo4", "No4"))
        # The scripts spell `Ub_FireEndJohnsonLmg` for the `JohnsonLMG`.
        self.assertEqual("Ub_FireEnd",
                         extract_pose.generic_state("Ub_FireEndJohnsonLmg", "JohnsonLMG"))

    def test_states_without_a_weapon_are_left_alone(self) -> None:
        self.assertEqual("_POSE_", extract_pose.generic_state("_POSE_", "Colt"))
        self.assertEqual("Ub_CrouchToStand",
                         extract_pose.generic_state("Ub_CrouchToStand", "Colt"))
        self.assertIsNone(extract_pose.generic_state(None, "Colt"))


class ExportActionsTests(unittest.TestCase):
    def export(self, out: Path) -> dict:
        return extract_pose.export_gait_clips(
            machine(), FakePool(FILES), skeleton(), ["Colt", "WalterP38"], out)

    def test_the_lower_bundle_adds_the_transitions_after_the_gaits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            names = [a["name"] for a in bundle(out / "gaits" / "lower.gait.glb")["animations"]]

            gaits = [f"{key}.lower" for key, _lo, _up in extract_pose.GAITS]
            self.assertEqual(gaits, names[:len(gaits)])
            self.assertEqual(list(extract_pose.STANCE_TRANSITIONS), names[len(gaits):])

    def test_the_grip_bundle_adds_the_torso_actions_under_the_generic_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            names = [a["name"] for a in bundle(out / "gaits" / "anims.gait.glb")["animations"]]

            self.assertEqual([f"{key}.upper" for key, _lo, _up in extract_pose.GAITS],
                             names[:4])
            self.assertEqual(
                ["Ub_CrouchToLie", "Ub_LieToCrouch", "Ub_LieToStand", "Ub_RunStandToLie",
                 "Ub_Fire", "Ub_LieFire", "Ub_StandReload", "Ub_LieReload"],
                names[4:])

    def test_every_clip_says_how_the_engine_plays_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            lower = bundle(out / "gaits" / "lower.gait.glb")["extras"]["states"]
            upper = bundle(out / "gaits" / "anims.gait.glb")["extras"]["states"]

            self.assertEqual(
                {"state": "Lb_LieToStand", "clip": "t/crouch2lie_lower.baf",
                 "speed": -3.0, "loop": False, "morph": 2.0,
                 "then": "Lb_CrouchToStand", "frames": 4, "period": 0.3333},
                lower["Lb_LieToStand"])
            self.assertEqual(12.0, lower["Lb_StandToCrouch"]["speed"])
            # The torso's `then` loses the weapon, so a renderer follows it by
            # the names it binds: `Ub_LieColt` is `Ub_Lie`.
            self.assertEqual("Ub_Lie", upper["Ub_CrouchToLie"]["then"])
            self.assertEqual("Ub_CrouchToStand", upper["Ub_LieToStand"]["then"])
            self.assertEqual("_POSE_", upper["Ub_Fire"]["then"])
            self.assertEqual(10000.0, upper["Ub_StandReload"]["morph"])
            self.assertEqual(2.43, upper["Ub_Fire"]["speed"])
            self.assertEqual(0.7, upper["run.upper"]["morph"])

    def test_a_backwards_transition_starts_where_its_forward_twin_ends(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            path = out / "gaits" / "lower.gait.glb"
            fwd_t, fwd = keyframes(path, "Lb_CrouchToLie", "Bip01", "translation")
            back_t, back = keyframes(path, "Lb_LieToCrouch", "Bip01", "translation")

            self.assertEqual(fwd[-1], back[0])
            self.assertEqual(fwd[0], back[-1])
            # One-shot layout: four frames over three intervals, `1/|speed|`.
            self.assertAlmostEqual(0.625, fwd_t[-1], places=5)
            self.assertAlmostEqual(0.5, back_t[-1], places=5)
            self.assertEqual(4, len(back_t))

    def test_a_weapon_sharing_the_grip_at_its_own_rate_is_listed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest = self.export(Path(tmp))
            machine_meta = manifest["stateMachine"]

            self.assertEqual({"WalterP38": {"Ub_Fire": 2.0}},
                             machine_meta["weaponSpeeds"])
            # The grip is the clip folder (`gait_grip`), here the gaits' `anims`.
            self.assertEqual({"anims": ["Ub_FireEnd"]}, machine_meta["absent"])

    def test_the_clipless_torso_transitions_are_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest = self.export(Path(tmp))
            clipless = manifest["stateMachine"]["clipless"]

            self.assertEqual({"state": "Ub_StandToCrouch", "morph": 2.0,
                              "then": "Ub_Crouch"}, clipless["Ub_StandToCrouch"])
            self.assertEqual("Ub_StandAim", clipless["Ub_CrouchToStand"]["then"])
            # Declared, and no archive ships the file.
            self.assertEqual("clip absent from the archives",
                             clipless["Ub_StandToLie"]["absent"])

    def test_the_new_clips_are_written_compact_and_the_old_ones_are_not(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.export(out)
            path = out / "gaits" / "anims.gait.glb"
            # The reload's torso holds still: two keys, first and last time.
            times, values = keyframes(path, "Ub_StandReload", "Bip01 Spine", "translation")
            self.assertEqual(2, len(times))
            self.assertAlmostEqual(2.5, times[-1], places=5)
            self.assertEqual(values[0], values[1])
            # A gait keeps its layout: one key per frame and the wrap.
            times, _values = keyframes(path, "run.upper", "Bip01 Spine", "translation")
            self.assertEqual(4, len(times))

    def test_the_manifest_keeps_the_keys_it_did_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "gaits").mkdir()
            (out / "gaits" / "gaits.json").write_text(json.dumps({
                "swim": "gaits/swim.gait.glb",
                "stateMachine": {"weaponSpeeds": {"Panzershreck": {"Ub_LieReload": 0.4}}},
            }))
            self.export(out)
            merged = json.loads((out / "gaits" / "gaits.json").read_text())

            self.assertEqual("gaits/swim.gait.glb", merged["swim"])
            # Merged all the way down: a run that knows only the Colt's grip
            # leaves another grip's weapon alone.
            self.assertEqual({"Panzershreck": {"Ub_LieReload": 0.4},
                              "WalterP38": {"Ub_Fire": 2.0}},
                             merged["stateMachine"]["weaponSpeeds"])


class CompactAnimationTests(unittest.TestCase):
    def test_compact_samples_the_same_values_as_the_full_layout(self) -> None:
        node_rot = [gltf.rot_y(a) for a in (0.0, 10.0, 25.0)]
        tracks = [(0, (0.0, 0.5, 1.0), [(r, (0.0, 1.0, 0.0)) for r in node_rot]),
                  (1, (0.0, 0.5, 1.0), [(gltf.rot_y(0.0), (0.0, 0.3, 0.0))] * 3)]
        full = gltf.GlbBuilder()
        full.add_node(gltf.Node("a")); full.add_node(gltf.Node("b"))
        full.add_animation("x", tracks)
        compact = gltf.GlbBuilder()
        compact.add_node(gltf.Node("a")); compact.add_node(gltf.Node("b"))
        compact.add_animation("x", tracks, compact=True)

        self.assertEqual(4, len(full._animations[0]["channels"]))
        self.assertEqual(4, len(compact._animations[0]["channels"]))
        # Node b never moves: both its channels are two keys in compact form,
        # and node a's moving rotation keeps all three.
        counts = [compact._accessors[s["input"]]["count"]
                  for s in compact._animations[0]["samplers"]]
        self.assertEqual([3, 2, 2, 2], counts)
        # One time accessor per distinct layout, not one per node.
        inputs = {s["input"] for s in compact._animations[0]["samplers"]}
        self.assertEqual(2, len(inputs))
        # And no `interpolation`: LINEAR is the spec's default.
        self.assertNotIn("interpolation", compact._animations[0]["samplers"][0])


if __name__ == "__main__":
    unittest.main()
