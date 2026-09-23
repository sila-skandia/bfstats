"""`viewer/gait-select.js` under node, against real recorded soldier lives.

Same trick as `test_soldier.py`: the module under test imports `soldier.js`
(for the engine's own speed tables) and nothing else browser-specific, so it
runs under plain `node` and can be asserted on directly rather than only in a
browser. `gait_select_harness.mjs` parses the two real recordings in
`tests/fixtures/` (round-replay-capture README sec 11.8) with a small,
independent NDJSON reader -- it does not import `replay.js`, which pulls in
`three` and cannot run under plain node (see the harness's own header) -- and
prints one JSON blob: measured speed distributions, the debounced gait
timeline, a handful of named real instants picked by hand from the raw data,
and a set of synthetic edge cases for exact, controlled assertions.

This is deliberately the *only* place that asserts on real recorded numbers.
`gait-select.js`'s own doc comments cite specific measurements (the run
cluster, the lateral/strafe cluster, the teleport artifact); this file is
what keeps those citations honest if the module or the fixtures ever change.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULES = [
    ROOT / "viewer" / "gait-select.js",
    ROOT / "viewer" / "soldier.js",
    ROOT / "viewer" / "physics.js",
    ROOT / "viewer" / "soldier-pose.js",
    ROOT / "viewer" / "soldier-locomotion.js",
    ROOT / "viewer" / "point-body.js",
    ROOT / "viewer" / "fixed-step.js",
    ROOT / "viewer" / "parachute.js",
    ROOT / "viewer" / "swim.js",
    ROOT / "viewer" / "spawn-safety.js",
]
HARNESS = Path(__file__).resolve().parent / "gait_select_harness.mjs"
FIXTURES = Path(__file__).resolve().parent / "fixtures"

FILE_213110 = "replay_20260915-213110.ndjson"
FILE_210619 = "replay_20260915-210619.ndjson"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for fixture in (FILE_213110, FILE_210619):
        if not (FIXTURES / fixture).exists():
            raise unittest.SkipTest(f"missing fixture {fixture}")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "package.json").write_text('{"type": "module"}')
        (work / "viewer").mkdir()
        for module in MODULES:
            shutil.copyfile(module, work / "viewer" / module.name)
        (work / "tests").mkdir()
        shutil.copyfile(HARNESS, work / "tests" / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "tests" / "harness.mjs"), str(FIXTURES)],
            capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class GaitSelectConstantsTests(unittest.TestCase):
    """The classification thresholds are derived from soldier.js's engine
    tables, not independently chosen -- these pin the derivation down."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_forward_speeds_are_gait_speed(self) -> None:
        c = self.results["constants"]
        self.assertEqual(6, c["forwardRun"])
        self.assertEqual(2, c["forwardWalk"])

    def test_lateral_speeds_come_from_strafe_and_directional_tables_agreeing(self) -> None:
        # physics.js DIRECTIONAL_SPEED[1] (no forward input at all: standing
        # still or backing up) and STRAFE_SPEED[0] (standing strafe) are two
        # independently declared engine numbers that happen to both be 4 --
        # gait-select.js asserts this at import time and throws if it ever
        # stops holding, so this is re-checked here against the values that
        # actually flowed through, not the literal 4.
        c = self.results["constants"]
        self.assertEqual(c["directionalSpeed1"], c["strafeSpeed0"])
        self.assertEqual(4, c["lateralRun"])
        self.assertAlmostEqual(4 / 3, c["lateralWalk"], places=6)

    def test_boundaries_are_midpoints_of_the_engine_speeds(self) -> None:
        c = self.results["constants"]
        self.assertAlmostEqual(1.0, c["forwardWalkMin"], places=6)
        self.assertAlmostEqual(4.0, c["forwardRunMin"], places=6)
        self.assertAlmostEqual(2 / 3, c["lateralWalkMin"], places=6)
        self.assertAlmostEqual(8 / 3, c["lateralRunMin"], places=6)

    def test_timing_constants(self) -> None:
        c = self.results["constants"]
        self.assertAlmostEqual(0.1, c["samplePeriod"], places=6)
        self.assertAlmostEqual(0.2, c["minDwellS"], places=6)
        self.assertAlmostEqual(0.15, c["gapThreshold"], places=6)
        self.assertEqual(12, c["teleportSpeed"])


class GaitSelectRealRecordingTests(unittest.TestCase):
    """Point 2 (measure, don't trust the reference speeds) and point 4
    (demonstrate no chatter), against both real recordings in
    tests/fixtures/."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_measured_run_speed_is_close_to_but_not_exactly_the_reference(self) -> None:
        for name in (FILE_213110, FILE_210619):
            median = self.results["recordings"][name]["rawSpeedStats"]["median"]
            # The dominant activity in both recordings is forward running
            # (round-replay-capture README sec 11.8's Sherman/jeep fight, on
            # foot in between), so the whole-life median lands in the run
            # band -- close to the engine's 6 m/s, not equal to it.
            self.assertGreater(median, 5.0, name)
            self.assertLess(median, 6.5, name)
            self.assertNotEqual(6.0, median, name)

    def test_no_leftover_teleport_or_jitter_inflation_in_the_speed_distribution(self) -> None:
        # Regression guard for two real artifacts found while building this:
        # (a) a vehicle-exit position discontinuity in replay_210619 (nid
        # 608's soldier body teleports 40 m in one 0.1 s window at t=103.47,
        # dated by that recording's own `p` record at t=103.468 -- see
        # gait-select.js's TELEPORT_SPEED comment) measured as 400 m/s before
        # it was filtered; (b) applying the hold-then-interpolate window to
        # *every* gap over one tick, including ordinary +-10% timer jitter,
        # measured a biased ~6.1-6.2 m/s "run". Both would show up here as an
        # implausible max.
        for name in (FILE_213110, FILE_210619):
            stats = self.results["recordings"][name]["rawSpeedStats"]
            self.assertLess(stats["max"], 10.0, name)

    def test_lateral_speed_cluster_matches_the_strafe_speed_table_not_the_forward_one(self) -> None:
        # The finding that motivated a heading-aware threshold at all: a
        # sustained, real, standing-strafe (and separately, standing
        # backward) burst measures close to STRAFE_SPEED[stand] = 4 m/s in
        # both recordings -- almost exactly on top of what a forward-only
        # walk/run midpoint (4.0 m/s) would have used as its own boundary,
        # which would make these readings a coin flip instead of a clean
        # 'run'.
        for instant in ("strafe_213110_t46_3", "strafe_210619_t19_0", "backward_210619_t109_85"):
            reading = self.results["namedInstants"][instant]
            self.assertGreater(reading["speed"], 3.5, instant)
            self.assertLess(reading["speed"], 4.5, instant)
            self.assertNotEqual(4.0, reading["speed"], instant)
            # Comfortably clear of the *lateral* run boundary (8/3 = 2.667) --
            # an unambiguous 'run' under the table that actually applies.
            self.assertGreater(reading["speed"] - 8 / 3, 0.5, instant)
            self.assertEqual("run", reading["gait"], instant)

    def test_vehicle_exit_teleport_reads_as_idle_zero_confidence_not_a_sprint(self) -> None:
        # The artifact that motivated TELEPORT_SPEED: nid 608 in
        # replay_210619 jumps 40 m in one 0.1s window when the player exits a
        # vehicle (dated by that recording's own 'p' record, see
        # gait-select.js). Before the fix this measured 400 m/s and
        # classified 'run' at full confidence; it must now read as an
        # explicitly low-confidence idle instead of a fabricated sprint.
        reading = self.results["namedInstants"]["teleport_210619_t103_42"]
        self.assertEqual("idle", reading["gait"])
        self.assertEqual(0, reading["confidence"])

    def test_heading_labels_on_the_three_real_clusters(self) -> None:
        ni = self.results["namedInstants"]
        self.assertEqual("forward", ni["forward_213110_t28_5"]["heading"])
        self.assertEqual("forward", ni["forward_210619_t14_45"]["heading"])
        self.assertEqual("strafe", ni["strafe_213110_t46_3"]["heading"])
        self.assertEqual("strafe", ni["strafe_210619_t19_0"]["heading"])
        self.assertEqual("backward", ni["backward_210619_t109_85"]["heading"])

    def test_forward_run_instants_are_full_confidence(self) -> None:
        ni = self.results["namedInstants"]
        for instant in ("forward_213110_t28_5", "forward_210619_t14_45"):
            self.assertEqual("run", ni[instant]["gait"], instant)
            self.assertEqual(1, ni[instant]["confidence"], instant)

    def test_no_chatter_across_either_full_recording(self) -> None:
        for name in (FILE_213110, FILE_210619):
            rec = self.results["recordings"][name]
            runs = rec["runs"]
            # Every *bounded* run (excludes the unbounded hold before the
            # first sample and after the last, which cannot chatter) is at
            # least MIN_DWELL_S wide -- the hysteresis invariant, checked
            # end to end through the public API on real data rather than
            # only on the module's own internal state.
            self.assertGreaterEqual(rec["minBoundedRunDuration"], 0.2 - 1e-9, name)
            # A handful of real transitions over one to two minutes of play,
            # not one per raw sample (247 and 222 of those) -- the shape a
            # chattering classifier would produce.
            self.assertLess(len(runs), 15, name)


class GaitSelectSyntheticTests(unittest.TestCase):
    """Exact, controlled cases the real recordings can't isolate cleanly."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_exact_engine_speeds_classify_at_their_own_boundary(self) -> None:
        s = self.results["synthetic"]
        run = s["run"][0]
        self.assertEqual("run", run["gait"])
        self.assertAlmostEqual(6.0, run["speed"], places=3)
        self.assertEqual("forward", run["heading"])
        self.assertEqual(1, run["confidence"])

        walk = s["walk"][0]
        self.assertEqual("walk", walk["gait"])
        self.assertAlmostEqual(2.0, walk["speed"], places=3)
        self.assertEqual("forward", walk["heading"])

    def test_full_speed_strafe_is_run_not_walk(self) -> None:
        # The same case the real data motivated, isolated with a controlled
        # quaternion: moving at the standing strafe top speed (4 m/s)
        # perpendicular to facing must not land on the ambiguous
        # forward-table boundary (which sits at exactly 4.0).
        strafe = self.results["synthetic"]["strafe"][0]
        self.assertEqual("run", strafe["gait"])
        self.assertEqual("strafe", strafe["heading"])
        self.assertAlmostEqual(4.0, strafe["speed"], places=3)

    def test_idle_life_and_out_of_range_queries(self) -> None:
        s = self.results["synthetic"]
        self.assertEqual("idle", s["idle"][0]["gait"])
        self.assertEqual(0, s["idle"][0]["speed"])
        self.assertIsNone(s["idle"][0]["heading"])
        # Before the first sample and long after the last: nothing has been
        # seen moving, and a gap (however long) is a hold, not a guess.
        self.assertEqual("idle", s["beforeFirst"][0]["gait"])
        self.assertEqual("idle", s["afterLast"][0]["gait"])

    def test_synthetic_teleport_reads_as_idle_zero_confidence(self) -> None:
        # Same shape as the real vehicle-exit artifact
        # (test_vehicle_exit_teleport_reads_as_idle_zero_confidence_not_a_sprint),
        # reproduced synthetically so this assertion does not depend on the
        # fixture file's exact timings.
        reading = self.results["synthetic"]["teleport"][0]
        self.assertEqual("idle", reading["gait"])
        self.assertEqual(0, reading["confidence"])

    def test_single_tick_noise_blip_never_surfaces_as_a_gait_change(self) -> None:
        # Point 4's demonstration case: a lone 0.1 s reading at 6.2 m/s
        # (under MIN_DWELL_S = 0.2 s) between two long idle holds must never
        # be reported, including *during* the blip itself -- a caller
        # sampling at any of these times, including inside the anomalous
        # tick, should see the recording as idle throughout.
        for reading in self.results["synthetic"]["blip"]:
            self.assertEqual("idle", reading["gait"], reading)


if __name__ == "__main__":
    unittest.main()
