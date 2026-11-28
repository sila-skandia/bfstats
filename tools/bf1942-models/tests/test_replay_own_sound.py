"""The replay's followed soldier's own hand sounds (`viewer/replay-own-sound.js`).

Why it exists. A 2026-11-28 report on a Berlin replay (q8uwcxrjcg): the medic
bag and the wrench made no sound, and nor did a reload. Every vanilla Reload
load and the `MedPack.ssc` / `RepairPack.ssc` loops stop at a metre, so played
at the soldier the replay's chase camera, 6.5 m behind him, never heard them,
and the packs had no path at all. The followed man's are played on the hand
weapon's bus, as the player hears his own.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "test_replay_own_sound.mjs"


class ReplayOwnSoundTest(unittest.TestCase):
    def test_reload_and_pack_loop(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)


if __name__ == "__main__":
    unittest.main()
