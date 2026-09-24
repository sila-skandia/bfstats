"""The bots' hand weapons (`tests/bot_weapons_harness.mjs`, features/bot-weapons).

What the owner reported, and what pins each fix:

* A bot's Bazooka fired once a second and never reloaded: its magazine was
  made on the bot's first tick, before the page had fetched the weapon's
  fire data, read the missing size as unlimited and was kept for good. No
  magazine is made before the data now; a Bazooka fires its one round, plays
  out the round's 1 s fire cycle, then its 5.6 s reload, six rockets and it is
  dry, and an SMG empties its magazine at its own rate of fire and reloads.
* A bot's rocket never showed: the referee resolved every round as an
  instant ray. A round the page flies (`env.launchRound`) is not resolved
  again, and the hull and splash damage of a bot's flown round are billed to
  the bot, with the weapon and the splash said for the kill line.
* An empty magazine ends the fire plan only where `createFirePlan` adds the
  break: an SMG's when it runs dry, never a Bazooka's, which waits out its
  reload aiming.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "bot_weapons_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class BotWeaponsTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the magazine ------------------------------------------------------

    def test_no_magazine_is_made_before_the_weapons_data(self) -> None:
        self.assertEqual(self.results["bazooka"]["entriesBeforeData"], 0)
        self.assertEqual(self.results["thompson"]["entriesBeforeData"], 0)

    def test_a_bazooka_fires_one_rocket_then_reloads(self) -> None:
        b = self.results["bazooka"]
        # One loaded and five spare: six rockets, then dry.
        self.assertEqual(b["rockets"], 6)
        self.assertEqual(len(b["gaps"]), 5)
        for gap in b["gaps"]:
            # The round's 1 s fire cycle, the 5.6 s reload, and the tick the
            # next round waits for.
            self.assertGreaterEqual(gap, 6.6)
            self.assertLess(gap, 6.7)
        self.assertEqual(len(b["reloads"]), 5)
        for length in b["reloads"]:
            self.assertGreaterEqual(length, 5.6)
            self.assertLess(length, 5.7)
        self.assertEqual(b["mag"]["rounds"], 0)
        self.assertEqual(b["mag"]["spare"], 0)
        self.assertTrue(b["empty"])

    def test_a_dry_weapon_is_dropped_and_a_loaded_one_is_not_rationed(self) -> None:
        ammo = {name: (value, rounds) for name, value, rounds in self.results["bazooka"]["ammo"]}
        self.assertEqual(ammo["Bazooka"], (0, 0))
        # The weapon choice keeps its unlimited reading while rounds are left
        # (the referee's PARITY DEPARTURE); the count itself is kept.
        self.assertEqual(ammo["Colt"], (-1, 32))

    def test_a_smg_empties_its_magazine_at_its_rate_and_reloads(self) -> None:
        t = self.results["thompson"]
        self.assertGreaterEqual(len(t["bursts"]), 2)
        for burst in t["bursts"][:2]:
            self.assertEqual(burst["n"], 30)
            self.assertAlmostEqual(burst["rate"], 10.0, places=2)
        for gap in t["gapsBetween"]:
            # The last round's 0.1 s fire cycle, then the 4.8 s reload.
            self.assertGreaterEqual(gap, 4.9)
            self.assertLess(gap, 5.0)
        self.assertTrue(t["endsPlan"])

    def test_a_reload_waits_for_the_last_rounds_fire_cycle(self) -> None:
        # `FireArms::handleMessage` 9 starts `Reload` only once
        # `timeToFireFinished` (1 / roundOfFire from the round) is spent.
        for delay in self.results["bazooka"]["reloadDelays"]:
            self.assertAlmostEqual(delay, 1.0, delta=1 / 30)

    def test_the_held_rate_carries_its_fraction_at_60_fps(self) -> None:
        m = self.results["mp40At60"]
        self.assertEqual(m["rounds"], 32)
        # 31 periods of 1/9 s: 3.444 s, where a period restarted each round
        # took 7 frames (3.617 s, 8.57 rounds a second).
        self.assertAlmostEqual(m["span"], 31 / 9, delta=1 / 60)

    def test_a_new_soldier_gets_a_full_kit(self) -> None:
        r = self.results["respawn"]
        self.assertEqual(r["dry"], {"rounds": 0, "spare": 0})
        self.assertEqual(r["refilled"], {"rounds": 1, "spare": 5})

    # --- the flown round -----------------------------------------------------

    def test_a_flown_round_is_not_resolved_again(self) -> None:
        b = self.results["bazooka"]
        self.assertGreater(b["launched"], 0)
        self.assertEqual(b["resolved"], 0)
        u = self.results["unflown"]
        self.assertEqual(u["resolved"], u["rounds"])

    def test_only_a_rocket_launchers_round_is_flown(self) -> None:
        f = self.results["flown"]
        self.assertTrue(f["bazooka"])
        for name in ("grenade", "landmine", "bullet", "bareTemplateName", "none"):
            self.assertFalse(f[name], name)

    def test_a_bots_flown_round_is_his_damage(self) -> None:
        b = self.results["billing"]
        # The tagged group (bot-rounds.js) bills the hull and the blast to the
        # bot; an untagged round is still the human's.
        self.assertEqual(b["hullAttackers"], ["bot_0", "local"])
        self.assertEqual(b["splashAttackers"], ["bot_0"])
        self.assertEqual(b["splashOnBot"], [{"id": "bot_5", "attacker": "bot_0", "splash": True, "weapon": "Bazooka"}])

    # --- the fire plan -------------------------------------------------------

    def test_an_empty_magazine_ends_the_plan_only_where_the_engine_breaks(self) -> None:
        p = self.results["planEnd"]
        self.assertTrue(p["smgRanDry"])
        self.assertFalse(p["smgPlanMadeInReload"])
        self.assertFalse(p["bazookaReloading"])
        self.assertFalse(p["loaded"])


if __name__ == "__main__":
    unittest.main()
