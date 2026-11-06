"""The dogfight school: air combat moves, their counters, and the pilots who
fly them, on the engine's own flight law.

features/dogfight-school. The sentence these tests defend:

    every number a lesson quotes is the Spitfire's own, measured on the
    flight law the page flies, and every fight the theatre replays ends the
    way its lesson says it does, from nine nearby starts and not one lucky
    one.

`dogfight_school_harness.mjs` flies El Alamein's Spitfire (its own table,
as `flight_harness.mjs` builds it) through `viewer/aircraft.js` under node,
with the school's modules: `dogfight-flight.js` (the hands),
`dogfight-pilot.js` (the moves and plans), `dogfight-duel.js` (two of them
against each other, their rounds flown), `dogfight-lessons.js` (the words)
and `dogfight-coach.js` (what the live fight says).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from test_flight import MODULES as FLIGHT_MODULES, THREE_PACKAGE, VIEWER  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "dogfight_school_harness.mjs"
MODULES = {
    **FLIGHT_MODULES,
    "dogfight-flight.js": VIEWER / "dogfight-flight.js",
    "dogfight-pilot.js": VIEWER / "dogfight-pilot.js",
    "dogfight-duel.js": VIEWER / "dogfight-duel.js",
    "dogfight-lessons.js": VIEWER / "dogfight-lessons.js",
    "dogfight-coach.js": VIEWER / "dogfight-coach.js",
    "dogfight-live.js": VIEWER / "dogfight-live.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class _Harness(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def lesson(self, lesson_id: str) -> dict:
        return next(l for l in self.results["lessons"] if l["id"] == lesson_id)

    def demo(self, lesson_id: str, demo_id: str) -> list[dict]:
        return next(d for d in self.lesson(lesson_id)["demos"] if d["id"] == demo_id)["runs"]


class AirframeTests(_Harness):
    """The Spitfire facts the lessons put in front of the player."""

    def test_the_sticks_signs_are_the_ones_the_pilots_write(self) -> None:
        # dogfight-flight.js: pitch negative pulls the nose up, roll positive
        # lowers the right wing, rudder positive yaws the nose right.
        s = self.results["signs"]
        self.assertGreater(s["pitchMinus"]["noseY"], 0.05)
        self.assertLess(s["rollPlus"]["rightY"], -0.1)
        self.assertGreater(s["yawPlus"]["noseX"], 0.02)

    def test_straight_up_a_spitfire_sheds_ten_to_fourteen_metres_a_second_each_second(self) -> None:
        # "Straight up, a Spitfire loses 10 to 14 m/s every second: from 70
        # m/s it is down to 34 in three" (up-and-over).
        v = self.results["vertical"]
        self.assertGreater(v["shedPerSecond"], 10.0)
        self.assertLess(v["shedPerSecond"], 15.0)
        self.assertLess(v["speeds"][3], 40)

    def test_a_45_degree_dive_takes_sixty_metres_a_second_past_a_hundred(self) -> None:
        # "a Spitfire diving at 45 degrees goes from 60 to over 100 m/s in ten seconds".
        self.assertGreater(self.results["dive45"]["speed"], 100)
        self.assertLess(self.results["dive45"]["speed"], 125)

    def test_the_best_sustained_climb_is_twenty_to_thirty_degrees_at_about_twelve(self) -> None:
        # "20 to 30 degrees, the Spitfire's best sustained climb (about 12 m/s up)".
        c = self.results["climbs"]
        best = max(c, key=lambda a: c[a]["rate"])
        self.assertIn(best, ("20", "30"))
        self.assertGreater(c[best]["rate"], 10)
        self.assertLess(c[best]["rate"], 15)
        self.assertGreater(c["20"]["rate"], c["45"]["rate"])

    def test_the_throttle_brakes_but_only_after_three_seconds(self) -> None:
        # "hold S and the propeller drags you back, but it takes 3 to 4
        # seconds to bite": two seconds of S have not slowed the aeroplane,
        # four have, and the propeller run backwards (S held) ends far
        # slower than the throttle merely shut.
        shut, reverse = self.results["throttle0"], self.results["throttle-1"]
        self.assertGreaterEqual(reverse[2], reverse[0] - 1)
        self.assertLess(reverse[4], reverse[0] - 1.5)
        self.assertLess(reverse[9], 40)
        self.assertGreater(shut[9] - reverse[9], 6)

    def test_a_slow_spitfire_can_barely_turn(self) -> None:
        # "Below 30 m/s a Spitfire can barely turn" and "6 degrees a second
        # against 46 at 55 m/s": the pull rate grows with the speed.
        r = self.results["pullRate"]
        self.assertLess(r["20"], 12)
        self.assertGreater(r["55"], 35)
        self.assertGreater(r["70"], r["55"])

    def test_the_hardest_sustained_turn_is_about_nine_seconds_round(self) -> None:
        # "A flat turn takes 9 seconds in a Spitfire": 40 degrees a second.
        self.assertGreater(self.results["turn"]["rate"], 32)
        self.assertLess(self.results["turn"]["rate"], 48)


class HandsTests(_Harness):
    def test_the_nose_settles_on_a_direction_without_wandering_off_it(self) -> None:
        for name, p in self.results["point"].items():
            self.assertLess(p["closest"], 3, name)
            if p["at"] is not None:
                self.assertLess(p["at"], 7, name)
                self.assertLess(p["worstAfter"], 5, name)

    def test_a_held_bank_holds(self) -> None:
        b = self.results["bankHold"]
        self.assertGreater(b["min"], 45)
        self.assertLess(b["max"], 75)


class GunTests(_Harness):
    def test_the_spitfires_wing_guns_reach_as_far_as_their_streams_cover_a_fighter(self) -> None:
        # 2.5 m out at 1.6 degrees in: the streams part by a wingspan at
        # (2.5 + 5) / tan 1.6 = 268 m.
        g = self.results["gun"]
        self.assertAlmostEqual(268.5, g["range"], delta=2)
        self.assertEqual(400, g["speed"])

    def test_a_gun_whose_numbers_have_not_loaded_keeps_the_spitfires(self) -> None:
        g = self.results["gunDefault"]
        self.assertEqual(400, g["speed"])
        self.assertGreater(g["range"], 200)

    def test_a_round_has_to_meet_the_airframe(self) -> None:
        s = self.results["strikes"]
        self.assertTrue(s["wing"])
        self.assertFalse(s["over"])
        self.assertFalse(s["between"])


class CoachTests(_Harness):
    def test_the_geometry_knows_who_is_behind_whom(self) -> None:
        self.assertEqual("defensive", self.results["situations"]["defensive"])
        self.assertEqual("offensive", self.results["situations"]["offensive"])

    def test_a_bandit_on_your_tail_is_the_coachs_first_word(self) -> None:
        c = self.results["coach"]
        self.assertEqual("danger", c["onTail"]["tone"])
        self.assertEqual("go", c["guns"]["tone"])
        self.assertIn("Guns", c["guns"]["line"])
        self.assertEqual("danger", c["slow"]["tone"])
        self.assertEqual("GROUND", c["ground"]["line"])

    def test_the_aces_words_turn_to_the_player(self) -> None:
        self.assertEqual(["Climbing above you, out of your reach", "You are on my tail: breaking into you"],
                         self.results["toYou"])

    def test_a_fighter_is_picked_before_a_bomber(self) -> None:
        spit, bf109, b17, stuka = self.results["fighterRank"]
        self.assertLess(spit, stuka)
        self.assertLess(bf109, stuka)
        self.assertLess(stuka, b17)


class LessonTests(_Harness):
    def test_every_lesson_names_plans_that_exist_and_keys_the_coach_can_name(self) -> None:
        plans = set(self.results["plans"])
        keys = set(self.results["keyWords"])
        for lesson in self.results["lessons"]:
            self.assertIn(lesson["ace"], plans, lesson["id"])
            for demo in lesson["demos"]:
                self.assertIn(demo["seat"], plans, f'{lesson["id"]}/{demo["id"]}')
                if demo["ace"]:
                    self.assertIn(demo["ace"], plans)
            self.assertLessEqual(set(lesson["coachKeys"]), keys, lesson["id"])

    def test_the_coach_has_words_for_every_phase_the_ace_flies(self) -> None:
        for lesson in self.results["lessons"]:
            missing = set(lesson["says"]) - set(lesson["coachPhases"]) - {"evade"}
            self.assertFalse(missing, f'{lesson["id"]}: no coach line for {sorted(missing)}')

    def test_every_fight_flies_and_talks(self) -> None:
        for lesson in self.results["lessons"]:
            for demo in lesson["demos"]:
                for run in demo["runs"]:
                    self.assertGreater(run["events"], 1, f'{lesson["id"]}/{demo["id"]}')

    # --- each lesson's words, held to its fights ------------------------------

    def test_boom_and_zoom_kills_the_pilot_who_never_looks_up_every_time(self) -> None:
        runs = self.demo("boom-and-zoom", "move")
        self.assertEqual(9, sum(1 for r in runs if r["winner"] == 0 and r["why"] == "shot down"))

    def test_meeting_the_dive_is_never_hit(self) -> None:
        runs = self.demo("boom-and-zoom", "counter")
        self.assertTrue(all(r["winner"] is None for r in runs))
        self.assertLessEqual(sum(r["hits"][0] for r in runs) / len(runs), 1)

    def test_letting_him_go_up_costs_you_hits_that_following_shallow_saves(self) -> None:
        # "Letting him go, he landed 11 hits on you on average. Following
        # shallow, he landed 1, and you landed more on him than he did on you."
        go = self.demo("up-and-over", "move")
        follow = self.demo("up-and-over", "counter")
        go_hits = sum(r["hits"][0] for r in go) / len(go)
        follow_hits = sum(r["hits"][0] for r in follow) / len(follow)
        self.assertGreater(go_hits, 8)
        self.assertLess(follow_hits, 3)
        self.assertGreater(sum(r["hits"][1] for r in follow), sum(r["hits"][0] for r in follow))

    def test_flying_straight_under_attack_is_fatal_and_the_break_is_not(self) -> None:
        # "the pilot who flew straight was shot down every time. The one who
        # broke never was, and barely took a hit."
        straight = self.demo("break-turn", "without")
        broke = self.demo("break-turn", "move")
        self.assertEqual(9, sum(1 for r in straight if r["winner"] == 1))
        self.assertTrue(all(r["winner"] is None for r in broke))
        self.assertLessEqual(sum(r["hits"][1] for r in broke) / len(broke), 1)

    def test_the_patient_attacker_is_not_shot_down_either(self) -> None:
        self.assertTrue(all(r["winner"] is None for r in self.demo("break-turn", "counter")))

    def test_under_his_height_climbing_between_dives_wins_the_height_back(self) -> None:
        # "climbing straight was shot down every time. Turning flat ...
        # finished 280 m of energy behind him. Climbing between his dives was
        # never hit, and finished 300 m of energy ahead of him".
        straight = self.demo("under-the-height", "move")
        flat = self.demo("under-the-height", "flat")
        between = self.demo("under-the-height", "counter")
        self.assertEqual(9, sum(1 for r in straight if r["winner"] == 0))
        self.assertLess(sum(r["lead"] for r in flat) / 9, -150)
        self.assertEqual(0, sum(r["hits"][0] for r in between))
        self.assertGreater(sum(r["lead"] for r in between) / 9, 150)

    def test_out_of_the_lock_turning_and_chopping_beats_flying_straight_or_diving(self) -> None:
        # "flying straight was shot down every time; diving away took 12 hits
        # a fight; turning hard took almost none; turning and chopping took
        # none and landed the only hits of the fight".
        straight = self.demo("out-of-the-lock", "without")
        dive = self.demo("out-of-the-lock", "move")
        flat = self.demo("out-of-the-lock", "flat")
        chop = self.demo("out-of-the-lock", "counter")
        self.assertEqual(9, sum(1 for r in straight if r["winner"] == 0))
        self.assertGreater(sum(r["hits"][0] for r in dive) / 9, 8)
        self.assertLess(sum(r["hits"][0] for r in flat) / 9, 1)
        self.assertEqual(0, sum(r["hits"][0] for r in chop))
        self.assertGreater(sum(r["hits"][1] for r in chop), 0)

    def test_a_flat_scissors_is_nobodys_kill(self) -> None:
        self.assertTrue(all(r["winner"] is None for r in self.demo("scissors", "move")))

    def test_the_immelmann_turns_him_round_without_being_shot_down(self) -> None:
        runs = self.demo("turnarounds", "move")
        self.assertFalse(any(r["winner"] == 1 for r in runs))


class AceTests(_Harness):
    def test_the_ace_out_hits_the_school_and_is_never_shot_down(self) -> None:
        # "Flown against every other pilot in the school from ten starts
        # each, he landed 128 hits and took 82" (Against the ace).
        bench = self.results["aceBench"]
        self.assertEqual(0, sum(r["losses"] for r in bench.values()), bench)
        by = sum(r["hitsBy"] for r in bench.values())
        on = sum(r["hitsOn"] for r in bench.values())
        self.assertGreater(by, on * 1.2, bench)
        self.assertGreater(by, 80, bench)


if __name__ == "__main__":
    unittest.main()
