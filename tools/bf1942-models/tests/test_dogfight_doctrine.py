"""Boelcke's rules measured over a fight (features/dogfight-doctrine), held to
the dogfight school's own flown lessons, whose shapes are known: the
boom-and-zoom ace attacks with the height and unseen, the pilot who meets
the dive meets it and the one who climbs straight does not, and the guns'
useful range follows each mod's damage falloff.

`dogfight_doctrine_harness.mjs` flies the demos (their middle starts) and
measures both sides with `viewer/dogfight-doctrine.js`.
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

from test_dogfight_school import HARNESS, MODULES, THREE_PACKAGE
from test_flight import VIEWER

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "dogfight_doctrine_harness.mjs"
RECORDED = HERE / "dogfight_doctrine_recorded.mjs"


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    head = HARNESS.read_text()
    head = head[: head.index("const out = {};")]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in {**MODULES, "dogfight-doctrine.js": VIEWER / "dogfight-doctrine.js"}.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        (work / "d.mjs").write_text(head + "\n" + SCRIPT.read_text())
        proc = subprocess.run(["node", str(work / "d.mjs")], capture_output=True, text=True, timeout=600, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"doctrine harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DoctrineTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def side(self, demo: str, s: int) -> dict:
        return self.out["demos"][demo]["sides"][s]

    def rule(self, demo: str, s: int, n: int):
        return next(r for r in self.side(demo, s)["rules"] if r["n"] == n)["kept"]

    def test_the_boom_and_zoom_ace_keeps_rules_one_three_and_five(self) -> None:
        ace = self.side("boom-and-zoom/move", 0)
        self.assertGreaterEqual(len(ace["attacks"]), 2)
        # Every dive begun from well above, every burst from close astern.
        self.assertTrue(all(a["advantage"] and a["lead"] >= 150 for a in ace["attacks"]), ace["attacks"])
        for n in (1, 2, 3, 5):
            self.assertTrue(self.rule("boom-and-zoom/move", 0, n), n)
        self.assertTrue(all(b["range"] <= 150 and b["aspect"] <= 20 for b in ace["bursts"]), ace["bursts"])

    def test_the_pilot_who_does_not_meet_the_dive_runs_from_every_one(self) -> None:
        dives = self.side("boom-and-zoom/move", 1)["dives"]
        self.assertTrue(dives and all(d["ran"] and not d["met"] for d in dives), dives)
        self.assertIs(self.rule("boom-and-zoom/move", 1, 6), False)
        self.assertIs(self.rule("under-the-height/move", 1, 6), False)

    def test_the_pilot_who_meets_the_dive_meets_every_one(self) -> None:
        for demo in ("boom-and-zoom/counter", "under-the-height/counter"):
            dives = self.side(demo, 1)["dives"]
            self.assertTrue(dives and all(d["met"] for d in dives), (demo, dives))
            self.assertIs(self.rule(demo, 1, 6), True, demo)

    def test_a_dive_met_head_on_is_broken_off_not_abandoned(self) -> None:
        ace = self.side("boom-and-zoom/counter", 0)
        self.assertTrue(ace["attacks"] and all(a["met"] and not a["abandoned"] and not a["fired"] for a in ace["attacks"]), ace["attacks"])
        self.assertIsNone(self.rule("boom-and-zoom/counter", 0, 2))

    def test_the_chaser_opens_fire_from_astern(self) -> None:
        for demo in ("on-his-tail/move", "break-turn/without"):
            for n in (3, 5):
                self.assertIs(self.rule(demo, 1, n), True, (demo, n))

    def test_the_circle_has_no_attack_in_it(self) -> None:
        for s in (0, 1):
            self.assertEqual([], self.side("the-circle/circle", s)["attacks"])

    def test_the_pilot_who_never_looks_back_loses_sight(self) -> None:
        self.assertLess(self.side("break-turn/without", 0)["sight"], 0.3)
        self.assertIs(self.rule("break-turn/without", 0, 4), False)

    def test_the_useful_range_follows_each_mods_falloff(self) -> None:
        g = self.out["guns"]
        # Vanilla: the wing guns' convergence; BF1918: half damage between
        # 100 and 150 m; FHSW: half of the straight fall from the muzzle.
        self.assertEqual(269, g["vanilla"])
        self.assertEqual(136, g["bf1918"])
        self.assertEqual(284, g["fhsw792"])
        self.assertEqual(501, g["fhsw20"])
        d = self.out["damage"]
        self.assertAlmostEqual(0.65, d["bf1918at125"], places=3)
        self.assertAlmostEqual(0.3, d["bf1918at300"], places=3)
        self.assertEqual(1, d["none"])

    def test_eight_rules(self) -> None:
        self.assertEqual(list(range(1, 9)), self.out["rules"])

    def test_the_coach_holds_your_fire_past_the_planes_useful_range(self) -> None:
        c = self.out["coach"]
        self.assertEqual(("Hold fire: 220 m", 3), (c["holdFire"]["line"], c["holdFire"]["rule"]))
        self.assertIn("inside 136 m", c["holdFire"]["tip"])
        self.assertIn("Full damage inside 100 m", c["holdFire"]["tip"])
        self.assertEqual("Guns: 120 m", c["inRange"]["line"])
        # With no useful range given, the coach is as it was.
        self.assertEqual("Guns: 220 m", c["noUseful"]["line"])

    def test_the_coachs_rule_lines(self) -> None:
        c = self.out["coach"]
        self.assertEqual(("No advantage", 1), (c["noAdvantage"]["line"], c["noAdvantage"]["rule"]))
        # Unseen, the same pass is no warning; head on, rule 5 says so.
        self.assertEqual(("Head on", 5), (c["unseenNoLead"]["line"], c["unseenNoLead"]["rule"]))
        self.assertEqual(("From the side", 5), (c["fromSide"]["line"], c["fromSide"]["rule"]))
        # Under a more urgent top line, the rule rides in its own row.
        self.assertEqual({"line": "Committed", "rule": 2}, c["committed"]["ruleLine"])
        self.assertEqual({"line": "Lost sight · 3 s", "rule": 4}, c["lostSight"]["ruleLine"])
        self.assertTrue(c["lostSight"]["line"].startswith("They are on your tail"))

    def test_the_gunnery_target_flies_its_pattern_and_never_shoots_back(self) -> None:
        g = self.out["gunnery"]
        self.assertEqual(["straight", "turn", "jink", "climb"], g["phases"])
        self.assertEqual(set(g["phases"]), set(g["coachPhases"]))
        self.assertEqual(0, g["targetRounds"])
        self.assertEqual(0, g["loneRounds"])
        # It holds its height and its cruise: a target, not a fighter.
        self.assertGreater(g["minY"], 200)
        self.assertLess(g["maxY"], 450)
        self.assertGreater(g["speeds"][0], 30)
        # And it can be shot.
        self.assertGreater(g["hits"][1], 0)


class RecordedDoctrineTests(unittest.TestCase):
    """A recorded fight carries no eyes: `perceive` runs over its tracks."""

    sides: list

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(RECORDED)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"recorded doctrine harness failed:\n{proc.stderr}")
        cls.sides = json.loads(proc.stdout)

    def test_the_hunter_dead_astern_is_never_seen(self) -> None:
        hunter, prey = self.sides
        self.assertEqual(0, prey["sight"])
        self.assertEqual(1, hunter["sight"])
        (attack,) = hunter["attacks"]
        self.assertTrue(attack["unseen"] and attack["advantage"])
        self.assertEqual(0, attack["first"]["aspect"])
        self.assertEqual(200, attack["first"]["range"])

    def test_holding_station_behind_them_and_firing_is_an_attack_carried_through(self) -> None:
        hunter = self.sides[0]
        (burst,) = hunter["bursts"]
        self.assertEqual(20, burst["rounds"])
        self.assertEqual(20, burst["closeRounds"])
        self.assertGreater(burst["hits"], 0)
        self.assertEqual({1: True, 2: True, 3: True, 4: True, 5: True, 6: None}, {r["n"]: r["kept"] for r in hunter["rules"]})


if __name__ == "__main__":
    json.dump(run(), sys.stdout, indent=1)
