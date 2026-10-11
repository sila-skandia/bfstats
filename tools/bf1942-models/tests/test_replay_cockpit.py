"""A round replay's first-person cockpit is drawn unlit.

The owner's report (2026-10-11, the Secret Weapons round): "The hud looks very
green, but in the real game it's more of a grey HUD." The game HUD's bars are
the retail art to the pixel; what was green was the Flettner's interior. Its
texture (`Flettner_interior`) measures rgb(50,54,56), a dark grey, and the
replay drew it olive: the replay's camera grafted `<Template>.cockpit.glb`
with no `prepare` callback, so the interior stayed a lit material and the
level's hemisphere and sun tinted it. The page's own flown vehicles hand
`unlitCockpit` to `loadCockpit` (map.html `buildHullDrive`); the replay now
does the same through its context.

Run under node through `replay_cockpit_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_cockpit_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayCockpitTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_interior_is_handed_a_prepare_that_unlights_it(self) -> None:
        self.assertEqual(self.results["received"]["prepare"], "function")
        self.assertEqual(self.results["calls"][0], ["unlit", "cockpit-root"],
                         "unlit before it is warmed, so the first frame links the unlit program")
        self.assertEqual(self.results["calls"][1], ["warm", "cockpit-root"])

    def test_the_hull_is_looked_out_of(self) -> None:
        self.assertTrue(self.results["firstPerson"])

    def test_a_context_without_the_hook_still_loads_the_interior(self) -> None:
        self.assertIsNone(self.results["bare"]["threw"])
        self.assertEqual(self.results["bare"]["warmed"], 1)


if __name__ == "__main__":
    unittest.main()
