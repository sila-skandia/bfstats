"""The DC ground-truth extractor (`lab/dc_truth.py`) on a cut of a real round.

The fixture (`fixtures/dc_truth_el_alamein.ndjson.gz`, made by
`fixtures/make_dc_truth_fixture.py`) is a bots-only Desert Combat El Alamein
co-op round as the server recorder wrote it on 2026-10-06, cut to two hulls
and six flights. What it pins:

- the frame: a moving hull's velocity lies along its quaternion's +Z;
- the abandoned-vehicle clock: M2A3 524's driver left at 247.2 s, its hit
  points start falling 46 s later at 10 a second (DC's spawner says
  TimeToLive 45), and its wreck stands 60 s;
- the rounds: a T-72 shell leaves at its authored 250 m/s and falls at the
  engine's 14.73 m/s^2 (IMP-7, gravityModifier 1); a TOW flies at 100 m/s
  with no gravity and no turn; an AS-7 off a Su-25 accelerates and falls.

No game install is needed: the terrain is the water plane alone.
"""

from __future__ import annotations

import importlib.util
import math
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("dc_truth", ROOT / "lab" / "dc_truth.py")
dc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dc)

FIXTURE = ROOT / "tests" / "fixtures" / "dc_truth_el_alamein.ndjson.gz"
FLAT = dc.Terrain(water=16.0)


class Reading(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rec = dc.read_recording(FIXTURE)

    def test_the_round_and_its_end(self):
        self.assertEqual(self.rec.level, "el_alamein")
        self.assertAlmostEqual(self.rec.round_end, 727.134, places=3)

    def test_a_moving_hull_goes_where_its_nose_points(self):
        humvee = next(lf for lf in self.rec.lives if lf.nid == 551)
        cos = [s.fwd / s.speed for s in dc.states(humvee) if s.speed > 8]
        self.assertGreater(len(cos), 100)
        self.assertGreater(sorted(cos)[len(cos) // 2], 0.99)

    def test_the_wreck_and_the_abandoned_vehicle_clock(self):
        m2 = next(lf for lf in self.rec.lives if lf.nid == 524)
        self.assertEqual(m2.end_kind, "destroyed")
        self.assertAlmostEqual(m2.ended - dc.death_time(m2), 60.0, delta=0.2)
        drain = dc.abandon_drain(m2)
        self.assertAlmostEqual(drain["idle"], 46.1, delta=0.6)
        self.assertAlmostEqual(drain["rate"], 10.0, delta=0.5)
        self.assertTrue(drain["used"])


class Statistics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.res = dc.analyse([FIXTURE], terrain=FLAT)

    def test_the_shell_falls_at_the_engines_gravity(self):
        shell = self.res["rounds"]["T72Projectile"]
        self.assertAlmostEqual(shell["v0_p50"], 250, delta=5)        # T72GunBarrel velocity 250
        self.assertAlmostEqual(shell["g_eff_p50"], 14.73, delta=0.5)
        self.assertEqual(shell["weapons"], {"T72GunBarrel": 1})

    def test_the_tow_flies_level_and_straight(self):
        tow = self.res["rounds"]["TOW_Projectile"]
        self.assertAlmostEqual(tow["v0_p50"], 100, delta=2)
        self.assertLess(abs(tow["g_eff_p50"]), 0.5)
        self.assertLess(abs(tow["a_tan_p50"]), 0.5)
        self.assertLess(tow["turn_p95"], 1.0)

    def test_the_as7_motor_pushes_and_gravity_pulls(self):
        as7 = self.res["rounds"]["AS-7"]
        self.assertEqual(as7["weapons"], {"SU-25_BombRack": 3})
        self.assertGreater(as7["a_tan_p50"], 0.5)
        self.assertAlmostEqual(as7["g_eff_p50"], 14.5, delta=0.8)

    def test_a_humvee_off_its_pad(self):
        # Its bot drove at AI LOD 2 (no human near: AI-136), where the AI moves
        # the hull, so it is kept out of the physics table.
        self.assertNotIn("Humvee", self.res["ground"])
        hv = self.res["ground_lod2"]["Humvee"]
        self.assertAlmostEqual(hv["t_to_5"], 0.76, delta=0.1)
        self.assertAlmostEqual(hv["top_speed"], 14.25, delta=0.3)   # held 3 s; the Humvee's AI maxSpeed is 25

    def test_the_pad_table(self):
        pads = self.res["files"][0]["pads"]
        self.assertAlmostEqual(pads["wreck_life"]["M2A3"]["min"], 60.0, delta=0.2)
        (drain,) = pads["abandoned"]["M2A3"]
        self.assertAlmostEqual(drain["idle"], 46.1, delta=0.6)


class Pieces(unittest.TestCase):
    def test_held_extreme_is_the_best_window_minimum(self):
        def st(t, fwd):
            s = dc.State(t, (0, 0, 0), (0, 0, 0, 1), (0, 0, fwd), (0, 0, 0), 0.0)
            return s
        run = [st(i / 10, v) for i, v in enumerate([1, 5, 9, 9, 9, 8, 9, 2, 9, 9])]
        self.assertEqual(dc.held_extreme(run, 0.35, lambda s: s.fwd), 8)
        self.assertEqual(dc.held_extreme(run, 0.15, lambda s: s.fwd), 9)

    def test_quadratic_fit_finds_gravity(self):
        ts = [i / 30 for i in range(30)]
        ys = [3 + 40 * t - 0.5 * 14.73 * t * t for t in ts]
        c0, c1, c2 = dc.quad_fit(ts, ys)
        self.assertAlmostEqual(2 * c2, -14.73, places=6)
        self.assertAlmostEqual(c1, 40, places=6)

    def test_rotation_helpers(self):
        q = (0.0, math.sin(math.radians(45)), 0.0, math.cos(math.radians(45)))   # 90 deg about +Y
        f = dc.qrot(q, (0, 0, 1))
        self.assertAlmostEqual(f[0], 1.0, places=6)
        self.assertAlmostEqual(dc.rot_angle(q), 90.0, places=6)


if __name__ == "__main__":
    unittest.main()
