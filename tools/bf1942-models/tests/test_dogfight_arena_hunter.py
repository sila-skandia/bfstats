"""The pair lesson on every arena, with each arena's own two planes.

features/dogfight-doctrine, "The hunter on every arena" and "The plane you
pick". The sentence these tests defend:

    on every arena of every tree the school flies (vanilla, Road to Rome,
    Secret Weapons, BF1918, Desert Combat, Forgotten Hope, FHSW), with the
    two planes the school page puts up by default, each on its own
    airframe: alone and flying straight you are shot down, seconds after the
    demo opens; with your wingman you are not; the hunter tracks you steadily rather than rocking its wings from
    stop to stop; and no plane in any of the four demos flies into the
    ground.

`dogfight_arena_hunter_harness.mjs` flies the pair's four demos as the
theatre flies them, from the published node trees in
`fixtures/arena-airframes.json.gz`, which also lists each arena's planes
(`surveys/dogfight_arena_airframes.mjs`).
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
                yield f"{mod}/{row['map']}", row, self.out["pairs"][f"{row['you']}|{row['ace']}"]["pair"]

    def test_every_tree_is_here(self) -> None:
        self.assertEqual({"bf1942", "xpack1", "xpack2", "bf1918", "desertcombat", "fh", "fhsw"}, set(self.arenas))
        self.assertGreaterEqual(sum(len(r) for r in self.arenas.values()), 50)

    def test_each_side_flies_its_own_plane(self) -> None:
        # Kursk: a Yak 9 against a Bf 109, not one airframe on both sides.
        kursk = next(r for r in self.arenas["bf1942"] if r["map"] == "Kursk")
        self.assertEqual(("bf1942:Yak9", "bf1942:BF109"), (kursk["you"], kursk["ace"]))
        self.assertNotEqual(self.out["fits"]["bf1942:Yak9"]["level"], self.out["fits"]["bf1942:BF109"]["level"])

    def test_alone_and_flying_straight_you_are_shot_down_on_every_arena(self) -> None:
        for arena, _, pair in self.each_arena():
            move = pair["move"]
            with self.subTest(arena=arena):
                self.assertEqual("shot down", move["youWhy"], move)
                self.assertGreaterEqual(move["onYou"], 22, move)
                # Seconds after the demo opens (the hunter 280 m back), and
                # before its minute ends.
                self.assertGreaterEqual(move["firstShot"], move["opens"] + 3, move)
                self.assertLess(move["youDown"], 60, move)

    def test_your_wingman_covers_you_on_every_arena(self) -> None:
        for arena, _, pair in self.each_arena():
            with self.subTest(arena=arena):
                self.assertIsNone(pair["counter"]["youDown"], pair["counter"])
        # FHSW's El Alamein, where the owner's check found you shot down, and
        # Gazala, where a Hurricane's wingman met the faster Bf 109 nose to
        # nose and was carried past (`PAIR.faster`).
        for name in ("El_Alamein", "Gazala"):
            row = next(r for r in self.arenas["fhsw"] if r["map"] == name)
            self.assertIsNone(self.out["pairs"][f"{row['you']}|{row['ace']}"]["pair"]["counter"]["youDown"], name)

    def test_nobody_flies_into_the_ground(self) -> None:
        # The hunter, you, and your wingman or weave partner, in all four
        # demos. On FHSW's Yak 9 the Thach weave's 80-degree turns rolled on
        # past the bank asked for, inverted, and both of the pair went in.
        for arena, _, pair in self.each_arena():
            for demo, r in pair.items():
                with self.subTest(arena=arena, demo=demo):
                    for who in ("hunterDown", "youWhy", "wingDown"):
                        self.assertNotEqual("flew into the ground", r[who], (who, r))

    def test_the_hunter_tracks_you_without_rocking_its_wings(self) -> None:
        # Stop to stop on the roll stick, a second, while it tracks you
        # flying straight: the FHSW fighters and the Albatros swung about
        # once in two seconds before their airframes were fitted a roll hand.
        for arena, _, pair in self.each_arena():
            move = pair["move"]
            with self.subTest(arena=arena):
                self.assertLessEqual(move["swingsPerSecond"], 0.25, move)

    def test_vanillas_fighters_are_flown_as_they_always_were(self) -> None:
        # No roll hand on vanilla's fighters but the Yak 9, whose roll is just
        # past the slack (1.26 times the Spitfire's lag): the school's
        # Spitfire, which the lessons' words were measured on, is untouched.
        for name in ("bf1942:Spitfire", "bf1942:BF109", "bf1942:Zero", "bf1942:Mustang", "bf1942:Corsair"):
            hand = self.out["fits"][name]["hand"] or {}
            self.assertNotIn("roll", hand, name)
        self.assertIsNone(self.out["fits"]["bf1942:Spitfire"]["hand"])

    def test_the_slow_rollers_carry_a_roll_hand(self) -> None:
        # Forgotten Hope's fighters roll at about a third of the Spitfire's
        # rate and take twice as long to get there; each carries a hand.
        for name, fit in self.out["fits"].items():
            if name.startswith(("fh:", "fhsw:")):
                with self.subTest(airframe=name):
                    self.assertGreater((fit["hand"] or {}).get("roll", 1), 1)


if __name__ == "__main__":
    unittest.main()
