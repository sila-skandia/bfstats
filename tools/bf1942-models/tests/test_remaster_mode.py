"""`viewer/remaster-mode.js` under node, through `remaster_mode_harness.mjs`.

The remaster (features/remaster-browser) is OPTIONS > VIDEO's REMASTER row:
off until the player ticks it, kept per browser. `?remaster` on the address
turns it on for one page and `?remaster=0` off, whatever is stored.
`map.html` makes the same choice in its first script, before any module can
load, because that is where the three build is picked.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "remaster_mode_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RemasterModeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_it_is_off_until_the_player_ticks_it(self) -> None:
        choose = self.results["choose"]
        self.assertFalse(choose["nothing"])
        self.assertTrue(choose["storedOn"])
        self.assertFalse(choose["storedOff"])
        # A page with no address and no storage (node): off.
        self.assertFalse(self.results["moduleDefault"])

    def test_the_address_wins_over_the_stored_choice(self) -> None:
        choose = self.results["choose"]
        self.assertTrue(choose["queryOn"])
        self.assertTrue(choose["queryOne"])
        self.assertFalse(choose["queryOff"])
        self.assertFalse(choose["queryOffOverStored"])
        self.assertTrue(choose["queryOnOverStored"])

    def test_nothing_turns_it_on_without_webgpu(self) -> None:
        self.assertEqual({"webgpu": True, "none": False, "noNavigator": False}, self.results["supported"])
        choose = self.results["choose"]
        self.assertFalse(choose["unsupportedStoredOn"])
        self.assertFalse(choose["unsupportedQueryOn"])
        inline = self.results["inline"]
        self.assertIsNone(inline["noWebgpuStoredOn"])
        self.assertIsNone(inline["noWebgpuQueryOn"])

    def test_the_choice_is_kept_under_its_own_key(self) -> None:
        stored = self.results["stored"]
        self.assertEqual("bf42-mesh-remaster", self.results["key"])
        self.assertIsNone(stored["none"])
        self.assertEqual({"value": True, "raw": "1"}, stored["on"])
        self.assertEqual({"value": False, "raw": "0"}, stored["off"])
        self.assertEqual({"value": None, "raw": None}, stored["cleared"])

    def test_a_bad_value_or_a_blocked_storage_is_no_choice(self) -> None:
        stored = self.results["stored"]
        self.assertIsNone(stored["junk"])
        self.assertIsNone(stored["blocked"])
        self.assertIsNone(stored["noStorage"])

    def test_the_pages_first_script_makes_the_same_choice(self) -> None:
        inline = self.results["inline"]
        webgpu = "./vendor/three-webgpu/three.webgpu.js"
        self.assertIsNone(inline["nothing"])
        self.assertEqual(webgpu, inline["storedOn"])
        self.assertIsNone(inline["storedOff"])
        self.assertEqual(webgpu, inline["queryOn"])
        self.assertIsNone(inline["queryOffOverStored"])
        self.assertIsNone(inline["blocked"])
        self.assertEqual(webgpu, inline["blockedQueryOn"])


if __name__ == "__main__":
    unittest.main()
