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
        for name, source in MODULES.items():
            target = work / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        (work / "node_modules" / "three" / "package.json").write_text(THREE_PACKAGE)
        (work / "package.json").write_text('{"type":"module"}\n')
        # The two-seaters' own node trees (`surveys/airframe_fixture.py`).
        shutil.copyfile(HERE / "jet_airframes.mjs", work / "jet_airframes.mjs")
        shutil.copyfile(HERE / "fixtures" / "two-seaters.json", work / "two-seaters.json")
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

    def test_the_moves_scored_on_the_spitfire_are_the_counts_the_lessons_declare(self) -> None:
        # The theatre scores a lesson's moves on the airframe on stage
        # (`dogfight-measure.js` `movesOn`); on the school's own Spitfire it
        # must give back every declared count.
        got = self.out["onSpitfire"]
        self.assertGreaterEqual(len(got), 30)
        for key, v in got.items():
            self.assertEqual(v["declared"], v["works"], key)

    def test_the_falling_leaf_gets_away_from_the_pilot_who_takes_it_for_a_kill(self) -> None:
        fooled, follow = self.out["leaf"]["move"], self.out["leaf"]["counter"]
        self.assertEqual(9, len(fooled))
        for run in fooled + follow:
            self.assertIsNotNone(run["fall"])
            self.assertTrue(run["recovered"])
        # Taken for a kill: out of sight and gone, every start; 0 to 5 rounds
        # after the fall (0 to 4 until it was re-pinned 2026-11-12 on retail g
        # and box area, features/retail-parity-cross-check-2026-11-12).
        for run in fooled:
            self.assertGreater(run["endRange"], 1100, run)
            self.assertLess(run["sight"], 0.3, run)
            self.assertLessEqual(run["hitsAfter"], 5, run)
        # Followed down: in sight, close, and hit, every start.
        for run in follow:
            self.assertLess(run["endRange"], 400, run)
            self.assertGreaterEqual(run["sight"], 0.7, run)
            self.assertGreaterEqual(run["hitsAfter"], 1, run)
        self.assertGreater(sum(r["hitsAfter"] for r in follow), 3 * sum(r["hitsAfter"] for r in fooled))
        # The price the lesson states: their pull-out answers in three of nine.
        self.assertEqual(3, sum(1 for r in follow if r["hisHits"] > 0))

    def test_the_pair_gets_a_shot_on_the_hunter(self) -> None:
        pair = self.out["pair"]
        # Alone and flying straight: shot down from every start.
        self.assertTrue(all(r["youDown"] is not None for r in pair["move"]), pair["move"])
        # Alone and turning hard: alive, and nobody wins.
        self.assertTrue(all(r["youDown"] is None and not r["aceDown"] for r in pair["flat"]), pair["flat"])
        # Drag and bag: you drag, your wingman cuts in on the hunter and
        # shoots, you reverse onto it. Never hit, and the hunter is hit from
        # most starts, mostly by your wingman, and none of your own rounds
        # strike your wingman (`friendInLine`). Retuned 2026-11-12 on retail g
        # and box area (features/retail-parity-cross-check-2026-11-12): the
        # bait was hit in two starts; now its drag tightens to a hard turn
        # toward the wingman once the hunter is about to fire
        # (`BAG.breakRange`, `BAG.breakCone`): the hunter hit in 8 of 9, 65
        # rounds, 39 the wingman's, the bait never.
        bag = pair["counter"]
        self.assertTrue(all(r["onYou"] == 0 and r["youDown"] is None for r in bag), bag)
        self.assertGreaterEqual(sum(r["onAce"] > 0 for r in bag), 7, bag)
        self.assertGreaterEqual(sum(r["onAce"] for r in bag), 40, bag)
        self.assertGreater(sum(r["byWing"] for r in bag), sum(r["onAce"] for r in bag) / 2, bag)
        self.assertEqual(0, sum(r["onWing"] for r in bag), bag)
        self.assertIn("bag", bag[0]["phases"])
        self.assertIn("reverse", bag[0]["youPhases"])
        # Far more than the turn alone, or the weave, put on it.
        self.assertGreater(sum(r["onAce"] for r in bag), 3 * sum(r["onAce"] for r in pair["flat"]))
        self.assertGreater(sum(r["onAce"] for r in bag), sum(r["onAce"] for r in pair["weave"]))
        # The weave, from these starts: the pair hit once (one round in nine
        # fights), the hunter hit more. Rewritten 2026-11-12 on retail g and
        # box area (features/retail-parity-cross-check-2026-11-12): "the pair
        # never hit"; the weave trades shots between equals, which the lesson
        # says, and on retail's law it trades one back.
        self.assertLessEqual(sum(r["onYou"] for r in pair["weave"]), 1, pair["weave"])
        self.assertEqual(0, sum(r["onWing"] for r in pair["weave"]), pair["weave"])
        self.assertGreater(sum(r["onAce"] for r in pair["weave"]), sum(r["onAce"] for r in pair["flat"]))
        self.assertIn("shoot", pair["weave"][0]["phases"])

    def test_alone_and_straight_the_hunter_fires_and_hits_after_the_demo_opens(self) -> None:
        # The owner saw this demo as a plane flying straight with nothing
        # happening: the hunter fires and lands its rounds from every start,
        # and its first round comes seconds after the demo opens, the hunter
        # 280 m back (`startRange`).
        rows = self.out["pair"]["move"]
        self.assertTrue(all(r["onYou"] >= 20 for r in rows), rows)
        self.assertTrue(all(r["firstShot"] is not None and r["firstShot"] >= r["opens"] + 4 for r in rows), rows)

    def test_the_picked_two_seater_flies_as_itself_and_its_gunner_fires_back(self) -> None:
        # The owner picked the Stuka and watched it fly straight "without
        # ever firing back". Picked, it flies on its own airframe and its rear
        # gunner fires at the hunter on its tail and hits, from every start.
        out = self.out["youSeater"]
        rows = out["rows"]
        self.assertTrue(all(r["flownByFight"] for r in rows), rows)
        self.assertTrue(all(r["side"] == [1] and r["gunnerRounds"] > 50 and r["gunnerHits"] > 0 and r["gunnerEvent"] for r in rows), rows)
        # A Stuka's cruise, not the Spitfire's: at the same throttle it is
        # 2 to 3 m/s slower 14 s in (59 against 56).
        self.assertTrue(all(r["youSpeeds"][-1] <= out["spitfireSpeeds"][-1] - 2 for r in rows), (out["spitfireSpeeds"], rows))

    def test_a_two_seater_is_attacked_from_beneath_its_tail(self) -> None:
        # The Stuka on its own airframe, its gunner on its own MG 42
        # (features/dogfight-doctrine, "The gunners from the planes' own data").
        behind, under = self.out["twoSeater"]["move"], self.out["twoSeater"]["counter"]
        # From behind and level: into the gunner's arc, hit in every fight,
        # 3 to 14 rounds; the Stuka still comes down each time.
        self.assertTrue(all(r["onYou"] >= 3 for r in behind), behind)
        self.assertTrue(all(r["gunnerRounds"] > 50 for r in behind), behind)
        self.assertTrue(all(r["heDown"] for r in behind), behind)
        # From beneath the tail: never hit, and landing rounds every time.
        self.assertTrue(all(r["onYou"] == 0 and not r["youDown"] for r in under), under)
        self.assertTrue(all(r["onHim"] >= 2 for r in under), under)

    def test_the_gunner_fires_the_planes_own_gun(self) -> None:
        behind = self.out["twoSeater"]["move"]
        for r in behind:
            # The MG 42's own: MG42_Air, 12 rounds a second on the 30 Hz
            # tick (a round every 3rd tick, GUN-13), its rounds living 3 s.
            self.assertEqual(["MG42_Air"], r["weapons"])
            self.assertEqual(3, r["gap"])
            self.assertEqual(3, r["life"])
            # Every hit on you was the gunner's: the Stuka's pilot flies
            # straight and never points at you.
            self.assertEqual(r["onYou"], r["gunnerHits"])

    def test_nobody_in_the_back_fires_nothing(self) -> None:
        # The same Stuka with its rear seat empty, and a fighter's seat.
        for demo, counts in self.out["emptySeat"].items():
            self.assertEqual([0] * 9, counts, demo)
        self.assertEqual([], self.out["arcs"]["Spitfire"])

    def test_each_gunners_arc_is_its_own_mount(self) -> None:
        arcs = self.out["arcs"]
        one = {name: rows[0] for name, rows in arcs.items() if rows}
        # Seat, weapon, rate and muzzle speed are the FireArms' own.
        self.assertEqual(("StukaRearGunControl", "MG42_Air", 12, 1000), (one["Stuka"]["seat"], one["Stuka"]["weapon"], one["Stuka"]["rate"], one["Stuka"]["speed"]))
        self.assertEqual(("SBD_PCO1", "SBD-6_guns", 10, 400), (one["SBD"]["seat"], one["SBD"]["weapon"], one["SBD"]["rate"], one["SBD"]["speed"]))
        self.assertEqual(("AlbatrossC3MG", 8, 1.5), (one["AlbatrossC3"]["weapon"], one["AlbatrossC3"]["rate"], one["AlbatrossC3"]["life"]))
        self.assertEqual({"interval": 2, "scaler": 50}, one["Stuka"]["tracer"])
        self.assertEqual({"interval": 3, "scaler": 60}, one["AlbatrossC3"]["tracer"])
        # How far round from astern each turns (yaw rigs of 40, 60 and 70
        # degrees, and the DH.4's ring all the way), on a 3-degree grid.
        self.assertAlmostEqual(40, one["Stuka"]["side"], delta=3)
        self.assertAlmostEqual(60, one["SBD"]["side"], delta=3)
        self.assertAlmostEqual(70, one["AlbatrossC3"]["side"], delta=3)
        self.assertEqual(180, one["AircoDH4_Brit"]["side"])
        # Up over the tail and never down past it: the gap under the tail
        # Mannock's rule attacks through.
        for name in ("Stuka", "SBD", "BF110", "AlbatrossC3", "AircoDH4_Brit"):
            self.assertGreaterEqual(one[name]["up"], 30, name)
            self.assertGreaterEqual(one[name]["down"], -5, name)
        # The gun sits behind the pilot, on the plane's back.
        self.assertGreater(one["Stuka"]["at"][2], 0.5)


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
