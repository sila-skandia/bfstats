"""`viewer/soldier-body.js` under node: which clips the local body plays.

The selection rules are the engine's and the clip names are the published
files'. Two of them are the kind of thing that is invisible until someone
renders it:

* A stationary crouched soldier reads `soldier.gait === 'stand'` -- the gait
  exists to pick a row of the view-bob table, which is only read while moving --
  so the stance has to be consulted or a crouching man stands up. This is the
  same trap `stance-clips.js` documents for the arms rig, and the same one that
  made a prone remote stand up before W5-A.

* The parachute's whole-body states replace the locomotion pair rather than
  layering over it (`setIsParachuting` sets both halves, PARA-5), so the chute
  outranks the gait.

The parachute half is asserted against `parachute.js`'s own `PARA_CLIPS`, which
is read out of `animations/AnimationStatesParachute.con`, so there is one table
and not two.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("soldier_body_harness.mjs")
MODULES = {"soldier-body.js": VIEWER / "soldier-body.js",
           "parachute.js": VIEWER / "parachute.js",
           "swim.js": VIEWER / "swim.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SoldierBodyTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_seven_gaits_the_six_parachutes_and_the_six_swims(self) -> None:
        self.assertEqual(
            ["stand", "walk", "run", "crouch", "crouchwalk", "prone", "crawl",
             "parachuteFall", "parachuteOpen", "parachuteGlide",
             "parachuteLanded", "parachuteDie", "parachuteDeadLanded",
             "swimStart", "swimFloat", "swimForward", "swimBackward",
             "swimEnd", "swimDie"],
            self.results["families"])

    def test_every_family_names_both_halves_of_the_body(self) -> None:
        # The engine runs two state machines over disjoint bone sets, so a
        # family that named only one half would leave the other holding the
        # static pose -- which is a bug, not a fallback.
        self.assertTrue(self.results["everyFamilyHasBothHalves"])
        self.assertTrue(self.results["everyFamilyHasAChain"])

    def test_the_clip_names_are_the_published_files_own(self) -> None:
        clips = self.results["clips"]
        self.assertEqual({"lower": "stand.lower", "upper": "stand.upper"},
                         clips["stand"])
        self.assertEqual({"lower": "run.lower", "upper": "run.upper"},
                         clips["run"])
        # The prone pose is baked as the engine's own word, `lie`.
        self.assertEqual({"lower": "lie.lower", "upper": "lie.upper"},
                         clips["prone"])
        self.assertEqual({"lower": "crawl.lower", "upper": "crawl.upper"},
                         clips["crawl"])
        # The parachute clips keep the engine's state names verbatim.
        self.assertEqual({"lower": "Lb_ParachuteOpen",
                          "upper": "Ub_ParachuteOpen"},
                         clips["parachuteOpen"])
        self.assertEqual({"lower": "Lb_ParachuteDeadHitGround",
                          "upper": "Ub_ParachuteDeadHitGround"},
                         clips["parachuteDeadLanded"])

    def test_the_glide_torso_is_the_weapon_aim_the_engine_returns_to(self) -> None:
        # Not a viewer choice: `Ub_ParachuteOpen`'s own
        # `addTransitionWhenDone Ub_StandAim`, which is also why there is no
        # `Ub_ParachuteIdle` state to bake.
        self.assertEqual("Ub_StandAim", self.results["glideUpperState"])
        self.assertEqual("stand.upper", self.results["standAim"])
        self.assertEqual("stand.upper", self.results["glideBakedUpper"])
        self.assertEqual("Lb_ParachuteIdle",
                         self.results["clips"]["parachuteGlide"]["lower"])

    def test_the_playonce_states_are_the_one_shots(self) -> None:
        # The four parachute `c_AsmPlayOnce` states, and the swim entry, exit and
        # death -- `Lb_StartSwim`, `Lb_EndSwim` and `Lb_DieSwim` are all
        # `c_AsmPlayOnce` with an `addTransitionWhenDone` (or, for the death,
        # nothing) after them.
        self.assertEqual(
            ["parachuteOpen", "parachuteLanded", "parachuteDie",
             "parachuteDeadLanded", "swimStart", "swimEnd", "swimDie"],
            self.results["once"])

    def test_every_pair_parachute_js_can_answer_resolves_to_a_family(self) -> None:
        pairs = self.results["paraPairs"]
        self.assertEqual(
            {"falling": "parachuteFall", "open": "parachuteOpen",
             "glide": "parachuteGlide", "landed": "parachuteLanded",
             "dead": "parachuteDie", "deadLanded": "parachuteDeadLanded"},
            pairs)
        self.assertIsNone(self.results["paraUnknown"])
        self.assertIsNone(self.results["paraNull"])
        self.assertEqual("parachuteGlide", self.results["paraCaseInsensitive"])

    def test_a_stationary_crouched_soldier_does_not_stand_up(self) -> None:
        loco = self.results["loco"]
        self.assertEqual("crouch", loco["crouchedStill"])
        self.assertEqual("prone", loco["proneStill"])
        self.assertEqual("stand", loco["standing"])

    def test_the_moving_gaits_of_a_stance_are_its_movement_families(self) -> None:
        loco = self.results["loco"]
        self.assertEqual("crouchwalk", loco["crouchedMoving"])
        self.assertEqual("crawl", loco["proneMoving"])
        self.assertEqual("walk", loco["walking"])
        self.assertEqual("run", loco["running"])

    def test_a_gait_that_proves_a_posture_outranks_a_stale_stance(self) -> None:
        loco = self.results["loco"]
        self.assertEqual("crouchwalk", loco["crouchGaitStandStance"])
        self.assertEqual("crawl", loco["proneGaitStandStance"])

    def test_nonsense_lands_on_standing_rather_than_nothing(self) -> None:
        self.assertEqual("stand", self.results["loco"]["garbage"])
        self.assertEqual("stand", self.results["emptyState"])

    def test_the_parachute_outranks_the_gait(self) -> None:
        self.assertEqual("parachuteGlide", self.results["parachuteWinsOverGait"])
        self.assertEqual("run", self.results["noParachuteFallsThrough"])

    def test_a_chain_falls_back_toward_the_posture_before_standing(self) -> None:
        fall = self.results["fallback"]
        self.assertEqual("prone", fall["crawlToProne"])
        self.assertEqual("walk", fall["crawlToWalk"])
        self.assertEqual("crouch", fall["crouchwalkToCrouch"])
        self.assertEqual("walk", fall["runToWalk"])
        self.assertTrue(self.results["everyChainEndsAtStand"])
        self.assertTrue(self.results["everyChainStartsWithItself"])

    def test_a_tree_without_the_parachute_bundle_still_draws_a_body(self) -> None:
        fall = self.results["fallback"]
        self.assertEqual("stand", fall["glideWithoutBundle"])
        self.assertEqual("stand", fall["openWithoutBundle"])
        self.assertEqual("parachuteGlide", fall["openWithGlideOnly"])
        self.assertEqual("parachuteLanded", fall["deadLandedToLanded"])

    def test_no_predicate_means_what_the_engine_owes(self) -> None:
        self.assertEqual("crawl", self.results["fallback"]["noPredicate"])
        self.assertEqual("stand", self.results["fallback"]["nothingBound"])
        self.assertEqual("stand", self.results["fallback"]["unknownFamily"])

    def test_end_to_end_selection(self) -> None:
        end = self.results["endToEnd"]
        self.assertEqual("parachuteGlide", end["glideOnAFullRig"])
        self.assertEqual("stand", end["glideOnAnOldRig"])
        self.assertEqual("crouch", end["crouchedStillOnAFullRig"])

    def test_the_canopy_is_drawn_only_while_the_chute_carries_him(self) -> None:
        canopy = self.results["canopy"]
        # Free fall: the pack is still on his back.
        self.assertIsNone(canopy["fall"])
        self.assertIsNone(canopy["run"])
        self.assertIsNone(canopy["stand"])
        # `setIsParachuting` drives the child to "OpenParachute", which
        # transitions to "IdleParachute" when done (PARA-5).
        self.assertEqual("open", canopy["open"])
        self.assertEqual("idle", canopy["glide"])
        self.assertEqual("idle", canopy["landed"])
        self.assertEqual("idle", canopy["die"])
        self.assertEqual("idle", canopy["deadLanded"])

    def test_every_pair_swim_js_can_answer_resolves_to_a_family(self) -> None:
        self.assertEqual(
            {"swimStart": "swimStart", "swimFloat": "swimFloat",
             "swimForward": "swimForward", "swimBackward": "swimBackward",
             "swimEnd": "swimEnd", "swimDie": "swimDie"},
            self.results["swimPairs"])
        # One table, not two: the clip names here are `swim.js`'s own.
        self.assertTrue(self.results["swimTableAgrees"])
        self.assertIsNone(self.results["swimUnknown"])
        self.assertIsNone(self.results["swimNull"])
        self.assertEqual("swimForward", self.results["swimCaseInsensitive"])

    def test_swimming_replaces_the_gait_and_the_stance(self) -> None:
        # `updateSwimming` enters the swim states by name on BOTH machines
        # (`0x082823f7` / `0x08282426`), so they are whole-body states like the
        # parachute's -- a swimming man is not also running, and not also
        # crouching (the swim states declare no `c_AsmIsCrouching`).
        sel = self.results["swimSelection"]
        self.assertEqual("run", sel["running"])
        self.assertEqual("swimForward", sel["swimmingWhileRunning"])
        self.assertEqual("swimFloat", sel["swimmingWhileCrouched"])
        self.assertEqual("swimDie", sel["deadInTheWater"])
        # A canopy over water is the parachute's landing, not a swim.
        self.assertEqual("parachuteGlide", sel["underACanopyOverWater"])

    def test_a_tree_without_the_swim_bundle_falls_back_to_treading(self) -> None:
        old = self.results["swimOnAnOldRig"]
        # Never `run`: the chain goes swim -> swimFloat -> stand.
        self.assertEqual("stand", old["noSwimBundle"])
        self.assertEqual("swimFloat", old["onlyFloat"])
        self.assertEqual("swimBackward", old["fullRig"])

    def test_a_swimmer_has_no_canopy(self) -> None:
        canopy = self.results["swimCanopy"]
        self.assertIsNone(canopy["float"])
        self.assertIsNone(canopy["die"])


if __name__ == "__main__":
    unittest.main()
