"""A blast throws a soldier: `viewer/knockback.js`, headless.

Read out of `bf1942_lnxded.static` (ledger KNOCK-4..KNOCK-8, the
`features/bf1942-blast-and-bounce` build record):

  * `GameServer::handleExplosionOnObject` (0x08156500), for a victim with no
    parent and a physics node, once `calcDamage` priced him above zero, adds
    `explosionForceMod * forceOnExplosion * (1/radius) * exposure` (a tenth in
    water, times the friendly-fire ratio, held under `explosionForceMax`) to
    his `PointPhysicsNode`'s accumulator along `normalize(s^ + axis)`, where
    `axis` is his own row most along the separation and a soldier's `s^.y` is
    `(1 - d/r) * 5` -- and nothing past half the radius;
  * the accumulator is one 1/30 s tick (`updatePositionalPhysics` 0x082560c0),
    so the speed left is a thirtieth of it;
  * vanilla's soldiers carry 75 / 600, Desert Combat's 150 / 600, so a DC man
    gets twice the push of a vanilla one at the same blast until the ceiling;
  * the flight is KNOCK-1, and the landing KNOCK-2 with KNOCK-8's rider: only
    a bot plays the survive landing, a human is back on `Lb_Stand` at once.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("knockback_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                          timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


def norm(v) -> float:
    return math.sqrt(sum(c * c for c in v))


class BlastLawTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["law"]

    def test_a_desert_combat_soldier_gets_twice_vanillas_push(self) -> None:
        # S7: `explosionForceMod 150` against 75, the same blast, under the
        # ceiling: twice the force along the same line, twice the speed.
        van, dc = self.results["quarterVanilla"], self.results["quarterDc"]
        self.assertEqual(187.5, van["force"])
        self.assertEqual(375.0, dc["force"])
        for a, b in zip(van["a"], dc["a"]):
            self.assertAlmostEqual(2 * a, b, places=4)
        self.assertAlmostEqual(6.25, van["dv"])
        self.assertAlmostEqual(12.5, dc["dv"])

    def test_the_ceiling_holds_both_to_600(self) -> None:
        # Fully seen, 750 and 1500 both hit `explosionForceMax` 600: 20 m/s.
        self.assertEqual(600.0, self.results["fullVanilla"]["force"])
        self.assertEqual(600.0, self.results["fullDc"]["force"])
        self.assertEqual(self.results["fullVanilla"]["a"], self.results["fullDc"]["a"])
        self.assertAlmostEqual(20.0, self.results["fullDc"]["dv"])
        # A standing man is at most half seen (HP-10): vanilla 375 (12.5 m/s),
        # DC already at the ceiling.
        self.assertEqual(375.0, self.results["halfVanilla"]["force"])
        self.assertEqual(600.0, self.results["halfDc"]["force"])

    def test_past_half_the_radius_he_is_not_pushed(self) -> None:
        self.assertEqual([0, 0, 0], self.results["pastTheCut"]["a"])
        self.assertEqual(187.5, self.results["atTheCut"]["force"])

    def test_water_and_friendly_fire_cut_it(self) -> None:
        self.assertAlmostEqual(18.75, self.results["inWater"]["force"])
        self.assertEqual(0, self.results["friendlyOff"]["force"])
        self.assertAlmostEqual(93.75, self.results["friendlyHalf"]["force"])

    def test_the_templates_own_defaults(self) -> None:
        # `explosionForceMod 1.0` (0x081dc0ac) times 150 / 15: 10, under 300.
        self.assertEqual(10.0, self.results["defaults"]["force"])

    def test_the_rise_is_replaced_and_the_nearest_row_added(self) -> None:
        # 5 m off along his forward row: s^ = (0, 0, 1), its rise replaced by
        # (1 - 5/15) * 5, plus the forward row: normalize((0, 3.333, 2)).
        a = self.results["quarterVanilla"]["a"]
        rise = self.results["rise"]
        self.assertAlmostEqual(10 / 3, rise, places=5)
        expect = [0, rise / math.hypot(rise, 2), 2 / math.hypot(rise, 2)]
        for got, want in zip(a, expect):
            self.assertAlmostEqual(want, got / norm(a), places=5)
        # From his side his right row, facing the blast his back's: always
        # away from the blast, the same push.
        side = self.results["side"]["a"]
        self.assertAlmostEqual(a[2], side[0], places=4)
        self.assertAlmostEqual(a[1], side[1], places=4)
        self.assertEqual(a, self.results["facing"]["a"])
        # Under him, his up row: nearly straight up.
        under = self.results["under"]["a"]
        self.assertGreater(under[1] / norm(under), 0.9999)
        # On top of him, the terrain's normal.
        self.assertEqual([112.5, 150, 0], self.results["onTop"])


class ThrownBodyTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["body"]

    def test_the_push_is_one_engine_tick_of_speed(self) -> None:
        # a / 30 m/s at the body's own 60 Hz tick (KNOCK-6).
        self.assertAlmostEqual(6.25, norm(self.results["vanillaHuman"]["firstTickDv"]), places=3)
        self.assertAlmostEqual(12.5, norm(self.results["dcHuman"]["firstTickDv"]), places=3)

    def test_under_8_m_s_he_is_shoved_not_thrown(self) -> None:
        self.assertEqual([None], [s["family"] for s in self.results["vanillaHuman"]["states"]])
        self.assertEqual([None], [s["family"] for s in self.results["weak"]["states"]])

    def test_a_desert_combat_man_flies_and_a_human_lands_on_his_feet(self) -> None:
        dc = self.results["dcHuman"]
        self.assertEqual(["flyForward", None], [s["family"] for s in dc["states"]])
        # Twice the speed: four times the height, and further.
        van = self.results["vanillaHuman"]
        self.assertGreater(dc["apex"], 3.5 * van["apex"])
        self.assertGreater(dc["landedAt"][1], 3.5 * van["landedAt"][1])

    def test_a_bot_plays_the_survive_landing_and_the_get_up(self) -> None:
        states = self.results["dcBot"]["states"]
        self.assertEqual(["flyForward", "landFrontSurvive", "getUpFront", None],
                         [s["family"] for s in states])
        # 1.0 s of landing, 2.0 of getting up (rates 1.0 and 0.5, ANIM-1).
        self.assertAlmostEqual(1.0, states[2]["t"] - states[1]["t"], places=1)
        self.assertAlmostEqual(2.0, states[3]["t"] - states[2]["t"], places=1)

    def test_a_dead_man_flies_and_holds_his_landing(self) -> None:
        dead = self.results["dcDead"]
        self.assertEqual(["flyForward", "landFront"], [s["family"] for s in dead["states"]])
        self.assertTrue(dead["locked"])

    def test_his_legs_are_not_his_own_in_the_air(self) -> None:
        held = self.results["heldForward"]
        self.assertEqual("flyForward", held["family"])
        self.assertLessEqual(held["after"], held["before"])

    def test_a_new_life_resets_the_machine(self) -> None:
        placed = self.results["placedResets"]
        self.assertEqual("flyForward", placed["flying"])
        self.assertIsNone(placed["after"])
        self.assertFalse(placed["stamped"])

    def test_walls_slopes_the_window_and_the_canopy(self) -> None:
        bounce = self.results["bounce"]
        self.assertEqual("flyForward", bounce["flew"])
        self.assertEqual("bounceFront", bounce["hit"])
        self.assertEqual("flyBackward", bounce["then"])
        self.assertEqual("flyForward", bounce["backFirst"])
        self.assertEqual("flyForward", bounce["slope"])
        self.assertIsNone(self.results["lateWindow"])
        self.assertIsNone(self.results["canopy"])


class PageSplashTests(unittest.TestCase):
    """The page's own splash pass (`vehicle-hits.js` `applyVehicleHit`)."""

    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["page"]

    def test_the_page_pushes_a_dc_soldier_twice_as_hard(self) -> None:
        # The same grenade, `forceOnExplosion 30` (under the ceiling for
        # both), the human and a bot 5 m off: 5 m/s against 10.
        for who in ("human", "bot"):
            van = norm(self.results["vanilla"][who]["dv"])
            dc = norm(self.results["dc"][who]["dv"])
            self.assertAlmostEqual(5.0, van, places=3)
            self.assertAlmostEqual(10.0, dc, places=3)

    def test_the_bot_is_marked_a_bot(self) -> None:
        self.assertTrue(self.results["dc"]["bot"]["ai"])
        self.assertFalse(self.results["dc"]["human"]["ai"])
        self.assertTrue(self.results["dc"]["human"]["stamped"])

    def test_an_old_tree_and_an_undeclared_round(self) -> None:
        # No words in the manifest: vanilla's 75 / 600 stand in.
        self.assertEqual(self.results["vanilla"], self.results["noWords"])
        # No `forceOnExplosion`: the constructor's 150, held to 600: 20 m/s.
        self.assertAlmostEqual(20.0, norm(self.results["vanillaDefaultForce"]["human"]["dv"]),
                               places=3)


if __name__ == "__main__":
    unittest.main()
