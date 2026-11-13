"""What the bots do with every radio message, an engineer's wrench on a
friendly hull, and a ship bot answering a request for its seat.

Read from lnxded (bf1942_lnxded.static) 2026-11-13:

* `AIRadio::getMessageStrength` 0x084825c0 has 38 call sites. `1 - s` is
  `fld1; fsubp %st, %st(1)` with the bytes `de e1` (Intel FSUBRP) at each of
  its eight sites.
    - Fire (`BBFire` 0x085652b5..0x08565329, and `BBFire3d`,
      `BBFireLargeBore`, `BBFireUnarmed`, `BBFireGuided`):
      `(1 + Fire 0x25)(1 + CoverMe 0x2b)(1 - HoldFire 0x26)`, on the urgency
      and on what the fire inclination takes.
    - MoveTo (`BBMoveTo` 0x08575035.., `BBMoveToFixed` 0x085756ee..):
      `(1 + Go 0x31)(1 - HoldPosition 0x2c)(1 - Wait 0x24)`.
    - Scout (`BBScout` 0x0857a81a..): `(1 + CheckYourSix 0x34)` times `(1 +
      s)` of the seven "spotted" calls 0x0f..0x15.
    - TakeCover (0x0857d063, 0x0858103d): `1 + TakeCover 0x29`.
    - MedicAssist (0x08573d59, 0x08573d83): `1 + Medic 0x28` for a soldier
      target, `1 + NeedRepairs 0x36` for any other, on the choice of target
      only (0x085742ae / 0x08574320), never on the sum.
* `operator>>(istream&, RadioMessage&)` 0x08489060 names 46 messages, sends
  `RMShipSpotted` to 17 (`je 0x8489218` at 0x08489235) and any unknown word
  to 0. `subscribeToMessage`: one argument a 0.1 b 0.5, two a 1/t b 0.5,
  three a 1/t b g (0x084824e0, 0x08482510, 0x08482540).
* `BBMedicAssist::calculateUrgency` 0x08573840 scores every friendly unit by
  its armour class: `value / (d x SCurve(h))`, `value` the unit's
  `Information+0x14` (`flds 0x14(%esi)` at 0x08574219), for `0 < h < 0.95`
  (0x086d16cc) upright by 0.7071 (0x08702470). Vanilla `RepairPackAI` rates
  every armour class 2.0 and Infantry 0; `MedPackAI` Infantry 2.0 alone.
* `BBChangeTeleport::calculateUrgency` 0x085611f0, the own seat staying
  best: the requested unit is the bot's own -> 6.0 (`0x40c00000`,
  0x085619ce) and `BBPChangeTeleport::init(own, false)`; the attack share
  under 0.05 with the bot off LOD 0 -> 2.0 (0x0856191f), the same plan.
  `createPlan` 0x08590590 with the flag clear registers the bot on the
  SAI's teleporter list (0x08590cde) and waits 2.0 s (0x08590dad);
  `SAI::handleTeleportingBot` 0x08631390 re-spawns it alive
  (`GameServer::reSpawnPlayer` 0x0814c4b0). `BBChangeLandingCraft`'s 6.0
  (0x08560aaa) is a swap's urgency while the request stands.

Driven headless by `bot_radio_harness.mjs` against the viewer's modules.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).with_name("bot_radio_harness.mjs")

sys.path.insert(0, str(ROOT))

import extract_vehicle_ai  # noqa: E402


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


VANILLA_IDS = [15, 16, 17, 19, 20, 21, 36, 37, 38, 39, 40, 41, 42, 43, 44, 49, 51, 52, 53, 54]


class BotRadioTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the products ---------------------------------------------------------------

    def test_the_message_ids_are_the_engines(self) -> None:
        ids = self.results["factors"]["ids"]
        self.assertEqual(
            {"Fire": 0x25, "CoverMe": 0x2B, "HoldFire": 0x26, "Go": 0x31, "HoldPosition": 0x2C, "Wait": 0x24,
             "CheckYourSix": 0x34, "TakeCover": 0x29, "Medic": 0x28, "NeedRepairs": 0x36,
             "ArmorSpotted": 0x0F, "InfantrySpotted": 0x10, "UnitSpotted": 0x11, "ShipSpotted": 0x12,
             "SubmarineSpotted": 0x13, "AirplaneSpotted": 0x14, "ScoutSpotted": 0x15,
             "BailOut": 0x2A, "GetIn": 0x33, "AbandonShip": 0x35, "FireInHole": 0x27},
            ids)

    def test_nobody_has_spoken_and_every_product_is_exactly_one(self) -> None:
        self.assertEqual([1, 1, 1, 1], self.results["factors"]["quiet"])

    def test_fire_and_cover_me_raise_the_fire_and_hold_fire_damps_it(self) -> None:
        f = self.results["factors"]
        self.assertAlmostEqual(1.8, f["fire"], places=9)
        self.assertAlmostEqual(1.8, f["coverMe"], places=9)
        self.assertAlmostEqual(0.2, f["holdFire"], places=9)
        self.assertAlmostEqual(1.5 * 1.25 * 0.8, f["fireAll"], places=9)
        # Unclamped, as the engine's: a shout from 35 m is 1.6, and 1 - 1.6 < 0.
        self.assertAlmostEqual(-0.6, f["holdFireNear"], places=9)

    def test_go_raises_the_move_and_hold_position_and_wait_damp_it(self) -> None:
        f = self.results["factors"]
        self.assertAlmostEqual(1.8, f["go"], places=9)
        self.assertAlmostEqual(0.2, f["holdPosition"], places=9)
        self.assertAlmostEqual(0.2, f["wait"], places=9)
        self.assertAlmostEqual(1.5 * 0.75 * 0.8, f["moveAll"], places=9)

    def test_check_your_six_and_each_spotted_call_raise_the_scout(self) -> None:
        f = self.results["factors"]
        self.assertAlmostEqual(1.8, f["six"], places=9)
        self.assertEqual(7, len(f["spotted"]))
        for v in f["spotted"]:
            self.assertAlmostEqual(1.8, v, places=9)
        self.assertAlmostEqual(1.5 ** 3, f["scoutAll"], places=9)

    def test_take_cover_medic_and_need_repairs(self) -> None:
        f = self.results["factors"]
        self.assertAlmostEqual(1.8, f["takeCover"], places=9)
        self.assertAlmostEqual(1.8, f["medic"]["soldier"], places=9)
        self.assertAlmostEqual(1.4, f["medic"]["other"], places=9)

    def test_fire_in_the_hole_is_read_by_nothing(self) -> None:
        self.assertEqual([1, 1, 1, 1], self.results["factors"]["fireInHole"])

    # --- the generators ---------------------------------------------------------------

    def test_move_to_is_the_waypoint_times_the_modifier_times_the_radio(self) -> None:
        m = self.results["moveTo"]
        self.assertEqual([3, 3], m["quiet"])
        self.assertEqual(3, m["noRadio"])
        self.assertAlmostEqual(3 * 1.8, m["go"][0], places=9)
        self.assertAlmostEqual(3 * 0.2, m["holdPosition"][0], places=9)
        self.assertAlmostEqual(3 * 0.2, m["wait"][0], places=9)
        self.assertLess(m["near"][0], 0)

    def test_a_fixed_seat_publishes_the_order_with_the_radio_on_it(self) -> None:
        urgency, order = self.results["moveTo"]["fixed"]
        self.assertEqual(0, urgency)
        self.assertAlmostEqual(3 * 0.2, order, places=9)

    def test_fire_is_the_score_times_the_modifier_times_the_radio(self) -> None:
        f = self.results["fire"]
        self.assertEqual([3, 3], f["quiet"])
        for case, factor in (("fire", 1.8), ("coverMe", 1.8), ("holdFire", 0.2)):
            self.assertAlmostEqual(3 * factor, f[case][0], places=9, msg=case)
            # ...and the fire inclination takes the same value.
            self.assertAlmostEqual(3 * factor, f[case][1], places=9, msg=case)

    def test_an_unarmed_seats_threat_takes_the_radio_too(self) -> None:
        urgency, inclination = self.results["fire"]["unarmedHold"]
        self.assertEqual(0, urgency)
        self.assertAlmostEqual(3 * 0.2, inclination, places=9)

    def test_scout_and_take_cover_are_handed_their_product(self) -> None:
        h = self.results["handed"]
        self.assertAlmostEqual(1.8 * 1.5, h["scout"], places=9)
        self.assertAlmostEqual(1.8, h["cover"], places=9)
        s = self.results["scoutState"]
        self.assertEqual(s["quiet"], s["one"])
        self.assertGreater(s["called"], s["quiet"])

    # --- radio.con --------------------------------------------------------------------

    def test_vanillas_twenty_one_lines_subscribe_twenty_messages(self) -> None:
        c = self.results["con"]
        self.assertEqual(VANILLA_IDS, c["ids"])
        self.assertEqual({"a": 0.1, "b": 0.8}, c["record"])
        # The table a tree without the file's rows runs is the same one.
        self.assertEqual(VANILLA_IDS, c["builtIn"])
        self.assertEqual(c["record"], c["builtRecord"])

    def test_ship_spotted_parses_to_unit_spotted_and_is_never_heard(self) -> None:
        names = self.results["con"]["names"]
        self.assertEqual(17, names["RMShipSpotted"])
        self.assertEqual(17, names["RMUnitSpotted"])
        self.assertNotIn(18, names.values())
        s = self.results["shipSpotted"]
        self.assertEqual(0, s["ship"])
        self.assertAlmostEqual(0.8, s["unit"], places=9)

    def test_one_argument_is_a_tenth_and_a_half_and_an_unknown_name_is_zero(self) -> None:
        c = self.results["con"]
        self.assertEqual({"a": 0.1, "b": 0.5}, c["default"])
        self.assertEqual([0, *VANILLA_IDS], c["gcIds"])
        self.assertEqual({"a": 0.1, "b": 0.5}, c["gcRecord"])
        self.assertEqual(c["gcIds"], c["builtGc"])
        self.assertEqual(c["gcRecord"], c["builtGcRecord"])
        self.assertEqual({"a": 0.25, "b": 0.5}, c["twoArgs"])

    def test_the_exporter_and_the_viewer_hold_one_name_table(self) -> None:
        self.assertEqual(extract_vehicle_ai.RADIO_MESSAGE_IDS, self.results["con"]["names"])
        self.assertEqual(47, len(extract_vehicle_ai.RADIO_MESSAGE_IDS))

    def test_the_exporter_writes_the_rows_the_viewer_reads(self) -> None:
        text = ("aiRadio.subscribeToMessage RMLocalHoldFire\t10\t0.8\r\n"
                "rem aiRadio.subscribeToMessage RMRoger\r\n"
                "aiRadio.subscribeToMessage RMShipSpotted 4\r\n"
                "aiRadio.subscribeToMessage RMFirstRadioSpotted\r\n")
        rows = extract_vehicle_ai.radio_subscriptions(text)
        self.assertEqual(
            [{"name": "RMLocalHoldFire", "id": 38, "a": 0.1, "b": 0.8},
             {"name": "RMShipSpotted", "id": 17, "a": 0.25, "b": 0.5},
             {"name": "RMFirstRadioSpotted", "id": 0, "a": 0.1, "b": 0.5}], rows)
        self.assertIsNone(extract_vehicle_ai.radio_subscriptions(None))
        self.assertEqual({"mod": "x", "equipmentTypes": {}, "vehicles": {}},
                         extract_vehicle_ai.named("x", {}, {}))
        self.assertEqual(rows, extract_vehicle_ai.named("x", {}, {}, rows)["radio"])

    def test_a_trees_rows_replace_the_built_in_table(self) -> None:
        self.assertEqual([[37, {"a": 0.25, "b": 0.6}]], self.results["con"]["fromRows"])
        self.assertIsNone(self.results["con"]["fromNothing"])
        s = self.results["subscribe"]
        self.assertTrue(s["took"])
        self.assertTrue(s["source"])
        self.assertAlmostEqual(0.8, s["fireKept"], places=9)
        self.assertAlmostEqual(0.25, s["holdFire"], places=9)
        self.assertEqual(0, s["goDropped"])
        self.assertFalse(s["refused"])

    # --- the wrench -------------------------------------------------------------------

    def test_the_wrench_takes_a_hull_and_the_bag_a_soldier(self) -> None:
        m = self.results["medicState"]
        self.assertEqual("hull:t", m["engineer"]["targetId"])
        self.assertTrue(m["engineer"]["hull"])
        self.assertEqual([20, 0, 0], m["engineer"]["targetPos"])
        self.assertEqual("mate", m["medic"]["targetId"])
        self.assertFalse(m["medic"]["hull"])
        # A wrench has nothing to give a soldier.
        self.assertIsNone(m["lone"]["targetId"])
        self.assertEqual(0, m["lone"]["urgency"])

    def test_a_hull_is_weighed_as_any_friend_is(self) -> None:
        m = self.results["medicState"]
        c = m["constants"]
        self.assertEqual(0.95, c["healthBelow"])
        self.assertEqual(1, c["unitValue"])
        for case in ("whole", "wreck", "tipped", "offMap", "untraced"):
            self.assertIsNone(m[case], case)
        self.assertEqual("hull:t", m["offMapInReach"])
        self.assertEqual("hull:t", m["traced"])
        self.assertEqual("hull:near", m["nearer"]["targetId"])

    def test_the_radio_picks_the_target_and_leaves_the_urgency(self) -> None:
        m = self.results["medicState"]
        self.assertEqual("mate", m["bothMedic"]["targetId"])
        self.assertEqual(m["bothQuiet"]["urgency"], m["bothMedic"]["urgency"])
        # "Need repairs!" turns a bot with both packs from the soldier to the hull.
        self.assertEqual("mate", m["bothRepairsQuiet"])
        self.assertEqual("hull:t", m["bothRepairs"])

    def test_the_plan_stops_inside_the_wrenchs_reach(self) -> None:
        m = self.results["medicState"]
        c = m["constants"]
        self.assertEqual(0.9, c["rangeFraction"])
        self.assertEqual(2.0, c["repairReach"])
        # R + 0.9 x maxRange for a friend with no reach of its own (the engine's stop)...
        self.assertAlmostEqual(4 + 0.9 * 2.5, m["arriveNoReach"], places=9)
        # ...and inside `repairDistance` for a hull.
        self.assertAlmostEqual(4 + c["reachFraction"] * 2.0, m["engineer"]["arrive"], places=9)
        self.assertLess(m["engineer"]["arrive"], 4 + c["repairReach"])

    def test_the_sides_hulls_are_the_friends(self) -> None:
        hulls = self.results["friendlyHulls"]
        self.assertEqual(["hull:mine", "hull:willy"], [h["id"] for h in hulls])
        sherman, willy = hulls
        self.assertEqual(("HeavyArmour", 12, 0.4), (sherman["type"], sherman["value"], sherman["health"]))
        self.assertEqual(("LightArmour", 6), (willy["type"], willy["value"]))
        self.assertAlmostEqual(3.5, sherman["radius"], places=9)
        self.assertEqual(0, self.results["friendlyHullsNone"])

    def test_an_engineer_walks_to_a_damaged_tank_and_holds_the_wrench_on_it(self) -> None:
        e = self.results["engineer"]["wrench"]
        self.assertTrue(e["chosen"])
        self.assertEqual("hull:tank", e["target"])
        self.assertTrue(e["fired"])
        self.assertEqual("RepairPack", e["weapon"])
        # Standing: a crouched wrench disarms and repairs nothing.
        self.assertEqual("stand", e["stance"])
        self.assertLessEqual(e["firingDist"], e["arrive"] + 1e-6)
        # In the wrench's own law, from where the bot stands.
        self.assertTrue(e["reached"])
        self.assertLessEqual(e["firing3d"], e["radius"] + 2.0)
        self.assertTrue(e["planHull"])

    def test_a_medic_and_an_enemy_hull_are_no_business_of_the_wrench(self) -> None:
        for case in ("bag", "enemyHull"):
            e = self.results["engineer"][case]
            self.assertFalse(e["chosen"], case)
            self.assertFalse(e["fired"], case)
            self.assertEqual(0, e["urgency"], case)

    def test_the_hulls_plan(self) -> None:
        p = self.results["hullPlan"]
        self.assertEqual(["InfanteryMoveToObject", "MouseTurretAimAt", "TriggerContinously", "SoldierPose"], p["types"])
        self.assertTrue(p["hull"])
        self.assertTrue(p["live"])
        self.assertTrue(p["triggerHull"])
        self.assertTrue(p["heal"])
        d = self.results["healPlanDone"]
        self.assertFalse(d["mending"])
        for case in ("mended", "gone", "left", "dry"):
            self.assertTrue(d[case], case)

    # --- the seat request on a ship -----------------------------------------------------

    def test_a_request_with_no_better_seat_scores_six_and_re_deploys(self) -> None:
        t = self.results["teleport"]
        self.assertEqual({"request": 6, "noOrder": 2, "split": 0.05, "wait": 2}, t["constants"])
        self.assertEqual({"urgency": 0, "best": None, "redeploy": False}, t["quiet"])
        self.assertEqual({"urgency": 6, "best": None, "redeploy": True}, t["requested"])
        self.assertEqual(t["requested"], t["pending"])

    def test_a_better_seat_is_the_ordinary_swap(self) -> None:
        t = self.results["teleport"]["requestedSwap"]
        self.assertEqual("aa", t["best"]["id"])
        self.assertFalse(t["redeploy"])

    def test_the_no_order_re_deploy_needs_a_bot_off_lod_zero(self) -> None:
        t = self.results["teleport"]
        self.assertEqual(0, t["noOrder"]["urgency"])
        self.assertEqual({"urgency": 2, "best": None, "redeploy": True}, t["noOrderLod"])
        self.assertEqual(0, t["noOrderAttacking"]["urgency"])

    def test_a_landing_craft_swaps_at_six_under_a_request_and_never_re_deploys(self) -> None:
        t = self.results["teleport"]
        self.assertEqual({"urgency": 0, "best": None, "redeploy": False}, t["landing"])
        self.assertEqual(6, t["landingSwap"]["urgency"])
        self.assertEqual("mg", t["landingSwap"]["best"]["id"])
        self.assertEqual(4, t["landingSwapQuiet"]["urgency"])

    def test_only_a_teleport_rows_seat_answers_this_way(self) -> None:
        s = self.results["shipSeat"]
        want = {"urgency": 6, "best": "ship:gun", "redeploy": True, "teleport": True}
        self.assertEqual(want, s["asked"])
        self.assertEqual(want, s["late"])
        self.assertEqual(want, s["noRowShip"])
        for case in ("stale", "never", "tank", "noRowTank"):
            self.assertIsNone(s[case], case)

    def test_the_plan_registers_the_bot_once_and_waits_two_seconds(self) -> None:
        p = self.results["redeployPlan"]
        self.assertTrue(p["first"])
        self.assertTrue(p["kept"])
        self.assertFalse(p["registeredAgain"])
        self.assertEqual([p["wait"]], p["types"])
        self.assertEqual(102, p["until"])
        self.assertFalse(p["waiting"])
        self.assertTrue(p["over"])

    def test_the_referee_stands_the_bot_on_a_spawn_of_its_side_alive(self) -> None:
        r = self.results["redeploy"]
        self.assertTrue(r["moved"])
        self.assertEqual(1, r["left"])
        self.assertEqual([{"id": "b", "flag": "ours", "advance": False}], r["calls"])
        self.assertEqual([50, 0, 60], r["position"])
        self.assertFalse(r["seated"])
        self.assertIsNone(r["request"])
        self.assertIsNone(r["route"])
        # The same body: nothing healed, nobody killed.
        self.assertEqual(12, r["hitPoints"])
        self.assertEqual(["ours"], r["redeployed"])
        self.assertFalse(r["deadMoved"])
        # No group of the side to stand on: nothing happens.
        self.assertFalse(r["nowhere"])

    def test_a_bot_with_no_radio_hears_nothing(self) -> None:
        self.assertEqual({"none": 0, "some": 0.3}, self.results["radioOf"])


if __name__ == "__main__":
    unittest.main()
