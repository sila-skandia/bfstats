from __future__ import annotations

import json
import math
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import animstates, pose, ske  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from test_pose import pack_ske  # noqa: E402
import extract_viewmodel  # noqa: E402

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
        out += struct.pack("<H", 14)
        for value in (*quat, *pos):
            out += struct.pack("<HHH", 2, 0x0281, value & 0xFFFF)
    return bytes(out)


class FakeObjects:
    """The `try_read` face of an ArchivePool over an in-memory dict."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self._files = {key.lower(): value for key, value in files.items()}

    def try_read(self, name: str) -> bytes | None:
        return self._files.get(name.replace("\\", "/").lower())


SOLDIER_CON = """
ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.createSkeleton animations/TestSoldier.ske

ObjectTemplate.addTemplate TestSoldier3PBody
ObjectTemplate.addTemplate TestSoldier1PBody
ObjectTemplate.setIsFirstPersonPart 1
ObjectTemplate.addTemplate 1pTestRightHand
ObjectTemplate.setIsFirstPersonPart 1
ObjectTemplate.addTemplate TestCamera
ObjectTemplate.setIsFirstPersonPart 2
ObjectTemplate.addTemplate 1pUnskinnedProp
ObjectTemplate.setIsFirstPersonPart 1

ObjectTemplate.create SimpleObject TestSoldier3PBody
ObjectTemplate.geometry Body3P
ObjectTemplate.create SimpleObject TestSoldier1PBody
ObjectTemplate.geometry Body1P
ObjectTemplate.create SimpleObject 1pTestRightHand
ObjectTemplate.geometry Hand1P
ObjectTemplate.create Camera TestCamera
ObjectTemplate.create SimpleObject 1pUnskinnedProp
ObjectTemplate.geometry Prop1P

GeometryTemplate.create AnimatedMesh Body3P
GeometryTemplate.setSkin animations/body3p.skn
GeometryTemplate.create AnimatedMesh Body1P
GeometryTemplate.setSkin animations/body1p.skn
GeometryTemplate.create AnimatedMesh Hand1P
GeometryTemplate.setSkin animations/hand1p.skn
GeometryTemplate.create StandardMesh Prop1P
"""


class FirstPersonPartsTests(unittest.TestCase):
    """§4.1's gate: `instance_template_name` erases every child declared with
    `setIsFirstPersonPart 1`, so the viewmodel exporter walks the children
    itself and keeps exactly the skinned first-person ones."""

    def _library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/TestSoldier/Objects.con", SOLDIER_CON)
        return library

    def test_keeps_only_skinned_first_person_children(self) -> None:
        parts = extract_viewmodel.first_person_parts(
            self._library(), "TestSoldier")

        self.assertEqual(["TestSoldier1PBody", "1pTestRightHand"],
                         [p.name for p in parts])

    def test_the_camera_and_the_third_person_body_are_not_arms(self) -> None:
        names = [p.name for p in extract_viewmodel.first_person_parts(
            self._library(), "TestSoldier")]

        # fp=2 (the camera) is not the arms; fp=0 is the 3P body; a 1P part
        # without a skin cannot be animated and is dropped too.
        self.assertNotIn("TestCamera", names)
        self.assertNotIn("TestSoldier3PBody", names)
        self.assertNotIn("1pUnskinnedProp", names)

    def test_a_soldier_without_first_person_parts_is_an_error(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/x.con",
                        "ObjectTemplate.create BFSoldier Bare\n")

        with self.assertRaises(extract_viewmodel.PoseError):
            extract_viewmodel.first_person_parts(library, "Bare")


ANIM_CON = """
AnimationStateMachine.createState Ub_StandAimThompson
AnimationStateMachine.addAnimation Animations/3p/Thompson/3PStandAim.baf 0.8 1
AnimationStateMachine.addAnimation Animations/1p/Thompson/1PStandAim.baf 0.1 1
AnimationStateMachine.addIdle Ub_IdleThompson1
AnimationStateMachine.addIdle Ub_IdleThompson2
AnimationStateMachine.addIdle Ub_IdleThompson3
AnimationStateMachine.returnToState Ub_StandAimThompson
AnimationStateMachine.setMorphFactor 0.7
AnimationStateMachine.copyState2 Colt Thompson

AnimationStateMachine.createState Ub_IdleThompson1
AnimationStateMachine.addAnimation Animations/3p/Thompson/3pIdle1Thompson.baf 1.0 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/WeaponHandling/1p/Thompson/1pIdle1Thompson.baf 0.52 c_AsmPlayOnce
AnimationStateMachine.addTransitionWhenDone Ub_StandAimThompson

AnimationStateMachine.createState Ub_IdleThompson2
AnimationStateMachine.addAnimation Animations/3p/Thompson/3pIdle2Thompson.baf 1.0 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/WeaponHandling/1p/Thompson/1pIdle2Thompson.baf 0.39 c_AsmPlayOnce
AnimationStateMachine.addTransitionWhenDone Ub_StandAimThompson

rem the third registered fidget is never declared — the engine cannot play it
rem and neither may the export invent a clip for it

AnimationStateMachine.createState WeaponReloadThompson
AnimationStateMachine.addAnimation Animations/Weapons/Thompson/ThompsonReload.baf 0.4 c_AsmPlayOnce

AnimationStateMachine.createState Ub_StandReloadThompson
AnimationStateMachine.setOtherState c_AsmWeaponState WeaponReloadThompson
AnimationStateMachine.addAnimation Animations/3p/Thompson/3PReload.baf 0.4 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/1p/Thompson/1PReload.baf 0.4 c_AsmPlayOnce
AnimationStateMachine.addTransitionWhenDone Ub_StandAimThompson
AnimationStateMachine.setMorphFactor 3.0
AnimationStateMachine.copyState2 Colt Thompson

AnimationStateMachine.createState Ub_FireThompson
AnimationStateMachine.addAnimation Animations/1p/Thompson/1PFire.baf 10 c_AsmLooping
AnimationStateMachine.returnToState _POSE_

rem the tweaking scripts run last and name the state outright
AnimationStateMachine.set1pAnimationSpeed Ub_StandReloadColt 0.6
AnimationStateMachine.set3pAnimationSpeed Ub_StandReloadColt 0.52
"""


def parsed_machine() -> animstates.StateMachine:
    files = {"animations/animationstates.con": ANIM_CON}
    return animstates.parse(lambda p: files.get(p.lower()))


class ResolveFamiliesTests(unittest.TestCase):
    def test_idle_resolves_the_1p_clip_not_the_3p_one(self) -> None:
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")

        self.assertEqual("Animations/1p/Thompson/1PStandAim.baf",
                         resolved["idle"]["ref"].path)
        self.assertAlmostEqual(0.1, resolved["idle"]["ref"].speed)
        self.assertTrue(report["idle"]["loop"])

    def test_reload_carries_its_declared_weapon_channel(self) -> None:
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")

        self.assertEqual("Animations/Weapons/Thompson/ThompsonReload.baf",
                         resolved["reload"]["weaponRef"].path)
        self.assertEqual("WeaponReloadThompson",
                         resolved["reload"]["weaponState"])
        # The Thompson's fire state declares no weapon state (only fireOnce
        # weapons and the bazooka do) — the channel must not be invented.
        self.assertIsNone(resolved["fire"]["weaponRef"])

    def test_a_missing_family_records_its_error_and_is_skipped(self) -> None:
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")

        self.assertNotIn("walk", resolved)
        self.assertIn("Ub_WalkForwardThompson", report["walk"]["error"])

    def test_tweaking_lines_replace_the_declared_speed_by_state_name(self) -> None:
        machine = parsed_machine()

        colt = machine.state("Ub_StandReloadColt")
        thompson = machine.state("Ub_StandReloadThompson")
        self.assertAlmostEqual(0.6, colt.clip_1p().speed)
        self.assertAlmostEqual(0.52, colt.clip_3p().speed)
        # The tweak named the Colt; the Thompson keeps its declaration.
        self.assertAlmostEqual(0.4, thompson.clip_1p().speed)

    def test_morph_factor_and_return_state_are_read_and_cloned(self) -> None:
        machine = parsed_machine()

        aim = machine.state("Ub_StandAimThompson")
        self.assertAlmostEqual(0.7, aim.morph_factor)
        self.assertEqual("Ub_StandAimThompson", aim.return_to)
        colt = machine.state("Ub_StandReloadColt")
        self.assertAlmostEqual(3.0, colt.morph_factor)
        self.assertEqual("Ub_StandAimColt", colt.return_to)
        self.assertEqual("_POSE_", machine.state("Ub_FireThompson").return_to)
        self.assertAlmostEqual(5.0, machine.state("WeaponReloadThompson").morph_factor)

    def test_a_cloned_state_renames_its_weapon_channel(self) -> None:
        machine = parsed_machine()

        state = machine.state("Ub_StandReloadColt")
        self.assertIsNotNone(state)
        self.assertEqual("WeaponReloadColt", state.weapon_state)


BOLT_CON = """
AnimationStateMachine.createState Ub_StandAimNo4
AnimationStateMachine.addAnimation Animations/3p/No4/3PStandAim.baf 0.8 1
AnimationStateMachine.addAnimation Animations/1p/No4/1PStandAim.baf 0.36 1
AnimationStateMachine.returnToState Ub_StandAimNo4

AnimationStateMachine.createState Ub_FireNo4
AnimationStateMachine.addAnimation Animations/3p/No4/3PFire.baf 1.0 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/1p/No4/1PFireNo4.baf 2.95 c_AsmPlayOnce
AnimationStateMachine.returnToState Ub_StandBoltOperateMosinNagant

AnimationStateMachine.createState Ub_LieFireNo4
AnimationStateMachine.addAnimation Animations/3p/No4/3PLieFire.baf 1.0 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/1p/No4/1PLieFireNo4.baf 2.0 c_AsmPlayOnce
AnimationStateMachine.returnToState Ub_LieBoltOperateMosinNagant

AnimationStateMachine.createState WeaponReloadMosinNagant
AnimationStateMachine.addAnimation Animations/Weapons/No4/No4Reload.baf 1.67 c_AsmPlayOnce

AnimationStateMachine.createState Ub_StandBoltOperateMosinNagant
AnimationStateMachine.setOtherState c_AsmWeaponState WeaponReloadMosinNagant
AnimationStateMachine.addAnimation Animations/3p/No4/3PReloadNo4.baf 0.52 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/1p/No4/1PReloadNo4.baf 1.05 c_AsmPlayOnce
AnimationStateMachine.returnToState _POSE_

AnimationStateMachine.createState Ub_LieBoltOperateMosinNagant
AnimationStateMachine.addAnimation Animations/3p/No4/3PLieReloadNo4.baf 0.52 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/1p/No4/1PLieReloadNo4.baf 0.9 c_AsmPlayOnce
AnimationStateMachine.returnToState _POSE_
"""


class BoltCycleFamilyTests(unittest.TestCase):
    """FH / FHSW fire into `Ub_StandBoltOperate<W>`, not the reload state.

    The family used to be missing, so the viewer fired the clip and then had
    nothing to play: the owner's British No.4 never worked its bolt.
    """

    def setUp(self) -> None:
        files = {"animations/animationstates.con": BOLT_CON}
        machine = animstates.parse(lambda p: files.get(p.lower()))
        self.resolved, self.report = extract_viewmodel.resolve_families(
            machine, "No4")

    def test_the_bolt_family_is_the_state_the_fire_state_names(self) -> None:
        # The fire state names `...MosinNagant`, not `...No4`: the engine
        # plays the state it is told to, so that is the clip baked.
        self.assertEqual("Ub_StandBoltOperateMosinNagant",
                         self.report["bolt"]["state"])
        self.assertEqual("Animations/1p/No4/1PReloadNo4.baf",
                         self.resolved["bolt"]["ref"].path)
        self.assertAlmostEqual(1.05, self.resolved["bolt"]["ref"].speed)
        self.assertFalse(self.report["bolt"]["loop"])

    def test_the_bolt_carries_its_weapon_channel(self) -> None:
        self.assertEqual("Animations/Weapons/No4/No4Reload.baf",
                         self.resolved["bolt"]["weaponRef"].path)

    def test_the_prone_shot_has_its_own_bolt(self) -> None:
        self.assertEqual("Animations/1p/No4/1PLieReloadNo4.baf",
                         self.resolved["proneBolt"]["ref"].path)

    def test_the_fire_report_still_names_the_state_it_returns_to(self) -> None:
        # arms-rig.js keys fireReturnsToBolt off this string.
        self.assertIn("boltoperate", self.report["fire"]["returnTo"].lower())

    def test_a_reload_returning_rifle_gets_no_bolt_family(self) -> None:
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")
        self.assertNotIn("bolt", resolved)
        self.assertNotIn("bolt", report)


class FidgetFamilyTests(unittest.TestCase):
    """The idle fidgets resolve from the aim state's `addIdle` registrations
    (ANIM-6), named `idle1..idleN` in registration order, each one-shot at
    its own (tweaked) rate with the aim state as its return."""

    def test_registered_fidgets_resolve_in_order(self) -> None:
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")

        self.assertEqual(
            ["Animations/WeaponHandling/1p/Thompson/1pIdle1Thompson.baf",
             "Animations/WeaponHandling/1p/Thompson/1pIdle2Thompson.baf"],
            [resolved[f"idle{index}"]["ref"].path for index in (1, 2)])
        self.assertFalse(resolved["idle1"]["loop"])
        self.assertAlmostEqual(0.52, resolved["idle1"]["ref"].speed)
        self.assertAlmostEqual(0.39, resolved["idle2"]["ref"].speed)

    def test_the_fidget_report_carries_its_state_and_return(self) -> None:
        _resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")

        self.assertEqual("Ub_IdleThompson1", report["idle1"]["fidgetState"])
        self.assertEqual("Ub_StandAimThompson", report["idle1"]["returnTo"])
        # The engine's constructor default when a state never sets one — the
        # fidget states declare no setMorphFactor of their own.
        self.assertAlmostEqual(5.0, report["idle1"]["morphFactor"])

    def test_a_registered_but_undeclared_fidget_is_skipped(self) -> None:
        # The fixture registers idle3 and never declares it; the engine
        # cannot play what the machine does not hold, so the export skips it
        # rather than inventing a clip.
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Thompson")

        self.assertNotIn("idle3", resolved)
        self.assertIn("Ub_IdleThompson3", report["idle3"]["error"])

    def test_a_cloned_weapon_reports_its_unclonable_fidgets(self) -> None:
        # The Colt clone's aim state carries substituted registrations
        # (Ub_IdleColt1..3) the fixture never declares: skip, with the gap
        # visible in the report rather than silently dropped.
        resolved, report = extract_viewmodel.resolve_families(
            parsed_machine(), "Colt")

        self.assertNotIn("idle1", resolved)
        self.assertIn("Ub_IdleColt1", report["idle1"]["error"])


class WeaponBlockHeatTests(unittest.TestCase):
    """`weaponStats.heat`: the heat words a hand weapon declares, under their
    FireArms names, which is what the hand path builds its `FireState` from
    (ledger GUN-14, GUN-15)."""

    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        # Desert Combat's M249 and GrenadeAllies and vanilla's Thompson, the
        # lines that matter.
        library.add_con("Objects/HandWeapons/M249/Objects.con", """
ObjectTemplate.create HandFireArms M249
ObjectTemplate.roundOfFire 13.5
objectTemplate.heatAddWhenFire 0.0265
objectTemplate.coolDownPerSec 0.3
objectTemplate.timeDelayOnOverHeat 2
ObjectTemplate.create HandFireArms GrenadeAllies
ObjectTemplate.velocityDependentOnHeat 1
ObjectTemplate.heatAddWhenFire 0.03
ObjectTemplate.create HandFireArms Thompson
ObjectTemplate.roundOfFire 10
""")
        return library

    def test_a_machine_gun_carries_its_heat(self) -> None:
        block = extract_viewmodel.weapon_block(self.library().object("M249"))
        self.assertEqual({"heatAddWhenFire": 0.0265, "coolDownPerSec": 0.3,
                          "timeDelayOnOverheat": 2.0}, block["heat"])
        self.assertEqual(13.5, block["roundOfFire"])

    def test_a_grenade_carries_its_charge_flag(self) -> None:
        block = extract_viewmodel.weapon_block(self.library().object("GrenadeAllies"))
        self.assertEqual({"heatAddWhenFire": 0.03, "velocityDependentOnHeat": True},
                         block["heat"])

    def test_a_rifle_has_no_heat_block(self) -> None:
        self.assertNotIn("heat", extract_viewmodel.weapon_block(self.library().object("Thompson")))


class ClipTimesTests(unittest.TestCase):
    """The engine has no frame rate: a pass of a clip lasts 1/|speed| s
    (`updateState` advances a normalized phase by dt*speed and
    `applyOnSkeleton` maps frac(phase)*N onto the frames)."""

    def test_a_pass_lasts_one_over_speed_whatever_the_frame_count(self) -> None:
        self.assertAlmostEqual(10.0, extract_viewmodel.clip_span(0.1))
        self.assertAlmostEqual(0.1, extract_viewmodel.clip_span(10.0))
        self.assertAlmostEqual(2.5, extract_viewmodel.clip_span(0.4))

    def test_a_loop_has_frames_intervals_and_a_wrap_key(self) -> None:
        times = extract_viewmodel.clip_times(13, 0.1, loop=True)

        # 13 frames, 13 intervals (12 -> 0 is one of them), a 14th key at the
        # full span holding frame 0 again so LoopRepeat crosses the wrap.
        self.assertEqual(14, len(times))
        self.assertAlmostEqual(0.0, times[0])
        self.assertAlmostEqual(10.0, times[-1])
        self.assertAlmostEqual(10.0 / 13, times[1])

    def test_a_one_shot_has_frames_minus_one_intervals(self) -> None:
        times = extract_viewmodel.clip_times(29, 1.0, loop=False)

        self.assertEqual(29, len(times))
        self.assertAlmostEqual(1.0, times[-1])
        self.assertAlmostEqual(1.0 / 28, times[1])

    def test_a_negative_speed_is_a_reversed_clip_not_reversed_time(self) -> None:
        times = extract_viewmodel.clip_times(17, -0.5, loop=True)

        self.assertGreater(times[-1], 0.0)
        self.assertAlmostEqual(2.0, times[-1])

    def test_a_single_frame_clip_still_has_a_span(self) -> None:
        times = extract_viewmodel.clip_times(1, 1.0, loop=False)

        self.assertEqual(2, len(times))
        self.assertGreater(times[-1], times[0])

    def test_the_loop_flag_is_read_off_the_declaration(self) -> None:
        self.assertTrue(extract_viewmodel.clip_loops(
            animstates.ClipRef("a.baf", 1.0, "1")))
        self.assertTrue(extract_viewmodel.clip_loops(
            animstates.ClipRef("a.baf", 1.0, "c_AsmLooping")))
        self.assertFalse(extract_viewmodel.clip_loops(
            animstates.ClipRef("a.baf", 1.0, "c_AsmPlayOnce")))
        self.assertFalse(extract_viewmodel.clip_loops(
            animstates.ClipRef("a.baf", 1.0, "0")))


class WeaponPartLocalsTests(unittest.TestCase):
    """A weapon-channel clip poses the weapon skeleton in the raw file
    convention; the exported bound parts sit relative to the main bone in the
    parsed one. Frame 0 of a clip that stores the rest pose must therefore
    reproduce `skeleton.relative(part, main)` exactly — the identity that
    pins the conjugation (measured on the real ThompsonReload to 0.1 mm)."""

    def _skeleton(self) -> ske.Skeleton:
        # A raw rest rotation about X and a translation with a z component,
        # so a dropped or double-applied Z-mirror cannot pass.
        c, s = math.cos(math.radians(90.0)), math.sin(math.radians(90.0))
        rot_x90 = ((1.0, 0.0, 0.0), (0.0, c, -s), (0.0, s, c))
        return ske.parse(pack_ske([
            ("Bip01 R Hand", -1, IDENTITY, (0.305, 0.0, 0.0)),
            ("Thompson", 0, IDENTITY, (0.05, 0.02, 0.0)),
            ("magasin", 1, rot_x90, (0.0, 0.076, 0.085)),
        ]), "Thompson.ske")

    def _rest_clip(self):
        # Stored quats decode via the conjugate, so the stored image of the
        # raw X+90 rotation is (-sin45, 0, 0, cos45).
        from bf42 import baf
        w = int(math.cos(math.radians(45.0)) * 32767)
        x = -int(math.sin(math.radians(45.0)) * 32767)
        pos = tuple(int(v * 32768) for v in (0.0, 0.076, 0.085))
        return baf.parse(pack_baf([("magasin", (x, 0, 0, w), pos)]),
                         "reload.baf")

    def test_frame_zero_of_a_rest_clip_is_the_static_relative(self) -> None:
        skeleton = self._skeleton()
        clip = self._rest_clip()

        rel = extract_viewmodel.weapon_part_locals(clip, skeleton, 1, 0)

        want_rot, want_t = skeleton.relative(2, 1)
        got_rot, got_t = rel["magasin"]
        for i in range(3):
            self.assertAlmostEqual(want_t[i], got_t[i], places=3)
            for j in range(3):
                self.assertAlmostEqual(want_rot[i][j], got_rot[i][j], places=3)

    def test_a_bone_the_clip_leaves_alone_rides_its_rest(self) -> None:
        skeleton = self._skeleton()
        clip = self._rest_clip()

        rel = extract_viewmodel.weapon_part_locals(clip, skeleton, 1, 0)

        # The main bone relative to itself is identity.
        rot, t = rel["thompson"]
        for i in range(3):
            self.assertAlmostEqual(0.0, t[i], places=5)
            for j in range(3):
                self.assertAlmostEqual(IDENTITY[i][j], rot[i][j], places=5)


class WeaponMainLocalTests(unittest.TestCase):
    """The grip wrapper, one frame at a time.

    `weapon_part_locals` re-expresses bound parts against the main bone, which
    divides out whatever the clip does to the main bone itself — and for the
    two grenades, the Detonator, the Landmine, the MedPack, the JohnsonLMG's
    reload, the M1Garand and the Type5 that motion is the point: it is the whole
    weapon moving in the hand. `weapon_main_local` is where it lands instead,
    and the identity that pins it is the same one `weapon_attachment` answers:
    a clip frame holding the rest pose must reproduce the static weld.
    """

    def _skeleton(self) -> ske.Skeleton:
        c, s = math.cos(math.radians(90.0)), math.sin(math.radians(90.0))
        rot_x90 = ((1.0, 0.0, 0.0), (0.0, c, -s), (0.0, s, c))
        return ske.parse(pack_ske([
            ("Bip01 R Hand", -1, IDENTITY, (0.305, 0.0, 0.0)),
            ("Base", 0, rot_x90, (0.099, 0.046, 0.032)),
            ("sprint", 1, IDENTITY, (0.011, 0.062, 0.012)),
        ]), "GrenadeAllies.ske")

    def _clip(self, quat, pos):
        from bf42 import baf
        return baf.parse(pack_baf([("Base", quat, pos)]), "GrenadeAlliesFire.baf")

    def test_a_rest_frame_reproduces_the_static_weld(self) -> None:
        skeleton = self._skeleton()
        # The stored image of the raw X+90 rest, the same conjugate the
        # WeaponPartLocals tests above rely on.
        w = int(math.cos(math.radians(45.0)) * 32767)
        x = -int(math.sin(math.radians(45.0)) * 32767)
        clip = self._clip((x, 0, 0, w),
                          tuple(int(v * 32768) for v in (0.099, 0.046, 0.032)))

        got_rot, got_t = extract_viewmodel.weapon_main_local(clip, skeleton, 1, 0)
        want_rot, want_t = pose.weapon_attachment(skeleton, 1, clip_posed=True)

        for i in range(3):
            self.assertAlmostEqual(want_t[i], got_t[i], places=3)
            for j in range(3):
                self.assertAlmostEqual(want_rot[i][j], got_rot[i][j], places=3)

    def test_a_moved_frame_carries_the_weapon_out_of_the_hand(self) -> None:
        # The release: the grenade's main bone leaves the palm. The wrapper's
        # translation has to move with it, in metres, and not be cancelled the
        # way the bound parts' main-relative transforms are.
        skeleton = self._skeleton()
        w = int(math.cos(math.radians(45.0)) * 32767)
        x = -int(math.sin(math.radians(45.0)) * 32767)
        thrown = (-0.360, -0.045, 0.233)
        clip = self._clip((x, 0, 0, w),
                          tuple(int(v * 32768) for v in thrown))

        _rot, got_t = extract_viewmodel.weapon_main_local(clip, skeleton, 1, 0)

        # Raw z becomes the wrapper's z unchanged: the clip is already in the
        # file convention, so nothing is conjugated on this path.
        self.assertAlmostEqual(thrown[0], got_t[0], places=3)
        self.assertAlmostEqual(thrown[1], got_t[1], places=3)
        self.assertAlmostEqual(thrown[2], got_t[2], places=3)
        # And it really has left: the static weld is 0.11 m from the hand root,
        # this is half a metre away.
        _srot, still = pose.weapon_attachment(skeleton, 1, clip_posed=True)
        moved = math.dist(got_t, still)
        self.assertGreater(moved, 0.4)


class SoldierViewConstantsTests(unittest.TestCase):
    def test_constants_are_read_through_the_include(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/US/Objects.con",
                        "ObjectTemplate.create BFSoldier US\n"
                        "include ../Common/CommonSoldierData.inc\n")
        objects = FakeObjects({
            "Objects/Soldiers/US/Objects.con":
                b"ObjectTemplate.create BFSoldier US\n"
                b"include ../Common/CommonSoldierData.inc\n",
            "Objects/Soldiers/Common/CommonSoldierData.inc":
                b"objectTemplate.center1pHands -0.12/-1.56/0.1\n"
                b"ObjectTemplate.set1pFov 0.47\n",
        })

        view = extract_viewmodel.soldier_view_constants(
            objects, library.object("US"))

        self.assertEqual([-0.12, -1.56, 0.1], view["center1pHands"])
        self.assertAlmostEqual(0.47, view["fov1p"])

    def test_missing_files_yield_nones_not_a_crash(self) -> None:
        library = ObjectLibrary()
        library.add_con("gone.con", "ObjectTemplate.create BFSoldier X\n")

        view = extract_viewmodel.soldier_view_constants(
            FakeObjects({}), library.object("X"))

        self.assertIsNone(view["center1pHands"])
        self.assertIsNone(view["fov1p"])


VIEWMODEL_GLB = (Path(__file__).resolve().parents[1]
                 / "viewer" / "models" / "viewmodels"
                 / "USSoldier__Thompson.fp.glb")


@unittest.skipUnless(VIEWMODEL_GLB.exists(), "Thompson viewmodel not extracted")
class ThompsonViewmodelArtifactTests(unittest.TestCase):
    """The committed artifact itself: the clips, the meshes and the weld the
    rest of this file asserts piecewise, checked end to end."""

    @classmethod
    def setUpClass(cls) -> None:
        data = VIEWMODEL_GLB.read_bytes()
        json_size, kind = struct.unpack_from("<II", data, 12)
        assert kind == 0x4E4F534A
        cls.doc = json.loads(data[20:20 + json_size])
        cls.names = [node.get("name") for node in cls.doc["nodes"]]

    def test_every_family_bakes_an_animation(self) -> None:
        # The six standing families, the eight stance ones (`Ub_Crouch*` /
        # `Ub_Lie*`, which the engine declares per weapon and which the page
        # used to substitute the standing aim for), then the three fidgets.
        self.assertEqual(
            ["idle", "walk", "run", "fire", "reload", "deploy",
             "crouch", "crouchWalk", "prone", "crawl",
             "proneFire", "proneReload", "crouchDeploy", "proneDeploy",
             "idle1", "idle2", "idle3"],
            [anim["name"] for anim in self.doc["animations"]])

    def test_crouch_is_the_standing_aim_clip_at_the_crouch_rate(self) -> None:
        # `Ub_CrouchThompson` names `1PStandAimThompson.baf` -- the same clip
        # `Ub_StandAimThompson` names -- and differs only in its rate, 0.33
        # against 0.1. So the two baked animations hold the same frames over
        # different spans: 3.0303 s against 10 s.
        report = json.loads((VIEWMODEL_GLB.parent
                             / "USSoldier__Thompson.fp.report.json").read_text())
        idle, crouch = report["clips"]["idle"], report["clips"]["crouch"]
        self.assertEqual(idle["upperClip"], crouch["upperClip"])
        self.assertEqual(idle["frames"], crouch["frames"])
        self.assertEqual(0.1, idle["speed"])
        self.assertEqual(0.33, crouch["speed"])
        self.assertAlmostEqual(10.0, idle["duration"], places=3)
        self.assertAlmostEqual(3.0303, crouch["duration"], places=3)

    def test_prone_has_clips_of_its_own(self) -> None:
        # Unlike crouch, lying down is not a rate change: four of its families
        # name clips nothing else uses.
        report = json.loads((VIEWMODEL_GLB.parent
                             / "USSoldier__Thompson.fp.report.json").read_text())
        clips = report["clips"]
        for key, stem in (("prone", "1pLieAimThompson.baf"),
                          ("crawl", "1pCrawlThompson.baf"),
                          ("proneFire", "1PLieFireThompson.baf"),
                          ("proneReload", "1PLieReloadThompson.baf")):
            self.assertTrue(clips[key]["upperClip"].endswith(stem),
                            f"{key}: {clips[key]['upperClip']}")

    def test_the_three_first_person_meshes_are_skinned(self) -> None:
        skinned = [self.names[i] for i, node in enumerate(self.doc["nodes"])
                   if node.get("skin") is not None]
        self.assertEqual(
            ["USSoldier1PBody", "1pUSSoldierRightHand", "1pUSSoldierLeftHand"],
            skinned)
        self.assertEqual(3, len(self.doc["skins"]))

    def test_the_weapon_is_welded_under_the_right_hand(self) -> None:
        hand = self.names.index("Bip01 R Hand")
        grip = self.names.index("Thompson grip")
        self.assertIn(grip, self.doc["nodes"][hand]["children"])
        self.assertEqual("Bip01 R Hand",
                         self.doc["nodes"][grip]["extras"]["weldBone"])

    def test_the_reload_moves_the_magazine(self) -> None:
        mag = self.names.index("ThompsonMagasin")
        reload_anim = next(anim for anim in self.doc["animations"]
                           if anim["name"] == "reload")
        channel = next(
            ch for ch in reload_anim["channels"]
            if ch["target"]["node"] == mag
            and ch["target"]["path"] == "translation")
        sampler = reload_anim["samplers"][channel["sampler"]]
        # 181 frames of magazine travel, not a two-key constant.
        self.assertEqual(
            181, self.doc["accessors"][sampler["output"]]["count"])

    def test_the_mount_constants_ride_in_the_extras(self) -> None:
        extras = self.doc["extras"]
        self.assertEqual([-0.12, -1.56, 0.1], extras["view"]["center1pHands"])
        self.assertAlmostEqual(0.47, extras["view"]["fov1p"])
        self.assertEqual([-0.01, -0.04, 0.09],
                         extras["view"]["soldierCameraPosition"])
        self.assertIn("idle", extras["clips"])
        self.assertAlmostEqual(0.1, extras["clips"]["idle"]["speed"])
        # One pass of the aim sway is 1/0.1 = 10 s in the engine, and the
        # blend into that state runs at its `setMorphFactor` 0.7 per second.
        self.assertAlmostEqual(10.0, extras["clips"]["idle"]["duration"])
        self.assertAlmostEqual(0.7, extras["clips"]["idle"]["morphFactor"])
        self.assertEqual("1/speed", extras["clipTiming"])


class TestModRigSelection(unittest.TestCase):
    """A mod's rigs come from its kits.json, and the tree says what it holds."""

    KITS = {"kits": [
        {"soldiers": ["USSoldier"], "levels": ["Basra"],
         "items": [{"template": "M16"}, {"template": "Binoculars"}]},
        {"soldiers": ["USSoldier"], "levels": ["Kursk"],
         "items": [{"template": "binoculars"}, {"template": "Thompson"}]},
        {"soldiers": ["IraqSoldier"], "levels": None,
         "items": [{"template": "AK47"}]},
    ]}

    def test_pairs_once_ignoring_case(self):
        self.assertEqual(extract_viewmodel.kit_pairs(self.KITS), [
            ("USSoldier", "M16"), ("USSoldier", "Binoculars"),
            ("USSoldier", "Thompson"), ("IraqSoldier", "AK47")])

    def test_pairs_only_for_levels_the_tree_bakes(self):
        # Kursk is an inherited vanilla level the mod tree does not hold; a
        # kit with no levels at all is kept.
        self.assertEqual(extract_viewmodel.kit_pairs(self.KITS, {"basra"}), [
            ("USSoldier", "M16"), ("USSoldier", "Binoculars"), ("IraqSoldier", "AK47")])

    def test_a_rolled_item_asks_for_each_variant_not_the_bundle(self):
        # FHSW's `RandomGBTankcommander` is never held (ledger KIT-1); each
        # variant plays its own numbered states, so each gets arms.
        kits = {"kits": [{"soldiers": ["FrenchSoldier"], "levels": None, "items": [
            {"template": "RandomGBTankcommander",
             "variants": ["RandomGBTankcommander1", None, "RandomGBTankcommander3"]},
            {"template": "KnifeAllies"}]}]}
        self.assertEqual(extract_viewmodel.kit_pairs(kits), [
            ("FrenchSoldier", "RandomGBTankcommander1"),
            ("FrenchSoldier", "RandomGBTankcommander3"),
            ("FrenchSoldier", "KnifeAllies")])

    def test_a_pad_kit_is_held_in_every_side_s_sleeves(self):
        # DC 0.7's M82 kit lies on pads anyone can take (`pickupSoldiers`,
        # extract_kits.py); its wearer is the US soldier.
        kits = {"kits": [{"soldiers": ["USSoldier"], "levels": ["Basra"],
                          "pickupSoldiers": ["IraqSoldier", "USSoldier"],
                          "items": [{"template": "M82Sniper"}]}]}
        self.assertEqual(extract_viewmodel.kit_pairs(kits), [
            ("USSoldier", "M82Sniper"), ("IraqSoldier", "M82Sniper")])

    def test_index_lists_every_rig_in_the_tree(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            for name in ("USSoldier__M16.fp.glb", "IraqSoldier__AK47.fp.glb",
                         "IraqSoldier__AK47.fp.glb.gz", "USSoldier__M16.fp.report.json"):
                (out / name).write_bytes(b"")
            self.assertEqual(extract_viewmodel.write_index(out),
                             ["IraqSoldier__AK47", "USSoldier__M16"])
            self.assertEqual(json.loads((out / "index.json").read_text()),
                             ["IraqSoldier__AK47", "USSoldier__M16"])


if __name__ == "__main__":
    unittest.main()
