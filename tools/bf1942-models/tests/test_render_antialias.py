"""`viewer/render-antialias.js` under node, through `render_antialias_harness.mjs`.

The map page's WebGL canvas gets MSAA except on an Intel GPU under Mesa
(Linux, ChromeOS), which locks up drawing the effect sprites into a 4x MSAA
target and takes Firefox down with it (features/intel-gpu-msaa-hang).
`?aa=0` turns MSAA off anywhere and `?aa=1` forces it on. Which GPU the page
is on comes from a throwaway context, read the way each browser answers.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "render_antialias_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RenderAntialiasTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def choice(self, key: str) -> dict:
        return self.results["choose"][key]

    def test_intel_under_mesa_draws_without_msaa(self) -> None:
        for key in ("linuxFirefoxIntel", "linuxChromeIntel", "chromeOSIntel"):
            with self.subTest(key):
                choice = self.choice(key)
                self.assertFalse(choice["antialias"])
                self.assertEqual(choice["reason"], "intel-mesa")
                self.assertEqual(choice["probes"], 1)
        # The console line names the GPU it turned MSAA off for.
        self.assertEqual(self.choice("linuxFirefoxIntel")["gpu"], "Intel(R) HD Graphics, or similar")

    def test_other_gpus_on_linux_keep_msaa(self) -> None:
        for key in ("linuxNvidia", "linuxAmd", "linuxSilent", "linuxProbeNull"):
            with self.subTest(key):
                self.assertTrue(self.choice(key)["antialias"])
                self.assertEqual(self.choice(key)["reason"], "default")

    def test_intel_off_mesa_keeps_msaa_without_probing(self) -> None:
        # Windows and macOS drive Intel through other drivers, where the hang
        # was never seen; Android says Linux but is not Mesa's Intel driver.
        for key in ("windowsIntel", "macIntel", "androidIntel", "emptyUa"):
            with self.subTest(key):
                choice = self.choice(key)
                self.assertTrue(choice["antialias"])
                self.assertEqual(choice["probes"], 0)

    def test_the_query_overrides_without_probing(self) -> None:
        on = self.choice("forcedOnIntel")
        self.assertEqual((on["antialias"], on["reason"], on["probes"]), (True, "aa=1", 0))
        off = self.choice("forcedOffWindows")
        self.assertEqual((off["antialias"], off["reason"], off["probes"]), (False, "aa=0", 0))
        # Any other value is no override: the page still picks.
        self.assertFalse(self.choice("otherValueIntel")["antialias"])

    def test_the_players_choice_beats_the_gpu_default(self) -> None:
        # OPTIONS > VIDEO (features/video-options): ticked on the GPU that
        # defaults to off, cleared on one that defaults to on. Neither probes.
        on = self.choice("storedOnIntel")
        self.assertEqual((on["antialias"], on["reason"], on["probes"]), (True, "stored", 0))
        off = self.choice("storedOffWindows")
        self.assertEqual((off["antialias"], off["reason"], off["probes"]), (False, "stored", 0))
        # `?aa` is the bench's knob and still wins.
        self.assertEqual(self.choice("queryOverStored")["reason"], "aa=0")

    def test_the_choice_is_kept_and_forgotten(self) -> None:
        stored = self.results["stored"]
        self.assertIsNone(stored["none"])
        self.assertEqual(stored["on"], {"value": True, "raw": "1"})
        self.assertEqual(stored["off"], {"value": False, "raw": "0"})
        # DEFAULT forgets it: the key goes, the GPU's default is back.
        self.assertEqual(stored["cleared"], {"value": None, "raw": None})
        self.assertIsNone(stored["junk"])

    def test_storage_that_throws_is_no_choice(self) -> None:
        self.assertIsNone(self.results["stored"]["blocked"])
        self.assertIsNone(self.results["stored"]["noStorage"])

    def test_probe_reads_each_browsers_answer(self) -> None:
        probe = self.results["probe"]
        # Firefox names the GPU family in RENDERER; the debug extension is not
        # touched (Firefox warns it is deprecated).
        self.assertEqual(probe["firefox"]["renderer"], "Intel(R) HD Graphics, or similar")
        # Chromium says "WebKit WebGL" there and the GPU through the extension.
        self.assertIn("Mesa Intel(R) Xe Graphics", probe["chrome"]["renderer"])
        self.assertEqual(probe["chrome"]["vendor"], "Google Inc. (Intel)")
        self.assertEqual(probe["chromeNoExtension"]["renderer"], "WebKit WebGL")
        self.assertEqual(probe["webgl1Only"]["vendor"], "Intel")

    def test_probe_is_cheap_and_let_go(self) -> None:
        probe = self.results["probe"]
        for key in ("firefox", "chrome", "webgl1Only"):
            with self.subTest(key):
                self.assertEqual(probe[key]["lost"], 1)
                self.assertTrue(all(c["antialias"] is False for c in probe[key]["contexts"]))

    def test_probe_never_throws(self) -> None:
        probe = self.results["probe"]
        for key in ("noContext", "throws"):
            with self.subTest(key):
                self.assertEqual((probe[key]["vendor"], probe[key]["renderer"]), ("", ""))


if __name__ == "__main__":
    unittest.main()
