"""What a LIVE third-person soldier plays that only a replay's did
(retail-inverse-gap-audit 2026-11-12, entries 9, 34, 35 and 38).

Retail's rules, each pinned here on the modules the page loads:

* **9, the jump, the backward run, the draw.** `AnimationStatesLower.con`:
  `Lb_Stand` and the walks enter `Lb_StandJump` on `c_PIAction 0.5 1`, the run
  and the strafes `Lb_RunJump`, `Lb_RunBackward` its own `Lb_RunJumpBackward`;
  `c_PIThrottle -1 -0.5` is `Lb_RunBackward` (its own clip, -1.6) or with
  `c_PIWalk` the walk's clip reversed. The page already runs that machine a
  tick at a time for the jump gate (`SoldierJumpState`, PHY-35), and its
  state is what a live body now plays and what a room's snapshot carries
  (`netcode.js` `LOWER_WIRE`, in the seat byte of a player on foot). The
  draw is `Ub_<Pose>RaiseWeapon<W>`, set by name on an item change: a cut
  (`setMorphFactor 10000`), then `_POSE_`.
* **38, the turn on the spot and the idles.** `c_PIMouseLookX` past 0.01
  either way is `Lb_TurnLeft` / `Lb_TurnRight` (`3PTurnLower.baf` at 2.0 and
  -2.0, the constructor's morph 5.0, `returnToState Lb_Stand`). ANIM-6: a
  state's idle timer is `(rand & 3) + 4.0` s (lnxded `0x0832b2d9`) and at 0
  draws `rand() % n` of its `addIdle` list: `Lb_Stand`'s is `Lb_StandRelax`
  alone, `Ub_StandAim<W>`'s and `Ub_Crouch<W>`'s three fidgets each.
* **34, the hand signs.** `BFSoldier::speakLine` (lnxded `0x0826e220`, client
  `0x004feb20`): sign 0..6 added to `HandSign_Freeze`'s index, set on the
  soldier's third machine (`+0x360`); `setMorphFactor 2.5`, one second, then
  `StopDummyState`.
* **35, the clip eject.** `BFSoldier::handleMessage` (lnxded `0x082775d8`):
  `Ub_LieEjectClip<W>` lying, else `Ub_StandEjectClip<W>`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
HARNESS = Path(__file__).with_name("live_body_anim_harness.mjs")

import extract_pose  # noqa: E402
import extract_viewmodel  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS), str(ROOT / "viewer")],
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LiveBodyAnimTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    # -- entry 9 ---------------------------------------------------------- #

    def test_each_lower_state_names_the_engines_own_clips(self) -> None:
        live = self.r["liveLower"]
        self.assertEqual("Lb_StandJump", live["standJump"]["lower"])
        self.assertEqual("Ub_StandJump", live["standJump"]["upper"])
        self.assertEqual("Lb_RunJump", live["runJump"]["lower"])
        self.assertEqual("Ub_RunJump", live["runJump"]["upper"])
        self.assertEqual("Lb_RunJumpBackward", live["runJumpBackward"]["lower"])
        self.assertEqual("Lb_RunBackward", live["runBackward"]["lower"])
        self.assertEqual("Ub_RunBackward", live["runBackward"]["upper"])
        # `Lb_WalkBackward` is `3PWalkLower.baf` at -0.7: the gait, reversed.
        self.assertEqual({"reverse": True}, live["walkBackward"])
        self.assertEqual({"reverse": True}, live["backward"])
        for state in ("stand", "walkForward", "runForward", "strafeLeft", "strafeRight"):
            self.assertIsNone(live[state], state)

    def test_the_bodys_own_machine_is_the_source(self) -> None:
        seen = self.r["bodyLowerState"]
        # forward held; the press; backward; the mouse past 0.01; inside it.
        self.assertEqual(["runForward", "runJump", "runBackward", "turnLeft", "stand"],
                         seen["seen"])
        self.assertEqual("backward", seen["crouchBackward"])
        self.assertIsNone(seen["crouchForward"])
        self.assertIsNone(seen["swimming"])

    def test_a_jump_is_entered_by_name_and_hands_back_to_the_run(self) -> None:
        # `Lb_RunJump` and `Ub_RunJump<W>`: `setMorphFactor 100`.
        self.assertEqual(
            [{"half": "lower", "name": "Lb_RunJump", "morph": 100},
             {"half": "upper", "name": "Ub_RunJump", "morph": 100}],
            self.r["jumpEntered"])
        # One pass of the clip at 1.18: 0.847 s, to the frame.
        self.assertAlmostEqual(1 / 1.18, self.r["jumpSeconds"], delta=1 / 30)
        self.assertEqual({"lower": "run.lower", "upper": "run.upper"}, self.r["jumpEndsOn"])
        self.assertEqual(0, self.r["afterJumpNoReentry"])

    def test_a_jump_is_taken_before_the_speed_bands_catch_up(self) -> None:
        halves = self.r["liveHalves"]
        self.assertEqual("Lb_RunJump", halves["runJumpBeforeTheBandsCatchUp"]["lower"])
        self.assertEqual("Lb_StandJump", halves["standJump"]["lower"])

    def test_the_backward_run_plays_its_own_clip_and_lets_go(self) -> None:
        self.assertEqual({"lower": "Lb_RunBackward", "upper": "Ub_RunBackward", "loop": True},
                         self.r["backwardRun"])
        self.assertEqual({"lower": "run.lower", "upper": "run.upper"}, self.r["backwardRunLeft"])
        halves = self.r["liveHalves"]
        # A tree baked before the clip: the forward run reversed.
        self.assertEqual({"lower": None, "upper": None, "reverse": True},
                         halves["runBackwardOldTree"])
        self.assertTrue(halves["runBackwardAtWalkSpeed"]["reverse"])

    def test_a_backward_walk_or_crawl_is_the_gait_reversed(self) -> None:
        self.assertEqual(
            [{"half": "lower", "name": "walk.lower", "reverse": True},
             {"half": "upper", "name": "walk.upper", "reverse": True}],
            self.r["backwardWalk"])
        halves = self.r["liveHalves"]
        self.assertTrue(halves["crawlBackward"]["reverse"])
        self.assertFalse(halves["crouchStillBackward"]["reverse"])

    def test_the_draw_cuts_in_by_pose_and_survives_a_stance_change(self) -> None:
        draw = self.r["draw"]
        self.assertTrue(draw["drew"])
        self.assertEqual({"name": "Ub_StandRaiseWeapon", "action": "draw"}, draw["first"])
        self.assertEqual(10000, draw["morph"])
        # `isReadyToUse`: the item is not ready until it is up.
        self.assertEqual("Ub_StandRaiseWeapon", draw["through"])
        # `3PDeploy<W>.baf` at -1.6: 0.625 s.
        self.assertAlmostEqual(1 / 1.6, draw["seconds"], delta=1 / 30)
        self.assertEqual("crouch.upper", draw["endsOn"])
        self.assertEqual("Ub_LieRaiseWeapon", draw["prone"])
        self.assertFalse(draw["oldTree"])

    def test_a_whole_family_rig_gets_the_same_states(self) -> None:
        fam = self.r["liveFamily"]
        self.assertEqual({"family": "live.runJump", "reverse": False}, fam["runJump"])
        self.assertEqual({"family": "run", "reverse": False}, fam["runJumpUnbound"])
        self.assertEqual({"family": "live.runBackward", "reverse": False}, fam["runBackward"])
        self.assertEqual({"family": "run", "reverse": True}, fam["runBackwardUnbound"])
        self.assertEqual({"family": "walk", "reverse": True}, fam["walkBackward"])
        clips = self.r["liveClips"]
        self.assertEqual({"lower": "Lb_RunJump", "upper": "Ub_RunJump",
                          "lowerOnce": True, "upperOnce": True}, clips["live.runJump"])
        # A turn's torso is the standing aim: no torso state is entered.
        self.assertEqual({"lower": "Lb_TurnLeft", "upper": "stand.upper"}, clips["live.turnLeft"])

    def test_the_snapshot_carries_the_lower_state_in_the_seat_byte(self) -> None:
        wire = self.r["wire"]
        # Append only: a code is an index into this list.
        self.assertEqual(
            ["stand", "walkForward", "walkBackward", "runForward", "runBackward",
             "turnLeft", "turnRight", "strafeLeft", "strafeRight",
             "standJump", "runJump", "runJumpBackward", "backward", "climb"], wire["order"])
        self.assertEqual(0x1f, wire["none"])
        # No new bytes: 5 header + 5 players of 31 + the vehicle count.
        self.assertEqual(5 + 5 * 31 + 1, wire["bytes"])
        # On foot `0xe0 | code`; seated the seat; nothing known, the old 0xff.
        self.assertEqual([0xe0 | 10, 0xe0 | 12, 3, 0xff, 0xff], wire["seatBytes"])
        self.assertEqual(
            [{"slot": 1, "seatIndex": None, "lower": "runJump"},
             {"slot": 2, "seatIndex": None, "lower": "backward"},
             {"slot": 3, "seatIndex": 3, "lower": None},
             {"slot": 4, "seatIndex": None, "lower": None},
             {"slot": 5, "seatIndex": None, "lower": None}], wire["decoded"])
        self.assertIsNone(wire["oldServer"])

    # -- entry 38 --------------------------------------------------------- #

    def test_the_turn_is_the_legs_alone_at_the_default_morph(self) -> None:
        turn = self.r["turn"]
        self.assertEqual([{"half": "lower", "name": "Lb_TurnLeft", "morph": 5}], turn["entered"])
        self.assertEqual("stand.upper", turn["upper"])
        # `returnToState Lb_Stand`, entered at its own morph of 2.
        self.assertEqual([{"half": "lower", "name": "stand.lower", "morph": 2}], self.r["turnLeft"])
        halves = self.r["liveHalves"]
        self.assertEqual("Lb_TurnLeft", halves["turnStanding"]["lower"])
        self.assertIsNone(halves["turnWhileTheBandsSayWalk"]["lower"])
        vanilla = self.r["vanillaIdles"]
        self.assertEqual({"speed": 2, "loop": True, "morph": 5, "then": "Lb_Stand"}, vanilla["turnLeft"])
        self.assertEqual({"speed": -2, "loop": True, "morph": 5, "then": "Lb_Stand"}, vanilla["turnRight"])

    def test_the_idle_dwell_is_four_to_seven_whole_seconds(self) -> None:
        dwell = self.r["idleDwell"]
        # `(rand & 3) + 4.0` (lnxded 0x0832b2d9, .rodata 0x086c0304).
        self.assertEqual(4.0, dwell["base"])
        self.assertEqual(4, dwell["steps"])
        self.assertEqual([4, 4, 5, 6, 7, 7], dwell["draws"])
        clock = self.r["idleClock"]
        # random 0.5 -> 6 s; then `rand() % 3` with 0.7 -> index 2.
        self.assertEqual([{"t": 6.02, "k": 2}], clock["fired"])
        self.assertEqual(6, clock["rekeyed"])

    def test_standing_still_relaxes_the_legs_and_fidgets_the_torso(self) -> None:
        log = [(e["t"], e["half"], e["name"], e["morph"]) for e in self.r["idle"]["log"]]
        self.assertIn((4.03, "lower", "Lb_StandRelax", 2), log)
        # The aim's own dwell (5 s), the first fidget, then back to the aim.
        self.assertIn((5.03, "upper", "Ub_Idle1", 5), log)
        self.assertIn((7.03, "upper", "stand.upper", 0.7), log)
        # `Lb_StandRelax` loops (`returnToState Lb_StandRelax`) until an input.
        self.assertEqual("Lb_StandRelax", self.r["idle"]["lower"])
        self.assertTrue(self.r["idle"]["lowerLoops"])
        self.assertEqual(["walk.lower"], self.r["idleLeft"])

    def test_a_replay_and_a_clipless_grip_enter_no_idle(self) -> None:
        self.assertEqual({"entries": 2, "lower": "stand.lower"}, self.r["idleOffWithoutTheFlag"])
        self.assertEqual(["stand.upper"], self.r["idleNoClip"])
        vanilla = self.r["vanillaIdles"]
        self.assertEqual(["Lb_StandRelax"], vanilla["standLower"])
        self.assertEqual(["Ub_Idle1", "Ub_Idle2", "Ub_Idle3"], vanilla["standUpper"])
        self.assertEqual(["Ub_CrouchIdle1", "Ub_CrouchIdle2", "Ub_CrouchIdle3"], vanilla["crouchUpper"])
        self.assertEqual({"speed": 0.6, "loop": True, "morph": 2}, vanilla["relax"])

    def test_a_replay_names_the_new_states_itself(self) -> None:
        self.assertEqual({"turn": "Lb_TurnLeft", "relax": "Lb_StandRelax", "run": None},
                         self.r["recordedClips"])

    # -- entry 34 --------------------------------------------------------- #

    def test_the_signs_are_in_speaklines_order(self) -> None:
        signs = self.r["handSigns"]
        self.assertEqual(["Freeze", "Come", "Medic", "Shout", "Down", "Roger", "Negative"],
                         signs["order"])
        self.assertEqual(list(extract_pose.HANDSIGN_STATES),
                         [f"HandSign_{name}" for name in signs["order"]])
        self.assertEqual(2.5, signs["morph"])
        self.assertEqual(["HandSign_Freeze", "HandSign_Negative", None, "HandSign_Medic",
                          "HandSign_Come", None], signs["states"])

    def test_only_a_shout_carries_a_sign_and_each_names_a_state(self) -> None:
        radio = self.r["handSigns"]["radio"]
        self.assertEqual({"31", "32", "36", "38", "39", "40", "44"}, set(radio))
        for message, (kind, _sign, state) in radio.items():
            self.assertEqual("local", kind, message)
            self.assertIsNotNone(state, message)

    def test_the_sign_is_laid_over_the_arm_at_its_morph_and_let_go(self) -> None:
        self.assertEqual({"unknown": False, "notASign": False, "medic": True}, self.r["signPlay"])
        frames = {f["i"]: f for f in self.r["signFrames"]}
        # Entered at weight 0; then `w = t x 2.5` of the way to the clip,
        # whose own angle is `90 x t`: 0.1 s -> 0.25 x 9 degrees.
        self.assertEqual(0, frames[0]["drawn"])
        self.assertAlmostEqual(0.25 * 9, frames[6]["drawn"], places=2)
        self.assertAlmostEqual(0.5 * 18, frames[12]["drawn"], places=2)
        # At full weight from 0.4 s (1 / 2.5).
        self.assertAlmostEqual(36, frames[24]["drawn"], places=2)
        self.assertAlmostEqual(45, frames[30]["drawn"], places=2)
        # Each frame starts from what the body drew, not from the sign.
        self.assertTrue(all(f["restored"] == 0 for f in frames.values()))
        # One second at rate 1.0, then the torso's own pose.
        self.assertEqual("HandSign_Medic", frames[59]["playing"])
        self.assertIsNone(frames[60]["playing"])
        self.assertEqual({"playing": None, "angle": 0}, self.r["signAfter"])

    # -- entry 35 --------------------------------------------------------- #

    def test_the_eject_is_picked_by_the_lying_flag_alone(self) -> None:
        eject = self.r["eject"]
        self.assertEqual({"stand": ["eject"], "crouch": ["eject"],
                          "prone": ["proneEject", "eject"]}, eject["chains"])
        self.assertEqual("eject", eject["crouch"])
        self.assertEqual("proneEject", eject["prone"])
        self.assertEqual([True, True, False, False], eject["is"])

    def test_the_arms_keep_the_eject_until_it_ends_or_the_reload_cuts_in(self) -> None:
        sel = self.r["ejectSelection"]
        self.assertEqual({"want": "eject"}, sel["kept"])
        self.assertEqual("idle", sel["over"]["want"])
        self.assertEqual("reload", sel["reloadCutsIn"]["want"])
        self.assertTrue(sel["reloadCutsIn"]["startReload"])


class ExporterTests(unittest.TestCase):
    """The states the exporter bakes for them, and retail's values where the
    game is installed."""

    def test_the_new_states_are_baked_by_name(self) -> None:
        for name in ("Lb_TurnLeft", "Lb_TurnRight", "Lb_StandRelax"):
            self.assertIn(name, extract_pose.LOWER_ACTIONS)
        self.assertEqual(("Idle", "CrouchIdle"), extract_pose.IDLE_ACTIONS)
        self.assertEqual(3, extract_pose.IDLE_COUNT)
        self.assertEqual(7, len(extract_pose.HANDSIGN_STATES))
        self.assertEqual("HandSign_Freeze", extract_pose.HANDSIGN_STATES[0])
        self.assertEqual((("eject", "StandEjectClip"), ("proneEject", "LieEjectClip")),
                         extract_viewmodel.EJECT_FAMILIES)

    def test_an_idles_name_drops_the_weapon_from_its_middle(self) -> None:
        self.assertEqual("Ub_Idle1", extract_pose.idle_generic("Ub_IdleThompson1", "Thompson"))
        self.assertEqual("Ub_CrouchIdle3", extract_pose.idle_generic("Ub_CrouchIdleMp403", "MP40"))
        self.assertEqual("Lb_StandRelax", extract_pose.idle_generic("Lb_StandRelax", ""))
        self.assertEqual("Lb_StandRelax", extract_pose.idle_generic("Lb_StandRelax", "Colt"))

    @unittest.skipUnless((DEFAULT_GAME_DIR / "Mods" / "bf1942").is_dir(),
                         "the game is not installed")
    def test_vanillas_scripts_say_what_the_page_plays(self) -> None:
        from extract_models import build_pools, mod_chain
        meshes, *_ = build_pools(mod_chain(DEFAULT_GAME_DIR, "bf1942"), [])
        machine = extract_pose.state_machine(meshes)

        def row(name: str):
            state = machine.state(name)
            ref = state.clip_3p()
            return (ref.speed if ref else None, ref.loops if ref else None,
                    state.morph_factor, state.return_to)

        self.assertEqual((2.0, True, 5.0, "Lb_Stand"), row("Lb_TurnLeft"))
        self.assertEqual((-2.0, True, 5.0, "Lb_Stand"), row("Lb_TurnRight"))
        self.assertEqual((0.6, True, 2.0, "Lb_StandRelax"), row("Lb_StandRelax"))
        self.assertEqual(["Lb_StandRelax"], machine.state("Lb_Stand").idles)
        self.assertEqual(["Ub_IdleThompson1", "Ub_IdleThompson2", "Ub_IdleThompson3"],
                         machine.state("Ub_StandAimThompson").idles)
        self.assertEqual((0.5, False, 5.0, "Ub_StandAimThompson"), row("Ub_IdleThompson1"))
        # The only third-person fidgets vanilla ships a clip for.
        with_clip = sorted(
            w for w in machine.weapons()
            for n in (1, 2, 3)
            if (s := machine.state(f"Ub_Idle{w}{n}")) is not None and s.clip_3p() is not None)
        self.assertEqual(["Sg44", "Thompson"], with_clip)
        for index, name in enumerate(extract_pose.HANDSIGN_STATES):
            self.assertEqual((1.0, False, 2.5, "StopDummyState"), row(name), index)
        # The seven are declared together and in this order: `speakLine`
        # addresses them as `HandSign_Freeze`'s index plus the sign.
        order = [s.name for s in machine.states.values() if s.name.startswith("HandSign_")]
        self.assertEqual(list(extract_pose.HANDSIGN_STATES), order)
        eject = machine.state("Ub_StandEjectClipM1Garand")
        self.assertEqual(10000.0, eject.morph_factor)
        self.assertEqual("_POSE_", eject.return_to)
        self.assertEqual("WeaponEjectClipM1Garand", eject.weapon_state)
        self.assertEqual(1.0, eject.clip_1p().speed)
        self.assertEqual(2.5, machine.state("Ub_LieEjectClipM1Garand").clip_1p().speed)
        self.assertEqual(2.2, machine.state("WeaponEjectClipM1Garand").clips[0].speed)
        # Only a weapon that throws its clip bakes the eject families.
        _resolved, report = extract_viewmodel.resolve_families(machine, "M1Garand", True)
        self.assertIn("eject", report)
        self.assertIn("proneEject", report)
        _resolved, report = extract_viewmodel.resolve_families(machine, "Thompson", False)
        self.assertNotIn("eject", report)


if __name__ == "__main__":
    unittest.main()
