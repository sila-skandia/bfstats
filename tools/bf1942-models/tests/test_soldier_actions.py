"""`viewer/soldier-actions.js` under node: what each half of a drawn soldier
plays between and over his gaits.

The chains are `BFSoldier::handlePlayerInput`'s (lnxded `0x08273c70`) and each
state's own `addTransitionWhenDone`; the morph is ANIM-4's weight ramp and
slerp from the bone's current local. See `features/bot-body-animation/`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "viewer" / "soldier-actions.js"
HARNESS = Path(__file__).with_name("soldier_actions_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(SOURCE, work / "soldier-actions.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def entered(log: list[dict], half: str) -> list[str]:
    return [e["name"] for e in log if e["half"] == half]


def at(log: list[dict], half: str, name: str) -> float:
    return next(e["t"] for e in log if e["half"] == half and e["name"] == name)


class StanceTransitionTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_standing_still_he_dives(self) -> None:
        # The engine's forward test is `input x state speed < 0`; standing
        # still is not negative, so the dive, as for a man at a run.
        log = self.results["dive"]
        self.assertEqual(["stand.lower", "Lb_RunStandToLie", "lie.lower"],
                         entered(log, "lower"))
        self.assertEqual(["stand.upper", "Ub_RunStandToLie", "lie.upper"],
                         entered(log, "upper"))
        # `3PJump2LieLower.baf` at the tweaked 1.4: 1/1.4 s before the loop.
        self.assertAlmostEqual(1 / 1.4, at(log, "lower", "lie.lower")
                               - at(log, "lower", "Lb_RunStandToLie"), delta=2 / 60)

    def test_moving_backward_he_lies_down_through_the_crouch(self) -> None:
        log = self.results["backward"]
        self.assertEqual(["stand.lower", "Lb_StandToLie", "Lb_CrouchToLie", "lie.lower"],
                         entered(log, "lower"))
        # `Ub_StandToLie` names a file no archive ships: straight to its
        # `addTransitionWhenDone`, `Ub_CrouchToLie`.
        self.assertEqual(["stand.upper", "Ub_CrouchToLie", "lie.upper"],
                         entered(log, "upper"))
        self.assertAlmostEqual(1 / 6, at(log, "lower", "Lb_CrouchToLie")
                               - at(log, "lower", "Lb_StandToLie"), delta=2 / 60)

    def test_getting_up_goes_through_the_crouch(self) -> None:
        log = self.results["getUp"]
        self.assertEqual(["lie.lower", "Lb_LieToStand", "Lb_CrouchToStand", "stand.lower"],
                         entered(log, "lower"))
        self.assertEqual(["lie.upper", "Ub_LieToStand", "stand.upper"],
                         entered(log, "upper"))
        # 1/3 s up to the crouch, 1/10 s to standing (the tweaked -3 and -10).
        # (An event's state is logged on the frame after the event, so a gap
        # measured from one reads up to a frame short.)
        self.assertAlmostEqual(1 / 3, at(log, "lower", "Lb_CrouchToStand")
                               - at(log, "lower", "Lb_LieToStand"), delta=2 / 60)
        self.assertAlmostEqual(0.1, at(log, "lower", "stand.lower")
                               - at(log, "lower", "Lb_CrouchToStand"), delta=1 / 60)

    def test_crouching_the_torso_goes_straight_to_the_crouch_aim(self) -> None:
        # `Ub_StandToCrouch` rems out its clip; its `addTransitionWhenDone` is
        # the crouch aim, entered at that state's own 0.7.
        log = self.results["crouch"]
        self.assertEqual(["stand.lower", "Lb_StandToCrouch", "crouch.lower"],
                         entered(log, "lower"))
        self.assertEqual(["stand.upper", "crouch.upper"], entered(log, "upper"))

    def test_the_engines_morph_factors_ride_along(self) -> None:
        log = self.results["dive"]
        morph = {(e["half"], e["name"]): e["morph"] for e in log}
        self.assertEqual(4, morph[("lower", "Lb_RunStandToLie")])
        self.assertEqual(2, morph[("lower", "lie.lower")])
        self.assertEqual(0.7, morph[("upper", "lie.upper")])

    def test_a_reload_keeps_the_torso_through_a_dive(self) -> None:
        log = self.results["reloadThroughDive"]
        self.assertEqual(["stand.lower", "Lb_RunStandToLie", "lie.lower"],
                         entered(log, "lower"))
        self.assertEqual(["stand.upper", "Ub_StandReload", "lie.upper"],
                         entered(log, "upper"))
        # The reload runs its whole 1/0.47 s, then hands back to the pose the
        # soldier is in by then.
        self.assertAlmostEqual(1 / 0.47, at(log, "upper", "lie.upper")
                               - at(log, "upper", "Ub_StandReload"), delta=2 / 60)

    def test_a_prone_reload_is_the_prone_clip(self) -> None:
        self.assertEqual(["lie.upper", "Ub_LieReload", "lie.upper"],
                         entered(self.results["proneReload"], "upper"))

    def test_an_automatic_loops_while_the_trigger_is_held(self) -> None:
        log = self.results["automatic"]
        # One entry for two rounds, back to the aim on release, and a round
        # during the dive does not interrupt it.
        self.assertEqual(["stand.upper", "Ub_Fire", "stand.upper", "Ub_RunStandToLie"],
                         entered(log, "upper"))
        self.assertEqual(4, next(e["morph"] for e in log if e["name"] == "Ub_Fire"))

    def test_a_bolt_action_works_the_bolt_after_the_shot(self) -> None:
        log = self.results["bolt"]
        self.assertEqual(["stand.upper", "Ub_Fire", "Ub_StandReload", "stand.upper"],
                         entered(log, "upper"))
        self.assertEqual(10000, next(e["morph"] for e in log if e["name"] == "Ub_Fire"))

    def test_a_tree_without_the_clips_goes_straight_to_the_loop(self) -> None:
        log = self.results["oldTree"]
        self.assertEqual(["stand.lower", "lie.lower"], entered(log, "lower"))
        self.assertEqual(["stand.upper", "lie.upper"], entered(log, "upper"))

    def test_a_stance_that_comes_straight_back_settles_without_a_dive(self) -> None:
        # `getPose` is the lower state's flags: `Lb_LieToStand` still lies,
        # so the tick-long stand of a Fire -> Change -> Fire flicker ends
        # back on the lie loop by the morph.
        log = self.results["flicker"]
        self.assertEqual(["lie.lower", "Lb_LieToStand", "lie.lower"], entered(log, "lower"))
        self.assertEqual(["lie.upper", "Ub_LieToStand", "lie.upper"], entered(log, "upper"))
        self.assertNotIn("Lb_RunStandToLie", entered(log, "lower"))

    def test_a_crouch_then_prone_lies_down_from_the_crouch(self) -> None:
        log = self.results["crouchThenProne"]
        self.assertEqual(["stand.lower", "Lb_StandToCrouch", "Lb_CrouchToLie", "lie.lower"],
                         entered(log, "lower"))

    def test_a_gait_change_on_the_base_re_enters_it(self) -> None:
        log = self.results["gait"]
        self.assertEqual(["stand.lower", "run.lower"], entered(log, "lower"))
        self.assertEqual(0.5, [e for e in log if e["name"] == "run.upper"][0]["morph"])

    def test_a_corpse_plays_its_death_and_nothing_after(self) -> None:
        log = self.results["death"]
        self.assertEqual(["lie.lower", "Lb_DieLie"], entered(log, "lower"))
        self.assertEqual(["lie.upper", "Ub_DieLie"], entered(log, "upper"))
        self.assertEqual(20, self.results["dieMorph"])

    def test_the_dive_test_only_turns_a_standing_lie_down(self) -> None:
        keys = self.results["entryKeys"]
        self.assertEqual("stand>prone", keys["still"])
        self.assertEqual("stand>prone backward", keys["backward"])
        self.assertEqual("crouch>prone", keys["crouchedBackward"])


class MorphBlendTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_nothing_moves_on_the_frame_the_state_is_entered(self) -> None:
        first = self.results["morph"][0]
        self.assertEqual(0, first["w"])
        self.assertEqual(1.0, first["y"])
        self.assertEqual(0, first["angle"])

    def test_the_weight_gains_dt_times_the_morph_factor(self) -> None:
        trace = self.results["morph"]
        self.assertAlmostEqual(2 / 60, trace[1]["w"], places=4)
        self.assertAlmostEqual(0.5, trace[15]["w"], places=4)
        self.assertEqual(1, trace[30]["w"])

    def test_the_bones_start_where_they_were_and_never_jump(self) -> None:
        # Slerped from the CURRENT local each frame, so the bones converge
        # well before the weight reaches one, and no frame moves them more
        # than a fraction of the way.
        trace = self.results["morph"]
        steps = [b["angle"] - a["angle"] for a, b in zip(trace, trace[1:])]
        self.assertTrue(all(step >= -1e-6 for step in steps))
        self.assertLess(max(steps), 12.0)
        self.assertGreater(trace[10]["angle"], 70.0)
        self.assertEqual(90, trace[-1]["angle"])
        self.assertEqual(0.5, trace[-1]["y"])

    def test_a_bone_the_clip_holds_still_still_reaches_it(self) -> None:
        # three writes it once, as the state starts; without the mixer's pose
        # restored the morph read its own frame back and froze where it began
        # (a replayed rifleman's clavicles and left hand, 27 cm off his rifle).
        still = self.results["stillBone"]
        self.assertEqual({"angle": 90.0, "y": 0.5}, still["restored"])
        self.assertEqual({"angle": 0.0, "y": 1.0}, still["unrestored"])

    def test_a_morph_factor_above_a_thousand_cuts(self) -> None:
        self.assertEqual({"w": 1, "y": 0.5}, self.results["cut"])

    def test_a_frame_with_no_time_in_it_draws_the_frame_before(self) -> None:
        # A replay paused mid-morph steps every body with dt 0. Slerped toward
        # the clip by the same weight each frame, the bone kept closing on it;
        # skipped, it would show the mixer's 90 degrees. It shows the pose it
        # was drawn in, the weight where it stood.
        frames = self.results["stillFrames"]
        before = frames["before"]
        self.assertAlmostEqual(0.2, before["w"], places=9)
        self.assertGreater(before["angle"], 0)
        self.assertLess(before["angle"], 90)
        self.assertEqual(5, len(frames["still"]))
        for still in frames["still"]:
            self.assertEqual(before, still)

    def test_the_morph_goes_on_from_where_it_stopped(self) -> None:
        # The first frame after the pause gains one frame's weight on the pose
        # it held, and every frame after is the unpaused morph's own.
        frames = self.results["stillFrames"]
        before, resumed = frames["before"], frames["resumed"]
        self.assertAlmostEqual(before["w"] + 2 / 60, resumed["w"], places=9)
        # Slerped from the held pose toward 90 degrees by the new weight.
        self.assertAlmostEqual(before["angle"] + (90 - before["angle"]) * resumed["w"],
                               resumed["angle"], places=6)
        self.assertAlmostEqual(before["y"] + (0.5 - before["y"]) * resumed["w"],
                               resumed["y"], places=9)
        self.assertTrue(frames["sameAsUnpaused"])


class BundleStateTests(unittest.TestCase):
    """What a gait bundle says of its states rides on each clip as `userData`
    (`bundleClips`, the loader the page's bodies and the replay's plain
    soldier share), and what a state is entered with (`stateInfo`,
    `stateMorph`, the bots' and the replay's lookup alike)."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_gait_bundles_states_ride_on_its_clips(self) -> None:
        bundles = self.results["bundles"]
        self.assertEqual([{"morph": 2, "speed": 1.6}, {}], bundles["gait"])
        self.assertEqual([{}], bundles["bare"])

    def test_a_named_state_bundle_reads_as_the_same_shape(self) -> None:
        # `morphFactor` as `morph`, `c_AsmHideWeapon` as `hidesWeapon`.
        self.assertEqual([{"speed": 1, "loop": True, "morph": 50, "hidesWeapon": True}],
                         self.results["bundles"]["named"])

    def test_a_states_morph_is_the_first_description_of_it(self) -> None:
        morphs = self.results["stateMorphs"]
        self.assertEqual(2, morphs["bundle"])
        # An empty `userData` is no description: the vanilla scripts speak.
        self.assertEqual(2.0, morphs["emptyUserData"])
        self.assertEqual(3, morphs["clipless"])
        self.assertEqual(0.7, morphs["vanilla"])
        # Nobody names it, or the bundle names it with no morph: the
        # constructor's 5.0.
        self.assertEqual(5, morphs["unknown"])
        self.assertEqual(5, morphs["noMorph"])


if __name__ == "__main__":
    unittest.main()
