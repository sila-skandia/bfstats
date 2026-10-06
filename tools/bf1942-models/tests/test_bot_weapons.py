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
import math
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

    def test_a_held_trigger_fires_on_whole_ticks(self) -> None:
        # GUN-13: a round sets `timeToFireFinished` to 1 / roundOfFire and it
        # runs down a tick at a time, so the rate is 30 / ceil(30 / rof).
        m = self.results["wholeTicks"]["mp40"]
        self.assertEqual(m["rounds"], 32)
        # 31 periods of four ticks (7.5 a second), not of 1/9 s.
        self.assertAlmostEqual(m["span"], 31 * 4 / 30, delta=1e-3)
        # The M249's 13.5 fires every third tick: 10 a second.
        self.assertEqual(self.results["wholeTicks"]["m249"]["gaps"], [0.1])

    def test_a_new_soldier_gets_a_full_kit(self) -> None:
        r = self.results["respawn"]
        self.assertEqual(r["dry"], {"rounds": 0, "spare": 0})
        self.assertEqual(r["refilled"], {"rounds": 1, "spare": 5})
        # ...and a new input index, the next life's (ledger AI-145).
        self.assertEqual(r["index"][2:], [1, r["expected"][1]])

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


class BotBarrelsTests(unittest.TestCase):
    """A bot's shotgun fires every barrel (ledger XHIT-12, XHIT-16).

    The bots fired one ray down the eye per pull: a Remington's eight
    pellets came out as one, with an eighth of the pull's damage. The server
    runs one barrel loop for every player; `bot-barrels.js` hands the bot's
    eye and the weapon's barrels to `gun-groups.js cameraLaunch`, the law the
    human's hand weapon and the vehicle coax fire through.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.b = run_harness()["barrels"]

    def test_a_pull_is_one_round_a_barrel(self) -> None:
        self.assertGreaterEqual(self.b["pulls"], 2)
        self.assertEqual(self.b["resolved"], 8 * self.b["pulls"])

    def test_each_round_flies_its_own_barrels_turn(self) -> None:
        # The glb's turns: up to 1.5 deg off the view axis, no two alike.
        self.assertEqual(len(self.b["offAxis"]), 8)
        self.assertTrue(all(0.2 < a < 1.6 for a in self.b["offAxis"]), self.b["offAxis"])
        self.assertEqual(self.b["distinct"], 8)

    def test_a_gun_without_barrels_fires_one_ray(self) -> None:
        c = self.b["colt"]
        self.assertEqual(c["resolved"], c["pulls"])
        self.assertEqual(c["rays"], 0)
        self.assertIsNone(self.b["plain"])
        self.assertEqual(self.b["noBarrels"], 0)

    def test_the_barrels_compose_down_the_path(self) -> None:
        # In index order; the bundle's quarter turn about y carries the -1 m
        # offset of the second barrel to -x.
        p = self.b["parsed"]
        self.assertEqual([b["position"] for b in p], [[0, 0, 0], [-1, 0, 0]])
        self.assertAlmostEqual(p[0]["rotation"][1], 0.707107, places=5)


if __name__ == "__main__":
    unittest.main()


class BotHeatHoldTests(unittest.TestCase):
    """`createFirePlan`'s `If(Or(empty, Not(BAPConWeaponHeat(0.8, 0.5))), hold,
    fire)` (ledger AI-144, bot-plans.js `heatHolds`): the trigger is let go
    the tick the heat reaches 0.8 and pressed again at 0.5, inside one plan;
    a new plan's condition starts unlatched."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.h = run_harness()["heat"]

    def test_a_stationary_mg42_burst_ends_at_30_rounds(self) -> None:
        # The lab's longest bot bursts: 30 rounds on the MG42 (GUN-15).
        self.assertEqual(self.h["mg42"]["bursts"][0], 30)
        self.assertEqual(self.h["lawReaches"]["MG42"], 30)
        self.assertGreaterEqual(self.h["mg42"]["lastHeat"][0], 0.8)

    def test_the_browning_ends_at_30_and_the_coax_at_20(self) -> None:
        self.assertEqual(self.h["browning"]["bursts"][0], 30)
        self.assertEqual(self.h["coax"]["bursts"][0], 20)

    def test_it_fires_again_at_half_heat_and_never_locks(self) -> None:
        mg = self.h["mg42"]
        self.assertGreater(len(mg["bursts"]), 1)
        for heat in mg["resumeHeat"]:
            self.assertLessEqual(heat, 0.5)
            self.assertGreater(heat, 0.45)
        self.assertLess(mg["maxHeat"], 0.85)
        self.assertFalse(mg["locked"])

    def test_a_new_plan_fires_under_08(self) -> None:
        # Replanned during the hold, the new plan's condition is unlatched.
        r = self.h["mg42Replan"]
        self.assertEqual(r["bursts"][0], 30)
        self.assertAlmostEqual(r["resumeAt"][0], 2.3, places=1)
        self.assertGreater(r["resumeHeat"][0], 0.5)
        self.assertLess(r["resumeHeat"][0], 0.8)

    def test_a_gun_with_no_heat_never_holds(self) -> None:
        self.assertEqual(len(self.h["noHeat"]["bursts"]), 1)
        self.assertIsNone(self.h["noWords"])
        self.assertIsNone(self.h["colt"])
        # A grenade's `heatAddWhenFire` is its throw's charge (GUN-14).
        self.assertIsNone(self.h["grenade"])

    def test_the_fire_data_carries_the_heat_words(self) -> None:
        self.assertEqual(self.h["words"], {"heatAddWhenFire": 0.04, "coolDownPerSec": 0.4,
                                           "timeDelayOnOverheat": 2.0, "roundOfFire": 15.0})

    def test_a_hand_m249_holds_where_the_law_reaches_08(self) -> None:
        hand = self.h["hand"]
        # On whole ticks (GUN-13) the M249 nets +0.0165 a round: 48 rounds.
        self.assertEqual(hand["reaches"], self.h["lawReaches"]["M249"])
        self.assertEqual(hand["bursts"][0], 48)
        self.assertGreater(len(hand["bursts"]), 1)
        self.assertLess(hand["heat"], 0.85)
        # Without the hold the same trigger runs on into the lockout.
        self.assertTrue(hand["freeLocked"])


class BotDeviationPointTests(unittest.TestCase):
    """A bot's round lands on a point of the DEV-9 square fixed by its input
    index, scaled by the total (ledger AI-145, bot-deviation.js): 618 in a
    seat, one multiple of 4 a life on foot; a barrel-less gun draws at the
    index - 1, barrel i of one with barrels at the index + i."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.d = run_harness()["devPoint"]

    def test_a_seated_bots_barrel_less_gun_draws_at_617(self) -> None:
        self.assertEqual(self.d["seatIndex"], 618)
        self.assertEqual(self.d["seatK"], 617)
        self.assertEqual(self.d["seated"], 618)
        self.assertEqual(self.d["unset"], 618)
        x, y, z = self.d["north"]
        # u_right 0.2325 to the right (+x), u_up 0.9517 up, in hundredths.
        n = (1 + 0.009517212 ** 2 + 0.002325311 ** 2) ** 0.5
        self.assertAlmostEqual(x, 0.002325311 / n, places=6)
        self.assertAlmostEqual(y, 0.009517212 / n, places=6)
        self.assertLess(z, -0.9999)

    def test_the_barrel_decides_the_index(self) -> None:
        # `Fire` hands fireBarrel -1 for no barrels (BOMB-2), 0..n-1 else.
        self.assertEqual(self.d["rifleK"], 475)
        self.assertEqual(self.d["launcherK"], 476)
        self.assertEqual(self.d["shotgunK"], [476, 477, 483])
        # The exporter gives a barrel-less gun one muzzle: one reads as none.
        self.assertEqual(self.d["declared"], [0, 0, 8, 0])

    def test_a_bot_on_foot_takes_a_multiple_of_4_each_life(self) -> None:
        lives = self.d["lives"]
        self.assertTrue(all(k % 4 == 0 and 0 <= k < 1024 for k in lives))
        self.assertEqual(self.d["again"], lives[0])
        self.assertEqual(self.d["onFoot"], lives[0])
        self.assertGreater(len(set(lives)), 25)

    def test_it_scales_with_the_total_and_draws_nothing_at_the_floor(self) -> None:
        self.assertAlmostEqual(self.d["north2"][1] / self.d["north"][1], 2.0, places=3)
        self.assertEqual(self.d["floor"], [0, 0, -1])

    def test_each_index_has_its_own_point_and_the_right_turns_with_the_line(self) -> None:
        self.assertNotEqual(self.d["barrel1"], self.d["north"])
        x, y, z = self.d["east"]
        # Facing +x, the shooter's right is +z.
        self.assertAlmostEqual(z, self.d["north"][0], places=6)
        self.assertAlmostEqual(y, self.d["north"][1], places=6)

    # Three recorded shotgun pulls (the lab's LOD 0 server recordings): each
    # pellet's launch velocity off the pull's `f` direction, (right, up) in
    # hundredths of a radian, barrels in order. DC's Saiga12k and Remington
    # turn their eight barrels by these (yaw, pitch) degrees.
    PULL_TURNS = [(1.25, -0.8), (0.5, -0.7), (-0.35, 1.25), (0.4, 0.26),
                  (-0.22, 1.0), (-1.5, 0.35), (1.0, 0.22), (-0.85, -1.25)]
    PULLS = {
        # dc-gazala-coop-lod0, pid 231, Saiga12k at 230.9 s
        180: [(3.068, 1.559), (0.203, 1.657), (-0.572, -1.224), (0.685, -0.517),
              (-0.31, -1.58), (-2.229, -1.552), (1.22, 0.597), (-0.457, 2.777)],
        # dc-el_alamein-coop-lod0 (01:01), pid 247, Saiga12k at 343.4 s
        876: [(1.832, 1.522), (1.221, 0.728), (-1.126, -2.154), (0.69, -0.302),
              (-0.534, -1.492), (-3.112, -0.203), (1.983, -0.556), (-1.931, 2.566)],
        # dc-basrahs_edge-coop-lod0, pid 254, Remington at 161.6 s
        476: [(2.142, 1.497), (0.702, 1.072), (-0.437, -2.371), (0.697, -0.592),
              (-0.175, -1.737), (-2.856, -0.615), (1.518, -0.258), (-1.439, 2.07)],
    }

    def _fit(self, pellets, first):
        """Least squares of the pellets less their barrels' turns against
        T x the points at seed indices first..first+7: (residual, T)."""
        k = math.pi / 180 * 100
        table = self.d["table"]
        rows = []
        for i, ((ar, au), (yaw, pitch)) in enumerate(zip(pellets, self.PULL_TURNS)):
            up, right = table[(first + i) & 0x3FF]
            rows.append((ar - yaw * k, au + pitch * k, right, up))
        den = sum(r[2] ** 2 + r[3] ** 2 for r in rows)
        t = max(0.0, sum(r[0] * r[2] + r[1] * r[3] for r in rows) / den)
        return sum((r[0] - t * r[2]) ** 2 + (r[1] - t * r[3]) ** 2 for r in rows), t

    def test_each_bot_on_foot_draws_at_its_own_index(self) -> None:
        # Every pull fits one index to the recorder's rounding, a multiple of
        # 4, and not the seats' 617 + barrel the bots used to share.
        for index, pellets in self.PULLS.items():
            fits = sorted((self._fit(pellets, g)[0], g) for g in range(1024))
            self.assertEqual(fits[0][1], index)
            self.assertLess(fits[0][0], 0.05)
            self.assertGreater(fits[1][0], 10 * fits[0][0])
            self.assertGreater(self._fit(pellets, 617)[0], 5 * fits[0][0])
            self.assertGreater(self._fit(pellets, 618)[0], 5 * fits[0][0])

    def test_the_table_is_the_binarys_own_draws(self) -> None:
        # `fireBarrel` 0x0828aba0's generator over `random_seeds` (.data
        # 0x0872fc80), when the server binary is on this PC. The table is
        # the C runtime's rand() from seed 1, and the word after it is 0.
        binary = Path.home() / "projects/public/bf42plus/bf1942_lnxded.static"
        if not binary.exists():
            self.skipTest("the lnxded binary is not on this machine")
        import struct
        with binary.open("rb") as fh:
            fh.seek(0x6c4500 + (0x0872fc80 - 0x0870d500))
            seeds = struct.unpack("<1025I", fh.read(4 * 1025))
        x, lcg = 1, []
        for _ in range(1024):
            x = (x * 214013 + 2531011) & 0xFFFFFFFF
            lcg.append((x >> 16) & 0x7FFF)
        self.assertEqual(list(seeds[:1024]), lcg)
        self.assertEqual(seeds[1024], 0)
        m = 0xffffffff
        s32 = lambda x: (x & m) - (1 << 32) if x & 0x80000000 else x & m

        def schrage(y, a):
            lo = ((y & 0xffff) * a) & m
            hi = ((s32(lo) >> 16) + (s32(y) >> 16) * a) & m
            x = ((s32(hi) >> 15) + (lo & 0xffff) + ((hi & 0x7fff) << 16)) & m
            z = (x - 0x7fffffff) & m
            return x if s32(z) < 0 else z

        def draw(k):
            r = schrage(schrage((seeds[k] + k) & m, 0x5e30), 0x661f)
            return (((s32(r) >> 7) | 1) + 1) * 5.9604645e-08 * 2.0 - 1.0

        for k, (up, right) in enumerate(self.d["table"]):
            k2 = k + 0x200 if k + 0x200 <= 0x400 else k - 0x200
            self.assertAlmostEqual(up, draw(k), places=6)
            self.assertAlmostEqual(right, draw(k2), places=6)

