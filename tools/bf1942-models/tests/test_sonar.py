"""The sonar and radar scope: `viewer/sonar.js`, driven headless by
`sonar_harness.mjs`, and the con words and table behind it
(`bf42/con.py`, `extract_vehicle_sonar.py`).

The rules are the engine's: what a SonarObject senses is
`SonarObject::getSensedObjects` (lnxded 0x08321e20), the sweep and its dots
the sonar pass of the client's `BfMap::update` (BF1942.exe 0x0046d47e).
Ledger SONAR-1..SONAR-7; `features/vehicle-radar`.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import extract_vehicle_sonar as evs  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402

VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("sonar_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(VIEWER / "sonar.js", work / "sonar.js")
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SonarScopeTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_a_sonar_senses_what_is_level_or_below_within_its_radius(self) -> None:
        self.assertEqual(["below", "level", "edgeBelow", "edgeWide"], self.r["sonar"])

    def test_a_radar_senses_what_is_level_or_above(self) -> None:
        self.assertEqual(["level", "above"], self.r["radar"])

    def test_the_bearing_runs_clockwise_from_west(self) -> None:
        b = self.r["bearing"]
        self.assertAlmostEqual(math.pi * 0.25, b["northWest"])
        self.assertAlmostEqual(math.pi * 0.75, b["northEast"])
        self.assertAlmostEqual(math.pi * 1.25, b["southEast"])
        self.assertAlmostEqual(math.pi * 1.75, b["southWest"])
        self.assertAlmostEqual(0.0, b["nearWest"], places=2)
        self.assertAlmostEqual(math.pi / 2, b["nearNorth"], places=2)

    def test_an_object_on_a_cardinal_line_is_never_lit(self) -> None:
        self.assertIsNone(self.r["bearing"]["dueNorth"])
        self.assertIsNone(self.r["bearing"]["dueEast"])
        self.assertEqual(0, self.r["cardinalLit"])

    def test_the_sweep_lights_a_dot_as_it_passes_and_the_dot_lasts_half_a_turn(self) -> None:
        s = self.r["sweep"]
        turn = 2 * math.pi / s["speed"]
        # North-east is 3/8 of a turn from west.
        self.assertAlmostEqual(turn * 3 / 8, s["litAt"], delta=1.5)
        self.assertAlmostEqual(1 - s["fade"], s["peak"])
        self.assertAlmostEqual(turn / 2, s["goneAt"] - s["litAt"], delta=1.5)
        # The next pass lights it again, one turn (and the wrap's step) later.
        self.assertAlmostEqual(turn, s["relitAt"] - s["litAt"], delta=2.5)
        self.assertAlmostEqual(turn, s["wrappedAt"], delta=2.5)

    def test_the_sweep_keeps_its_own_rate(self) -> None:
        self.assertAlmostEqual(60, self.r["pacing"]["perSecondAt144Hz"], delta=1)
        self.assertEqual(15, self.r["pacing"]["afterAStall"])

    def test_only_a_sonar_seat_of_the_hull_gets_the_scope(self) -> None:
        seat = self.r["seat"]
        self.assertEqual(400, seat["pilot"])
        self.assertIsNone(seat["pantsyrDriver"])
        self.assertTrue(seat["pantsyrRadar"])
        self.assertIsNone(seat["noTable"])
        self.assertIsNone(seat["otherHull"])


def library(text: str) -> ObjectLibrary:
    lib = ObjectLibrary()
    lib.add_con("Objects/Vehicles/Test/Objects.con", text)
    return lib


CON = """
ObjectTemplate.create SonarObject TestSonar
ObjectTemplate.detectionRadius 400.0

ObjectTemplate.create SonarObject TestRadar
ObjectTemplate.detectionRadius 700.0
ObjectTemplate.enableRadarMode 1
ObjectTemplate.scanForEnemySonars c_True

ObjectTemplate.create SonarObject TestBareSonar

ObjectTemplate.create PlayerControlObject TestJet
ObjectTemplate.sonarPos 1
ObjectTemplate.addTemplate TestSonar

ObjectTemplate.create PlayerControlObject TestGunSeat
ObjectTemplate.sonarPos 1

ObjectTemplate.create PlayerControlObject TestFlak
ObjectTemplate.addTemplate TestGunSeat
ObjectTemplate.addTemplate TestRadar
ObjectTemplate.addTemplate TestSonar

ObjectTemplate.create PlayerControlObject TestGunship
ObjectTemplate.sonarPos 1

ObjectTemplate.create PlayerControlObject TestDeaf
ObjectTemplate.addTemplate TestBareSonar
"""


class SonarTableTests(unittest.TestCase):
    lib: ObjectLibrary

    @classmethod
    def setUpClass(cls) -> None:
        cls.lib = library(CON)

    def test_the_con_reader_keeps_the_four_words(self) -> None:
        radar = self.lib.object("TestRadar")
        self.assertEqual(700.0, radar.detection_radius)
        self.assertTrue(radar.enable_radar_mode)
        self.assertTrue(radar.scan_for_enemy_sonars)
        self.assertIsNone(self.lib.object("TestSonar").enable_radar_mode)
        self.assertTrue(self.lib.object("TestJet").sonar_pos)
        self.assertIsNone(self.lib.object("TestFlak").sonar_pos)

    def test_a_hull_with_a_sonar_seat_and_a_sonar_gets_an_entry(self) -> None:
        self.assertEqual(
            {"template": "TestJet", "sonar": "TestSonar", "radius": 400.0,
             "radarMode": False, "scanForEnemySonars": False, "seats": ["TestJet"]},
            evs.sonar_entry(self.lib, "TestJet"))

    def test_the_first_sonar_under_the_hull_is_the_scope_and_a_nested_seat_counts(self) -> None:
        entry = evs.sonar_entry(self.lib, "TestFlak")
        self.assertEqual("TestRadar", entry["sonar"])
        self.assertTrue(entry["radarMode"])
        self.assertEqual(["TestGunSeat"], entry["seats"])

    def test_a_seat_without_a_sonar_or_a_sonar_without_a_seat_draws_nothing(self) -> None:
        self.assertIsNone(evs.sonar_entry(self.lib, "TestGunship"))
        self.assertIsNone(evs.sonar_entry(self.lib, "TestDeaf"))
        self.assertIsNone(evs.sonar_entry(self.lib, "NoSuchHull"))

    def test_an_unwritten_radius_is_the_templates_fifty(self) -> None:
        lib = library(CON + "\nObjectTemplate.create PlayerControlObject TestDefault\n"
                      "ObjectTemplate.sonarPos 1\nObjectTemplate.addTemplate TestBareSonar\n")
        self.assertEqual(50.0, evs.sonar_entry(lib, "TestDefault")["radius"])


if __name__ == "__main__":
    unittest.main()
