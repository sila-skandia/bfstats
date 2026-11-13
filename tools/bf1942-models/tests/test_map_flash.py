"""`viewer/map-flash.js`: a radio speaker blinks yellow on the minimap.

Retail (gap audit 2026-11-12, entry 21): `Radio::outputRadioMessage` adds any
speaker but the local player to `MenuMapNode`'s flash list for
`Game.setRadioFlashTime` blinks. The shipped `Game.rfa` sets the count and the
blink in `Bf1942/Game/Init/Menu.con`: `Game.setRadioFlashTime 7`,
`Game.setPlayerBlink 1.0 2.0`. One clock blinks the whole list: lit while it
is at or under 1.0 s, and past 2.0 s every entry loses one and it restarts.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
HARNESS = Path(__file__).resolve().parent / "map_flash_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "map-flash.js", work / "map-flash.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MapFlashTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.out = run_harness()

    def test_the_shipped_values(self) -> None:
        o = self.out
        self.assertEqual(7, o["count"])
        self.assertEqual(1.0, o["on"])
        self.assertEqual(2.0, o["period"])
        self.assertEqual([255, 255, 0], o["tint"])

    def test_one_second_lit_in_a_two_second_cycle(self) -> None:
        o = self.out
        self.assertTrue(o["litAtStart"])
        self.assertFalse(o["otherLit"])
        self.assertTrue(o["litAtHalf"])
        self.assertFalse(o["litAtOneAndHalf"])
        self.assertTrue(o["litAfterCycle"])
        self.assertEqual(6, o["leftAfterCycle"])

    def test_seven_blinks_then_off_the_list(self) -> None:
        o = self.out
        self.assertEqual(6, o["relit"])
        self.assertAlmostEqual(14.0, o["goneAt"], delta=0.3)
        self.assertEqual("", o["keyEmpty"])

    def test_counts(self) -> None:
        o = self.out
        self.assertFalse(o["zero"])
        self.assertEqual(7, o["larger"])
        self.assertEqual(2, o["setCount"])
        self.assertIn("b", o["key"])

    def test_the_radio_and_the_map_use_it(self) -> None:
        comms = (VIEWER / "comms.js").read_text()
        self.assertIn("if (!listener && !speaker.local && speaker.key != null) mapFlash.add(speaker.key);", comms)
        friendlies = (VIEWER / "map-friendlies.js").read_text()
        self.assertIn("flash: mapFlash.lit(", friendlies)
        self.assertIn("mapFlash.updateAt(", friendlies)
        surfaces = (VIEWER / "map-surfaces.js").read_text()
        self.assertIn("flash ? FLASH_TINT", surfaces)


if __name__ == "__main__":
    unittest.main()
