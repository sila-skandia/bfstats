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
                     "bot-vehicle.js", "bot-behaviours.js"):
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
