"""`viewer/recording-inspect.js` under node, through `recording_inspect_harness.mjs`.

What the REPLAY feed's share dialog sends up for a recording that names no
level: the level recognised by its flags, and the tree it was recognised in.
On 2026-11-07 a Secret Weapons round (gb8ft8napv, Hellendoorn) went up as
`bf1942/hellendoorn`: the search found it in xpack2's tree but only the level
name was kept, so the feed looked for Hellendoorn in vanilla's tree and called
it not extracted.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "recording_inspect_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RecordingInspectTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_pack_level_goes_up_in_its_pack(self) -> None:
        self.assertEqual(self.results["packOnly"], {"level": "hellendoorn", "mod": "xpack2"})

    def test_a_vanilla_level_stays_vanilla(self) -> None:
        self.assertEqual(self.results["vanilla"], {"level": "tobruk", "mod": "bf1942"})


if __name__ == "__main__":
    unittest.main()
