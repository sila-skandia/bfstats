"""Dogfights found in round recordings (features/dogfight-recordings).

`dogfight_recordings_harness.mjs` writes a 30 s round in the recorder's own
format (a Spitfire chasing a Bf 109 round a circle, aimed bursts, a kill; a
teammate shooting at his own side, a burst sprayed at the sky, a jeep),
reads it with the viewer's reader, and runs `viewer/dogfight-detect.js` and
`viewer/dogfight-recorded.js` on it. These tests hold the detection rules
and the theatre's reading of what they find.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "dogfight_recordings_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"dogfight recordings harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DogfightRecordingsTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_a_plane_is_a_fast_life_a_player_flies(self) -> None:
        # The three planes, each with its pilot; the jeep at 20 m/s is not one.
        planes = self.out["planes"]
        self.assertEqual(["Spitfire", "BF109", "Spitfire"], [p["tmpl"] for p in planes])
        self.assertEqual([[1], [2], [3]], [p["pilots"] for p in planes])

    def test_the_catalogue_rules_out_a_fast_car_the_motion_test_takes(self) -> None:
        # A modded KettenKrad holding 50 m/s passes the motion test alone;
        # the model catalogue calls it land.
        self.assertIn("KettenKrad", self.out["planesByMotion"])
        self.assertNotIn("KettenKrad", [p["tmpl"] for p in self.out["planes"]])

    def test_only_the_aimed_fight_between_opposing_pilots_is_found(self) -> None:
        # The wingman's fire at his own side and the burst at the sky are not
        # fights: one fight, the hunter's.
        fights = self.out["fights"]
        self.assertEqual(1, len(fights))
        f = fights[0]
        hunter, prey = f["sides"]
        self.assertEqual(("Hunter", "Spitfire"), (hunter["name"], hunter["tmpl"]))
        self.assertEqual(("Prey", "BF109"), (prey["name"], prey["tmpl"]))
        self.assertNotEqual(hunter["team"], prey["team"])
        # Every round of his bursts is aimed; the prey's straight up is not.
        self.assertEqual(41, hunter["aimed"])
        self.assertEqual(0, prey["aimed"])
        self.assertFalse(f["mutual"])
        # 172 degrees each in 15 s: under the 180 a turning fight needs.
        self.assertEqual("bounce", f["kind"])
        self.assertEqual({"t": 14, "side": 0, "weapon": "SpitfireGuns"}, f["kill"])

    def test_the_fight_opens_before_the_first_shot_and_closes_after_the_kill(self) -> None:
        f = self.out["fights"][0]
        # First aimed round at 10 s, 8 s of lead-in; the kill at 14 s, 3 s after.
        self.assertAlmostEqual(2.0, f["t0"], places=3)
        self.assertAlmostEqual(17.0, f["t1"], places=3)
        self.assertEqual(130, f["closest"])

    def test_the_sampled_fight_is_both_planes_every_tenth(self) -> None:
        raw = self.out["raw"]
        self.assertEqual(0.1, raw["dt"])
        self.assertEqual(15, raw["duration"])
        self.assertEqual([151, 151], raw["samples"])
        # Both pilots' gun rounds in the window: the hunter's 41 and the
        # prey's 11 at the sky.
        self.assertEqual(52, raw["shots"])

    def test_the_theatre_reads_who_was_on_whose_tail(self) -> None:
        f = self.out["fight"]
        self.assertEqual([151, 151], f["lengths"])
        self.assertEqual(["Hunter", "Prey"], f["names"])
        self.assertEqual(["Spitfire", "BF109"], f["planes"])
        self.assertGreater(f["hunterOnTail"], 0.95)
        self.assertGreater(f["preyChased"], 0.95)
        # The kill, in the fight's own time.
        self.assertEqual({"t": 12, "winner": 0, "why": "shot down"}, f["end"])
        self.assertEqual([{"t": 12, "side": 0}], f["kill"])

    def test_the_theatre_has_the_recording_in_its_own_frame(self) -> None:
        f = self.out["fight"]
        # z negated, the nose -z: along the flight.
        self.assertGreater(f["noseAlongFlight"], 0.99)
        self.assertAlmostEqual(60, f["speed"][0], delta=1)
        self.assertAlmostEqual(60, f["speed"][1], delta=1)
        self.assertEqual(500, f["height"])

    def test_rounds_flown_against_the_other_path_show_the_hits(self) -> None:
        f = self.out["fight"]
        self.assertEqual(52, f["rounds"])
        self.assertEqual([41, 0], f["hits"])


if __name__ == "__main__":
    unittest.main()
