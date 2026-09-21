"""`viewer/chase-camera.js` under node: the external-camera law.

The numbers are `Camera::getTransformation`'s own, read in both binaries
(lnxded `0x081aaf90`, client `0x005659b0`): the wanted offset is
`(-/+forward + 0.3 up) * 1.2 R`, eased by `1 - exp(-2 dt)`, trailing 0.6 s of
velocity, anchored on the seat Camera and kept 1 m above the terrain.

Which FRAME supplies forward/up is the part the round's brief and the binaries
disagree on; `chaseLawFor` pins the page's answer (the brief's by default, the
binaries' under `?chase=engine`) so a change to it is a deliberate one.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("chase_camera_harness.mjs")
MODULES = {"chase-camera.js": VIEWER / "chase-camera.js"}


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


class ChaseCameraTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertVec(self, want, got, places=5) -> None:
        self.assertEqual(len(want), len(got))
        for w, g in zip(want, got):
            self.assertAlmostEqual(w, g, places=places)

    def test_the_constants_are_the_binaries_own(self) -> None:
        self.assertEqual(
            {"radiusScale": 1.2, "upFraction": 0.3, "speedLag": 0.6,
             "easeRate": 2.0, "floorClearance": 1.0, "behind": -1, "ahead": 1},
            self.results["constants"])

    def test_bounding_radius_is_the_engine_s_recursion(self) -> None:
        self.assertEqual(2.5, self.results["radiusLeaf"])
        # |(3,0,4)| + 0.5 beats the root's own 1.
        self.assertAlmostEqual(5.5, self.results["radiusChildWins"])
        # 2 + (3 + 0.25) down the chain.
        self.assertAlmostEqual(5.25, self.results["radiusNested"])
        self.assertEqual(0, self.results["radiusEmpty"])

    def test_chase_hangs_behind_and_front_chase_ahead(self) -> None:
        # forward is -Z, so "behind" is +Z. R = 4 * 1.2, up = 0.3 R.
        self.assertVec([0, 1.44, 4.8], self.results["targetBehind"])
        self.assertVec([0, 1.44, -4.8], self.results["targetAhead"])

    def test_the_offset_swings_with_whatever_frame_it_is_given(self) -> None:
        self.assertVec([4.8, 1.44, 0], self.results["targetBehindYawed"])

    def test_the_ease_is_one_minus_exp_minus_two_dt(self) -> None:
        k = 1 - math.exp(-1.0)
        self.assertVec([0, 1.44 * k, 4.8 * k], self.results["stepHalfSecond"])

    def test_the_ease_does_not_depend_on_frame_rate(self) -> None:
        self.assertVec(self.results["stepHalfSecond"],
                       self.results["stepThirtyFrames"], places=4)

    def test_a_zero_dt_changes_nothing(self) -> None:
        self.assertEqual([1, 2, 3], self.results["stepZeroDt"])

    def test_velocity_trails_the_chase_view_and_leads_the_front_view(self) -> None:
        # 10 m/s along -Z: chase settles 6 m further back, front 6 m further on.
        self.assertVec([0, 1.44, 10.8], self.results["settledBehindMoving"], places=2)
        self.assertVec([0, 1.44, -10.8], self.results["settledAheadMoving"], places=2)

    def test_the_eye_is_anchor_plus_offset(self) -> None:
        self.assertVec([10, 6.5, 24.8], self.results["eyeClear"])

    def test_the_eye_is_kept_a_metre_above_the_terrain(self) -> None:
        self.assertVec([10, 5, 24.8], self.results["eyeLifted"])
        # ...and the lift is carried in the offset, as the engine carries it.
        self.assertVec([0, 0, 4.8], self.results["eyeLiftedRel"])
        self.assertVec([10, -25, 20], self.results["eyeNoFloor"])

    def test_the_default_is_the_brief_s_turret_frame(self) -> None:
        law = self.results["law"]
        self.assertEqual({"law": "engine", "frameFromAim": True}, law["defaultTurret"])
        self.assertEqual(law["defaultTurret"], law["unknownTurret"])

    def test_a_turretless_vehicle_is_left_exactly_as_it_was(self) -> None:
        self.assertEqual({"law": "legacy", "frameFromAim": False},
                         self.results["law"]["defaultPlain"])

    def test_chase_engine_runs_the_law_as_read_for_everything(self) -> None:
        law = self.results["law"]
        self.assertEqual({"law": "engine", "frameFromAim": False}, law["engineTurret"])
        self.assertEqual({"law": "engine", "frameFromAim": False}, law["enginePlain"])

    def test_chase_legacy_restores_the_old_framing(self) -> None:
        self.assertEqual({"law": "legacy", "frameFromAim": False},
                         self.results["law"]["legacyTurret"])


if __name__ == "__main__":
    unittest.main()
