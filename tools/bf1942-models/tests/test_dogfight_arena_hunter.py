"""The pair lesson's hunter on every arena's airframe.

features/dogfight-doctrine, "The hunter on every arena". The sentence these
tests defend:

    on every arena of every tree the school flies (vanilla, Road to Rome,
    Secret Weapons, BF1918, Desert Combat, Forgotten Hope, FHSW), alone and
    flying straight you are shot down, with your wingman you are not, the
    hunter tracks you steadily rather than rocking its wings from stop to
    stop, and nobody's hunter flies into the ground.

`dogfight_arena_hunter_harness.mjs` flies the pair's four demos as the
theatre flies them on each arena's airframe, from the published node trees
in `fixtures/arena-airframes.json.gz`, which also maps each arena to its
airframe (`surveys/dogfight_arena_airframes.mjs`).
"""

from __future__ import annotations

import gzip
import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "dogfight_arena_hunter_harness.mjs"
FIXTURE = HERE / "fixtures" / "arena-airframes.json.gz"


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=900)
    if proc.returncode != 0:
        raise AssertionError(f"arena hunter harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class HunterOnEveryArenaTests(unittest.TestCase):
    out: dict
    arenas: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()
        cls.arenas = json.loads(gzip.decompress(FIXTURE.read_bytes()))["arenas"]

    def each_arena(self):
        for mod, rows in self.arenas.items():
            for row in rows:
                yield f"{mod}/{row['map']}", self.out[row["airframe"]]

    def test_every_tree_is_here(self) -> None:
        self.assertEqual({"bf1942", "xpack1", "xpack2", "bf1918", "desertcombat", "fh", "fhsw"}, set(self.arenas))
        self.assertGreaterEqual(sum(len(r) for r in self.arenas.values()), 50)

    def test_alone_and_flying_straight_you_are_shot_down_on_every_arena(self) -> None:
        for arena, a in self.each_arena():
            move = a["pair"]["move"]
            with self.subTest(arena=arena):
                self.assertEqual("shot down", move["youWhy"], move)
                self.assertGreaterEqual(move["onYou"], 22, move)
                # After the 8 s the demo opens at, and before its minute ends.
                self.assertGreater(move["firstShot"], 8, move)
                self.assertLess(move["youDown"], 60, move)

    def test_your_wingman_covers_you_on_every_arena(self) -> None:
        for arena, a in self.each_arena():
            counter = a["pair"]["counter"]
            with self.subTest(arena=arena):
                self.assertIsNone(counter["youDown"], counter)
        # FHSW's El Alamein, where the owner's check found you shot down 29 s in.
        el = next(r["airframe"] for r in self.arenas["fhsw"] if r["map"] == "El_Alamein")
        self.assertIsNone(self.out[el]["pair"]["counter"]["youDown"])

    def test_nobody_flies_into_the_ground(self) -> None:
        # The hunter, you, and your wingman or weave partner, in all four
        # demos. On FHSW's Yak 9 the Thach weave's 80-degree turns rolled on
        # past the bank asked for, inverted, and both of the pair went in.
        for arena, a in self.each_arena():
            for demo, r in a["pair"].items():
                with self.subTest(arena=arena, demo=demo):
                    for who in ("hunterDown", "youWhy", "wingDown"):
                        self.assertNotEqual("flew into the ground", r[who], (who, r))

    def test_the_hunter_tracks_you_without_rocking_its_wings(self) -> None:
        # Stop to stop on the roll stick, a second, while it tracks you
        # flying straight: the FHSW fighters and the Albatros swung about
        # once in two seconds before their airframes were fitted a roll hand.
        for arena, a in self.each_arena():
            move = a["pair"]["move"]
            with self.subTest(arena=arena):
                self.assertLessEqual(move["swingsPerSecond"], 0.25, move)

    def test_vanillas_fighters_are_flown_as_they_always_were(self) -> None:
        # No roll hand on vanilla's airframes: the lessons' counts stand.
        for name in ("bf1942:Spitfire", "bf1942:BF109", "bf1942:Zero"):
            hand = self.out[name]["fit"]["hand"] or {}
            self.assertNotIn("roll", hand, name)
        self.assertIsNone(self.out["bf1942:Spitfire"]["fit"]["hand"])
        self.assertAlmostEqual(25.5, self.out["bf1942:Spitfire"]["pair"]["move"]["youDown"], delta=0.2)

    def test_the_slow_rollers_carry_a_roll_hand(self) -> None:
        # Forgotten Hope's fighters roll at about a third of the Spitfire's
        # rate and take twice as long to get there; each carries a hand.
        for name, a in self.out.items():
            if name.startswith(("fh:", "fhsw:")):
                with self.subTest(airframe=name):
                    self.assertGreater((a["fit"]["hand"] or {}).get("roll", 1), 1)


if __name__ == "__main__":
    unittest.main()
