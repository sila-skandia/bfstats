"""A spawn into a seat (SPAWN-25) climbs in before the kit's weapon rig has
loaded, and the rig must land holstered whatever the seat: FHSWEurope Saipan's
B-29 turret, a seat with no drive, showed the kit's rifle over the gunner's
view. The live check is `audit_behaviour.mjs` `seatSpawnPhase` (cause
`spawn.seat-shows-kit`); this pins the two places the rig's visibility is
decided when its load lands."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"


class SeatSpawnRigTests(unittest.TestCase):
    def test_arms_rig_asks_one_seated_test_that_knows_a_holstered_weapon(self) -> None:
        src = (VIEWER / "arms-rig.js").read_text()
        self.assertRegex(src, r"const seated = \(\) => !!page\.holstered \|\|")
        # The drive-only test is the seated test's second half and nowhere else.
        self.assertEqual(1, src.count("page.optPilot?.checked && (page.aircraft || page.car)"))
        self.assertNotIn("!(page.optPilot.checked && (page.aircraft || page.car))", src)

    def test_the_hand_weapon_remembers_a_holster_and_publishes_hidden(self) -> None:
        src = (VIEWER / "hand-weapon.js").read_text()
        self.assertIn("soldierKit.holstered = true;", src)
        self.assertIn("soldierKit.holstered = false;", src)
        self.assertRegex(src, r"soldierKit\.handWeapon = hw;\s*(//[^\n]*\n\s*)*if \(soldierKit\.holstered\) rig\.visible = false;")
        self.assertIn("get holstered() { return !!soldierKit.holstered; }", src)


if __name__ == "__main__":
    unittest.main()
