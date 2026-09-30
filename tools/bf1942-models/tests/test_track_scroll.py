"""`viewer/track-scroll.js` under node: a tank's belts scroll as the engine
scrolls them.

`AnimatedBundle::updateAnimations` (lnxded `0x08266080`, reached from
`handleVisualUpdate` `0x08265730`; client `0x0054f580`) adds
`getCurrentRatio() * getCurrentDifferentialRPM(relativePosition.x) *
animatedTextureSpeed` to the belt's texture offset once a visual update, and
only when the belt's parent is an Engine. The page pins that step to 60
visual updates a second (`TRACK_VISUAL_HZ`), runs it per world tick for a hull
the world integrates, and from the drawn motion for a hull presented from
outside (a replay, a room's remote), whose engine nobody carries.

One node run (`track_scroll_harness.mjs`), many assertions.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "track_scroll_harness.mjs"

# `speed * TRACK_VISUAL_HZ` in texture widths per metre of contact speed.
PER_METRE = 0.006 * 60


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def wrapped(delta: float) -> float:
    """A change of offset, back from the [0, 2) wrap into [-1, 1)."""
    return (delta + 1) % 2 - 1


class TrackScrollTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- which belts, and whose material --------------------------------------

    def test_belts_are_the_bundles_under_the_engine(self) -> None:
        collect = self.results["collect"]
        # The stray scrolling bundle outside the Engine is not one: the engine
        # gives a belt whose parent is no PhysicsEngine a rate of 0.
        self.assertEqual(["ShermanTrackL", "ShermanTrackR"], collect["names"])
        self.assertEqual([0.006, 0], collect["speed"])

    def test_the_side_is_the_belt_node_s_x_and_the_lateral_its_wheels(self) -> None:
        collect = self.results["collect"]
        self.assertAlmostEqual(-0.009, collect["sideL"])
        self.assertAlmostEqual(0.01, collect["sideR"])
        self.assertAlmostEqual(-1.008, collect["lateralL"], places=3)
        self.assertAlmostEqual(1.01, collect["lateralR"], places=3)

    def test_each_belt_scrolls_a_map_of_its_own_over_the_same_image(self) -> None:
        collect = self.results["collect"]
        self.assertTrue(collect["ownMaterials"])
        self.assertTrue(collect["ownMaps"])
        self.assertTrue(collect["sameImage"])

    def test_the_page_s_shading_hooks_survive_the_clone(self) -> None:
        self.assertTrue(self.results["collect"]["keptHooks"])

    def test_a_belt_is_cloned_once(self) -> None:
        self.assertTrue(self.results["collect"]["sameBeltsTwice"])
        self.assertTrue(self.results["collect"]["cached"])

    # --- the engine's rate ------------------------------------------------------

    def test_a_straight_tank_runs_both_belts_at_ratio_times_revs(self) -> None:
        rate = self.results["engineRate"]
        self.assertEqual(4, rate["ratio"])
        self.assertEqual([4, 4], rate["straight"])

    def test_steering_splits_the_sides_by_the_differential(self) -> None:
        # steer 0.5: left (1 + 0.75) clamps to 1, right (1 - 0.75) = 0.25.
        self.assertEqual([4, 1], self.results["engineRate"]["right"])

    def test_no_revs_no_scroll(self) -> None:
        self.assertEqual([0, 0], self.results["engineRate"]["stopped"])

    def test_a_tank_s_belt_is_clamped_to_one_a_centred_one_is_not(self) -> None:
        rate = self.results["engineRate"]
        self.assertEqual([4, 4], rate["overrev"])
        self.assertEqual(4, rate["centred"])

    def test_a_car_engine_runs_both_sides_at_the_raw_revs(self) -> None:
        self.assertEqual([4.8, 4.8], self.results["engineRate"]["car"])
        self.assertEqual(0, self.results["engineRate"]["none"])

    # --- the step ---------------------------------------------------------------

    def test_one_step_is_rate_speed_hz_dt_on_top_of_the_map_s_own_offset(self) -> None:
        step = self.results["step"]
        self.assertEqual(60, step["hz"])
        self.assertAlmostEqual(0.25 + 10 * PER_METRE / 30, step["one"])
        self.assertAlmostEqual(10 * PER_METRE / 30, step["oneOffset"])

    def test_the_step_does_not_depend_on_frame_rate(self) -> None:
        self.assertAlmostEqual(self.results["step"]["one"], self.results["step"]["halves"])

    def test_no_rate_or_no_time_moves_nothing(self) -> None:
        self.assertEqual(0.25, self.results["step"]["frozen"])

    def test_reverse_scrolls_back_and_a_long_drive_stays_wrapped(self) -> None:
        step = self.results["step"]
        self.assertAlmostEqual(-10 * PER_METRE / 30, wrapped(step["back"] - 0.25))
        self.assertGreaterEqual(step["longOffset"], 0)
        self.assertLess(step["longOffset"], 2)

    # --- motion -------------------------------------------------------------------

    def test_body_motion_is_in_the_hull_s_own_frame(self) -> None:
        motion = self.results["motion"]
        self.assertEqual(5, motion["forward"])
        self.assertEqual(0.5, motion["yawRate"])

    def test_a_pivot_to_the_left_runs_the_belts_against_each_other(self) -> None:
        self.assertEqual([-0.5, 0.5], self.results["motion"]["pivot"])

    def test_motion_between_two_poses(self) -> None:
        motion = self.results["motion"]
        self.assertAlmostEqual(0.5, motion["betweenYaw"], places=3)
        self.assertAlmostEqual(5, motion["betweenForward"], places=1)
        self.assertEqual({"forward": 0, "yawRate": 0}, motion["still"])

    # --- the drives ----------------------------------------------------------------

    def test_an_integrated_tank_scrolls_both_belts_under_throttle(self) -> None:
        drive = self.results["drive"]
        self.assertLess(max(abs(v) for v in drive["idle"]), 1e-3)
        self.assertGreater(drive["driven"][0], 0.5)
        self.assertEqual(drive["driven"][0], drive["driven"][1])
        self.assertGreater(drive["revs"], 0.5)

    def test_an_integrated_hull_is_drawn_between_its_last_two_ticks(self) -> None:
        # local-look.js draws the hull at `alpha` between ticks; its belts go
        # with it, or 0.18 of a 0.25 link pattern a tick reads as backwards.
        drawn = self.results["presentAlpha"]
        self.assertGreater(drawn["lastStep"], 0)
        self.assertAlmostEqual(drawn["tick"] - drawn["lastStep"] / 2, drawn["half"], places=5)
        self.assertAlmostEqual(drawn["tick"], drawn["whole"], places=5)

    def test_full_lock_right_runs_the_left_belt_on_and_the_right_back(self) -> None:
        # right: clamp(revs * (1 - 1.5)) < 0, left: clamp(revs * 2.5) = 1.
        drive = self.results["drive"]
        self.assertGreater(wrapped(drive["turnL"]), 0)
        self.assertLess(wrapped(drive["turnR"]), 0)

    def test_a_presented_tank_scrolls_from_its_recorded_motion(self) -> None:
        present = self.results["present"]
        # 0.8 rad/s left about the belts' lateral place, 1.008 m out.
        self.assertAlmostEqual(-0.8 * 1.008 * PER_METRE / 30, wrapped(present["pivotL"]), places=4)
        self.assertAlmostEqual(0.8 * 1.01 * PER_METRE / 30, wrapped(present["pivotR"]), places=4)
        self.assertAlmostEqual(8 * PER_METRE / 30, wrapped(present["straightL"]), places=6)
        self.assertAlmostEqual(8 * PER_METRE / 30, wrapped(present["straightR"]), places=6)

    def test_a_remote_replica_scrolls_from_its_drawn_poses(self) -> None:
        remote = self.results["remote"]
        self.assertAlmostEqual(10, remote["forward"])
        self.assertAlmostEqual(10 * PER_METRE * 0.1, remote["L"])
        self.assertAlmostEqual(remote["L"], remote["R"])
        self.assertEqual(remote["L"], remote["afterNullEngine"])


class TrackScrollWiringTests(unittest.TestCase):
    """Every drawn hull kind reaches `track-scroll.js`."""

    def read(self, name: str) -> str:
        return (VIEWER / name).read_text(encoding="utf-8")

    def test_the_integrated_drives_scroll_from_their_engine(self) -> None:
        for name in ("tracked-vehicle.js", "wheeled-vehicle.js"):
            text = self.read(name)
            integrate = text[text.index("  integrate(dt) {"):]
            integrate = integrate[:integrate.index("\n  }\n")]
            self.assertIn("scrollBeltsByEngine(this.node, this.engine, dt)", integrate, name)

    def test_the_presented_drives_scroll_from_their_motion(self) -> None:
        for name in ("tracked-vehicle.js", "wheeled-vehicle.js"):
            text = self.read(name)
            present = text[text.index("  presentKinematic(dt, throttle = 0, running = true) {"):]
            present = present[:present.index("\n  }\n")]
            self.assertIn("scrollBeltsByMotion(this.node, bodyMotion(", present, name)

    def test_a_room_s_remote_replica_scrolls_from_its_poses(self) -> None:
        text = self.read("netcode-render.js")
        self.assertIn("scrollBeltsByMotion(v.group,", text)
        self.assertIn("motionBetween(v.lastPos, v.lastQuat,", text)

    def test_the_drawn_hulls_draw_their_belts_between_ticks(self) -> None:
        text = self.read("local-look.js")
        interp = text[text.index("  function applyVehicleInterp(alpha) {"):]
        interp = interp[:interp.index("\n  }\n")]
        self.assertIn("presentBelts(rec.root, alpha)", interp)

    def test_a_replay_hull_is_presented_by_the_drive(self) -> None:
        # replay-hulls.js hands every recorded frame to the drive's own
        # `presentKinematic`, which is where the belts step.
        self.assertIn("drive.presentKinematic(", self.read("replay-hulls.js"))


if __name__ == "__main__":
    unittest.main()
