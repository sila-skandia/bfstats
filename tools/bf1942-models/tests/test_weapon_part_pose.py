"""weapon-part-pose.js: a first-person rig's weapon parts are never crossfaded.

The weapon's bones belong to its own state machine, and a weapon one-shot
ends in `StopDummyState`, whose `resetSkeleton` puts every bone back at rest
the frame it is entered (ledger ANIM-22). The page baked those parts into the
arms clips and so faded them at the arms' rate: BF1918's Berthier case,
thrown 0.43 m right by the bolt, drifted back into the action for 1.4 s after
every shot. The harness runs the module against a real three.js mixer.
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
HARNESS = Path(__file__).resolve().parent / "weapon_part_pose_harness.mjs"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "weapon-part-pose.js", work / "weapon-part-pose.js")
        three = work / "node_modules" / "three"
        three.mkdir(parents=True)
        shutil.copyfile(VIEWER / "vendor" / "three.module.js", three / "three.module.js")
        (three / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class WeaponPartPoseTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_only_bound_parts_are_collected(self) -> None:
        self.assertEqual(["BerthierShell"], self.r["parts"])
        self.assertEqual(["position"], self.r["boltTracks"])
        self.assertFalse(self.r["deployTracks"])

    def test_the_case_follows_the_bolt_while_it_runs(self) -> None:
        self.assertGreater(self.r["midBoltOffRest"], 0.3)

    def test_a_finished_bolt_puts_the_case_home(self) -> None:
        # The mixer alone holds the clamped last frame, 0.43 m out.
        self.assertGreater(self.r["clampedMixerOffRest"], 0.4)
        self.assertEqual(0.0, self.r["clampedPosedOffRest"])

    def test_the_fade_to_the_aim_does_not_drag_the_case_back(self) -> None:
        # The defect: 0.3 s into the 1.43 s fade the case is still well out.
        self.assertGreater(self.r["fadeMixerOffRest"], 0.25)
        self.assertEqual(0.0, self.r["fadePosedOffRest"])
        self.assertTrue(self.r["handStillBlending"])

    def test_a_clip_fading_in_owns_the_parts_at_full_weight(self) -> None:
        self.assertLess(self.r["fadeInPosedMatchesClip"], 1e-3)

    def test_no_owner_or_no_track_is_rest(self) -> None:
        self.assertEqual(0.0, self.r["noOwnerOffRest"])
        self.assertEqual(0.0, self.r["noTrackOffRest"])

    def test_a_loop_is_never_reset(self) -> None:
        self.assertGreater(self.r["loopAtEndOffRest"], 0.4)


if __name__ == "__main__":
    unittest.main()
