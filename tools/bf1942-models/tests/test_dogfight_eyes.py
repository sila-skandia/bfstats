"""The dogfight school's pilots see only what a pilot could see from his seat
(features/dogfight-school/reviews/eyes.md): the cockpit hides the cone astern
and the sky under the wings, the rear is watched in glances, a plane is
noticed after a reaction delay, lost after a few seconds unseen, and never
fired at unseen. `dogfight_eyes.mjs` stands two planes in the sky by hand and
flies a few duels; these tests hold what it measures.
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

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "dogfight_eyes.mjs"
TICK = 1 / 30


def run_eyes() -> dict:
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
        (work / "eyes.mjs").write_text(head + "\n" + SCRIPT.read_text())
        proc = subprocess.run(["node", str(work / "eyes.mjs")],
                              capture_output=True, text=True, timeout=300, env={**os.environ})
    if proc.returncode != 0:
        raise AssertionError(f"eyes harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class EyesTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_eyes()

    def test_the_numbers_are_the_reviewed_ones(self) -> None:
        # Each with its source in reviews/eyes.md.
        self.assertEqual({"front": 15, "tail": 20, "below": 10, "belowTail": 5, "watch": 90, "glance": 1,
                          "glanceEvery": 2.5, "glanceG": 4, "roof": 30, "notice": 0.8, "reacquire": 0.25,
                          "lose": 4}, self.out["eyes"])

    def test_the_cockpit_hides_the_tail_cone_and_under_the_wings(self) -> None:
        b = {k: v["blind"] for k, v in self.out["blind"].items()}
        for hidden in ("deadAstern", "astern10", "astern15Low", "sixLow", "belowWing", "belowAhead"):
            self.assertTrue(b[hidden], hidden)
        # Over the shoulder and above is visible, and so is anything in the
        # gunsight, even a little under the nose.
        for seen in ("abeam", "aboveAbeam", "overShoulderHigh", "highAstern", "ahead", "gunsightLow"):
            self.assertFalse(b[seen], seen)

    def test_behind_the_tail_he_is_never_seen_and_lost_after_four_seconds(self) -> None:
        a = self.out["astern"]
        self.assertFalse(a["seenEver"])
        self.assertAlmostEqual(4.0, a["lostAt"], delta=2 * TICK)
        # Until then the pilot works on where he was, carried forward.
        self.assertLess(a["carriedOff"], 5)

    def test_a_plane_coming_into_view_is_noticed_after_the_reaction_delay(self) -> None:
        f = self.out["front"]
        self.assertTrue(f["lostBefore"])
        self.assertAlmostEqual(0.8, f["seenAt"] - f["appearsAt"], delta=2 * TICK)

    def test_one_just_lost_behind_the_headrest_is_found_again_at_once(self) -> None:
        r = self.out["reacquire"]
        self.assertTrue(r["seenBefore"])
        self.assertAlmostEqual(0.25, r["seenAt"] - r["out"], delta=2 * TICK)

    def test_behind_him_the_pilot_sees_only_in_a_glance_over_that_shoulder(self) -> None:
        s = self.out["scan"]
        # Found in a look over the left shoulder, the reaction delay into it,
        # and no later than one round of glances plus the delay.
        self.assertEqual(-1, s["glanceThen"])
        self.assertAlmostEqual(0.8, s["intoGlance"], delta=2 * TICK)
        self.assertLessEqual(s["seenAt"] - s["start"], 2 * 2.5 + 0.8 + TICK)

    def test_pulling_hard_his_eyes_stay_forward_and_up_into_the_turn(self) -> None:
        p = self.out["pulling"]
        self.assertFalse(p["glances"])
        self.assertFalse(p["rearSeen"])
        self.assertAlmostEqual(0.8, p["roofSeenAt"] - p["from"], delta=2 * TICK)

    def test_in_a_duel_a_man_closing_from_dead_astern_is_not_seen(self) -> None:
        d = self.out["duelAstern"]
        self.assertTrue(d["recorded"])
        self.assertTrue(all(s == 0 for s in d["sees"]))
        # He flies straight by design: never looks round (`NEVER_CLEARS`).
        self.assertEqual(["cruise"], d["phases"])
        self.assertEqual(1.0, self.out["duelBeam"]["seenShare"])

    def test_the_guns_fire_only_at_a_plane_he_sees(self) -> None:
        g = self.out["guns"]
        # Lost, but in front of his guns he sees him at once.
        self.assertFalse(g["firedUnseen"])
        self.assertTrue(g["anyFire"])
        self.assertAlmostEqual(0, g["firstFire"], delta=2 * TICK)
        d = self.out["demos"]
        self.assertGreater(d["ticks"], 10000)
        self.assertEqual(0, d["unseenFire"])
        self.assertGreater(d["unseenShare"], 0)

    def test_a_pilot_who_has_lost_him_turns_to_clear_his_tail(self) -> None:
        c = self.out["clearing"]
        # He clears once he has not seen him for `EYES.lose`.
        self.assertAlmostEqual(4.0, c["clearAt"] - c["lastSeen"], delta=2 * TICK)
        self.assertIsNotNone(c["seenAfter"])
        self.assertLess(c["seenAfter"] - c["clearAt"], 6)
        self.assertTrue(c["backToPlan"])


if __name__ == "__main__":
    unittest.main()
