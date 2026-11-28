"""Runs `test_replay_event_sounds.mjs`: a depot's or a medic's heal sounds at the
patient, and a thrown knife whooshes along its recorded flight.

A node test over `viewer/replay-bodies.js` (`healSounds`) and
`viewer/replay-flights.js` (`updateSounds`) with stubbed players.
"""

# watches: tools/bf1942-models/viewer/replay-bodies.js tools/bf1942-models/viewer/replay-flights.js
# tools/bf1942-models/sim/env.mjs

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_replay_event_sounds.mjs")


class ReplayEventSoundTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
