"""A RotationalBundle that is not `setAutomaticReset` holds the angle its key
left it at (ledger GUN-2): FH's ammo selectors latch
(`tests/held_axis_harness.mjs`). FHSWEurope Ilomantsi's SU-122 snapped back to
HEAT the moment its key was let go, and an FH horse's held legs went back to
rest with the free part that shares their key."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "held_axis_harness.mjs"


class HeldAxisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_selector_latches_on_a_land_hull(self) -> None:
        selector = [row[0] for row in self.r["land"]]
        # Down: HE (-180) and it stays; up: HEAT (0) and it stays; a tap moves it all the way.
        self.assertEqual(selector, [-180, -180, 0, 0, -180, -180])

    def test_a_stick_surface_still_centres(self) -> None:
        self.assertEqual(self.r["land"][0][1], 20)
        self.assertEqual(self.r["land"][1][1], 0)

    def test_an_aircraft_keeps_the_surface_servo(self) -> None:
        self.assertEqual([row[0] for row in self.r["air"]][:2], [-180, 0])

    def test_a_held_part_keeps_its_own_register_on_a_shared_key(self) -> None:
        # FHSW's horses: the free `Horse_wheelshake` registers the c_PIThrottle
        # pitch entry first, and the held legs followed it back to rest on
        # release (`audit_behaviour` veh.selector-springs-back on every
        # Cavalry_*). Each leg now integrates between its own bounds.
        fl, fr = [row[0] for row in self.r["horse"]], [row[1] for row in self.r["horse"]]
        self.assertEqual(fl, [20, 20, 0, 0])
        self.assertEqual(fr, [-10, -10, 0, 0])

    def test_a_held_part_ramps_and_coasts_on_its_speed_register(self) -> None:
        # FHSWEurope's FordGPA waterguard (`setMaxSpeed 150`,
        # `setAcceleration 100`): GUN-2's speed register ramps at 100 deg/s^2,
        # so 0.4 s of the key turns it about 8 deg and it coasts as far again
        # after the release, then holds. Pressed against its 161 deg stop it
        # waits there, and the other key takes it back the same way.
        guard = self.r["waterguard"]
        self.assertAlmostEqual(guard[0], 8.7, delta=0.5)
        self.assertAlmostEqual(guard[1], 2 * guard[0], delta=1.5)
        self.assertEqual(guard[1], guard[2])
        self.assertEqual(guard[3:5], [161, 161])
        self.assertLess(guard[5], 161)
        self.assertLess(guard[6], guard[5])
        self.assertGreater(guard[6], 100)

    def test_a_free_part_on_that_key_spins_while_held_and_stops_where_it_is(self) -> None:
        # GUN-2's wrap gate (min and max both 0): `Horse_wheelshake` has no
        # range, so it does not follow the key to a position. S held for
        # 0.5 s turned it, and released it slowed and stayed where it stopped
        # (ledger GUN-25); it used to snap back to 0.
        shake = [row[2] for row in self.r["horse"]]
        self.assertNotEqual(shake[0], 0)
        self.assertNotEqual(shake[1], 0)

    def test_a_free_leg_turns_without_end_while_held(self) -> None:
        # BF1918's `horse_leg_FL1_rot1` (900 deg/s, 1000 deg/s^2): the angle
        # changes every tick for the whole 2 s hold, past +-180 (it wraps),
        # at 30 deg a tick (900 deg/s) once the register is up to speed; the
        # child turning back (`-1000`) runs the other way at the same rate.
        spin = self.r["spin"][:60]
        steps = []
        for (a, _), (b, _) in zip(spin, spin[1:]):
            d = (b - a + 180) % 360 - 180
            steps.append(d)
        self.assertTrue(all(d > 0 for d in steps), steps[:5])
        self.assertAlmostEqual(steps[-1], 30.0, delta=0.5)
        self.assertGreater(max(a for a, _ in spin), 150)
        self.assertLessEqual(min(a for a, _ in spin[30:]), -150)
        back = [((b - a + 180) % 360 - 180) for (_, a), (_, b) in zip(spin, spin[1:])]
        self.assertAlmostEqual(back[-1], -30.0, delta=0.5)

    def test_a_released_free_leg_slows_and_holds(self) -> None:
        rest = [a for a, _ in self.r["spin"][60:]]
        # 900 deg/s at 1000 deg/s^2 is 0.9 s, 27 ticks, to a stop; held after.
        self.assertNotEqual(rest[0], rest[10])
        self.assertEqual(rest[-1], rest[-10])


if __name__ == "__main__":
    unittest.main()
