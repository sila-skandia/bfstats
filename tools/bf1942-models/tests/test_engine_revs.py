"""`viewer/engine-revs.js` -- the engine's gearbox, which is what a ship's
throttle actually is.

`PhysicsEngine::updatePhysics` (`0x0824cbb0`) reads `PhysicsEngine+0xa0` for the
`throttle` in `K = 0.1*|throttle| + e*|e|` (`fsubr [edi+0xa0]` at `0x0824cf4b`),
and `+0xa0` is written only by `Engine::handleUpdate` (`0x0823e120`). So the
pedal reaches the thrust law through a first-order filter with a load feedback,
never directly. Ledger TANK-12 (the filter), TANK-13 (the load), TANK-3/TANK-4
(the two curves), `subsystems/tank-driving.md` §3-§4.

Every number below is derived from those rows, not read back off the module.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "engine_revs_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "engine-revs.js", work / "engine-revs.mjs")
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class CurveTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_both_curves_are_101_slots(self):
        """101 floats each, `tmpl+0x378` (ratio) and `tmpl+0x1b8` (torque)."""
        self.assertEqual(self.out["curveLengths"], [101, 101])

    def test_the_ratio_curve_is_the_published_one(self):
        """tank-driving.md §3's own recomputation, index 0..100 by 10."""
        self.assertEqual(
            self.out["ratioByTen"],
            [1.0, 2.25, 3.5, 2.85, 2.2, 1.85, 1.5, 1.3, 1.1, 1.02, 0.94])
        self.assertEqual(self.out["ratioSpot"], {"25": 3.175, "50": 1.85, "75": 1.2})

    def test_the_torque_curve_peaks_at_sixty_percent_revs(self):
        """Authored 0:0.70, 10:0.80, 30:0.90, 60:1.00, 85:0.85, 100:0.70 --
        peak in the middle, 70% of peak at both ends (TANK-4)."""
        by_ten = self.out["torqueByTen"]
        self.assertEqual(by_ten[0], 0.7)
        self.assertEqual(by_ten[6], 1.0)
        self.assertEqual(by_ten[10], 0.7)
        self.assertEqual(max(by_ten), 1.0)

    def test_generate_distribution_holds_the_last_value_flat(self):
        self.assertTrue(self.out["flatTail"])

    def test_slot_zero_anchors_at_the_constructors_fill(self):
        """Why the ratio curve ramps 1.0 -> 3.5 over 0..20 instead of sitting
        flat: index 0 is unauthored, so the fill is the anchor."""
        self.assertEqual(self.out["rampFromFill"], 2.25)

    def test_the_sampler_truncates_and_lerps(self):
        s = self.out["sampled"]
        self.assertEqual(s["at20"], 3.5)
        # Halfway from 3.5 (index 20) to 3.435 (index 21) = (3.5+3.435)/2.
        self.assertAlmostEqual(s["at205"], 3.468, places=3)
        self.assertEqual(s["at100"], 0.94)
        # The engine would read off the end of the array; this clamps.
        self.assertEqual(s["past"], 0.94)


class RatioTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_ships_ratio_is_constant_because_it_has_one_gear(self):
        """`EngineTemplate`'s ctor defaults `numberOfGears` to 1
        (`0x0823f018`), `PhysicsEngine`'s seeds the gear to 1 (`0x0824c770`),
        and no vanilla ship authors `setNumberOfGears` -- so the index is
        `100*1/1` and the divisor is `ratioCurve[100] = 0.94` forever."""
        self.assertAlmostEqual(self.out["ratios"]["fletcher"], 3.5 * 2 / 0.94, places=3)
        self.assertAlmostEqual(self.out["ratios"]["enterprise"], 3.5 * 1.5 / 0.94, places=3)
        self.assertAlmostEqual(self.out["ratios"]["princeow"], 3.5 * 2.2 / 0.94, places=3)

    def test_the_published_ground_ladders_come_out_of_the_same_curve(self):
        """tank-driving.md §3's table, which is the cross-check that the curve
        is right rather than merely self-consistent."""
        self.assertEqual(self.out["ratios"]["sherman"],
                         [4.0, 6.364, 9.333, 12.727, 14.894])
        # M3A1 is 5.512, not 17.5: `idx = 25`, `curve[25] = 3.175`.
        self.assertEqual(self.out["ratios"]["m3a1"][0], 5.512)


class TorqueTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_torque_is_the_curve_times_set_torque(self):
        t = self.out["torque"]
        self.assertAlmostEqual(t["atRest"], 0.7 * 2, places=3)
        self.assertAlmostEqual(t["atPeak"], 1.0 * 2, places=3)
        self.assertAlmostEqual(t["atRedline"], 0.7 * 2, places=3)

    def test_the_index_is_the_clamped_magnitude_of_the_revs(self):
        """`100 * min(|revs|, 1)`: a saturated 1.2 reads slot 100, and astern
        reads the same slot ahead does."""
        t = self.out["torque"]
        self.assertEqual(t["saturated"], t["atRedline"])
        self.assertEqual(t["astern"], t["atPeak"])


class FilterTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_constants_are_the_bytes(self):
        c = self.out["constants"]
        self.assertAlmostEqual(c["REV_GAIN"], 0.05, places=6)
        self.assertEqual(c["REV_DAMP"], 0.5)
        self.assertEqual(c["REV_MAX"], 1.2)
        self.assertEqual(c["REV_MIN"], -1.0)
        self.assertAlmostEqual(c["LOAD_DECAY"], 0.99, places=6)

    def test_one_tick_is_the_gain_times_the_error(self):
        self.assertAlmostEqual(self.out["filter"]["firstTick"], 0.05, places=6)

    def test_revs_saturate_at_1_2_not_1_0(self):
        """`ds:0x86c4f64` = 1.2f, and the arm is type-independent: an unloaded
        engine at full pedal would run to 2*T1 and is stopped there."""
        self.assertEqual(self.out["filter"]["clampsHigh"], 1.2)
        self.assertEqual(self.out["filter"]["settledWithLoad"], 1.2)

    def test_revs_clamp_at_minus_one_astern(self):
        self.assertEqual(self.out["filter"]["clampsLow"], -1.0)

    def test_the_fixed_point_is_twice_the_pedal_less_the_load(self):
        """`(T1 - L) - 0.5*revs = 0`."""
        self.assertAlmostEqual(self.out["filter"]["settledInside"],
                               2 * (1 - 0.7), places=5)

    def test_a_load_past_the_pedal_turns_the_engine_round(self):
        self.assertLess(self.out["filter"]["loadWins"], 0.5)

    def test_the_closed_form_is_the_iteration(self):
        cf = self.out["filter"]["closedForm"]
        self.assertAlmostEqual(cf["iterated"], cf["advanced"], places=9)
        self.assertEqual(cf["zeroTicks"], 0.4)

    def test_forty_ticks_is_the_time_constant(self):
        """The documented 40-tick constant: `1 - (1 - 0.025)^40 = 0.6368`."""
        self.assertAlmostEqual(self.out["filter"]["timeConstant"], 0.6368, places=3)
        # With no load the same 40 ticks are already at the clamp, which is why
        # the constant has to be measured against a fixed point inside the arms.
        self.assertEqual(self.out["filter"]["unloadedAtForty"], 1.2)


class LoadTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_one_sample_a_tick_is_the_decay_times_it(self):
        self.assertAlmostEqual(self.out["load"]["one"], 0.99 * 2, places=3)

    def test_repeated_identical_samples_do_not_compound(self):
        """Four sub-steps of one tick must not multiply 0.99 four times: the
        count divides most of it back out (`0x0824c952`-`0x0824c97e`), so four
        samples of 2 land above `0.99**4 * 2` and below one sample's 1.98."""
        four = self.out["load"]["four"]
        self.assertGreater(four, 0.99 ** 4 * 2)
        self.assertLessEqual(four, self.out["load"]["one"])

    def test_two_samples_average(self):
        self.assertAlmostEqual(self.out["load"]["mixed"], 0.99 * 3, places=1)


if __name__ == "__main__":
    unittest.main()
