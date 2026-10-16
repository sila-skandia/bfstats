"""The third-person body follows the hand when it changes twice in a tick (FHX-15).

On Battle_Of_Foy with 2Us_AssaultGarand the knife was in hand and the body
still held the M1 Garand. `ensureFootBody` returned early for a request whose
weapon the body already held, and left a pose load still in flight for another
weapon on the current token, so the rifle's pose, landing after the knife had
been raised again, put the rifle on the body. Measured in the page: slot 3 then
slot 2 in one tick gave hand `Knife_M1Bayonet_ID2`, body `M1Garand`, for as
long as the probe read. `foot_body_race_harness.mjs` holds each pose until it
says so; against the module before the fix it reads `M1Garand`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "foot_body_race_harness.mjs"


class FootBodyRaceTests(unittest.TestCase):
    def test_the_body_ends_on_the_weapon_in_hand(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode, proc.stderr)
        r = json.loads(proc.stdout)
        self.assertEqual("Knife_M1Bayonet_ID2", r["start"])
        self.assertEqual("Knife_M1Bayonet_ID2", r["afterRace"])
        self.assertEqual("M1Garand", r["afterChange"])


if __name__ == "__main__":
    unittest.main()
