"""A weapon stays in the hands that hold it while a clip plays.

Owner's report on FHSW's Hungary Forest: the K98's reload spun the rifle like
a clock hand. FHSW's and FH's bolt rifles carry the whole rifle on a `GUNBODY`
bone that the weapon clip counter-rolls against the right hand as the hand
works the bolt (K98BoltOperate.baf: the hand rolls 113 degrees, GUNBODY 112
back). `extract_viewmodel.weapon_part_locals` wrote that counter-roll in the
weapon model's convention (the raw transform conjugated by the Z mirror);
under the grip wrapper, which hangs from a clip-posed hand through
`CLIP_WORLD_YAW`, the part has to be the raw transform conjugated by the yaw.
The two differ by the X mirror, which reverses a roll about the barrel: the
two rolls added and the rifle reached 179 degrees.

`audit_viewmodel_motion.py` plays every rig offline and reports the class.
"""

from __future__ import annotations

import math
import unittest
from pathlib import Path

import audit_viewmodel_motion as motion
import extract_viewmodel
from bf42 import pose as pose_mod

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


def rot(axis: int, degrees: float):
    c, s = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    i, j = [(1, 2), (2, 0), (0, 1)][axis]
    m = [[1.0 if r == k else 0.0 for k in range(3)] for r in range(3)]
    m[i][i], m[i][j], m[j][i], m[j][j] = c, -s, s, c
    return tuple(tuple(row) for row in m)


def mat_mul(a, b):
    return tuple(tuple(sum(a[i][k] * b[k][j] for k in range(3))
                       for j in range(3)) for i in range(3))


class UnderGripTests(unittest.TestCase):
    def test_a_part_under_the_grip_is_the_raw_transform_turned_by_the_yaw(self):
        yaw = pose_mod.CLIP_WORLD_YAW
        raw = (mat_mul(rot(2, 70.0), rot(0, 25.0)), (0.03, 0.05, -0.2))
        parsed = extract_viewmodel._conjugate(raw)
        got = extract_viewmodel._under_grip(parsed)
        want = mat_mul(mat_mul(yaw, raw[0]), yaw)        # the yaw is its own inverse
        for i in range(3):
            for j in range(3):
                self.assertAlmostEqual(got[0][i][j], want[i][j], places=9)
        want_t = tuple(sum(yaw[i][k] * raw[1][k] for k in range(3))
                       for i in range(3))
        for a, b in zip(got[1], want_t):
            self.assertAlmostEqual(a, b, places=9)

    def test_a_roll_about_the_barrel_is_reversed_and_a_pitch_is_kept(self):
        roll = extract_viewmodel._under_grip((rot(2, 40.0), (0.0, 0.0, 0.0)))
        self.assertAlmostEqual(roll[0][0][1], rot(2, -40.0)[0][1], places=9)
        pitch = extract_viewmodel._under_grip((rot(0, 40.0), (0.0, 0.0, 0.0)))
        self.assertAlmostEqual(pitch[0][1][2], rot(0, 40.0)[1][2], places=9)


class FindingTests(unittest.TestCase):
    @staticmethod
    def measured(turn_l: float, turn_r: float, grip: float = 0.0,
                 world: float = 65.0, unheld=None, files=None,
                 clip: str = "bolt") -> dict:
        hand = lambda turn: {"slip": 0.0, "turn": turn, "start": (0.0, 0.0),
                             "still": (0.0, 0.0), "end": (0.0, 0.0)}
        row = {"class": motion.family_class(clip), "duration": 1.0, "keys": 30,
               "moving": 4, "bodyPeak": world, "bodyPath": 2 * world,
               "bodyEnd": (0.0, 0.0), "bodyTravel": 0.02, "bodyMove": 0.02,
               "gripMoves": grip, "parts": {},
               "hands": {"L": hand(turn_l), "R": hand(turn_r)}}
        if unheld is not None:
            row["unheld"] = unheld
        if files is not None:
            row["files"] = files
        return {"rig": "S__W", "weapon": "W", "soldier": "S", "body": "W",
                "problems": [], "clips": {clip: row}}

    def kinds(self, m: dict) -> set[str]:
        return {f["kind"] for f in motion.findings_of(m)}

    def test_a_body_turning_against_both_hands_is_reported(self):
        self.assertIn("body-turns-in-hands", self.kinds(self.measured(170.0, 112.0)))

    def test_a_body_still_in_one_hand_is_not(self):
        # the fixed K98: 112 degrees against the bolt hand, 3 against the other
        self.assertEqual(self.kinds(self.measured(3.4, 112.0)), set())

    def test_a_body_at_rest_while_both_hands_work_is_not(self):
        # FHSW's S18 anti-tank rifle, prone: 1 degree in the view
        self.assertEqual(self.kinds(self.measured(180.0, 120.0, world=1.1)), set())

    def test_a_throw_is_let_be(self):
        self.assertEqual(self.kinds(self.measured(90.0, 90.0, grip=0.5)), set())

    def test_a_rifle_passed_from_hand_to_hand_is_not(self):
        # FHSW's K98Grenade reload: 112 against the right hand, 69 against the
        # left, 38 in the view, and at every step it rides one of them
        # (3.9 deg summed, the float noise vanilla's welded rigs also show)
        self.assertEqual(self.kinds(self.measured(69.0, 112.0, unheld=(3.9, 0.02))),
                         set())

    def test_a_rifle_turning_against_everything_at_once_still_is(self):
        # the d758adb2 class: every step turns it against both hands and the view
        self.assertIn("body-turns-in-hands",
                      self.kinds(self.measured(170.0, 112.0, world=179.0,
                                               unheld=(450.0, 0.3))))


class AuthoredTests(unittest.TestCase):
    """A flag the mod's own files make is accepted, by file and by value."""

    VG1 = ("Animations/WeaponHandling/1p/VG-1/1PLieReloadVG-1.baf",
           "Animations/Weapons/VG-1/VG-1Reload.baf")

    def found(self, turn_l: float, files, world: float = 104.0) -> list[dict]:
        m = FindingTests.measured(turn_l, 111.5, world=world,
                                  unheld=(336.0, 1.09), files=files,
                                  clip="proneReload")
        return [f for f in motion.findings_of(m) if f["kind"] == "body-turns-in-hands"]

    def test_the_vg1_prone_reload_is_the_files_own(self):
        [f] = self.found(103.7, self.VG1)
        self.assertEqual(f["authored"], "VG-1 prone reload")

    def test_a_different_value_on_the_same_files_is_not(self):
        # what the pre-d758adb2 convention made of the same pair
        [f] = self.found(112.0, self.VG1, world=179.0)
        self.assertNotIn("authored", f)

    def test_the_same_value_on_other_files_is_not(self):
        [f] = self.found(103.7, ("1PLieReloadK98.baf", "K98Reload.baf"))
        self.assertNotIn("authored", f)

    def test_every_entry_names_files_kinds_and_a_reason(self):
        kinds = {"body-turns-in-hands", "body-leaves-hands", "part-leaves-body"}
        for entry in motion.AUTHORED:
            with self.subTest(entry["name"]):
                self.assertTrue(entry["upper"] and entry["weapon"].endswith(".baf"))
                self.assertTrue(set(entry["values"]) <= kinds)
                self.assertEqual("part-leaves-body" in entry["values"],
                                 bool(entry.get("part")))
                self.assertGreater(len(entry["reason"]), 40)


class RigsOnDiskTests(unittest.TestCase):
    def findings(self, rel: str) -> list[dict]:
        path = VIEWER / rel
        if not path.is_file():
            self.skipTest(f"{rel} is not on this PC")
        return motion.findings_of(motion.measure(path))

    def test_fhsw_k98_stays_in_the_left_hand_through_bolt_and_reload(self):
        found = self.findings(
            "models/mods/fhsw/viewmodels/GermanSoldier__K98.fp.glb")
        self.assertEqual([f for f in found if f["clip"] in
                          ("bolt", "proneBolt", "reload", "proneReload")], [])

    def test_fhsw_vg1_prone_reload_is_accepted_as_the_files_own(self):
        found = self.findings(
            "models/mods/fhsw/viewmodels/GermanSoldier__VG-1.fp.glb")
        prone = [f for f in found if f["clip"] == "proneReload"]
        self.assertTrue(prone)
        self.assertEqual({f.get("authored") for f in prone}, {"VG-1 prone reload"})
        self.assertEqual([f for f in found if f["clip"] == "reload"], [])

    def test_fhsw_rifle_grenade_regrip_is_quiet(self):
        found = self.findings(
            "models/mods/fhsw/viewmodels/GermanSoldier__K98Grenade.fp.glb")
        self.assertEqual([f for f in found if f["clip"] in ("reload", "proneReload")],
                         [])

    def test_vanilla_rifles_are_quiet(self):
        for stem in ("GermanSoldier__K98", "USSoldier__Thompson",
                     "BritishSoldier__No4", "USSoldier__M1Garand"):
            with self.subTest(stem):
                self.assertEqual(
                    self.findings(f"models/viewmodels/{stem}.fp.glb"), [])


class SourceReaderTests(unittest.TestCase):
    """`viewmodel_source_motion` reads the clips without the exporter."""

    def test_its_quaternion_matrix_is_the_conjugate(self):
        import viewmodel_source_motion as source
        # a stored (0, 0, sin 20, cos 20) is a 40 degree turn about z, read
        # as its conjugate (the row-vector storage): -40
        q = (0.0, 0.0, math.sin(math.radians(20)), math.cos(math.radians(20)))
        m = source._conj_matrix(q)
        self.assertAlmostEqual(m[0][1], rot(2, -40.0)[0][1], places=9)

    @unittest.skipUnless(
        (Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods/FHSW").is_dir()
        and (VIEWER / "models/mods/fhsw/viewmodels").is_dir(),
        "needs the FHSW install and its rigs")
    def test_every_authored_entry_is_what_the_fhsw_files_compose_to(self):
        import viewmodel_source_motion as source
        failures = source.check(source.Source("fhsw"),
                                VIEWER / "models/mods/fhsw/viewmodels", verbose=False)
        self.assertEqual(failures, [])


if __name__ == "__main__":
    unittest.main()
