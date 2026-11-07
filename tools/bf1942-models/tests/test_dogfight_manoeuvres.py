"""The manoeuvres named in a fight (features/dogfight-recordings, "Naming the
manoeuvres"), held to the dogfight school's own flown lessons, whose
manoeuvres are known: the ace who breaks reads as a break turn, the
Immelmann as an Immelmann, the scissors as scissors, and a pilot who flies
straight reads as nothing at all.

`dogfight_manoeuvres_harness.mjs` flies the demos (their middle starts) and
names what each side flew with `viewer/dogfight-manoeuvres.js`.
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

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "dogfight_manoeuvres_harness.mjs"


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in {**MODULES, "dogfight-manoeuvres.js": VIEWER / "dogfight-manoeuvres.js"}.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "m.mjs").write_text(head + "\n" + SCRIPT.read_text())
        proc = subprocess.run(["node", str(work / "m.mjs")], capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"manoeuvres harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ManoeuvreNameTests(unittest.TestCase):
    demos: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.demos = run()

    def named(self, demo: str, side: int) -> list[dict]:
        return [m for m in self.demos[demo]["moves"] if m["side"] == side]

    def names(self, demo: str, side: int) -> set[str]:
        return {m["name"] for m in self.named(demo, side)}

    def test_the_ace_who_breaks_reads_as_a_break_turn(self) -> None:
        breaks = [m for m in self.named("break-turn/move", 0) if m["name"] == "Break turn"]
        self.assertTrue(breaks)
        # He breaks when the attacker is 300 m back, about 11 s in.
        self.assertTrue(9 <= breaks[0]["t0"] <= 14, breaks)
        # The attacker closing on his tail is a tail chase.
        self.assertIn("Tail chase", self.names("break-turn/move", 1))

    def test_a_pilot_who_flies_straight_flies_nothing(self) -> None:
        self.assertEqual(set(), self.names("break-turn/without", 0))
        self.assertIn("Tail chase", self.names("break-turn/without", 1))

    def test_the_immelmann_and_the_split_s(self) -> None:
        imm = [m for m in self.named("turnarounds/immelmann", 0) if m["name"] == "Immelmann"]
        self.assertTrue(imm and imm[0]["t0"] < 4, imm)
        self.assertIn("Split-S", self.names("turnarounds/split", 0))
        self.assertNotIn("Immelmann", self.names("turnarounds/split", 0))

    def test_the_scissors_reads_as_one_scissors_for_both(self) -> None:
        for side in (0, 1):
            sc = [m for m in self.named("scissors/move", side) if m["name"] == "Scissors"]
            self.assertEqual(1, len(sc), sc)
            self.assertGreater(sc[0]["t1"] - sc[0]["t0"], 30)
        # A chop that makes one pass is no scissors.
        self.assertNotIn("Scissors", self.names("out-of-the-lock/counter", 0))

    def test_the_boom_and_zoom(self) -> None:
        booms = [m for m in self.named("boom-and-zoom/move", 0) if m["name"] == "Boom and zoom"]
        self.assertGreaterEqual(len(booms), 2)

    def test_the_hard_turn_under_his_guns_is_a_break(self) -> None:
        self.assertIn("Break turn", self.names("out-of-the-lock/flat", 1))

    def test_the_chop_makes_him_overshoot_and_reverses_the_fight(self) -> None:
        self.assertIn("Overshoot", self.names("out-of-the-lock/counter", 0))
        self.assertIn("Forced overshoot", self.names("out-of-the-lock/counter", 1))
        self.assertIn("Reversal", self.names("out-of-the-lock/counter", 1))

    def test_the_flip_against_a_breaker_is_a_high_yo_yo(self) -> None:
        self.assertIn("High yo-yo", self.names("on-his-tail/flip", 1))

    def test_the_dips_read_as_extensions(self) -> None:
        for demo in ("break-turn/dip", "scissors/dip", "up-and-over/dip"):
            self.assertIn("Extension", self.names(demo, 1), demo)

    def test_up_and_over_goes_over_the_top(self) -> None:
        self.assertIn("Immelmann", self.names("up-and-over/move", 0))

    def test_each_manoeuvre_is_scored_before_and_after(self) -> None:
        for demo, d in self.demos.items():
            for m in d["scored"]:
                self.assertIn(m["before"], ("offensive", "defensive", "neutral", "headOn", None), (demo, m))
                self.assertIn(m["after"], ("offensive", "defensive", "neutral", "headOn", None), (demo, m))
        # The chop's reversal ends offensive.
        rev = [m for m in self.demos["out-of-the-lock/counter"]["scored"] if m["name"] == "Reversal" and m["side"] == 1]
        self.assertEqual("offensive", rev[0]["after"])


if __name__ == "__main__":
    unittest.main()
