"""`viewer/doctrine.js` and `viewer/doctrine-squad.js` under node
(`tests/doctrine_harness.mjs`).

The strategic interface (features/bot-doctrines/README.md): the engine's SAI
behind `StrategicCommand` gives the orders the bare SAI gives, the
`WPCloseTo` law (0x08536990) the follow orders are built on, the order
contract and the doctrine spec, and the squad play's leaders, followers,
holds and boarding.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "doctrine_harness.mjs"
MODULES = ("strategic.js", "strategic-layer.js", "strategic-ai.js", "doctrine.js", "doctrine-squad.js", "doctrine-garrison.js", "doctrine-landing.js",
           # `doctrine.js` reads the crew rule from the bots' vehicle code.
           "bot-vehicle.js", "bot-behaviours.js")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        proc = subprocess.run(["node", str(work / "harness.mjs")], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DoctrineTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_sai_behind_the_command_orders_as_the_bare_sai(self) -> None:
        # 60 s, 6 bots a side walking in, two deaths and a unit change: every
        # bot's order sampled twice a second is the same object shape.
        e = self.r["saiEquivalent"]
        self.assertTrue(e["identical"])
        self.assertEqual(e["samples"], 120)
        self.assertGreater(e["ordered"], 0)
        self.assertEqual(e["passes"], 30)

    def test_close_to_radius_is_at_least_5_and_twice_the_bounding_radius(self) -> None:
        # ctor 0x085365b0: max(5, r); a physical object max(R, 2 x vt+0x30).
        c = self.r["closeTo"]
        self.assertEqual(c["radiusFloor"], 5)
        self.assertEqual(c["radiusBounding"], 7)

    def test_close_to_urgency_is_d2_over_4r2_capped_with_no_floor(self) -> None:
        # getUrgency 0x08536990: 0 inside R, min(1, d^2 / 4R^2) outside, 3D.
        c = self.r["closeTo"]
        self.assertEqual(c["inside"], 0)
        self.assertTrue(c["insideArrived"])
        self.assertEqual(c["atR"], 0.25)
        self.assertEqual(c["sevenFive"], 0.563)
        self.assertEqual(c["far"], 1)
        self.assertEqual(c["threeD"], 0.36)
        self.assertTrue(c["noFloor"])

    def test_close_to_regoals_only_past_r_and_only_outside_r(self) -> None:
        c = self.r["closeTo"]
        self.assertTrue(c["movedLessThanR"])
        self.assertTrue(c["movedPastR"])
        self.assertTrue(c["insideNoRegoal"])
        self.assertTrue(c["lost"])

    def test_the_order_contract_is_enforced(self) -> None:
        c = self.r["contract"]
        self.assertTrue(c["unknownKind"])
        self.assertTrue(c["noUrgency"])
        self.assertTrue(c["areaWithoutInside"])
        self.assertTrue(c["nullIsNoOrder"])
        self.assertEqual(c["kinds"], ["WPAltitudeMoveTo", "WPBeachLanding", "WPBoard", "WPFollow", "WPHold", "WPLeave", "WPMoveTo",
                                      "WPMoveToBeachLanding", "WPPost"])

    def test_the_doctrine_spec_names_each_side(self) -> None:
        s = self.r["spec"]
        self.assertEqual(s["none"], {"1": "sai", "2": "sai"})
        self.assertEqual(s["both"], {"1": "squad", "2": "squad"})
        self.assertEqual(s["axis"], {"1": "squad", "2": "sai"})
        self.assertEqual(s["sides"], {"1": "sai", "2": "squad"})
        self.assertTrue(s["unknown"])

    def test_squads_of_four_with_a_leader_on_the_sai_order(self) -> None:
        s = self.r["squad"]
        self.assertEqual(s["squads"], [[f"s1_{i}" for i in range(4)], [f"s1_{i}" for i in range(4, 8)]])
        self.assertEqual(s["leaders"], ["s1_0", "s1_4"])
        self.assertEqual(s["leaderKinds"], ["WPMoveTo", "WPMoveTo"])
        self.assertEqual(s["followerKinds"], ["WPFollow"] * 4)
        self.assertEqual(s["followerLeader"], ["s1_0", "s1_4"])
        self.assertEqual(s["followerArea"], s["leaderArea"])
        # The other side still runs the bare SAI.
        self.assertTrue(all(k in ("WPMoveTo", None) for k in s["alliesAllSai"]))

    def test_the_follow_slots_sit_behind_and_beside_the_leader(self) -> None:
        s = self.r["squad"]
        for got, want in ((s["slot1"], s["slot1Expected"]), (s["slot3"], s["slot3Expected"])):
            self.assertAlmostEqual(got[0], want[0], places=2)
            self.assertAlmostEqual(got[1], want[1], places=2)

    def test_the_leader_holds_for_a_straggler_but_not_for_a_respawn(self) -> None:
        h = self.r["hold"]
        self.assertTrue(h["heldAt30"])
        self.assertEqual(h["notAt150"], "WPMoveTo")
        # Held from the first pass for 15 s (passes at 2..16 s), then the
        # 20 s cooldown, then held again.
        t = h["timeline"]
        self.assertEqual(t[:7], ["WPHold"] * 7)
        self.assertEqual(t[8:17], ["WPMoveTo"] * 9)
        self.assertEqual(t[18], "WPHold")

    def test_followers_board_the_leaders_hull_and_press_use_at_the_door(self) -> None:
        b = self.r["board"]
        # The third is 90 m off, past `boardRange`: on foot behind a hull he
        # cannot take, he goes to the SAI.
        self.assertEqual(b["kinds"], ["WPBoard", "WPBoard", "WPMoveTo"])
        self.assertEqual(sorted(b["seats"]), ["H:gunner", "H:mg"])
        self.assertEqual(b["leader"], "WPHold")
        self.assertEqual(len(b["entered"]), 1)
        self.assertEqual(b["entered"][0][0], "s1_1")
        self.assertEqual(b["enteredAfterTick"], 2)

    def test_a_member_at_the_wheel_leads(self) -> None:
        d = self.r["driverLeads"]
        self.assertEqual(d["leader"], "s1_2")
        self.assertEqual(d["kind"], "WPMoveTo")
        # His hull has no other seat: the members on foot go to the SAI.
        self.assertEqual(d["follows"], "WPMoveTo")

    def test_a_mounted_leaders_followers_on_foot_without_a_seat_go_to_the_sai(self) -> None:
        self.assertEqual(self.r["driverLeads"]["follows"], "WPMoveTo")

    def test_an_aircraft_leaders_followers_go_to_the_sai(self) -> None:
        a = self.r["air"]
        self.assertEqual(a["leader"], "WPAltitudeMoveTo")
        self.assertEqual(a["followers"], ["WPMoveTo"] * 3)

    def test_a_follower_riding_another_hull_away_gets_out(self) -> None:
        v = self.r["leave"]
        self.assertEqual(v["kind"], "WPLeave")
        self.assertEqual(v["exited"], ["s1_1"])
        self.assertEqual(v["leaves"], 1)

    def test_a_driving_follower_far_behind_makes_the_leader_hold(self) -> None:
        v = self.r["leave"]
        self.assertEqual(v["leader2"], "s1_4")
        self.assertEqual(v["leader2Kind"], "WPHold")


if __name__ == "__main__":
    unittest.main()


class GarrisonTests(unittest.TestCase):
    """doctrine-garrison.js: one busy guard a flag, everyone else attacking
    (doctrine_harness.mjs section 5)."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.g = DoctrineTests.r["garrison"] if hasattr(DoctrineTests, "r") else run_harness()["garrison"]

    def test_the_post_cap(self) -> None:
        # None under three bots, then a third of them.
        self.assertEqual(self.g["cap"], [0, 1, 2, 4])

    def test_one_guard_and_the_rest_attack(self) -> None:
        # The Axis holds West (the base cannot be taken): the bot nearest its
        # flag guards it, every other one attacks East and takes no idle gun.
        self.assertEqual(self.g["orders"], ["WPPost:West"] + ["WPMoveTo:East:engaged"] * 7)
        # The engine's SAI on the same world leaves more than one on West.
        self.assertGreater(self.g["sai"].count("WPMoveTo:West"), 1)

    def test_the_post_walks_its_ring(self) -> None:
        p = self.g["post"]
        self.assertEqual(p["phase"], "patrol")
        self.assertEqual(p["gait"], "walk")
        self.assertAlmostEqual(p["ringDist"], p["ringR"], places=3)
        self.assertEqual(p["urgencyFar"], 1)
        # Leg after leg round the ring, each after its stop (3..7 s).
        self.assertEqual([l["leg"] for l in self.g["legs"]], [0, 1, 2, 3])
        for l in self.g["legs"]:
            self.assertAlmostEqual(l["dist"], p["ringR"], places=3)
        t = self.g["legTimes"]
        for a, b in zip(t, t[1:]):
            self.assertGreaterEqual(b - a, 3.0)
            self.assertLessEqual(b - a, 7.5)

    def test_the_post_mans_the_flags_gun(self) -> None:
        g = self.g["gun"]
        self.assertEqual(g["first"], {"phase": "board", "point": [411, -410], "gunId": "G:gun"})
        self.assertEqual(g["entered"], [["g1_0", "G:gun"]])
        self.assertEqual(g["manned"], {"phase": "man", "gunId": "G:gun", "urgency": 0})
        # A post sitting in a gun away from its flag gets out.
        self.assertEqual(g["farExit"], ["x"])

    def test_a_guard_freed_holds_no_post(self) -> None:
        u = self.g["unitChange"]
        self.assertEqual(u["freed"], {"free": True, "post": None, "lastPost": "West"})
        self.assertEqual(u["reposted"], ["WPPost:West"] + ["WPMoveTo:East:engaged"] * 7)
        # One flag guarded: never two posts, never a post order on a record
        # that is not posted.
        self.assertLessEqual(u["worstPosts"], 1)
        self.assertEqual(u["strayPosts"], 0)
