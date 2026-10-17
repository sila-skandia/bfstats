"""A bot's knife and bayonet (`tests/bot_melee_harness.mjs`, FHX-12 in
features/fh-fhsw-open-issues).

Retail's AI has no melee rule of its own; a knife is a weapon like any other:

* `BBFire::calculateUrgency` 0x08563570 scores the target with the weapon of
  the best `strength[type] / (1 + (20 (shots - hits) + 10) / ammo)`, with no
  range in it: Desert Combat's knives (9 against infantry) score best against
  every infantryman, vanilla's (1) once the rest are dry.
* The fire plan does not fire that weapon. `BBPFireInfantery::createPlan`
  calls `choseWeapon` 0x085cf0e0 (at 0x085a402f) with the target's distance:
  a weapon whose `minRange < d < maxRange` beats any outside its window, the
  stronger in range wins, and the scored weapon counts three times. A knife
  (1.5 m) is drawn for a man inside 1.5 m when nothing in range outweighs
  it, or when nothing else has rounds. The page's bots fired the scored
  weapon, so every Desert Combat bot walked up to his targets with a knife.
* `BBPFireInfantery::createFirePlan` 0x085ac240 builds its trigger on the AI
  template's +0x44 (`weaponTemplate.weaponFire`): XPack1's `No4Bayonet`, whose
  AI weapon is the stab, presses the right button, and the item's
  `c_PIAltFire` FireArms goes off with its own `fireDelay` and cycle.
* A round dies when its `timeToLive` is out, so a knife's (50 m/s, 0.0665 s)
  reaches 3.3 m; the bots' ray used to reach 600 m.
* A bot's fire data comes from the item's `c_PIFire` FireArms. FHSW's bayonet
  rifles list the stab first in the glb, and a bot holding one fired the
  bayonet's round down the bayonet's barrels.
* The plan's `BAPAChangeWeapon` is the item the bot's body holds.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_melee_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class BotMeleeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the glb --------------------------------------------------------------

    def test_the_rifle_fires_its_own_fire_arms_not_the_first_in_the_glb(self) -> None:
        g = self.results["glb"]
        self.assertTrue(g["firstNodeIsTheStab"])
        self.assertEqual(g["fire"], "M1GarandBay")
        self.assertEqual(g["round"], "7,62mmProjectile")
        self.assertEqual(g["fireArms"], "7,62mmProjectile")
        # The stab's three muzzles are its own barrels, not the rifle's.
        self.assertEqual(g["rifleBarrels"], 1)
        self.assertEqual(g["stabBarrels"], 3)

    def test_the_alternate_fire_arms_is_read_whole(self) -> None:
        g = self.results["glb"]
        self.assertEqual(g["alt"], "BayonetM1Garand")
        self.assertEqual(g["altName"], "BayonetM1Garand")
        self.assertEqual(g["altRound"], "Melee_Bayonet_Projectile")
        self.assertAlmostEqual(g["altReach"], 105 * 0.065, places=4)
        self.assertEqual(g["altDelay"], 0.2)
        self.assertEqual(g["altRate"], 1.51)
        self.assertEqual(g["plain"], {"fire": 0, "alt": -1})

    def test_a_round_reaches_velocity_times_its_life(self) -> None:
        g = self.results["glb"]
        self.assertAlmostEqual(g["knifeReach"], 3.325, places=4)
        self.assertIsNone(g["noReach"])
        self.assertAlmostEqual(g["reach"], 855 * 1.067, places=2)

    # --- the choice -----------------------------------------------------------

    def test_bbfire_scores_desert_combat_knives_best_at_any_range(self) -> None:
        c = self.results["choice"]
        self.assertEqual(c["dcAt30"], "KnifeAxis")
        self.assertEqual(c["dcAt1"], "KnifeAxis")

    def test_bbfire_scores_a_vanilla_knife_once_the_rest_are_dry(self) -> None:
        c = self.results["choice"]
        self.assertEqual(c["vanillaAt1"], "Thompson")
        self.assertEqual(c["vanillaDry"], "KnifeAllies")
        self.assertEqual(c["vanillaRetailMisses"], "KnifeAllies")

    # --- the knife ------------------------------------------------------------

    def test_a_knife_meets_a_man_in_reach_and_nobody_past_it(self) -> None:
        k = self.results["knife"]
        # `roundOfFire 2.0`: six swings in 3 s, every one landing at 2 m.
        self.assertEqual(k["nearSwings"], 6)
        self.assertEqual(k["nearHits"], 6)
        self.assertEqual(k["farSwings"], 6)
        self.assertEqual(k["farHits"], 0)
        # Without its reach the ray went 600 m.
        self.assertEqual(k["unboundedHits"], 6)

    # --- the bayonet ----------------------------------------------------------

    def test_a_pi_alt_fire_weapon_stabs_with_the_alternate_fire_arms(self) -> None:
        b = self.results["bayonet"]
        self.assertEqual(b["names"], ["No4BayonetStabFireArm"])
        self.assertEqual(b["shots"], 0)
        # The rifle's magazine is not spent.
        self.assertEqual(b["rifleRounds"], 5)
        self.assertEqual(b["input"], {"fire": 0, "altFire": 1})
        self.assertEqual(b["farHits"], 0)
        self.assertEqual(b["bareEvents"], 0)

    def test_a_stab_lands_its_fire_delay_after_the_press_and_cycles(self) -> None:
        b = self.results["bayonet"]
        self.assertEqual(len(b["stabs"]), 4)
        self.assertEqual(len(b["hits"]), 4)
        for press, hit in zip(b["stabs"], b["hits"]):
            # 0.12 s, on the 30 Hz ticks: the fourth tick after the press.
            self.assertAlmostEqual(hit - press, 4 / 30, places=3)
        gaps = [round(b - a, 4) for a, b in zip(b["stabs"], b["stabs"][1:])]
        # The delay's 4 ticks, then the stab's own cycle from its round, 24
        # ticks (`roundOfFire 1.3`): two timers, each whole ticks (GUN-13).
        for gap in gaps:
            self.assertAlmostEqual(gap, b["period"], places=3)

    # --- the plan's weapon ------------------------------------------------------

    def test_the_plan_fires_what_is_in_range_not_what_scored_best(self) -> None:
        p = self.results["plan"]
        # `BBFire` scored the knife (9) every time. At 30 m the PKM (3..175)
        # is the one in range, and the bot does not walk in to stab.
        self.assertEqual(p["at30"]["fired"], "PKM")
        self.assertIsNone(p["at30"]["approach"])
        # At 1 m the PKM is inside its 3 m minimum and the pistol's 1 m.
        self.assertEqual(p["at1"]["fired"], "KnifeAxis")
        # At 2 m the knife's 1.5 m is short and the Browning Hi-Power (1..25) is in.
        self.assertEqual(p["at2"]["fired"], "Browninghipo")

    def test_a_running_plan_keeps_its_weapon(self) -> None:
        for at in self.results["plan"].values():
            self.assertEqual(at["kept"], at["fired"])

    def test_the_plan_changes_his_hands_and_a_new_life_clears_them(self) -> None:
        for at in self.results["plan"].values():
            self.assertIsNone(at["before"])
            self.assertEqual(at["held"], at["fired"])
            self.assertIsNone(at["afterRespawn"])

    def test_chose_weapon_counts_the_scored_weapon_three_times(self) -> None:
        c = self.results["chose"]
        self.assertEqual(c["akKeepsAk"], "AK47")
        self.assertEqual(c["akKnife"], "KnifeAxis")
        self.assertEqual(c["vanilla"], "Thompson")
        self.assertEqual(c["vanillaDry"], "KnifeAllies")

    def test_chose_weapon_ties_and_window_ends(self) -> None:
        c = self.results["chose"]
        self.assertEqual(c["tieInRange"], "B")
        self.assertEqual(c["tieOutOfRange"], "A")
        # A distance on maxRange or on minRange is outside the window.
        self.assertEqual(c["atMax"], 1)
        self.assertEqual(c["atMin"], 1)
        self.assertEqual(c["healingSkipped"], -1)
        self.assertEqual(c["indirectSkipped"], -1)
        self.assertEqual(c["none"], -1)


if __name__ == "__main__":
    unittest.main()
