"""`extract_vehicle_ai.py`: the anti-aircraft flag is the unit's Armament.

`setIsAntiAircraft` sits on an `aiTemplatePlugIn` of kind Armament
(`AA_AlliesArmament`), never on a `weaponTemplate`. ConsoleClass550 (lnxded
0x08504dd0) writes it to `AITemplateArmament+0x5` and
`IPIArmamentReal::isAntiAircraft` (0x085e9b00) reads it back through the
unit's plug-in 4. The viewer used to look for it on the AI weapons, found it
on none, and every AA gun scored an aircraft as a non-AA gun does: not at all
past 150 m or above 15 m/s.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_vehicle_ai import control_info, is_anti_aircraft, parse_objects_con  # noqa: E402

AA_ALLIES = """
rem *** Plugins ***
aiTemplatePlugIn.create Unit AA_AlliesUnit
aiTemplatePlugIn.setStrategicStrength 1 2

aiTemplatePlugIn.create Armament AA_AlliesArmament
aiTemplatePlugIn.setIsAntiAircraft 1

aiTemplatePlugIn.create Physical AA_AlliesPhysical
aiTemplatePlugIn.setStrType LightArmour

aiTemplate.create AA_Allies
aiTemplate.addPlugIn AA_AlliesUnit
aiTemplate.addPlugIn AA_AlliesArmament
aiTemplate.addPlugIn AA_AlliesPhysical

aiTemplatePlugIn.create Armament ShermanArmament

aiTemplate.create Sherman
aiTemplate.addPlugIn ShermanArmament
"""


class AntiAircraftTests(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_objects_con(AA_ALLIES)

    def test_the_aa_guns_armament_is_anti_aircraft(self):
        self.assertTrue(is_anti_aircraft(self.parsed["templates"]["aa_allies"],
                                         self.parsed["plugIns"]))

    def test_an_armament_without_the_word_is_not(self):
        self.assertFalse(is_anti_aircraft(self.parsed["templates"]["sherman"],
                                          self.parsed["plugIns"]))

    def test_no_template_is_not(self):
        self.assertFalse(is_anti_aircraft(None, self.parsed["plugIns"]))


SHERMAN_TOP_MG = """
aiTemplatePlugIn.create ControlInfo ShermanTopMgCtrl
aiTemplatePlugIn.lookHorizontalControl      PIMouseLookX
aiTemplatePlugIn.lookVerticalControl        PIMouseLookY
rem aiTemplatePlugIn.pitchSensitivity           0.021817
aiTemplatePlugIn.pitchSensitivity           0.21817
aiTemplatePlugIn.rollSensitivity           -0.21817
aiTemplatePlugIn.pitchScale                 5.0
aiTemplatePlugIn.rollScale                  5.0
aiTemplatePlugIn.setCameraRelativeMinRotationDeg -360/-45/0
aiTemplatePlugIn.setCameraRelativeMaxRotationDeg 360/10/0

aiTemplatePlugIn.create ControlInfo DefGunCtrl
aiTemplatePlugIn.pitchScale                 0.1
aiTemplatePlugIn.rollScale                  0.1

aiTemplate.create ShermanTopMG
aiTemplate.addPlugIn ShermanTopMgCtrl

aiTemplate.create Defgun
aiTemplate.addPlugIn DefGunCtrl

aiTemplate.create Crate
"""


class ControlInfoTests(unittest.TestCase):
    """`mouseControlLookAtDirection` 0x08627b90 scales its counts by the
    seat's `pitchScale` / `rollScale` and signs them by the sensitivities."""

    def setUp(self):
        self.parsed = parse_objects_con(SHERMAN_TOP_MG)

    def test_the_seats_aim_numbers_and_camera_limits(self):
        c = control_info(self.parsed["templates"]["shermantopmg"], self.parsed["plugIns"])
        self.assertEqual(c["pitchSensitivity"], 0.21817)
        self.assertEqual(c["rollSensitivity"], -0.21817)
        self.assertEqual(c["pitchScale"], 5.0)
        self.assertEqual(c["rollScale"], 5.0)
        self.assertEqual(c["lookVerticalControl"], "PIMouseLookY")
        self.assertEqual(c["cameraMinDeg"], [-360.0, -45.0, 0.0])
        self.assertEqual(c["cameraMaxDeg"], [360.0, 10.0, 0.0])

    def test_a_gun_with_its_own_scale(self):
        c = control_info(self.parsed["templates"]["defgun"], self.parsed["plugIns"])
        self.assertEqual(c["pitchScale"], 0.1)
        self.assertEqual(c["rollScale"], 0.1)
        self.assertNotIn("pitchSensitivity", c)

    def test_a_template_without_one(self):
        self.assertIsNone(control_info(self.parsed["templates"]["crate"], self.parsed["plugIns"]))


if __name__ == "__main__":
    unittest.main()
