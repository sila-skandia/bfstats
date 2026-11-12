"""`viewer/strategic.js` under node (`tests/strategic_harness.mjs`).

The strategic AI as the engine runs it (bot-behaviours.md §7): areas bound
to the level's control points, a strategy chosen per side through its
prerequisites, attack targets among the areas the side does not hold that
touch one it does, and a WPMoveTo order for every bot. Runs on El Alamein's
extracted `scene.json` when it is present, else on an inline fixture.
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
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).resolve().parent / "strategic_harness.mjs"
SCENE = VIEWER / "maps" / "el_alamein" / "scene.json"


def run_harness(scene: Path | None) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "strategic.js", work / "strategic.js")
        # `strategic.js` re-exports the layer, the AI and the doctrines.
        for name in ("strategic-layer.js", "strategic-ai.js", "doctrine.js", "doctrine-squad.js", "doctrine-garrison.js", "doctrine-landing.js",
                     "bot-vehicle.js", "bot-behaviours.js",
                     # `strategic-ai.js` reads a flag's capture radius for its orders.
                     "control-point-law.js"):
            shutil.copyfile(VIEWER / name, work / name)
        shutil.copyfile(HARNESS, work / "harness.mjs")
        (work / "package.json").write_text('{"type":"module"}\n')
        cmd = ["node", str(work / "harness.mjs")] + ([str(scene)] if scene else [])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class StrategicFixtureTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness(None)

    def test_conditions_compare_as_the_engine_does(self) -> None:
        c = self.results["compare"]
        self.assertEqual(c["crispGreaterTrue"], 1)
        self.assertEqual(c["crispGreaterFalse"], -1)
        self.assertEqual(c["fuzzySmaller"], 150)
        self.assertEqual(c["fuzzyEqual"], -3)
        self.assertEqual(c["quotientZero"], 1)

    def test_areas_take_their_control_points_owner(self) -> None:
        owners = {a["name"]: a["owner"] for a in self.results["areas"]}
        self.assertEqual(owners, {"AxisBase": 1, "Mid": 0, "AlliedBase": 2})

    def test_an_area_is_a_centre_box_about_p2(self) -> None:
        # `create Island 833/701 846/717 200`: p1 the corner, p2 the centre
        # (ctor 0x0863c000), inside = p1 <= p <= 2 p2 - p1 (0x08653fa0), each
        # side's radius |p2 - p1| (0x0863c657).
        p = self.results["pins"]
        self.assertEqual(p["corner"], [833, -701])
        self.assertEqual(p["centre"], [846, -717])
        self.assertEqual(p["min"], [833, -733])
        self.assertEqual(p["max"], [859, -701])
        self.assertAlmostEqual(p["sideRadius"], 20.616, places=3)
        self.assertTrue(p["cpInside"])

    def test_the_random_point_spans_the_corner_eighty_percent(self) -> None:
        # `randomizePos(side, 0.8)` 0x086449e0: p2 + rand W f - W/2.
        p = self.results["pins"]
        self.assertEqual(p["r0"], [833, -701])
        self.assertEqual(p["r1"], [853.8, -726.6])

    def test_a_tank_order_uses_the_side_radius_and_its_bounding_radius(self) -> None:
        # 0.25 x 20.616 + 2 x 3 (orderNormalBot 0x08640bd0).
        self.assertAlmostEqual(self.results["pins"]["tankRadius"], 11.154, places=3)

    def test_inside_round_r_plus_the_path_radius_the_order_has_arrived(self) -> None:
        # `WPMoveTo::getUrgency` 0x085374a0: d^2 < R'^2 -> arrived, 0.
        p = self.results["pins"]
        self.assertEqual(p["inR"], 0)
        self.assertTrue(p["inRArrived"])
        self.assertEqual(p["outU"], 2)

    def test_the_fallback_is_the_units_order_position_when_valid_else_p2(self) -> None:
        p = self.results["pins"]
        self.assertEqual(p["tankPosPoint"], [836, -731])
        self.assertEqual(p["blockedPoint"], [846, -717])

    def test_an_aircraft_is_ordered_to_the_area_at_75_m_with_a_50_m_clearance(self) -> None:
        # `orderAirBot` 0x08640810 -> WPAltitudeMoveTo(min(40, r), 120, 50, 2);
        # `WPAltitudeMoveTo::getUrgency` 0x08535610.
        a = self.results["pins"]["air"]
        self.assertEqual(a["point"], [846, -717])
        self.assertEqual(a["y"], 85)
        self.assertAlmostEqual(a["radius"], 20.616, places=3)
        self.assertEqual(a["clearance"], 50)
        self.assertEqual(a["far"], 1)
        self.assertEqual(a["at"], 0)
        self.assertAlmostEqual(a["ten"], 100 / (20.615528 ** 2 + 120 ** 2), places=5)
        self.assertEqual(a["high"], 1)
        self.assertFalse(a["arrived"])

    def test_a_passing_required_condition_adds_its_value(self) -> None:
        # `StrategyPrerequisite::evaluate` 0x0863aa50: 3 (Required) + 2.
        p = self.results["pins"]["prereq"]
        self.assertEqual(p["passing"], 5)
        self.assertEqual(p["failing"], 0)

    def test_an_area_without_a_control_point_is_held_by_presence(self) -> None:
        # Axis-authored pass: Allies alone take it and keep it while it is
        # empty or contested; a base Allies may not take stays Axis.
        self.assertEqual(self.results["pins"]["presence"], [1, 2, 2, 2, 1])

    def test_a_capture_only_flag_binds_only_where_the_engine_binds_it(self) -> None:
        # `AIStrategicArea::update` 0x0863d6d0 looks a point up only for an
        # area flagged `ControlPoint`, inside its centre box
        # (`BFEnvironment::findControlPoint` 0x085e53a0). Midway's sea areas
        # lie in no box: the nearest-centre rule would have bound North_Midway
        # to SouthSea and South_Midway to NorthSea, handing NorthSea to the
        # Axis. The Axis still count both among their control points
        # (`getNumberOfControlPoints` 0x085e4f80 counts every point whose
        # team is the side's). The page's state is that plus its owned areas
        # typed `ControlPoint`, which the engine's `SAI::updateStates` does
        # not add (the type flag 0x10 has no slot); kept, and pinned here as
        # the page's (features/bot-map-generation/flag-binding.md, section 5).
        c = self.results["pins"]["captureOnly"]
        self.assertEqual([["Base", ["Airfield"], 0], ["OutPost", ["Coastal_Defences"], 0],
                          ["NorthSea", [], 2], ["SouthSea", [], 1]], c["midway"])
        self.assertEqual([1, 1], c["controlPoints"]["neutralSeas"])
        self.assertEqual([3, 1], c["controlPoints"]["axisSeas"])
        self.assertEqual([["hillnest", ["HILL_424"], 2], ["supply_left", [], 0]], c["salerno"])

    def test_an_aircraft_does_not_hold_an_area_its_gunner_seat_does(self) -> None:
        # `AIStrategicArea::update` 0x0863d6d0 skips an air object in the
        # counts (0x0863e182 / 0x0863e1e5) but not a secondary seat of it.
        h = self.results["pins"]["airHold"]
        self.assertEqual(h["pilot"], {"owner": 1, "present": 0})
        self.assertEqual(h["gunner"], {"owner": 2, "present": 1})
        self.assertEqual(h["foot"], {"owner": 2, "present": 1})

    def test_every_order_carries_the_area_test(self) -> None:
        # bot.js calls `wp.inside` for Fire's outside-area factor and the
        # medic; an order without it threw every frame (ee729113).
        for inside in self.results["pins"]["orderInside"]:
            self.assertEqual(inside, [True, True, False, False])

    def test_an_arrived_mounted_bot_is_reordered_after_35_s(self) -> None:
        # `SAI::updateBotPositions` 0x08635bc0: 20 s on foot, 35 s mounted.
        p = self.results["pins"]
        self.assertTrue(p["keptAt30"])
        self.assertTrue(p["movedAt36"])

    # --- INVENTION: the capture ring (`_captureRing`) -------------------------

    def test_a_soldier_ordered_to_a_5_m_flag_ends_inside_its_ring(self) -> None:
        # R' is 7 m on foot here and the flag 5 m: the order's point is the
        # pole, it has arrived only 4 m from it (the radius less a body's),
        # and the walk ends inside the 5 m the capture law measures.
        n = self.results["pins"]["captureRing"]["narrow"]
        self.assertEqual(n["point"], [106, -100])
        self.assertEqual(n["radius"], 4)
        self.assertEqual(n["flag"], "Pole")
        self.assertLess(n["endToFlag"], 4)
        self.assertTrue(n["arrived"])
        # 4.5 m out, inside the engine's R': still asked for, at the urgency
        # the engine's order has at R' (0.25 x 2).
        self.assertEqual(n["outsideRing"], 0.5)
        self.assertFalse(n["outsideArrived"])
        # The flag taken: the engine's rule on the same point, arrived in R'.
        self.assertEqual(n["heldInsideRr"], 0)
        self.assertTrue(n["heldArrived"])

    def test_a_ring_the_ground_cut_is_asked_for_against_its_own_radius(self) -> None:
        # The pole 4.1 m over the ground: a 1.862 m ring. On its edge the
        # law's floor, 0.25 x 2; past 1.155 radii it outbids a look round
        # (Scout's 1.0 against MoveTo's 1.5 x the order), which against R' it
        # never did inside 6.9 m; at two radii it is whole.
        g = self.results["pins"]["captureRing"]["ground3d"]
        self.assertEqual(g["liftedAtEdge"], 0.5)
        self.assertEqual(g["liftedOverScout"], [True, True])
        self.assertEqual(g["liftedTwoRadii"], 2)

    def test_a_flat_ring_keeps_the_engines_radius_in_its_urgency(self) -> None:
        # A 4 m ring on its own ground: 8 m out is 8^2 / (4 x 7^2) x 2, the
        # engine's law against R', not the 2.0 its own radius would ask.
        # Shigaisen_B at 16 a side and Stalingrad's traces are the measure
        # (features/bot-map-generation/README.md, section 16).
        n = self.results["pins"]["captureRing"]["narrow"]
        self.assertEqual(n["twoRadii"], 0.6531)

    def test_a_wide_flags_order_is_the_engines_own(self) -> None:
        # A 10 m flag (>= R'), and one with the template's default 8 m: the
        # engine's random point, its R, and arrival inside R' of that point.
        c = self.results["pins"]["captureRing"]
        for key in ("wide", "unset"):
            self.assertEqual(c[key]["point"], c["engineDraw"], key)
            self.assertAlmostEqual(c[key]["radius"], 5.536, places=3, msg=key)
            self.assertIsNone(c[key]["flag"], key)
        self.assertLess(c["wide"]["endToPoint"], c["engineRr"])
        self.assertGreater(c["wide"]["endToPoint"], c["engineRr"] - 0.25)

    def test_a_held_flag_and_a_hull_keep_the_engines_order(self) -> None:
        # The ring is for a soldier and a flag still to take; a held flag
        # whose lose timer runs (state 2) is one.
        c = self.results["pins"]["captureRing"]
        for key in ("held", "hull"):
            self.assertEqual(c[key]["point"], c["engineDraw"], key)
            self.assertIsNone(c[key]["flag"], key)
        self.assertAlmostEqual(c["hull"]["radius"], 9.536, places=3)
        self.assertEqual(c["losing"], {"point": [106, -100], "radius": 4, "flag": "Pole"})

    def test_a_blocked_pole_takes_the_nearest_valid_point_of_its_ring(self) -> None:
        # The only free cell 2 m from the pole: the point, with the 2 m left
        # of the 4 m stand radius. No free cell within it: the engine's order.
        c = self.results["pins"]["captureRing"]
        self.assertEqual(c["beside"], {"point": [108, -100], "radius": 2, "flag": "Pole"})
        self.assertIsNone(c["walled"])

    def test_a_pole_the_ground_does_not_reach_keeps_the_engines_order(self) -> None:
        # A body on the ground at the ring's edge (4 m out) must be inside
        # the 5 m the law measures in 3D: 2.5 m under the pole it is, 13.5 m
        # under it (Stalingrad's upper-floor flags) it never is.
        c = self.results["pins"]["captureRing"]
        self.assertEqual(c["groundNear"], "Pole")
        self.assertIsNone(c["groundFar"])

    def test_a_pole_over_the_ground_is_ordered_into_what_its_radius_leaves_there(self) -> None:
        # A 5 m flag 4.1 m over the ground a soldier stands on reaches
        # sqrt(25 - 16.81) = 2.862 m across it: the order is the pole's foot,
        # arrived only inside that less a body's metre, and the walk ends
        # inside the 5 m the capture law measures in 3D. The flat 4 m ring
        # left the body at hypot(4, 4.1) = 5.7 m, outside it.
        g = self.results["pins"]["captureRing"]["ground3d"]
        self.assertEqual(g["lifted"], {"point": [106, -100], "radius": 1.862, "flag": "Pole"})
        self.assertLess(g["liftedEndToFlag"], 1.862)
        self.assertLess(g["liftedEnd3d"], 5)
        self.assertTrue(g["liftedArrived"])
        # 3 m out: inside the flat ring, outside this one, still asked for
        # (3^2 / (4 x 1.862^2) x 2).
        self.assertEqual(g["liftedOutside"], 1.298)
        self.assertFalse(g["liftedOutsideArrived"])
        # A pole 4.1 m under the ground (a pit) is the same ring.
        self.assertEqual(g["pit"], g["lifted"])

    def test_a_radius_that_leaves_no_ring_on_the_ground_keeps_the_engines_order(self) -> None:
        # 4.7 m up, a 5 m radius leaves 1.71 m: less a body's metre it is
        # under a body's width, no ring to stand in. 13.5 m up (Stalingrad's
        # upper-floor flags) it does not reach the ground at all.
        c = self.results["pins"]["captureRing"]
        self.assertEqual(c["ground3d"]["thin"]["point"], c["engineDraw"])
        self.assertIsNone(c["ground3d"]["thin"]["flag"])
        self.assertIsNone(c["groundFar"])

    def test_a_wide_flag_on_a_height_is_narrow_on_the_ground(self) -> None:
        # 10 m is at least R' (7 m here) and keeps the engine's order on its
        # own ground; 8.5 m over it the radius leaves 5.268 m, under R': the
        # ring, 4.268 m.
        g = self.results["pins"]["captureRing"]["ground3d"]
        self.assertIsNone(g["wideLevel"])
        self.assertEqual(g["wideLifted"], {"point": [106, -100], "radius": 4.268, "flag": "Pole"})

    def test_the_reach_and_the_stand_radius_follow_the_3d_radius(self) -> None:
        # control-point-law.js `captureReach`: sqrt(r^2 - dy^2), 0 where the
        # radius does not reach; the `ControlPointTemplate` ctor's 10 m with no
        # radius set (0x08284702, AI-115).
        law = self.results["pins"]["captureRing"]["ground3d"]["law"]
        self.assertEqual(law["reach"], [5, 4, 2.862, 0, 0, 10])
        # `captureStandRadius`: the flat figure (r - 1, at least r / 2) while
        # a body there is inside the 3D radius (to 3 m up or down at 5 m);
        # past that the reach less the metre; 0 under a body's width.
        self.assertEqual(law["stand"], [4, 4, 2.842, 1.862, 0, 0, 0.75, 4.268])

    def test_a_ring_no_route_reaches_is_handed_back(self) -> None:
        # `noRoute` (bot-decision.js, two route failures running): the bot's
        # next order to that flag's area is the engine's.
        a = self.results["pins"]["captureRing"]["afterNoRoute"]
        self.assertEqual(a["point"], self.results["pins"]["captureRing"]["engineDraw"])
        self.assertIsNone(a["flag"])

    def test_each_side_picks_a_strategy_and_attacks_the_middle(self) -> None:
        for side in ("1", "2"):
            s = self.results["sides"][side]
            self.assertEqual(s["strategy"], "broad")
            self.assertEqual(s["attacks"], ["Mid"], s)

    def test_the_attack_collects_its_wanted_strength_and_the_rest_hold(self) -> None:
        # A neutral area wants `round(2 * 1 * 1.25)` = 3 units; the fourth bot
        # of each side is retained at its base (`retainBot`) with no urgency
        # to move, being inside an owned area.
        for side in ("1", "2"):
            orders = [o for b, o in self.results["orders"].items() if b.startswith(f"bot_{side}_")]
            self.assertTrue(all(o is not None for o in orders))
            attacking = [o for o in orders if o["area"] == "Mid"]
            holding = [o for o in orders if o["area"] != "Mid"]
            self.assertEqual(len(attacking), 3, orders)
            self.assertEqual(len(holding), 1, orders)
            for o in attacking:
                self.assertGreaterEqual(o["radius"], 5.0)
                self.assertGreater(o["urgency"], 0)
            self.assertEqual(holding[0]["urgency"], 0)


class StrategicElAlameinTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if not SCENE.exists():
            raise unittest.SkipTest("el_alamein is not extracted")
        cls.results = run_harness(SCENE)

    def test_the_bases_are_owned_and_the_open_bases_neutral(self) -> None:
        owners = {a["name"]: a["owner"] for a in self.results["areas"]}
        self.assertEqual(owners["AxisBase"], 1)
        self.assertEqual(owners["AlliedBase"], 2)
        self.assertEqual(owners["easternbase"], 0)

    def test_both_sides_choose_a_shipped_strategy(self) -> None:
        for side in ("1", "2"):
            s = self.results["sides"][side]
            self.assertIn(s["strategy"], ["flank", "broad", "breakOut", "cleanUp"])
            self.assertTrue(s["attacks"], s)

    def test_bots_are_ordered_out_of_their_bases(self) -> None:
        for bot, order in self.results["orders"].items():
            self.assertIsNotNone(order, bot)
            self.assertNotIn(order["area"], ("AxisBase", "AlliedBase"), bot)


if __name__ == "__main__":
    unittest.main()
