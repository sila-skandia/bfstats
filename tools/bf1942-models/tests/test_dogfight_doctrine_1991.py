"""The jet age's rules on Desert Combat's jets (features/dogfight-doctrine-1991):
twelve sourced rules, each read on the two jets on stage, with their weapons
off their own models, the real game's missile flights from the lab server,
and what the page's flight law does with each airframe.

`dogfight_doctrine_1991_harness.mjs` reads an F-16 against a MiG-29 in the
numbers the page measured on the published tree, and measures the school's
own Spitfire with `viewer/dogfight-airframe.js`.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE
from test_flight import VIEWER

SCRIPT = Path(__file__).resolve().parent / "dogfight_doctrine_1991_harness.mjs"
OWN = ("dogfight-doctrine-1991.js", "dogfight-airframe.js")


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in {**MODULES, **{name: VIEWER / name for name in OWN}}.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "d.mjs").write_text(head + "\n" + SCRIPT.read_text())
        proc = subprocess.run(["node", str(work / "d.mjs")], capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"jet doctrine harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class JetRulesTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def test_twelve_rules_each_sourced_and_shown_in_a_lesson_that_exists(self) -> None:
        o = self.out
        self.assertEqual(12, len(o["ids"]))
        self.assertEqual(12, len(set(o["ids"])))
        self.assertTrue(o["sources"])
        # A few of the source's own words, never a passage; Shaw (in
        # copyright) is paraphrased, so the rule that is his alone quotes nothing.
        self.assertTrue(all(n < 15 for n in o["quotes"]))
        self.assertEqual(1, o["quotes"].count(0))
        for lesson in o["lessons"]:
            if lesson is not None:
                self.assertTrue(lesson[1], lesson)
        # Only the yo-yos are not in the school.
        self.assertEqual(1, o["lessons"].count(None))
        # Boelcke's eight are all carried but his third, and three are new.
        self.assertEqual({1, 2, 3, 4, 5, 6, 7, 8}, {b for b in o["boelcke"] if b})
        self.assertEqual(3, o["boelcke"].count(None))

    def test_a_jet_is_read_off_its_own_model(self) -> None:
        j = self.out["f16"]
        self.assertEqual(125, j["hp"])
        self.assertEqual((1000, 20, 500, 25), (j["gun"]["speed"], j["gun"]["rate"], j["gun"]["rounds"], j["gun"]["seconds"]))
        # The bomb rack on the fire key is not the cannon; the rocket is the missile.
        self.assertEqual(("AIM-9", "aim9", 8, 2), (j["missile"]["label"], j["missile"]["key"], j["missile"]["rack"], j["missile"]["racks"]))

    def test_where_the_game_parts_from_the_books(self) -> None:
        v = self.out["verdicts"]
        # Height is free, nothing sets a corner speed, and the missile has no seeker.
        for rule in ("energy", "corner", "envelope"):
            self.assertEqual("differs", v[rule]["status"], rule)
        for rule in ("commit", "sight", "circles", "pursuit", "defend", "pair", "plan"):
            self.assertEqual("holds", v[rule]["status"], rule)
        self.assertEqual("not here", v["yo-yo"]["status"])
        self.assertIn("500 rounds, 25 s of fire at 20 a second and 16 AIM-9s", v["commit"]["words"])
        self.assertIn("still makes 80 m/s after 10 s and is 705 m higher", v["energy"]["words"])
        self.assertIn("50 deg/s at 60 m/s, 80 deg/s at 100 m/s, 105 deg/s at 140 m/s", v["corner"]["words"])
        self.assertIn("close at 196 m/s", v["sight"]["words"])

    def test_the_missile_is_the_lab_servers(self) -> None:
        f = self.out["flown"]
        # 499 m/s off the rail, a third of it a second later: 275 m in the
        # first second, 406 in two.
        self.assertEqual([180, 275, 406, 509, 691], f["aim9"])
        self.assertEqual([249, 350], f["aa10"])
        self.assertEqual([498.8, 153.9, 87.4], f["speed"])
        w = self.out["verdicts"]["envelope"]["words"]
        self.assertIn("no seeker here: it flies straight and bursts within 7 m of an aircraft", w)
        self.assertIn("275 m in the first second, 406 in two", w)
        # Slower than a MiG-29 flying level (102 m/s) after 2.6 s.
        self.assertIn("After 2.6 s it is slower than their MiG-29", w)

    def test_the_plan_follows_the_two_jets(self) -> None:
        v, m = self.out["verdicts"], self.out["asMig"]
        self.assertIn("You out-turn them and cannot outrun them", v["plan"]["words"])
        self.assertIn("Turn across them (one circle)", v["circles"]["words"])
        self.assertIn("they are 7 m/s the faster: you cannot leave them behind", v["leave"]["words"])
        # From the other cockpit the same numbers say the opposite.
        self.assertIn("You are the faster jet and the worse turner", m["plan"]["words"])
        self.assertIn("Turn the same way as them (two circles)", m["circles"]["words"])
        self.assertIn("you are 7 m/s the faster: you can leave when you choose", m["leave"]["words"])

    def test_without_a_model_or_a_measure_a_rule_says_so(self) -> None:
        b = self.out["bare"]
        for rule in ("commit", "energy", "corner", "circles", "pursuit", "plan", "leave", "envelope"):
            self.assertEqual("partly", b[rule], rule)

    def test_the_fight_is_rodriguezs(self) -> None:
        f = self.out["fight"]
        self.assertEqual(("F-15C", "Mig29", ["the-circle", "circle"]), (f["yours"], f["theirs"], f["lesson"]))
        self.assertEqual((4, 2), (f["story"], f["sources"]))
        self.assertIn("this engine's wings stop lifting at 1,000 m", f["words"][1])
        self.assertTrue(self.out["card"]["head"].startswith("THE JET AGE'S RULES"))


class AirframeMeasureTests(unittest.TestCase):
    """`measureAirframe` on the school's Spitfire: no pilot in the pull or
    the climb, so the numbers are the airframe's."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()
        cls.s = cls.out["spitfire"]

    def test_level_speed_at_the_held_height(self) -> None:
        # The school's Spitfire (El Alamein's table), level at 300 m.
        self.assertGreater(self.s["level"], 65)
        self.assertLess(self.s["level"], 90)

    def test_a_full_pull_turns_faster_the_faster_it_flies(self) -> None:
        rates = [p["rate"] for p in self.s["pull"]]
        self.assertEqual([60, 100, 140], [p["speed"] for p in self.s["pull"]])
        self.assertEqual(sorted(rates), rates)
        self.assertGreater(rates[0], 30)
        # Rate rises with speed, so the circle barely changes.
        radii = [p["radius"] for p in self.s["pull"]]
        self.assertLess(max(radii) - min(radii), 25)

    def test_a_propeller_fighter_runs_out_of_speed_going_up(self) -> None:
        up = self.s["up"]
        self.assertTrue(up["stalls"])
        self.assertGreater(up["gained"], 100)
        self.assertLess(up["at"], 10)
        # So on the jets' card its rule 2 holds, where a jet's differs.
        prop = self.out["prop"]
        self.assertEqual("holds", prop["status"])
        self.assertIn("out of speed in", prop["words"])


if __name__ == "__main__":
    unittest.main()
