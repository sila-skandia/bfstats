from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import animstates  # noqa: E402


def machine_from(files: dict[str, str]) -> animstates.StateMachine:
    lowered = {key.lower(): value for key, value in files.items()}

    def read(path: str) -> str | None:
        return lowered.get(path.lower())

    return animstates.parse(read)


ROOT = """\
AnimationStateMachine.createState Ub_StandAimThompson
AnimationStateMachine.addAnimation Animations/StandWalkRun/3p/Thompson/3PStandAimUpperThompson.baf 0.8 1
AnimationStateMachine.addAnimation Animations/StandWalkRun/1p/Thompson/1PStandAimThompson.baf 0.1 1
include copyToallWeapons.inc Thompson
AnimationStateMachine.createState Ub_CrouchThompson
AnimationStateMachine.addAnimation Animations/Crouch/3p/Thompson/3PCrouchBreathUpperThompson.baf 1 1
AnimationStateMachine.addAnimation Animations/WeaponHandling/1p/Thompson/1PIdleThompson.baf 1 1
include copyToallWeapons.inc Thompson
AnimationStateMachine.createState Ub_LieThompson
AnimationStateMachine.addAnimation Animations/Lie/3p/Thompson/3PLieBreathUpperThompson.baf 1 1
AnimationStateMachine.addAnimation Animations/WeaponHandling/1p/Thompson/1PIdleThompson.baf 1 1
include copyToallWeapons.inc Thompson
AnimationStateMachine.createState Lb_Crouch
AnimationStateMachine.addAnimation Animations/Crouch/LowerBody/3PCrouchBreathLower.baf 1 1
AnimationStateMachine.createState Lb_Lie
AnimationStateMachine.addAnimation Animations/Lie/LowerBody/3PLieBreathLower.baf 1 1
"""

COPY_INC = """\
AnimationStateMachine.copyState2 Binoculars v_arg1
AnimationStateMachine.copyState2 JohnsonLMG v_arg1
AnimationStateMachine.copyState2 No4 v_arg1
AnimationStateMachine.copyState2 No4Sniper v_arg1
AnimationStateMachine.copyState K98 v_arg1 No4 1.0 K98 1.0
"""


class CloneResolutionTests(unittest.TestCase):
    """The vanilla layout: only the Thompson's state is written longhand;
    every other weapon is a `copyState2` clone (name substituted into state
    name and clip paths) or a `copyState` with explicit 3P/1P donors."""

    def setUp(self) -> None:
        self.machine = machine_from({
            "animations/AnimationStates.con": ROOT,
            "animations/copyToallWeapons.inc": COPY_INC,
        })

    def test_thompson_is_declared_longhand(self) -> None:
        clip = self.machine.clip_3p("Ub_StandAim", "Thompson")
        self.assertEqual(
            "Animations/StandWalkRun/3p/Thompson/3PStandAimUpperThompson.baf",
            clip.path)

    def test_copystate2_substitutes_the_weapon_into_the_clip_path(self) -> None:
        for weapon in ("Binoculars", "JohnsonLMG", "No4Sniper"):
            clip = self.machine.clip_3p("Ub_StandAim", weapon)
            self.assertIsNotNone(clip, weapon)
            self.assertEqual(
                f"Animations/StandWalkRun/3p/{weapon}/"
                f"3PStandAimUpper{weapon}.baf",
                clip.path, weapon)

    def test_copystate2_keeps_the_first_person_clip_distinct(self) -> None:
        state = self.machine.state("Ub_StandAimJohnsonLMG")
        first_person = [c for c in state.clips if c.is_first_person]
        self.assertEqual(
            ["Animations/StandWalkRun/1p/JohnsonLMG/"
             "1PStandAimJohnsonLMG.baf"],
            [c.path for c in first_person])

    def test_copystate_borrows_the_3p_donor_but_keeps_its_own_1p(self) -> None:
        # The K98 ships no 3P StandAim clips of its own; the state machine
        # points it at the No4's while the 1P donor stays K98.
        state = self.machine.state("Ub_StandAimK98")
        self.assertIsNotNone(state)
        clip = state.clip_3p()
        self.assertEqual(
            "Animations/StandWalkRun/3p/No4/3PStandAimUpperNo4.baf",
            clip.path)
        first_person = [c.path for c in state.clips if c.is_first_person]
        self.assertEqual(
            ["Animations/StandWalkRun/1p/K98/1PStandAimK98.baf"],
            first_person)

    def test_no4sniper_and_no4_share_the_no4_clip_set(self) -> None:
        # No4Sniper is a plain clone, so its substituted path names a real
        # per-weapon folder; the No4 donor case above is the config-level
        # sharing that a path convention alone would miss.
        self.assertEqual(
            self.machine.clip_3p("Ub_StandAim", "No4Sniper").path
            .replace("No4Sniper", "No4"),
            self.machine.clip_3p("Ub_StandAim", "No4").path)

    def test_weapons_lists_every_clone(self) -> None:
        self.assertEqual(
            ["Binoculars", "JohnsonLMG", "K98", "No4", "No4Sniper",
             "Thompson"],
            self.machine.weapons("Ub_StandAim"))

    def test_crouch_and_lie_states_clone_the_same_way_as_standaim(self) -> None:
        # The crouch and prone idle families — `Ub_Crouch<W>` / `Ub_Lie<W>`,
        # there is no separate CrouchAim/LieAim in vanilla — sit behind the
        # same include replay, so every clone must resolve per stance.
        for prefix, folder, clip_stem in (
                ("Ub_Crouch", "Crouch", "3PCrouchBreathUpper"),
                ("Ub_Lie", "Lie", "3PLieBreathUpper")):
            for weapon in ("Binoculars", "JohnsonLMG", "No4Sniper"):
                clip = self.machine.clip_3p(prefix, weapon)
                self.assertIsNotNone(clip, f"{prefix}{weapon}")
                self.assertEqual(
                    f"Animations/{folder}/3p/{weapon}/{clip_stem}{weapon}.baf",
                    clip.path, f"{prefix}{weapon}")

    def test_the_donor_rule_applies_per_stance(self) -> None:
        # `copyState K98 ... No4 ...` inside the include replays after every
        # longhand block, so the K98 borrows the No4's crouch and lie clips
        # exactly as it borrows the StandAim one.
        self.assertEqual(
            "Animations/Crouch/3p/No4/3PCrouchBreathUpperNo4.baf",
            self.machine.clip_3p("Ub_Crouch", "K98").path)
        self.assertEqual(
            "Animations/Lie/3p/No4/3PLieBreathUpperNo4.baf",
            self.machine.clip_3p("Ub_Lie", "K98").path)

    def test_crouch_and_lie_lower_body_states_resolve(self) -> None:
        for name, path in (
                ("Lb_Crouch", "Animations/Crouch/LowerBody/3PCrouchBreathLower.baf"),
                ("Lb_Lie", "Animations/Lie/LowerBody/3PLieBreathLower.baf")):
            state = self.machine.state(name)
            self.assertIsNotNone(state, name)
            self.assertEqual(path, state.clip_3p().path)

    def test_missing_include_is_recorded_not_fatal(self) -> None:
        machine = machine_from({
            "animations/AnimationStates.con":
                ROOT + "run AnimationStatesMod\n",
            "animations/copyToallWeapons.inc": COPY_INC,
        })
        self.assertIn("AnimationStatesMod", machine.missing)
        self.assertEqual(6, len(machine.weapons("Ub_StandAim")))


ANIM_CON = """\
AnimationStateMachine.createState Ub_StandAimThompson
AnimationStateMachine.addAnimation Animations/StandWalkRun/3p/Thompson/3PStandAimUpperThompson.baf 0.8 1
AnimationStateMachine.addAnimation Animations/StandWalkRun/1p/Thompson/1PStandAimThompson.baf 0.1 1
AnimationStateMachine.addIdle Ub_IdleThompson1
AnimationStateMachine.addIdle Ub_IdleThompson2
AnimationStateMachine.addIdle Ub_IdleThompson3
rem *** AnimationStateMachine.addIdle Ub_IdleThompson4
AnimationStateMachine.addTransitionOne c_PIFire 0.5 1 Ub_Fire
include copyToallWeapons.inc Thompson

AnimationStateMachine.createState Ub_IdleThompson1
AnimationStateMachine.addAnimation Animations/WeaponHandling/3p/Thompson/3pIdle1Thompson.baf 1.0 c_AsmPlayOnce
AnimationStateMachine.addAnimation Animations/WeaponHandling/1p/Thompson/1pIdle1Thompson.baf 1.0 c_AsmPlayOnce
AnimationStateMachine.addTransitionWhenDone Ub_StandAimThompson
include copyToallWeapons.inc Thompson

AnimationStateMachine.set1pAnimationSpeed Ub_IdleColt1 0.52
"""

ANIM_FILES = {
    "animations/animationstates.con": ANIM_CON,
    "animations/copytoallweapons.inc": "AnimationStateMachine.copyState2 Colt v_arg1\n",
}


class AddIdleTests(unittest.TestCase):
    """The fidget registration: `addIdle Ub_Idle<W>1..3` on the aim states
    (ANIM-6 — the 4-7 s dwell that picks one and returns through
    `addTransitionWhenDone`). The engine's own `Idle4` line sits commented
    out in the vanilla data and must stay unregistered."""

    def setUp(self) -> None:
        self.machine = machine_from(ANIM_FILES)

    def test_addidle_registers_on_the_aim_state_in_declaration_order(self) -> None:
        self.assertEqual(
            ["Ub_IdleThompson1", "Ub_IdleThompson2", "Ub_IdleThompson3"],
            self.machine.state("Ub_StandAimThompson").idles)

    def test_a_commented_out_addidle_is_not_a_registration(self) -> None:
        # `rem *** AnimationStateMachine.addIdle Ub_IdleThompson4` — the
        # vanilla file keeps a fourth fidget switched off.
        self.assertEqual(
            ["Ub_IdleThompson1", "Ub_IdleThompson2", "Ub_IdleThompson3"],
            self.machine.state("Ub_StandAimThompson").idles)

    def test_the_fidget_state_itself_resolves_like_any_other(self) -> None:
        state = self.machine.state("Ub_IdleThompson1")
        clip = state.clip_1p()
        self.assertEqual(
            "Animations/WeaponHandling/1p/Thompson/1pIdle1Thompson.baf",
            clip.path)
        self.assertTrue(clip.is_first_person)

    def test_addidle_clones_with_the_weapon_substitution(self) -> None:
        # `Ub_IdleThompson1` -> `Ub_IdleColt1` on the cloned aim state, so the
        # engine picks per-weapon fidgets for every clone as it does for the
        # longhand Thompson.
        self.assertEqual(
            ["Ub_IdleColt1", "Ub_IdleColt2", "Ub_IdleColt3"],
            self.machine.state("Ub_StandAimColt").idles)
        self.assertEqual(
            "Animations/WeaponHandling/1p/Colt/1pIdle1Colt.baf",
            self.machine.state("Ub_IdleColt1").clip_1p().path)

    def test_the_tweaking_speed_lands_on_the_cloned_fidget(self) -> None:
        # 1pAnimationsTweaking.con names the state outright; the clone's 1P
        # clip must pick the override up like every other state's.
        self.assertAlmostEqual(
            0.52, self.machine.state("Ub_IdleColt1").clip_1p().speed)


if __name__ == "__main__":
    unittest.main()
