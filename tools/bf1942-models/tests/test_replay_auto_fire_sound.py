"""Runs `test_replay_auto_fire_sound.mjs`: a replayed automatic burst is heard
every recorded round, from the first, over the live Fire Loop's span.

A self-contained node test over `viewer/world-fire.js`, `hand-fire-sound.js`
and `replay-bodies.js` (`primeReports`) with a stub Web Audio context, wrapped
so `unittest discover` (and therefore `verify.sh`) runs it.
"""

# watches: tools/bf1942-models/viewer/world-fire.js tools/bf1942-models/viewer/hand-fire-sound.js
# tools/bf1942-models/viewer/replay-bodies.js tools/bf1942-models/viewer/engine-audio.js
# tools/bf1942-models/viewer/sample-instances.js tools/bf1942-models/sim/env.mjs

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_replay_auto_fire_sound.mjs")


class ReplayAutoFireSoundTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
