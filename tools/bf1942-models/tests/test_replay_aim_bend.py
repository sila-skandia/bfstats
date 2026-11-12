"""A replayed soldier's torso bends to his recorded aim (`replay-gait.js` `bendTorso`).

The recorders write each soldier's aim register in every `st` row, and his
rounds and the replay's camera leave along his body raised by
`AIM_PITCH_SCALE` (2.5) times it and turned by `AIM_TWIST_SCALE` (3) times
the twist (ledger VIEW-14). The drawn body stood level: a man firing at an
aircraft had his rounds leaving above his head
(features/replay-feature-sweep-2026-11-01, entry 1). The harness poses a
skeleton shaped like the pose glb's and reads the chest's forward back.

Run with `python3 -m unittest tests.test_replay_aim_bend` from
tools/bf1942-models.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_aim_bend_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayAimBendTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_chest_points_where_the_camera_and_rounds_do(self) -> None:
        # On a yawed, leaning body, for pitch up and down, twist each way and
        # both at once: the drawn chest's forward is the view's.
        for m in self.r["matches"]:
            with self.subTest(pitch=m["pitch"], twist=m["twist"]):
                self.assertLess(m["offDeg"], 1e-3)

    def test_a_positive_aim_raises_the_chest_by_the_rounds_scale(self) -> None:
        for m in self.r["matches"]:
            if m["twist"] == 0:
                with self.subTest(pitch=m["pitch"]):
                    self.assertAlmostEqual(m["pitch"] * 2.5, m["riseDeg"], places=6)

    def test_holding_an_aim_does_not_wind_the_torso(self) -> None:
        # three's mixer writes a bone only when its value changed, so the bend
        # has to come off before the mixer runs.
        c = self.r["compounding"]
        self.assertLess(c["maxDrift"], 1e-6)
        self.assertLess(c["restored"], 1e-3)
        # A clip that writes the bone moves the base under the bend.
        self.assertLess(c["onClip"], 0.01)
        # And the trap is real: without the unbend, ten frames of 10 degrees
        # wind far past it.
        self.assertGreater(c["windWithoutUnbend"], 40)

    def test_lying_down_takes_the_bend_off(self) -> None:
        s = self.r["stances"]
        self.assertAlmostEqual(25.0, s["standing"], places=6)
        easing = s["easing"]
        # Eased off at 12 a second, never back on, and gone within half a second.
        self.assertTrue(all(a > b for a, b in zip(easing, easing[1:])))
        self.assertLess(easing[-1], 0.1)
        self.assertLess(s["afterCut"], 1e-3)
        # Lying bends too, under its own limits (ANIM-23, `updateAnimations`
        # 0x0826f0ed); it used to be off.
        self.assertEqual({"stand": True, "crouch": True, "prone": True, "none": True}, s["bends"])

    def test_the_bend_is_clamped_where_the_engine_clamps_it(self) -> None:
        # `BFSoldier::updateAnimations` holds the drawn pitch at +-20 register
        # degrees standing and crouched (0x086c0314 / 0x086d26f0), 2.5 drawn
        # each over the spine: 40 up or down draws 50. Lying it is the
        # template's `setLiePointUpDownAngle 0.0 -6.0` (0x0826f109 /
        # 0x0826f122): up only, at most 6 (15 drawn). ANIM-23. The old clamp
        # was the page's 60 drawn degrees.
        c = self.r["clamp"]
        self.assertEqual(60, c["max"])
        self.assertAlmostEqual(50.0, c["drawn"], places=4)
        self.assertAlmostEqual(50.0, c["standDown40"], places=4)
        self.assertAlmostEqual(7.5, c["proneUp3"], places=4)
        self.assertAlmostEqual(15.0, c["proneUp10"], places=4)
        self.assertAlmostEqual(0.0, c["proneDown10"], places=4)

    def test_the_fallback_rig_bends_through_set_gait_pose(self) -> None:
        f = self.r["fallback"]
        # Found under the name GLTFLoader gives it (`Spine_Root`): a plain
        # name match missed it on every real body.
        self.assertEqual("Spine_Root", f["found"])
        self.assertAlmostEqual(15.0, f["rise1"], places=6)
        self.assertAlmostEqual(f["rise1"], f["rise10"], places=6)


if __name__ == "__main__":
    unittest.main()
