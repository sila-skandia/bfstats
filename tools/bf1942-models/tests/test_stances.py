from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates, ske  # noqa: E402
from test_pose import pack_ske  # noqa: E402
import extract_pose  # noqa: E402

IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))


def pack_baf(bones: list[tuple[str, tuple[int, int, int, int],
                               tuple[int, int, int]]]) -> bytes:
    """A one-frame version-3 clip; quat/pos values are raw signed words."""
    out = bytearray()
    out += struct.pack("<IH", 3, len(bones))
    for name, _quat, _pos in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw)) + raw
    out += struct.pack("<IB", 1, 15)
    for _name, quat, pos in bones:
        out += struct.pack("<H", 14)  # 7 channels x (control + hold value)
        for value in (*quat, *pos):
            # Per channel: wordCount, then one hold segment (control, value).
            out += struct.pack("<HHH", 2, 0x0281, value & 0xFFFF)
    return bytes(out)


class FakePool:
    def __init__(self, files: dict[str, bytes]) -> None:
        self._files = {key.lower(): value for key, value in files.items()}

    def find(self, path: str) -> str | None:
        key = path.lower()
        return key if key in self._files else None

    def read(self, entry: str) -> bytes:
        return self._files[entry.lower()]


def machine_with(states: dict[str, str]) -> animstates.StateMachine:
    machine = animstates.StateMachine()
    for name, clip_path in states.items():
        state = animstates.State(name)
        state.clips.append(animstates.ClipRef(clip_path, 1.0, "1"))
        machine.states[name.lower()] = state
    return machine


# Raw words for an identity rotation (stored quats decode via conjugate, and
# the conjugate of identity is identity) and a distinctive translation per
# clip so the tests can tell which clip posed a bone.
QUAT_ID = (0, 0, 0, 32767)


def pos_words(x: float, y: float, z: float) -> tuple[int, int, int]:
    return (int(x * 32768), int(y * 32768), int(z * 32768))


LOWER_BONES = [("Bip01", QUAT_ID, pos_words(0.0, 0.0, 0.9)),
               ("Bip01 Pelvis", QUAT_ID, pos_words(0.0, 0.1, 0.0))]
UPPER_BONES = [("Bip01 Spine", QUAT_ID, pos_words(0.0, 0.2, 0.0))]

STATES = {
    "Lb_Stand": "anims/lower_stand.baf",
    "Lb_Crouch": "anims/lower_crouch.baf",
    "Lb_Lie": "anims/lower_lie.baf",
    "Ub_StandAimColt": "anims/upper_standaim_colt.baf",
    "Ub_CrouchColt": "anims/upper_crouch_colt.baf",
    "Ub_LieColt": "anims/upper_lie_colt.baf",
}

FILES = {
    "anims/lower_stand.baf": pack_baf(LOWER_BONES),
    "anims/lower_crouch.baf": pack_baf(
        [("Bip01", QUAT_ID, pos_words(0.0, 0.0, 0.5)),
         ("Bip01 Pelvis", QUAT_ID, pos_words(0.0, 0.1, 0.0))]),
    "anims/lower_lie.baf": pack_baf(
        [("Bip01", QUAT_ID, pos_words(0.0, 0.0, 0.2)),
         ("Bip01 Pelvis", QUAT_ID, pos_words(0.0, 0.1, 0.0))]),
    "anims/upper_standaim_colt.baf": pack_baf(UPPER_BONES),
    "anims/upper_crouch_colt.baf": pack_baf(
        [("Bip01 Spine", QUAT_ID, pos_words(0.0, 0.3, 0.0))]),
    "anims/upper_lie_colt.baf": pack_baf(
        [("Bip01 Spine", QUAT_ID, pos_words(0.0, 0.4, 0.0))]),
}


def skeleton() -> ske.Skeleton:
    return ske.parse(pack_ske([
        ("Bip01", -1, IDENTITY, (0.0, 0.0, 0.9)),
        ("Bip01 Pelvis", 0, IDENTITY, (0.0, 0.1, 0.0)),
        ("Bip01 Spine", 1, IDENTITY, (0.0, 0.2, 0.0)),
    ]), "s.ske")


class ResolveStanceTests(unittest.TestCase):
    def test_lower_and_upper_clips_union_into_one_pose(self) -> None:
        machine = machine_with(STATES)
        pool = FakePool(FILES)

        locals_map, lower, upper = extract_pose.resolve_stance(
            machine, pool, "Colt", "Lb_Crouch", "Crouch", 0)

        self.assertEqual("anims/lower_crouch.baf", lower)
        self.assertEqual("anims/upper_crouch_colt.baf", upper)
        self.assertAlmostEqual(0.5, locals_map["bip01"][1][2], places=3)
        self.assertAlmostEqual(0.3, locals_map["bip01 spine"][1][1], places=3)

    def test_a_missing_upper_state_names_the_state_it_wanted(self) -> None:
        machine = machine_with(
            {key: value for key, value in STATES.items()
             if key != "Ub_CrouchColt"})

        with self.assertRaises(extract_pose.PoseError) as caught:
            extract_pose.resolve_stance(
                machine, FakePool(FILES), "Colt", "Lb_Crouch", "Crouch", 0)
        self.assertIn("Ub_CrouchColt", str(caught.exception))

    def test_an_unreadable_clip_is_an_error_not_a_crash(self) -> None:
        files = dict(FILES)
        files["anims/upper_lie_colt.baf"] = b"\x21garbage"

        with self.assertRaises(extract_pose.PoseError) as caught:
            extract_pose.resolve_stance(
                machine_with(STATES), FakePool(files),
                "Colt", "Lb_Lie", "Lie", 0)
        self.assertIn("unreadable", str(caught.exception))


class CollectStancesTests(unittest.TestCase):
    def test_all_three_stances_resolve_with_clip_paths(self) -> None:
        stance_locals, report = extract_pose.collect_stances(
            machine_with(STATES), FakePool(FILES), skeleton(), "Colt", 0)

        self.assertEqual(["stand", "crouch", "lie"], list(stance_locals))
        for key in ("stand", "crouch", "lie"):
            self.assertIn("lowerClip", report[key])
            self.assertIn("upperClip", report[key])
        # Each stance carried its own clip's values through.
        self.assertAlmostEqual(
            0.3, stance_locals["crouch"]["bip01 spine"][1][1], places=3)
        self.assertAlmostEqual(
            0.4, stance_locals["lie"]["bip01 spine"][1][1], places=3)

    def test_root_locals_are_clip_world_aligned(self) -> None:
        stance_locals, _report = extract_pose.collect_stances(
            machine_with(STATES), FakePool(FILES), skeleton(), "Colt", 0)

        # ROOT_ALIGN is diag(-1, 1, -1): the root's clip-space translation
        # (0, 0, 0.5) crosses into mesh world as (0, 0, -0.5).
        self.assertAlmostEqual(
            -0.5, stance_locals["crouch"]["bip01"][1][2], places=3)
        # Non-root bones are untouched.
        self.assertAlmostEqual(
            0.1, stance_locals["crouch"]["bip01 pelvis"][1][1], places=3)

    def test_a_stance_the_weapon_lacks_records_its_error_and_is_skipped(self) -> None:
        machine = machine_with(
            {key: value for key, value in STATES.items()
             if key not in ("Ub_CrouchColt", "Ub_LieColt")})

        stance_locals, report = extract_pose.collect_stances(
            machine, FakePool(FILES), skeleton(), "Colt", 0)

        self.assertEqual(["stand"], list(stance_locals))
        self.assertIn("Ub_CrouchColt", report["crouch"]["error"])
        self.assertIn("Ub_LieColt", report["lie"]["error"])
        self.assertNotIn("error", report["stand"])


if __name__ == "__main__":
    unittest.main()
