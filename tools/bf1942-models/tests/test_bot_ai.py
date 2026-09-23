"""Stage 1 bot AI input contract (`viewer/world.js` + `viewer/bot.js`).

The plan (`features/bf1942-ai-research-2026-09-21/BOT_AI_IMPLEMENTATION_PLAN.md`
§1, §9) pins the one bug that made bots inert: an absolute-radian write into a
`MouseLookX` channel the world never reads. What this file pins, driven headless
by `bot_ai_harness.mjs` on the same module set `test_world.py` stages:

* a bot's `_aimLook` produces a bounded mouse-count pair the world consumes and
  the soldier actually turns;
* a visible *enemy* human target wins the urgency contest (Fire) and the bot
  turns to face it, while a human on the bot's own side is never sensed and
  never fired on;
* with no target, the nearest uncaptured flag wins (MoveTo) and the bot walks
  toward it.
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
HARNESS = Path(__file__).resolve().parent / "bot_ai_harness.mjs"

# world.js's dependency closure (test_world.py owns the canonical list) plus
# bot.js's own imports. Every dependency keeps its own name so the unmodified
# imports resolve; the world is copied as `world.mjs` for the harness.
_MODULE_NAMES = [
    "physics", "parachute", "swim", "soldier", "spawn-flags", "spawn-safety", "mouse-input",
    "point-body", "fixed-step", "soldier-pose", "soldier-locomotion", "walking-body", "soldier-resolve",
    "fall-damage",
    "body-world", "body-statics", "vehicle-bodies", "combat-area", "supply", "armor",
    "vehicle-damage", "seats", "seat-dots", "rigid-body", "body-contact",
    # seats.js re-exports its split modules.
    "seat-survey", "turret-rig", "vehicle-occupancy", "entry-points", "spawned-craft", "fire-state",
    # world.js's World delegates to its split modules.
    "world-input", "world-players", "world-snapshot", "world-bodies",
    "world-soldier-tick", "world-vehicle-tick", "world-fields", "world-damage",
    "body-ground", "body-friction", "crash-damage", "effects-core", "projectile-damage",
    "bomb-release", "torpedo-run",
    # bot.js's own imports.
    "deviation", "nav-grid", "nav-map", "nav-search",
]
MODULES = {f"{name}.js": VIEWER / f"{name}.js" for name in _MODULE_NAMES}
MODULES["world.mjs"] = VIEWER / "world.js"
MODULES["bot.js"] = VIEWER / "bot.js"
MODULES["nav-grid.js"] = VIEWER / "nav-grid.js"
for _m in ("bot-aim.js", "bot-perception.js", "bot-route.js", "bot-pilot.js", "bot-decision.js", "bot-plans.js", "bot-mount.js", "bot-sense.js", "bot-fire.js", "bot-behaviours.js", "bot-vehicle.js", "bot-vehicle-air.js", "bot-strength.js", "strategic.js", "strategic-layer.js", "strategic-ai.js", "doctrine.js", "doctrine-squad.js"):
    MODULES[_m] = VIEWER / _m
MODULES["node_modules/three/three.module.js"] = VIEWER / "vendor" / "three.module.js"
THREE_PACKAGE = json.dumps({
    "name": "three", "version": "0.0.0", "type": "module",
    "main": "three.module.js", "exports": "./three.module.js",
})


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class BotAiTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the look/input contract --------------------------------------------

    def test_the_boat_regulates_its_speed_by_open_water_and_angle(self) -> None:
        # `BoatControl::speedControl` 0x0860cf40.
        b = self.results["boatSpeed"]
        self.assertEqual(b["open"], [1, 0.8, 0.6])
        self.assertEqual(b["oneClear"], [1, 0.6, 0.4])
        self.assertEqual(b["tight"], [0.4, 0.5, 0.4, 0.3])
        self.assertEqual(b["reg"], [0.5, -0.5, 1])
        self.assertAlmostEqual(b["rudder"], b["want"], places=6)
        self.assertEqual(b["turnFast"], [-1, 1])
        self.assertEqual(b["turnSlow"], [1, 1])

    def test_the_left_vehicle_ramp_keys_on_the_hull(self) -> None:
        self.assertEqual(self.results["leftRamp"], {"id": "hull-uuid", "at": 10})

    def test_the_fire_area_factor_is_one_factor_counted_twice(self) -> None:
        f = self.results["fireArea"]
        self.assertAlmostEqual(f["inRange"], 1.0, places=9)
        self.assertAlmostEqual(f["beyond"], 0.75 ** 2, places=9)
        self.assertAlmostEqual(f["beyondBoth"], 0.5625 ** 2, places=9)

    def test_free_level_is_the_largest_aligned_free_block(self) -> None:
        f = self.results["freeLevel"]
        self.assertEqual(f["onIt"], -1)
        self.assertEqual(f["next"], 0)
        self.assertEqual(f["far"], 5)
        self.assertEqual(f["nearish"], 2)

    def test_aim_writes_bounded_mouse_counts_not_radians(self) -> None:
        look = self.results["look"]
        self.assertLessEqual(abs(look["lookX"]), 16)
        self.assertLessEqual(abs(look["lookY"]), 16)
        # 90 degrees of yaw at a 3x gain is 30 counts, clamped to 16.
        self.assertAlmostEqual(look["lookX"], -16)

    def test_the_world_applies_the_bot_look(self) -> None:
        self.assertTrue(self.results["look"]["turned"])

    # --- Fire: a visible target wins the contest ----------------------------

    def test_a_visible_human_is_sensed_and_fired_on(self) -> None:
        self.assertTrue(self.results["aim"]["sawTarget"])

    def test_the_bot_turns_toward_the_target(self) -> None:
        aim = self.results["aim"]
        self.assertGreater(aim["initialError"], 0.1)
        self.assertLess(aim["finalError"], 0.1)
        self.assertTrue(aim["turned"])

    # --- Friendly fire: a teammate is never a target ------------------------

    def test_a_teammate_is_never_sensed(self) -> None:
        self.assertIsNone(self.results["friendly"]["sensed"])

    def test_a_teammate_is_never_fired_on(self) -> None:
        friendly = self.results["friendly"]
        self.assertFalse(friendly["sawTarget"])
        self.assertFalse(friendly["fired"])

    # --- Avoid: the map sees the sandbag wall and the route goes round --------

    def test_the_map_blocks_the_wall_and_not_the_kerb(self) -> None:
        avoid = self.results["avoid"]
        self.assertTrue(avoid["wallBlocked"])
        self.assertEqual(avoid["kerbCell"], 0)
        self.assertFalse(avoid["traceThroughWall"])

    def test_the_bot_walks_around_the_wall(self) -> None:
        avoid = self.results["avoid"]
        self.assertGreater(avoid["routePoints"], 1)
        self.assertTrue(avoid["crossedOutsideWall"],
                        f"crossed the wall line at x={avoid['crossX']}")
        self.assertLess(avoid["minDistToGoal"], 8.0)

    def test_the_bot_never_stalls_on_the_wall(self) -> None:
        self.assertLess(self.results["avoid"]["maxStalled"], 30)

    # --- Steering: the engine's 31.5 degree throttle cone -------------------

    def test_a_point_behind_turns_without_throttle(self) -> None:
        steer = self.results["steer"]
        self.assertEqual(steer["behind"]["forward"], 0)
        self.assertNotEqual(steer["behind"]["lookX"], 0)

    def test_a_point_ahead_gets_full_throttle(self) -> None:
        self.assertEqual(self.results["steer"]["ahead"]["forward"], 1)

    def test_a_point_outside_the_cone_gets_no_throttle(self) -> None:
        self.assertEqual(self.results["steer"]["side"]["forward"], 0)

    # --- MoveTo: no target, walk to the flag --------------------------------

    def test_a_medic_walks_to_a_wounded_friend_and_holds_the_pack_on_him(self) -> None:
        m = self.results["medic"]
        self.assertTrue(m["chosen"], m)
        self.assertGreater(m["urgency"], 0.5, m)
        # `R + 0.9 * maxRange` = 1 + 2.25 m; the trigger goes down inside it.
        self.assertAlmostEqual(m["arrive"], 3.25, places=2)
        self.assertTrue(m["fired"], m)
        self.assertEqual(m["weapon"], "MedPack")
        self.assertLess(m["firingDist"], 3.25 + 0.5, m)

    def test_the_tank_law_drives_ahead_and_turns_first_when_the_target_is_behind(self) -> None:
        t = self.results["tankLaw"]
        self.assertGreater(t["ahead"]["throttle"], 0.9)
        self.assertAlmostEqual(t["ahead"]["steer"], 0.0, places=3)
        self.assertLess(t["fast"]["throttle"], 0.0)            # over the wanted speed: back off
        self.assertLess(t["right"]["steer"], 0.0)              # a target to +yaw steers negative
        self.assertTrue(t["right"]["aligned"])
        self.assertFalse(t["behind"]["aligned"])
        self.assertEqual(abs(t["behind"]["steer"]), 1.0)
        self.assertEqual(t["behindKept"]["turn"], t["behind"]["turn"])   # no flip across the seam

    def test_a_sherman_close_by_outranks_staying_on_foot(self) -> None:
        c = self.results["change"]
        self.assertEqual(c["split"], [0.5, 0.5])
        self.assertGreater(c["sherman"], c["foot"] * 1.25)
        self.assertGreater(c["near"], 3.0)                      # beats a MoveTo order (2 x 1.5)
        self.assertEqual(c["nearId"], "s")
        self.assertLess(c["far"], c["near"])
        self.assertEqual(c["none"], 0.0)

    def test_the_plane_law_climbs_banks_and_runs_straight_on_the_ground(self) -> None:
        a = self.results["air"]
        self.assertEqual([round(v, 3) for v in a["fwd"]], [0.0, 0.0, -1.0])
        self.assertLess(a["ahead"]["pitch"], 0.0)              # nose up is a negative stick
        self.assertFalse(a["ahead"]["takeoff"])
        self.assertGreater(a["right"]["roll"], 0.0)            # a point to the right banks right
        self.assertGreater(a["right"]["rudder"], 0.0)
        self.assertTrue(a["ground"]["takeoff"])
        self.assertEqual(a["ground"]["rudder"], 0.0)           # no turn before the airborne flag
        self.assertGreater(a["ground"]["pitch"], 0.0)          # slow: the climb limit holds the nose down
        self.assertEqual(a["boatTurn"]["steer"], -1.0)         # full rudder past 30 deg, toward +yaw
        self.assertGreater(a["boatAhead"]["throttle"], 0.9)

    def test_the_class_tables_score_a_unit_against_what_the_enemy_fields(self) -> None:
        s = self.results["strength"]
        self.assertEqual(s["sherman"]["Infantry"], 12)               # the max over the guns, the pack ignored
        self.assertEqual(s["sherman"]["LightArmour"], 7)
        self.assertAlmostEqual(s["types"]["Infantry"], 2.0, places=2)  # settles at the per-pass sum
        self.assertAlmostEqual(s["strengths"]["HeavyArmour"], 2.0, places=2)
        self.assertAlmostEqual(s["vsInfantry"], 144 - 2.0, places=2)   # 12^2 - the enemy's strength vs armour
        self.assertAlmostEqual(s["unknown"], 0.5 * 144)
        self.assertGreater(s["withGunner"], s["vsInfantry"])           # the gunner's 0.9 share
        self.assertEqual(s["fixedBlind"], 0)
        self.assertEqual(s["fixedStrategic"], 5.0)                     # 0x08584580 return 5.0
        self.assertEqual(s["gunnerFromDriver"], 0)                     # root vacated: fixed, blind
        self.assertLessEqual(s["rootFromGunner"], 0)                   # the gunner's share vacated
        self.assertGreater(s["tank"], s["foot"] * 1.25)
        self.assertEqual(s["heat"][0], 1)
        self.assertAlmostEqual(s["heat"][1], 0.5, places=6)
        self.assertEqual(s["radius"], 50.0)

    def test_a_side_knows_an_enemy_with_a_security_that_decays(self) -> None:
        # Ledger AI-75: `InformationKnown::getSecurity` 0x085e8670 is
        # 1 - SCurve((t - t0) / degeneration); SCurve::calculate 0x08658420
        # blends its 101-entry table at trunc(100 x).
        s = self.results["security"]
        for got, want in zip(s["curve"], [0.0, 0.0011246949, 0.0913624987, 0.5, 0.9997750998, 1.0, 1.0, 0.0]):
            self.assertAlmostEqual(got, want, places=7)
        for got, want in zip(s["soldier"], [1.0, 1 - 0.0872564986, 0.5, 1 - 0.912743986, 0.0, 0.0]):
            self.assertAlmostEqual(got, want, places=7)                  # the soldier's degeneration 15
        # Hearing: `setTime(now, 0.5)` 0x085e8210.
        self.assertEqual(s["heardFresh"], 1.0)                           # first contact makes it at security 1
        self.assertEqual(s["heardKept"], 10)                             # already above 0.5: unchanged
        self.assertAlmostEqual(s["heardBack"]["t0"], 30 - 1 / (0.5 * 15), places=5)
        self.assertAlmostEqual(s["heardBack"]["s"], 1 - (2 / 225) * 100 * 0.00224938989, places=6)
        # The enemy tables: a never-seen unit is not summed, a seen one fades
        # over its template's degeneration (Spitfire 5 s, soldier 15 s).
        series = s["series"]
        self.assertTrue(all(r["b"] == "absent" for r in series))
        self.assertAlmostEqual(series[0]["inf"], 5.0, places=5)          # (0 + 10 x 1) x 0.5
        self.assertAlmostEqual(series[1]["p"], 1 - 0.284830987, places=6)  # 2 s of 5
        self.assertEqual(series[3]["p"], 0.0)                            # 6 s past a 5 s degeneration
        f = 800 / 15 - 53                                                # 8 s of 15: x = 0.5333
        self.assertAlmostEqual(series[4]["a"], 1 - ((1 - f) * 0.568435013 + f * 0.590821028), places=6)
        self.assertEqual(series[8]["a"], 0.0)                            # 16 s: gone
        self.assertLess(series[8]["inf"], 0.6)                           # the table halves away
        self.assertLess(series[8]["infType"], series[3]["infType"])
        self.assertTrue(s["forgot"])                                     # a dead unit's record goes
        self.assertEqual(s["legacy"], 5.0)                               # no id, no clock: weight 1
        # The senses write it: a frustum candidate is made known before any
        # ray (e4, behind a wall, never spotted), a spot refreshes the spotted
        # hull's other seat too (e2, behind the bot), a re-sight refreshes the
        # remembered one only, a heard shot makes the unknown e3.
        self.assertFalse(s["e4InMemory"])
        self.assertEqual(s["afterSpot"], {"e1": 5, "e2": 5, "e4": 5})
        self.assertEqual(s["afterResight"], {"e1": 9, "e2": 5, "e4": 5})
        self.assertEqual(s["afterHear"], {"e1": 9, "e2": 5, "e4": 5, "e3": 9})
        self.assertIsNone(s["securityOfUnknown"])

    def test_the_seat_swap_prefers_the_wheel_of_a_free_jeep(self) -> None:
        t = self.results["teleport"]
        self.assertIsNone(t["gunnerStays"]["best"])                   # 10 x 0.5 < 8 x 1.0
        self.assertEqual(t["passengerDrives"]["best"]["id"], "root")
        self.assertGreater(t["passengerDrives"]["urgency"], 3.0)
        self.assertIsNone(t["rootKeeps"]["best"])
        self.assertEqual(t["pending"]["urgency"], 6.0)

    def test_the_box_test_backs_toward_a_target_behind_with_no_room(self) -> None:
        d = self.results["drive"]
        self.assertTrue(d["back"]["reverse"])
        self.assertFalse(d["room"]["reverse"])
        self.assertFalse(d["narrow"]["reverse"])
        self.assertFalse(d["shallow"]["reverse"])
        self.assertTrue(d["lawReverse"])
        self.assertLess(d["lawThrottle"], 0)

    def test_a_hull_prefers_the_close_target_and_a_plane_the_far_one(self) -> None:
        v = self.results["vehicleFire"]
        self.assertEqual(v["tank"], "near")
        self.assertEqual(v["plane"], "far")
        self.assertIsNone(v["blind"])
        self.assertIsNone(v["tooClose"])                              # inside the gun's minRange
        self.assertEqual(v["env"], "e")
        self.assertGreater(v["envUrgency"], 0)
        self.assertEqual(v["vehicle"], "v")
        self.assertGreater(v["vehicleScore"], 0)

    def test_an_aa_gun_engages_a_plane_in_flight_and_a_plain_gun_does_not(self) -> None:
        a = self.results["antiAircraft"]
        self.assertEqual(a["aa"], "pilot")
        self.assertGreater(a["aaScore"], 0)
        self.assertIsNone(a["plain"])

    def test_a_seated_player_is_sensed_at_his_seat(self) -> None:
        a = self.results["antiAircraft"]
        self.assertEqual(a["seatedAt"], [10, 90, -20])
        self.assertEqual(a["onFootAt"], [1, 2, 3])

    def test_the_sense_frustum_is_square_about_the_camera(self) -> None:
        f = self.results["frustum"]
        self.assertTrue(f["below40inf"])                              # 50 deg half-angle
        self.assertFalse(f["below40veh"])                             # 37.5 deg half-angle
        self.assertFalse(f["behind"])
        self.assertTrue(f["side30"])
        self.assertTrue(f["yawOnlyBelow"])                            # the old bearing-only test

    def test_the_plane_approaches_attacks_and_breaks(self) -> None:
        p = self.results["planeFire"]
        self.assertEqual(p["far"], "approach")
        self.assertEqual(p["inRange"], "attack")
        self.assertTrue(p["inRangeFire"])
        self.assertEqual(p["passed"], "break")                       # inside 1.3 x the turn radius
        self.assertEqual(p["breaking"], "break")                     # 100 m into the 200 m run
        self.assertEqual(p["again"], "approach")
        self.assertEqual([m["mode"] for m in p["modes"]], [0, 1, 2, 3])
        self.assertEqual(p["modes"][1]["radius"], 5.0)
        self.assertEqual(p["modes"][2]["radius"], 43.333333333333336)
        self.assertLess(p["aimUpPitch"], 0)                          # nose up is a negative stick
        self.assertFalse(p["takeoffAirborne"])                       # 1 m up: still taking off
        self.assertLess(p["aimLowPitch"], 0)                         # the pull-up demand wins
        self.assertLess(p["engineMaxErr"], 1e-4)                     # 0x08629fa0 vs its emulation
        self.assertAlmostEqual(p["shape"][0], 0.1617, places=3)      # log10(9 * 0.05 + 1)
        self.assertEqual(p["shape"][1:], [-1, 1])
        self.assertEqual(p["climb"], 0.3333)
        self.assertEqual(p["onTarget"][:2], ["attack", True])         # mode 0: no in-front gate
        self.assertLess(p["onTarget"][2], 0.01)
        self.assertFalse(p["offTarget"][0])                           # 0x0854baf0: miss > precision
        self.assertGreater(p["offTarget"][1], 6)
        self.assertEqual(p["unseen"], "approach")                     # 0x08551890: not seen, no attack
        self.assertFalse(p["closeInFront"])                           # 0x08550e70: 10 m half-space
        self.assertLess(p["leadMiss"], 1.0)

    def test_the_water_map_frees_the_deep_water_and_blocks_the_island(self) -> None:
        w = self.results["water"]
        self.assertEqual(w["deep"], w["free"])
        self.assertEqual(w["centre"], w["land"])
        self.assertEqual(w["shelf"], w["land"])                       # 4 m of water under a 5 m draft
        self.assertGreater(w["run"], 20)
        self.assertLess(w["run"], 60)                                # the island stops the run
        self.assertGreater(w["boxShort"], 20)
        self.assertNotEqual(w["islandWalkable"], w["land"])          # the infantry map is not a water map

    def test_the_winner_is_moveto_with_no_target(self) -> None:
        self.assertEqual(self.results["moveTo"]["behaviour"], "MoveTo")

    def test_the_bot_walks_toward_the_objective(self) -> None:
        move = self.results["moveTo"]
        self.assertGreater(move["movedForward"], 30)
        self.assertGreater(move["travelled"], 1.0)


if __name__ == "__main__":
    unittest.main()
