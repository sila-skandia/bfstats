"""Runs `test_remaster_audio.mjs`: the remaster spatial chain's laws and wiring.

`viewer/remaster-audio-law.js` (air absorption, reverb send, surroundings
classifier, the passing round's crack timing, the generated impulse
responses) and `viewer/remaster-audio.js` (the chain behind a panner), only
ever installed under `?remaster` (features/remaster-browser, AUDIO.md). The
node suite is wrapped here so `unittest discover`, and therefore
`verify.sh`, runs it.
"""

from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("test_remaster_audio.mjs")


class RemasterAudioNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
