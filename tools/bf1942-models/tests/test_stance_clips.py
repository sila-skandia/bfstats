"""`viewer/stance-clips.js` -- which upper-body family a stance owes.

The chains are not a viewer invention: `AnimationStates.con` declares a
separate upper-body state per stance, per weapon, and all 26 vanilla weapons
that declare `Ub_StandAim<W>` also declare `Ub_Crouch<W>`,
`Ub_CrouchForward<W>`, `Ub_CrouchRaiseWeapon<W>`, `Ub_Lie<W>`,
`Ub_LieForward<W>`, `Ub_LieFire<W>`, `Ub_LieReload<W>` and
`Ub_LieRaiseWeapon<W>`, each with a 1P clip. The survey that established that
is in `features/viewer-soldier-stance-and-blast/README.md`; reproduce it with
`bf42.animstates` over the vanilla `animations.rfa`.

Two absences are the data's and are asserted here so a later edit cannot
"complete" the table by inventing them:

  * no weapon declares `Ub_CrouchFire<W>` or `Ub_CrouchReload<W>`, so a
    crouching man fires and reloads on the standing states;
  * there is no crouch-run state -- `Ub_CrouchForward<W>` is the only forward
    crouch family -- so walking and running crouched are one clip.
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
HARNESS = Path(__file__).with_name("stance_clips_harness.mjs")
MODULES = {"stance-clips.js": VIEWER / "stance-clips.js"}

# Everything the very first viewmodel export carried. No chain may end
# anywhere else, or a rig published before this stream would resolve to a clip
# it does not hold.
ORIGINAL_FAMILIES = {"idle", "walk", "run", "fire", "reload", "deploy"}


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


class StanceClipTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_stationary_soldier_still_uses_his_stance(self) -> None:
        # The defect this module exists for: `soldier.js` `#gaitFor` answers
        # 'stand' for anything not moving, crouched and prone included, so a
        # selector keyed on the gait alone plays the standing aim in all three
        # stances.
        self.assertEqual(
            {"stand": "idle", "crouch": "crouch", "prone": "prone"},
            self.results["stationary"])

    def test_moving_picks_the_stances_own_movement_family(self) -> None:
        moving = self.results["moving"]
        self.assertEqual("walk", moving["walk"])
        self.assertEqual("run", moving["run"])
        self.assertEqual("crouchWalk", moving["crouch"])
        self.assertEqual("crawl", moving["prone"])

    def test_there_is_no_crouch_run(self) -> None:
        # `Ub_CrouchForward<W>` is the only forward crouch state in the data.
        self.assertEqual("crouchWalk", self.results["moving"]["crouchRun"])

    def test_crouch_fires_and_reloads_on_the_standing_states(self) -> None:
        actions = self.results["actions"]
        self.assertEqual("fire", actions["fireStand"])
        self.assertEqual("fire", actions["fireCrouch"])
        self.assertEqual("reload", actions["reloadCrouch"])
        # Prone has both of its own.
        self.assertEqual("proneFire", actions["fireProne"])
        self.assertEqual("proneReload", actions["reloadProne"])
        # The draw-in exists in all three stances.
        self.assertEqual("crouchDeploy", actions["deployCrouch"])
        self.assertEqual("proneDeploy", actions["deployProne"])

    def test_a_rig_without_the_stance_clips_behaves_as_it_did_before(self) -> None:
        old = self.results["oldRig"]
        self.assertEqual("idle", old["crouchIdle"])
        self.assertEqual("idle", old["proneIdle"])
        self.assertEqual("walk", old["crouchMove"])
        self.assertEqual("walk", old["proneMove"])
        self.assertEqual("fire", old["fireProne"])
        self.assertEqual("reload", old["reloadProne"])
        self.assertEqual("deploy", old["deployProne"])

    def test_every_chain_ends_on_an_original_family(self) -> None:
        for key, tail in self.results["chainTails"].items():
            self.assertIn(tail, ORIGINAL_FAMILIES, key)

    def test_with_no_rig_named_the_head_of_the_chain_is_returned(self) -> None:
        # Asking without a `has` is asking what the stance owes.
        self.assertEqual("crouch", self.results["noRig"]["crouchIdle"])
        self.assertEqual("crawl", self.results["noRig"]["proneMove"])

    def test_the_gait_names_the_moving_stances(self) -> None:
        roles = self.results["roles"]
        self.assertEqual(
            {"stand": "idle", "walk": "walk", "run": "run",
             "crouch": "walk", "prone": "walk", "nothing": "idle"},
            roles)
        stance = self.results["stance"]
        self.assertEqual("prone", stance["gaitWins"])
        self.assertEqual("crouch", stance["reportedUsed"])
        self.assertEqual("stand", stance["junk"])
        self.assertEqual("stand", stance["normalised"])

    def test_fire_variants_are_picked_per_family_and_ordered(self) -> None:
        variants = self.results["variants"]
        # `fire10` sorts after `fire2` because the suffix is a number, and the
        # prone family's own variants are not mixed in.
        self.assertEqual(["fire1", "fire2", "fire10"], variants["fire"])
        self.assertEqual(["proneFire1", "proneFire2"], variants["prone"])
        self.assertEqual([], variants["none"])

    def test_an_unknown_role_invents_nothing(self) -> None:
        self.assertIsNone(self.results["unknownRole"])


if __name__ == "__main__":
    unittest.main()
