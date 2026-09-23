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
import math
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
    "deviation", "nav-grid", "nav-map", "nav-search", "nav-baked",
]
MODULES = {f"{name}.js": VIEWER / f"{name}.js" for name in _MODULE_NAMES}
MODULES["world.mjs"] = VIEWER / "world.js"
MODULES["bot.js"] = VIEWER / "bot.js"
MODULES["nav-grid.js"] = VIEWER / "nav-grid.js"
for _m in ("bot-aim.js", "bot-perception.js", "bot-route.js", "bot-pilot.js", "bot-decision.js", "bot-plans.js", "bot-mount.js", "bot-sense.js", "bot-fire.js", "bot-behaviours.js", "bot-vehicle.js", "bot-vehicle-air.js", "bot-strength.js", "strategic.js", "strategic-layer.js", "strategic-ai.js", "doctrine.js", "doctrine-squad.js", "doctrine-landing.js"):
    MODULES[_m] = VIEWER / _m
# `actionStatusDecision` against the binary (the x87 emulator's answers).
MODULES["action_status_cases.json"] = Path(__file__).resolve().parent / "fixtures" / "action_status_cases.json"
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
        # A turn in place (`drive` 0): full lock, the throttle 1 at or under
        # 2 m/s and none above (the tail, 0x0862cad8).
        self.assertFalse(t["behind"]["aligned"])
        self.assertEqual(abs(t["behind"]["steer"]), 1.0)
        self.assertEqual(t["behind"]["throttle"], 1)
        self.assertEqual(t["behindFast"]["throttle"], 0)
        # A reverse drive backs; its angle is negated while the hull still
        # rolls forward (0x0862c9ae..0x0862c9c2).
        self.assertEqual(t["reverse"]["throttle"], -1)
        self.assertAlmostEqual(t["reverse"]["steer"], 0.2, places=6)
        self.assertAlmostEqual(t["reverseRolling"]["steer"], -0.2, places=6)
        # A rolling hull wants its speed over `|roll rate| x 10 + 1`: at 3 m/s
        # and a roll rate of 1 the wanted 20 / 11 is already beaten.
        self.assertEqual(t["steady"]["throttle"], 1)
        self.assertEqual(t["rolling"]["throttle"], -1)

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

    def test_the_turn_in_the_box_answers_as_the_binary_does(self) -> None:
        # `CommonControls::actionStatusDecision` 0x0860fbe0: every transition
        # the function can make, each against the machine code's own answer
        # in the x87 emulator (ledger AI-85). 0 -> 6 is not reachable (state
        # 0 picks 7 whenever `dir . forward < 0`, which it already is), and
        # nothing sets 1.
        f = self.results["actionStatusFixture"]
        want = {"0->0/1", "0->9/0", "0->8/0", "0->2/0", "0->4/0", "0->7/0", "1->1/0",
                "2->2/1", "2->3/0", "2->0/0", "3->3/-1", "3->0/0", "4->4/1", "4->5/0", "4->0/0",
                "5->5/-1", "5->0/0", "6->6/-1", "6->0/0", "7->7/-1", "7->0/0",
                "8->8/-1", "8->0/0", "9->9/1", "9->0/0"}
        self.assertEqual(set(f), want)
        for key, t in f.items():
            self.assertGreater(t["cases"], 0, key)
            self.assertEqual(t["wrong"], 0, key)

    def test_a_hull_backs_off_a_wall_and_turns_where_there_is_room(self) -> None:
        a = self.results["actionStatus"]
        self.assertEqual((a["ahead"]["state"], a["ahead"]["drive"]), (0, 1))
        # Dead astern with the wall 3 m ahead (inside the turn radius): state
        # 8, whose next tick backs straight out.
        self.assertEqual((a["astern"]["state"], a["astern"]["drive"]), (8, 0))
        self.assertEqual((a["astern2"]["state"], a["astern2"]["drive"]), (8, -1))
        # Room ahead: 9, then drive on turning (the full angle, pi).
        self.assertEqual((a["room"]["state"], a["room2"]["state"], a["room2"]["drive"]), (9, 9, 1))
        self.assertAlmostEqual(abs(a["room2"]["angle"]), 3.1415927, places=5)
        # About abeam behind: a mirrored-point drive out.
        self.assertIn(a["abeam"]["state"], (2, 4, 7))
        # Backed out past the turn radius: back to 0.
        self.assertEqual(a["clear"]["state"], 0)
        self.assertEqual(a["blind"]["state"], 8)

    def test_the_search_box_grows_by_free_blocks_and_takes_one_more(self) -> None:
        # `getSearchBox` 0x085f4180: the free level at the point (3 next to a
        # wall at gz 40), grown in blocks of that level and widened one block.
        b = self.results["searchBox"]
        self.assertEqual(b["nearWall"]["level"], 3)
        self.assertEqual(b["nearWall"]["max"][1], 48)          # the wall's row 40..47, plus one block
        self.assertIsNone(b["onWall"])
        self.assertEqual(b["exitAhead"], [0, 3])
        self.assertEqual(b["exitDiag"], [3, 3])
        self.assertIsNone(b["outside"])
        self.assertEqual(b["lineClear"]["dist"], 20)
        self.assertEqual(b["lineCut"]["dist"], 8)               # the circle at 10 m, radius 2
        self.assertFalse(b["lineTight"]["ok"])                  # an object inside the hull's radius

    def test_a_boat_brakes_on_arrival_and_drives_the_decision(self) -> None:
        # `BoatControl::resetControls` 0x0860dff0: -sign(v) log10(9|v| + 1),
        # clamped, until 1 m/s; then done.
        d = self.results["boatDecision"]
        self.assertEqual(d["brakeFast"], {"throttle": -1, "steer": 0, "done": False})
        self.assertEqual(d["brakeAstern"]["throttle"], 1)
        self.assertTrue(d["stopped"]["done"])
        self.assertEqual(d["stopped"]["throttle"], 0)
        # A reverse decision wants -maxSpeed; drive 0 turns (full rudder); a
        # state-9 drive runs underway past 30 deg.
        self.assertEqual(d["backing"]["wanted"], -10)
        self.assertLess(d["backing"]["throttle"], 0)
        self.assertEqual(abs(d["turning"]["steer"]), 1)
        self.assertNotIn("wanted", d["turning"])
        self.assertIn("wanted", d["onward"])

    def test_a_boat_turns_on_the_throttle_it_holds(self) -> None:
        # `speedControl` 0x0860cf40 reads last tick's throttle (the channel
        # persists: `BotMain::updatePlayerAction` 0x08526430 clears only
        # channels 8, 23, 24 and 28): a full one is kept at or under 3 m/s,
        # any other takes the motion's sign; above 3 m/s it brakes against
        # the motion. The rudder is the motion's sign times the side's.
        d = self.results["boatDecision"]
        self.assertEqual(d["heldAstern"]["throttle"], -1)      # backing while still going ahead
        self.assertEqual(d["heldAhead"]["throttle"], 1)
        self.assertEqual(d["partHeld"]["throttle"], 1)          # the motion's sign
        self.assertEqual(d["fastTurn"]["throttle"], -1)         # braking above 3 m/s
        self.assertEqual(d["heldAstern"]["steer"], -d["backingTurn"]["steer"])
        # Drive 0, the point dead ahead: no rudder, the brake to rest.
        self.assertEqual((d["alignedFast"]["throttle"], d["alignedFast"]["steer"]), (-1, 0))
        self.assertAlmostEqual(d["alignedSlow"]["throttle"], -math.log10(9 * 0.5 + 1), places=6)
        self.assertEqual(d["alignedStill"]["throttle"], 0)

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

    def test_the_plane_aims_like_entry_plane_aim_at_and_gates_like_the_precision_tests(self) -> None:
        a = self.results["planeAim"]
        # 0x0861f610: a ground target's Aimer gets no shooter velocity and the
        # round speed plus the plane's own; the aim is the line of sight; floor 0.5.
        self.assertEqual(a["groundRelVel"], [0, 0, 0])
        self.assertAlmostEqual(a["groundSpeed"], 460.0, places=6)
        self.assertEqual(a["groundFloor"], 0.5)
        self.assertGreater(a["groundOnLos"], 0.99999)
        # An air target keeps the relative velocity and the round's own speed.
        self.assertEqual(a["airSpeed"], 400)
        self.assertEqual(a["airFloor"], 1.0)
        self.assertEqual(a["airRelVel"], [0, 0, 60])
        self.assertLess(a["airOnLos"], 0.9999)
        # An indirect weapon flies the level bearing.
        self.assertAlmostEqual(a["bombDir"][1], 0.0, places=9)
        self.assertAlmostEqual(a["bombDir"][2], -1.0, places=6)
        self.assertAlmostEqual(a["bombSpeed"], 60.0, places=6)
        # 0x0854baf0: direct fires inside the precision; the closest approach
        # fires the tick after the minimum, and not when the minimum was wide.
        self.assertEqual(a["direct"], [False, True, True, False])
        self.assertEqual(a["caFire"], [False, False, False, True, False])
        self.assertEqual(a["caWide"], [False, False, False, False])
        # 0x0854a8c0: the bomb class also fires on the nearest approach.
        self.assertTrue(a["bombDirect"])
        self.assertFalse(a["bombNeither"])
        self.assertAlmostEqual(a["near"]["miss"], 3.0, places=6)
        self.assertAlmostEqual(a["near"]["t"], 0.5, places=6)
        # Out of range neither fires (mode 2's trigger has no range test, but
        # its attack still starts inside 0.9 R).
        self.assertFalse(a["mode1"])
        self.assertFalse(a["mode2"])
        # 0x0859bfbb / 0x0859beab: the approach and break clearances are 100 m.
        self.assertEqual(a["approachClearance"], 100.0)
        self.assertEqual(a["breakClearance"], 100.0)
        # A seated player is sensed where his seat is.
        self.assertEqual(a["seated"], [100, 50, -20])
        self.assertEqual(a["onFoot"], [1, 2, 3])

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



class RedeployTests(unittest.TestCase):
    """Brief K item 4 (ledger AI-101): the no-progress redeploy is the page's
    (INVENTION) and is measured per order."""

    def test_progress_is_measured_per_order(self) -> None:
        r = BotAiTests.results["redeploy"] if hasattr(BotAiTests, "results") else run_harness()["redeploy"]
        self.assertAlmostEqual(r["oneOrder"], 12.0, delta=0.1)
        self.assertIsNone(r["newOrders"], "a follower re-ordered each second keeps its seat")
        self.assertAlmostEqual(r["standing"], 12.0, delta=0.1)


class AirSpacingTests(unittest.TestCase):
    """Brief K item 2 (ledger AI-95): `BBChange::runwayClear` 0x0855f850 and
    `BBAvoid::calculateUrgency` 0x0855c650 with `collisionPredicted`
    0x0855d2f0 and `BBPAvoidCollision3d::createPlan` 0x08587420."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.a = BotAiTests.results["airSpacing"] if hasattr(BotAiTests, "results") else run_harness()["airSpacing"]

    def test_the_runway_box(self) -> None:
        r = self.a["runway"]
        self.assertTrue(r["empty"])
        # 0.6 x 11.2 = 6.7 m to 12 x 11.2 = 134 m ahead, 0.75 x 9.1 = 6.8 m aside.
        self.assertFalse(r["planeAhead"])
        self.assertTrue(r["planeFar"])
        self.assertTrue(r["planeBehind"])
        self.assertTrue(r["planeBeside"])
        # Only a mobile, non-soldier, non-naval object blocks it.
        self.assertTrue(r["soldierAhead"])
        self.assertTrue(r["shipAhead"])
        self.assertTrue(r["parkedGun"])

    def test_the_collision_prediction(self) -> None:
        a = self.a
        # Head-on at 100 m/s closing, radii summed 15: contact at (200 - 15) / 100.
        self.assertAlmostEqual(a["headOn"]["t"], 1.85, places=6)
        self.assertIsNone(a["offset"])
        self.assertIsNone(a["late"], "beyond the 5 s look-ahead")
        self.assertIsNone(a["opening"])
        self.assertEqual(a["touching"]["t"], 0)

    def test_the_urgency_and_the_turn(self) -> None:
        a = self.a
        # mass x |relVel| / |rel| of the one predicted: 2500 x 100 / 200.06.
        self.assertAlmostEqual(a["urgency"], 2500 * 100 / (200 ** 2 + 25) ** 0.5, places=6)
        self.assertEqual(a["best"], "b")
        # Flying +x with the other to +z, the point turns 45 deg to -z; lower, it dives by 2 t.
        self.assertAlmostEqual(a["right"][0], 35.355, places=3)
        self.assertAlmostEqual(a["right"][2], -35.355, places=3)
        self.assertAlmostEqual(a["right"][1], 96.0, places=6)
        self.assertAlmostEqual(a["rightUntil"], 2.2, places=6)
        self.assertAlmostEqual(a["left"][2], 35.355, places=3)
        self.assertAlmostEqual(a["left"][1], 104.0, places=6)


class GunnerAimTests(unittest.TestCase):
    """Brief F: a mounted gunner aims the engine's way (bot-aim.js).

    `mouseControlLookAtDirection` 0x08627b90 turns the direction into counts
    through the seat's ControlInfo, `Aimer::getFiringDirection` 0x08538ad0
    leads the target, and `BAPCConPrecision::evaluate` 0x0854b570 lets the
    trigger down. The rig is a real `TurretRig` whose gun node rests turned
    180 deg on its mount, as the Sherman's turret Browning does.
    """

    g: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.g = run_harness()["gunner"]

    def test_the_count_law(self) -> None:
        # SCurve of the log-shaped angle, times the 5.0 scale, capped at 4.
        counts = {row[0]: (row[1], row[2]) for row in self.g["counts"]}
        self.assertAlmostEqual(counts[1][0], 0.0484, places=3)
        self.assertAlmostEqual(counts[5][0], 0.4536, places=3)
        self.assertAlmostEqual(counts[10][0], 1.6305, places=3)
        self.assertEqual(counts[30][0], 4)
        self.assertEqual(counts[90][0], 4)
        for deg, (x, y) in counts.items():
            self.assertGreater(x, 0, deg)          # a target to the right: turn right
            self.assertAlmostEqual(y, -x, places=6, msg=deg)  # a target above: count up (negative)
        # A target behind turns at the full rate; an AA mount's 1.0 scale is a fifth.
        self.assertEqual(self.g["behind"], [4, 0])
        self.assertAlmostEqual(self.g["scaledX"] * 5, 0.5795, places=3)

    def test_the_hull_gunner_converges_within_half_a_degree_in_under_a_second(self) -> None:
        b = self.g["browning"]
        self.assertAlmostEqual(abs(b["startYaw"]), 0.0, places=6)   # the barrel rests aft of the rig
        self.assertGreaterEqual(b["settledTick"], 0)
        self.assertLess(b["settledSeconds"], 1.0)
        self.assertLess(b["maxAfterSettle"], 0.5)
        self.assertLess(b["errAt1s"], 0.05)
        # The old count law on the same rig swings by degrees.
        self.assertGreater(self.g["oldLaw"]["maxLastSecond"], 1.5)

    def test_a_slow_tower_settles_too(self) -> None:
        t = self.g["tower"]
        self.assertGreaterEqual(t["settledTick"], 0)
        self.assertLess(t["maxAfterSettle"], 0.5)

    def test_the_lead_and_the_drop(self) -> None:
        # A 300 m/s round to a plane crossing 150 m out at 55 m/s flies about
        # half a second; the aim sits well ahead of it.
        self.assertAlmostEqual(self.g["aa"]["leadTime"], 0.508, places=2)
        self.assertGreater(self.g["aa"]["leadAhead"], 10)
        # 100 m/s under -14.73 to 200 m: aim 8.6 deg up, 2 s of flight.
        self.assertAlmostEqual(self.g["dropUp"], 8.6, places=1)
        self.assertAlmostEqual(self.g["dropTime"], 2.02, places=2)
        # Still target, flat round: the straight line.
        d = self.g["stillDir"]
        self.assertAlmostEqual(d[0], 30 / (30 ** 2 + 5 ** 2 + 40 ** 2) ** 0.5, places=3)

    def test_the_precision_condition(self) -> None:
        # 0.25 x the extents (at least 0.4); an air target's largest extent (at least 1).
        self.assertEqual(self.g["precision"], [0.75, 0.4, 11, 1])
        # A single-shot weapon fires on the closest approach: the miss grows again.
        self.assertEqual(self.g["closest"], [False, False, False, True, False])

    def test_an_aa_gun_tracks_a_crossing_plane_with_a_lag(self) -> None:
        # The AA mount's ControlInfo scale is 1.0: at 55 m/s crossing it trails
        # the lead by more than the plane's span and does not fire...
        self.assertEqual(self.g["aa"]["fired"], 0)
        self.assertLess(self.g["aa"]["bestMiss"], 40)
        # ...while a plane still far out on its approach is inside it.
        self.assertGreater(self.g["aaPass"]["fired"], 0)
        self.assertLess(self.g["aaPass"]["bestMiss"], 11)

if __name__ == "__main__":
    unittest.main()
