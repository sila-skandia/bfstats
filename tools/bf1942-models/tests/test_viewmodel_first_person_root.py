"""A 1P clip that keys the skeleton root moves the arms as the files do.

FH's `1PFireFG42.baf` keys `Bip01` (on its raw rest) and XPack2's
`1PDeployGewehr42.baf` keys `Bip01` and `Spine Root`, which no other 1P clip
does. The rig holds those bones at their parsed `.ske` rests in every other
family, so a root track has to land in that frame
(`extract_viewmodel.first_person_locals`); aligned by the third-person
ROOT_ALIGN instead, the FG42 jumped 1.24 m on each shot where the files move
it 7 cm.
"""

from __future__ import annotations

import math
import unittest

import extract_viewmodel as ev
from bf42 import pose as pose_mod
from bf42.ske import Bone, Skeleton


def rot(axis: int, degrees: float):
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    i, j = [(1, 2), (2, 0), (0, 1)][axis]
    m = [[1.0 if r == k else 0.0 for k in range(3)] for r in range(3)]
    m[i][i], m[i][j], m[j][i], m[j][j] = c, -s, s, c
    return tuple(tuple(row) for row in m)


def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3))
                       for j in range(3)) for i in range(3))


# Parsed rests, as bf42.ske leaves them: a root turned and lifted, a spine
# root, the first bone the idle keys, and the hand under it.
SKELETON = Skeleton([
    Bone("Bip01", -1, mat_mul(rot(1, 30.0), rot(0, 10.0)), (0.02, 0.9, 0.1)),
    Bone("Spine Root", 0, rot(2, 15.0), (0.0, 0.1, 0.0)),
    Bone("Bip01 Spine", 1, rot(0, 5.0), (0.0, 0.12, 0.01)),
    Bone("Bip01 R Hand", 2, rot(1, 20.0), (0.3, 0.4, 0.2)),
])
HELD = frozenset({"bip01 spine", "bip01 r hand"})
IDLE = {"bip01 spine": (rot(0, 7.0), (0.0, 0.12, 0.01)),
        "bip01 r hand": (rot(1, 25.0), (0.3, 0.4, 0.2))}


def raw(name: str):
    bone = next(b for b in SKELETON.bones if b.name == name)
    return ev._conjugate((bone.rotation, bone.translation))


def hand(locals_):
    worlds = pose_mod.posed_worlds(SKELETON, locals_)
    return worlds[3]


def engine_hand(root, spine_root):
    """The engine's answer: every transform raw, multiplied down the chain."""
    chain = pose_mod.rt_mul(root, spine_root)
    return pose_mod.rt_mul(pose_mod.rt_mul(chain, IDLE["bip01 spine"]),
                           IDLE["bip01 r hand"])


def angle(a, b):
    m = mat_mul(tuple(zip(*a[0])), b[0])
    return math.degrees(math.acos(max(-1.0, min(1.0, (m[0][0] + m[1][1] + m[2][2] - 1) / 2))))


class FirstPersonRootTests(unittest.TestCase):
    def test_a_clip_without_a_root_track_is_left_alone(self):
        self.assertEqual(ev.first_person_locals(SKELETON, IDLE, HELD), IDLE)

    def test_a_root_track_on_its_raw_rest_is_the_rigs_rest(self):
        # the FG42 fire's frame 0
        clip = {**IDLE, "bip01": raw("Bip01")}
        got = hand(ev.first_person_locals(SKELETON, clip, HELD))
        want = hand(ev.first_person_locals(SKELETON, IDLE, HELD))
        self.assertLess(math.dist(got[1], want[1]), 1e-9)
        self.assertLess(angle(got, want), 1e-6)

    def test_the_arms_move_against_the_idle_as_the_files_move_them(self):
        # the Gewehr42 deploy: root and spine root both turned off their rest
        r0, s0 = raw("Bip01"), raw("Spine Root")
        r1 = pose_mod.rt_mul(r0, (rot(2, 40.0), (0.05, -0.02, 0.0)))
        s1 = pose_mod.rt_mul(s0, (rot(0, -12.0), (0.0, 0.01, 0.0)))
        idle = hand(ev.first_person_locals(SKELETON, IDLE, HELD))
        moved = hand(ev.first_person_locals(
            SKELETON, {**IDLE, "bip01": r1, "spine root": s1}, HELD))
        engine0, engine1 = engine_hand(r0, s0), engine_hand(r1, s1)
        self.assertAlmostEqual(math.dist(idle[1], moved[1]),
                               math.dist(engine0[1], engine1[1]), places=9)
        self.assertAlmostEqual(angle(idle, moved), angle(engine0, engine1), places=6)

    def test_the_third_person_alignment_would_not(self):
        r1 = pose_mod.rt_mul(raw("Bip01"), (rot(2, 40.0), (0.05, -0.02, 0.0)))
        idle = hand(ev.first_person_locals(SKELETON, IDLE, HELD))
        aligned = hand(pose_mod.align_clip_roots(SKELETON, {**IDLE, "bip01": r1}))
        engine = math.dist(engine_hand(raw("Bip01"), raw("Spine Root"))[1],
                           engine_hand(r1, raw("Spine Root"))[1])
        self.assertGreater(abs(math.dist(idle[1], aligned[1]) - engine), 0.05)


if __name__ == "__main__":
    unittest.main()
