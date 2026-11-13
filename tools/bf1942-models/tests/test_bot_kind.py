"""A bot flies a hull only when its AI template is an aircraft's (`tests/bot_kind_harness.mjs`).

Galactic Conquest's Speederbike hovers on `c_ETPlane` engines, so the page
drives it with its `Aircraft` class, and its AI template is vanilla's
`Willy`: a Car, typed ITGround. The bots took the hull's kind from its
drive, so a Speederbike's driver ran the plane law, whose takeoff run holds
the throttle open and the nose straight until the hull is airborne. The
bike never is. On GC_Mini_Wasteland every driver left the level in a
straight line and met the ground 525 m outside it at 107 m/s (3213 damage
on 25 hit points): 64 deaths by their own hand in eight seeded ten-minute
runner matches of 16 bots, 4 after the fix (bumps at the car law's speed).

Retail picks neither by the physics. The strategic order goes to
`orderAirBot` on the unit's ITAir type bit (`AIStrategicArea::orderBot`
0x08640760, AI-71), and the move is run by the plan interpreter of the
seat's equipment type (`AISettings::getPlanInterpreter` 0x08483db0, the
table `aiSettings.addInterpreterEntry <vehicle> <entry>` fills).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "bot_kind_harness.mjs"
BOT_UNITS = HERE.parent / "viewer" / "bot-units.js"


class BotKindTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout.strip().splitlines()[-1])

    def test_an_aircraft_drive_under_a_land_template_is_a_land_unit(self) -> None:
        self.assertEqual("ground", self.results["kinds"]["speederbike"])

    def test_an_aircraft_template_is_still_flown(self) -> None:
        self.assertEqual("air", self.results["kinds"]["spitfire"])

    def test_no_other_kind_moves(self) -> None:
        kinds = self.results["kinds"]
        self.assertEqual(["ground", "tank", "ship", "gun"], [kinds[k] for k in ("jeep", "tank", "ship", "gun")])

    def test_a_table_without_types_keeps_the_drive_kind(self) -> None:
        self.assertEqual("air", self.results["kinds"]["noTypes"])
        self.assertEqual("air", self.results["kinds"]["noRecord"])

    def test_a_land_unit_on_an_aircraft_drive_writes_the_air_channels(self) -> None:
        hover = self.results["hover"]
        self.assertAlmostEqual(0.8, hover["forwardKeys"])
        self.assertAlmostEqual(-0.5, hover["rudder"])
        self.assertEqual([0, 0], [hover["roll"], hover["pitch"]])

    def test_a_jeep_writes_only_the_land_pair(self) -> None:
        jeep = self.results["jeep"]
        self.assertAlmostEqual(0.8, jeep["forward"])
        self.assertAlmostEqual(-0.5, jeep["strafe"])
        self.assertNotIn("forwardKeys", jeep)
        self.assertNotIn("rudder", jeep)

    def test_a_pilot_writes_the_plane_laws_channels(self) -> None:
        pilot = self.results["pilot"]
        self.assertEqual([1, 0.25, -0.5, 0.75], [pilot[k] for k in ("forwardKeys", "rudder", "roll", "pitch")])
        self.assertEqual([0, 0], [pilot["forward"], pilot["strafe"]])

    def test_the_units_take_their_kind_through_it(self) -> None:
        # The candidates, the mount and the unit's information: no bot-facing
        # kind is read off the drive alone.
        source = BOT_UNITS.read_text()
        self.assertEqual(3, len(re.findall(r"= botKind\(", source)))
        self.assertIn("airframe: inst.rootKind === 'air'", source)


if __name__ == "__main__":
    unittest.main()
