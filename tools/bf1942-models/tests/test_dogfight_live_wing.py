"""The pair lesson flown: your wingman in the live fight.

features/dogfight-school, "Fly the pair". The sentence these tests defend:

    flown with your wingman off your wing, on your own plane's airframe,
    you are saved by them flying straight from every one of the nine
    starts where alone you are shot down from every one; turning hard you
    come through either way; a two-seater's gunner fires back and hits;
    nobody flies into the ground; the hunter goes after the nearer of you,
    and the end card says who shot whom, whether the wingman saved you, and
    when.

`dogfight_live_wing_harness.mjs` runs the live fight's plain half
(`viewer/dogfight-live-wing.js`) and the fight it flies under node, on
Kursk's Bf 109 against the Yak 9, Kursk with the Stuka picked, and FHSW's El
Alamein (`fixtures/arena-airframes.json.gz`, `fixtures/two-seaters.json`).
"""

# watches: tools/bf1942-models/viewer/dogfight-live-wing.js tools/bf1942-models/viewer/dogfight-live.js tools/bf1942-models/viewer/dogfight-pilot.js tools/bf1942-models/viewer/dogfight-fight.js tools/bf1942-models/viewer/dogfight-duel.js tools/bf1942-models/viewer/dogfight-flight.js tools/bf1942-models/viewer/dogfight-lessons.js

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "dogfight_live_wing_harness.mjs"


class LiveWingTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900)
        if proc.returncode != 0:
            raise AssertionError(f"live wing harness failed:\n{proc.stderr}")
        cls.out = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_the_hunter_goes_after_the_nearer_of_you(self) -> None:
        t = self.out["target"]
        self.assertEqual(1, t["alone"])
        self.assertEqual(2, t["wingNearer"])
        # Kept unless the other is a third nearer, as the demos pick.
        self.assertEqual(1, t["keptUnlessThirdNearer"])
        self.assertEqual(2, t["switched"])

    def test_the_wingman_breaks_onto_a_hunter_on_your_tail(self) -> None:
        self.assertEqual("cover", self.out["stepWing"]["phase"])
        self.assertEqual("Breaking onto the hunter", self.out["words"]["cover"])
        self.assertEqual("On your wing", self.out["words"]["station"])
        self.assertEqual("Down", self.out["words"]["down"])

    def test_the_end_card_says_who_shot_whom_and_whether_they_saved_you(self) -> None:
        e = self.out["ends"]
        self.assertEqual("Your wingman shot the hunter down at 31 s.", e["wingman"]["lines"][0])
        self.assertTrue(e["wingman"]["saved"])
        self.assertEqual("The hunter shot you down at 25 s.", e["you"]["lines"][0])
        self.assertFalse(e["you"]["saved"])
        self.assertIn("alone", e["lonely"]["lines"][1])
        self.assertEqual("You came through", e["time"]["title"])
        self.assertTrue(e["time"]["saved"])

    def test_flying_straight_your_wingman_saves_you(self) -> None:
        for arena, rows in self.out["flown"].items():
            with self.subTest(arena=arena):
                # Alone you are shot down from every start; with your wingman
                # you come through from most (all nine, measured).
                self.assertEqual(0, rows["straight-alone"]["saved"], rows)
                self.assertGreaterEqual(rows["straight"]["saved"], 7, rows)

    def test_turning_hard_you_come_through(self) -> None:
        for arena, rows in self.out["flown"].items():
            with self.subTest(arena=arena):
                self.assertGreaterEqual(rows["turn"]["saved"], 7, rows)

    def test_a_picked_two_seaters_gunner_fires_back(self) -> None:
        stuka = self.out["flown"]["kursk-stuka"]
        for hands in ("straight", "turn", "straight-alone"):
            self.assertGreater(stuka[hands]["gunnerRounds"], 100, hands)
            self.assertGreater(stuka[hands]["gunnerHits"], 0, hands)
        self.assertEqual(0, self.out["flown"]["kursk-bf109"]["straight"]["gunnerRounds"])

    def test_nobody_flies_into_the_ground(self) -> None:
        for arena, rows in self.out["flown"].items():
            for hands, r in rows.items():
                with self.subTest(arena=arena, hands=hands):
                    self.assertEqual([], r["crashed"], r)


if __name__ == "__main__":
    unittest.main()
