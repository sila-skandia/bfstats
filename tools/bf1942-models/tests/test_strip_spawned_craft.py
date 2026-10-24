"""A hull stood from a template's glb draws nothing its spawners field
(`viewer/spawned-craft.js` `stripSpawnedCraft`; `tests/strip_spawned_craft_harness.mjs`).
The Shokaku's Zero sat on her deck after the server's Zero had flown off it, so
a plane taken on the live page seemed to respawn at once (Wake, 2026-10-24)."""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "strip_spawned_craft_harness.mjs"


class StripSpawnedCraftTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(proc.stderr)
        cls.r = json.loads(proc.stdout)

    def test_the_carrier_loses_her_deck_planes_and_landing_craft(self) -> None:
        self.assertEqual(3, self.r["gone"])
        for name in ("Zero", "ZeroComplex", "AichiVal", "AichiValRearGunControl", "Daihatsu"):
            self.assertNotIn(name, self.r["kept"])

    def test_what_is_fixed_to_her_stays(self) -> None:
        for name in ("Scene", "Shokaku", "ShokakuComplex", "ShokakuAABattery1", "ShokakuEngine"):
            self.assertIn(name, self.r["kept"])

    def test_a_plane_of_its_own_keeps_itself(self) -> None:
        self.assertEqual(0, self.r["zeroGone"])
        self.assertEqual(["Scene", "Zero", "ZeroGunner"], self.r["zeroKept"])
        self.assertEqual(0, self.r["stampedGone"])
        self.assertEqual(["Scene", "Zero"], self.r["stampedKept"])


if __name__ == "__main__":
    unittest.main()
