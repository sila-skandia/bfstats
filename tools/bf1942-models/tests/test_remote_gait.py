"""`viewer/remote-gait.js` -- the clip a third-person soldier owes.

A remote player in a room arrives as a position stream plus two stance bits
(`netcode.js` snapshot flags 4 and 8). Turning that into a clip was wrong in
three name-level ways, none of which could throw:

  * the gait halves are baked as `run.lower` / `run.upper` and bound as
    `runLower` / `runUpper`, and selection asked for `actions.run` and
    `actions.walk` -- names that never existed, so **a remote soldier never
    played a walk or a run at all**;
  * the prone pose clip is baked as `lie` (the engine's own word: `Lb_Lie`,
    `c_BfSoldierLying`) and selection asked for `prone`, so a prone remote
    stood up;
  * `crouchwalk` and `crawl` are in every published gait bundle and nothing
    referenced them.

Read back out of the published tree to be sure, not assumed:
`USMarineSoldier__Colt.pose.glb` holds exactly `stand`, `crouch`, `lie`, and
`gaits/lower.gait.glb` holds `run.lower`, `walk.lower`, `crouchwalk.lower`,
`crawl.lower` with each grip bundle carrying the four `.upper`. That check is
`test_the_clip_names_are_the_published_files_own` below, which skips when the
tree is not linked into the worktree.

The speed bands are the engine's own tables rather than new numbers:
`BFSoldierTemplate::directionalSpeed` (`0x009581b4`, `physics.js`
`DIRECTIONAL_SPEED`) is 6 m/s standing forward, 2 crouched, 1 prone, and
`walkSpeedFactor` 1/3 puts a standing walk at 2. A boundary sits at the
midpoint of the two speeds it separates -- `gait-select.js`'s own rule.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("remote_gait_harness.mjs")
MODULES = {"remote-gait.js": VIEWER / "remote-gait.js"}
POSES = VIEWER / "models" / "poses"


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


def glb_animation_names(path: Path) -> list[str]:
    data = path.read_bytes()
    json_size, kind = struct.unpack_from("<II", data, 12)
    assert kind == 0x4E4F534A, path
    doc = json.loads(data[20:20 + json_size])
    return [anim.get("name") for anim in doc.get("animations", [])]


class RemoteGaitTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_bands_are_the_engines_own_speed_tables(self) -> None:
        self.assertEqual({"stand": 6, "crouch": 2, "prone": 1},
                         self.results["topSpeed"])
        self.assertAlmostEqual(1 / 3, self.results["walkFactor"])
        bands = self.results["bands"]
        self.assertAlmostEqual(1.0, bands["walk"])    # half of the 2 m/s walk
        self.assertAlmostEqual(4.0, bands["run"])     # midpoint of 2 and 6
        # Crouch and prone have one movement family, so their boundary
        # separates still from the SLOWEST speed it covers -- the stance's
        # walk speed, since `walkSpeedFactor` applies in every pose.
        self.assertAlmostEqual(1 / 3, bands["crouch"])   # half of 2 x 1/3
        self.assertAlmostEqual(1 / 6, bands["prone"])    # half of 1 x 1/3

    def test_a_standing_soldier_walks_and_runs(self) -> None:
        standing = self.results["standing"]
        self.assertEqual("stand", standing["still"])
        self.assertEqual("stand", standing["creeping"])
        # The bands are strict, so sitting exactly on one keeps the lower gait.
        self.assertEqual("stand", standing["atWalkBand"])
        self.assertEqual("walk", standing["walking"])
        self.assertEqual("walk", standing["betweenBands"])
        self.assertEqual("walk", standing["atRunBand"])
        self.assertEqual("run", standing["running"])
        # A speed is a magnitude, and a missing one is standing still.
        self.assertEqual("run", standing["negative"])
        self.assertEqual("stand", standing["nonsense"])

    def test_crouch_has_one_movement_family(self) -> None:
        crouched = self.results["crouched"]
        self.assertEqual("crouch", crouched["still"])
        self.assertEqual("crouch", crouched["atBand"])
        # A crouched man with the walk key down makes 0.67 m/s; he is moving.
        self.assertEqual("crouchwalk", crouched["walking"])
        self.assertEqual("crouchwalk", crouched["moving"])
        # There is no crouch-run: a lerp that overshoots still crouch-walks.
        self.assertEqual("crouchwalk", crouched["fast"])

    def test_prone_crawls_and_outranks_crouch(self) -> None:
        prone = self.results["prone"]
        self.assertEqual("prone", prone["still"])
        self.assertEqual("prone", prone["atBand"])
        # And with the walk key down, 0.33 m/s: still a crawl.
        self.assertEqual("crawl", prone["walking"])
        self.assertEqual("crawl", prone["crawling"])
        # `soldier.js` `#gaitFor` tests prone first; so does this.
        self.assertEqual("prone", prone["bothBits"])
        self.assertEqual("crawl", prone["bothBitsMoving"])

    def test_a_full_rig_plays_the_family_it_was_asked_for(self) -> None:
        self.assertEqual(
            {"stand": "stand", "walk": "walk", "run": "run",
             "crouch": "crouch", "crouchwalk": "crouchwalk",
             "prone": "prone", "crawl": "crawl"},
            self.results["resolvedFull"])

    def test_a_rig_with_no_gait_bundle_keeps_the_stance(self) -> None:
        # The fallbacks go toward the stance before they go toward standing: a
        # crawling man whose crawl did not bind is better drawn lying still.
        poses = self.results["resolvedPoses"]
        self.assertEqual("stand", poses["walk"])
        self.assertEqual("stand", poses["run"])
        self.assertEqual("crouch", poses["crouchwalk"])
        self.assertEqual("prone", poses["crawl"])
        self.assertEqual("prone", poses["prone"])

    def test_the_defect_this_replaces_is_pinned(self) -> None:
        # With only the two names the old code could ever reach, everything
        # prone or moving collapsed onto a standing pose. That is what the
        # page drew.
        broken = self.results["resolvedBroken"]
        self.assertEqual("stand", broken["walk"])
        self.assertEqual("stand", broken["run"])
        self.assertEqual("stand", broken["prone"])
        self.assertEqual("stand", broken["crawl"])
        self.assertEqual("crouch", broken["crouchwalk"])

    def test_an_unknown_family_and_an_unnamed_rig(self) -> None:
        self.assertEqual("crawl", self.results["resolvedNoBound"])
        self.assertEqual("stand", self.results["resolvedUnknown"])

    def test_end_to_end(self) -> None:
        end = self.results["endToEnd"]
        self.assertEqual("prone", end["proneStill"])
        self.assertEqual("crawl", end["proneCrawling"])
        self.assertEqual("crouchwalk", end["crouchMoving"])
        self.assertEqual("run", end["running"])
        self.assertEqual("stand", end["runningPosesOnly"])
        self.assertEqual("prone", end["crawlingPosesOnly"])

    def test_the_clip_names_are_the_published_files_own(self) -> None:
        pose = POSES / "USMarineSoldier__Colt.pose.glb"
        lower = POSES / "gaits" / "lower.gait.glb"
        upper = POSES / "gaits" / "Colt.gait.glb"
        if not (pose.exists() and lower.exists() and upper.exists()):
            raise unittest.SkipTest("the poses tree is not linked into this worktree")
        clips = self.results["clips"]
        pose_names = glb_animation_names(pose)
        # The prone pose is `lie`, which is the name the renderer asked for
        # wrongly for as long as this code has existed.
        self.assertIn("lie", pose_names)
        self.assertNotIn("prone", pose_names)
        for family in ("stand", "crouch", "prone"):
            self.assertIn(clips[family]["pose"], pose_names, family)
        lower_names = glb_animation_names(lower)
        upper_names = glb_animation_names(upper)
        for family in ("walk", "run", "crouchwalk", "crawl"):
            self.assertIn(clips[family]["lower"], lower_names, family)
            self.assertIn(clips[family]["upper"], upper_names, family)


class ReplayGaitFamilyTests(unittest.TestCase):
    """`replayGait`: the family a REPLAYED soldier draws.

    The replay picked its family from `gait-select.js` alone, which returns
    idle/walk/run and knows nothing of stance -- it was written when the
    recorder captured none. A crouch-walk travels 2 x walkSpeedFactor = 0.67
    m/s and a crawl 1 x = 0.33, both under the standing walk band of 1.0, so
    every crouching and prone sample read as standing still while the body
    translated: the soldier slid. Measured on replay_20261018-233939 against
    the engine's own recorded lower state, 73 of 73 crouching samples drew
    idle. Now that bf42plus records the state table these are reachable, and
    this pins each one against the band that used to swallow it.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.gait = run_harness()["replayGait"]

    def test_a_standing_soldier_reads_as_he_always_did(self) -> None:
        self.assertEqual("idle", self.gait["standingStill"])
        self.assertEqual("walk", self.gait["standingWalk"])
        self.assertEqual("run", self.gait["standingRun"])

    def test_a_crouch_walk_is_a_crouch_walk_not_a_stand(self) -> None:
        # 0.67 m/s: the exact speed the standing band called idle.
        self.assertEqual("crouchwalk", self.gait["crouchWalking"])
        self.assertEqual("crouch", self.gait["crouchStill"])

    def test_a_crawl_is_a_crawl_not_a_stand(self) -> None:
        # 0.33 m/s, likewise.
        self.assertEqual("crawl", self.gait["crawling"])
        self.assertEqual("prone", self.gait["proneStill"])

    def test_a_recording_with_no_stance_reads_on_speed_alone(self) -> None:
        # Every FHSW-family round recorded before 2026-10-18 has `st` rows and
        # no state table, so bodyAt gives null and this is all there is.
        self.assertEqual("run", self.gait["noBodyRunning"])
        self.assertEqual("idle", self.gait["noBodyStill"])


class RecordedLowerStateTests(unittest.TestCase):
    """`recordedGait` / `recordedStanceEntry`: the replay plays the engine's
    own recorded lower state instead of guessing it from the drawn speed.

    8t224pppqe (berlin, pid 1 "BF6", net id 899) in the 3P follow camera: the
    legs reached the run 0.22 s after he started strafing at 39.33 (stand,
    walk, run as a one-pole speed crossed the bands), a recorded
    `Lb_RunBackward` at the backward table's speed flickered run -> walk ->
    run 74 times, the dive at 35.83 drew as lying down backwards and slid,
    and the get-up the recording starts at 36.46 was started at 36.84, where
    the stance flag changes. Names and rates are vanilla's
    `AnimationStates*.con` through `bf42/animstates.py`.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def gait(self, name: str) -> tuple[str, bool]:
        g = self.out["recordedGait"][name]
        self.assertIsNotNone(g, name)
        return g["family"], g["reverse"]

    def test_the_standing_states(self) -> None:
        for name in ("Lb_Stand", "Lb_StandRelax", "Lb_StandJump"):
            self.assertEqual(("stand", False), self.gait(name), name)

    def test_the_strafes_and_the_jumps_are_the_forward_run(self) -> None:
        # `Lb_StrafeLeft 3PRunLower.baf 1.3`; `Lb_RunJump` returns to
        # `Lb_RunForward`, the family under its own clip (`recordedClip`).
        for name in ("Lb_RunForward", "Lb_StrafeLeft", "Lb_StrafeRight", "Lb_RunJump"):
            self.assertEqual(("run", False), self.gait(name), name)

    def test_backward_states_play_their_clip_backwards(self) -> None:
        self.assertEqual(("run", True), self.gait("Lb_RunBackward"))
        self.assertEqual(("run", True), self.gait("Lb_RunJumpBackward"))
        self.assertEqual(("walk", True), self.gait("Lb_WalkBackward"))
        self.assertEqual(("walk", False), self.gait("Lb_WalkForward"))
        self.assertEqual(("crouchwalk", True), self.gait("Lb_CrouchBackward"))
        self.assertEqual(("crawl", True), self.gait("Lb_LieBackward"))

    def test_crouch_and_prone(self) -> None:
        self.assertEqual(("crouch", False), self.gait("Lb_Crouch"))
        self.assertEqual(("crouchwalk", False), self.gait("Lb_CrouchForward"))
        self.assertEqual(("crouchwalk", False), self.gait("Lb_CrouchStrafeLeft"))
        self.assertEqual(("prone", False), self.gait("Lb_Lie"))
        self.assertEqual(("crawl", False), self.gait("Lb_LieForward"))
        self.assertEqual(("crawl", False), self.gait("Lb_LieStrafeRight"))

    def test_a_transition_is_the_stance_it_lands_in(self) -> None:
        self.assertEqual("crouch", self.gait("Lb_StandToCrouch")[0])
        self.assertEqual("stand", self.gait("Lb_CrouchToStand")[0])
        for name in ("Lb_RunStandToLie", "Lb_StandToLie", "Lb_CrouchToLie"):
            self.assertEqual("prone", self.gait(name)[0], name)
        self.assertEqual("crouch", self.gait("Lb_LieToCrouch")[0])
        self.assertEqual("stand", self.gait("Lb_LieToStand")[0])

    def test_names_it_does_not_know_leave_the_speed_to_guess(self) -> None:
        self.assertEqual(("run", False), self.gait("LB_RUNFORWARD"))
        self.assertIsNone(self.out["recordedGait"]["Lb_StartSwim"])
        self.assertIsNone(self.out["recordedGait"]["Lb_ParachuteFall"])
        self.assertEqual([None, None, None], self.out["recordedGaitNone"])

    def test_replay_gait_reads_the_state_before_the_speed(self) -> None:
        g = self.out["recordedReplayGait"]
        self.assertEqual("run", g["runBackwardSlow"])     # the speed said walk
        self.assertEqual("run", g["strafeStarting"])      # the speed said idle
        self.assertEqual("idle", g["standingStill"])
        self.assertEqual("run", g["modState"])            # unknown: speed

    def test_the_chain_starts_where_the_recording_enters_it(self) -> None:
        e = self.out["recordedStanceEntry"]
        self.assertEqual({"from": "stand", "to": "prone", "backward": False}, e["dive"])
        self.assertEqual({"from": "stand", "to": "prone", "backward": True}, e["lieDownBackwards"])
        self.assertEqual({"from": "prone", "to": "stand", "backward": False}, e["getUp"])
        self.assertEqual({"from": "crouch", "to": "prone", "backward": False}, e["crouchToLie"])
        self.assertEqual({"from": "crouch", "to": "stand", "backward": False}, e["standUp"])
        self.assertEqual({"from": "stand", "to": "crouch", "backward": False}, e["crouch"])
        self.assertEqual({"from": "prone", "to": "crouch", "backward": False}, e["lieToCrouch"])

    def test_a_chain_going_on_starts_nothing(self) -> None:
        e = self.out["recordedStanceEntry"]
        self.assertIsNone(e["chainGoesOn"])
        self.assertIsNone(e["getUpGoesOn"])
        self.assertIsNone(e["notAChain"])
        self.assertIsNone(e["nothing"])


class RecordedClipTests(unittest.TestCase):
    """`recordedClip`: the recorded states a half enters by the name the
    bundles file their clip under (`extract_pose.py` `LOWER_ACTIONS`,
    `UPPER_ACTIONS`), on 8t224pppqe the jump at 26.86, the knife's draw at
    27.00 and the backward run."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()["recordedClip"]

    def test_the_lower_states_keep_their_names(self) -> None:
        self.assertEqual("Lb_RunJump", self.out["runJump"])
        self.assertEqual("Lb_StandJump", self.out["standJump"])
        self.assertEqual("Lb_RunJumpBackward", self.out["runJumpBackward"])
        self.assertEqual("Lb_RunBackward", self.out["runBackward"])

    def test_states_a_gait_draws_name_no_clip(self) -> None:
        self.assertIsNone(self.out["runForward"])
        self.assertIsNone(self.out["upperAsLower"])
        self.assertIsNone(self.out["upperFire"])
        self.assertIsNone(self.out["resetRaise"])
        self.assertIsNone(self.out["upperBare"])
        self.assertIsNone(self.out["nothing"])

    def test_an_upper_state_loses_its_item(self) -> None:
        self.assertEqual("Ub_StandRaiseWeapon", self.out["drawKnife"])
        self.assertEqual("Ub_StandRaiseWeapon", self.out["drawKnifeAnyCase"])
        self.assertEqual("Ub_StandRaiseWeapon", self.out["drawNoWeapon"])
        self.assertEqual("Ub_RunJump", self.out["upperJump"])
        self.assertEqual("Ub_StandJump", self.out["upperStandJump"])
        self.assertEqual("Ub_RunBackward", self.out["upperBackward"])

    def test_another_items_state_is_not_this_bodys(self) -> None:
        self.assertIsNone(self.out["drawKnifeOnMp40"])


if __name__ == "__main__":
    unittest.main()
