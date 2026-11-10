"""A two-seater's gunner in a recorded fight, and in the school's theatre.

features/dogfight-recordings, "The gunners' rounds"; features/dogfight-
doctrine, "The gunners from the planes' own data". The sentence these tests
defend:

    a round a plane's gunner fired is in the fight the school plays, drawn
    as that gun's own tracer, and never counted as its pilot firing; and the
    gun the recording names is the gun the school reads off the plane's own
    model.

`dogfight_gunners_harness.mjs` reads `fixtures/gunner_stuka_558jj8m4nb.
ndjson.gz` (El Alamein, a Yak 9 on a Stuka whose rear gunner fires back)
with the viewer's own reader and the dogfight detector, and the Stuka's node
tree from `fixtures/two-seaters.json` with `dogfight-gunner-seats.js`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "dogfight_gunners_harness.mjs"


def run() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"gunners harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class RecordedGunnerTests(unittest.TestCase):
    out: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run()

    def stuka(self) -> dict:
        return next(f for f in self.out["fights"] if f["tmpls"] == ["Yak9", "Stuka"])

    def test_the_stukas_gunner_is_in_its_fight(self) -> None:
        f = self.stuka()
        # The recording's every MG 42 round from the Stuka's rear seat
        # (recorded as `f` rows on the Stuka, pid 20 in seat 1).
        self.assertEqual(40, f["gunner"])
        self.assertEqual([1], f["gunnerSides"])
        self.assertEqual(["MG42_Air"], f["gunnerWeapons"])
        # The pilots' own rounds are kept apart: the Yak's 82, the Stuka
        # pilot's 7.
        self.assertEqual([82, 7], f["pilotShotsBySide"])

    def test_no_other_fight_gains_a_gunner(self) -> None:
        # Single-seaters, and an Aichi Val whose back seat was empty.
        for f in self.out["fights"]:
            if f["tmpls"] != ["Yak9", "Stuka"]:
                self.assertEqual(0, f["gunner"], f["tmpls"])

    def test_the_theatre_draws_the_gunners_rounds(self) -> None:
        r = self.stuka()["recorded"]
        self.assertEqual(40, r["gunnerRounds"])
        self.assertTrue(r["dirs"])
        # Every second of them a tracer, as the MG 42's own interval.
        self.assertEqual(20, r["gunnerTracers"])
        # The gunner firing is not the pilot pressing the trigger.
        self.assertEqual(7, r["pilotFiringTicks"])

    def test_the_recorded_gun_is_the_one_the_model_carries(self) -> None:
        self.assertEqual(["MG42_Air"], self.out["stukaGun"])
        self.assertEqual(self.stuka()["gunnerWeapons"], self.out["stukaGun"])


if __name__ == "__main__":
    unittest.main()
