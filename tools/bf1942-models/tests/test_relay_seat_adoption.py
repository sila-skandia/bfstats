"""A seat a real server gives the player, taken by the page.

Two live reports of 2026-11-14, both on Secret Weapons levels through the
relay, both with the same look: the player seated by the server and the page
drawing him with his own weapon in hand.

- Peenemunde, the Calliope (`Sherman_T34`): from the wheel to the rocket seat
  (`Sherman_T34_PCO1`, a nested PlayerControlObject the server sends as an
  object of its own, class Seat, no template), the page showed the rockets'
  ammo box and the Bar1918 in hand. The seat is taken on the server's hull
  when that hull is up (`net-room.js` `adoptServerSeat`, from the frame's
  `syncHulls`), after the frame had sampled him on foot, and the frame's foot
  camera then ran once more: `footFire` showed the holstered rifle and nothing
  hid it again. `local-player.js` `frameCameras` reads the seat as it stands.
- Mimoyecques, the Axis R75 motorbikes: the bake stands the Allies' HD_XA42 on
  their pads and the page adds the R75 as the pads' other side
  (`level-statics.js` `loadPadVariants`), a copy no scene index names, so the
  server's R75 had nothing to bind and the page kept him on foot.
  `relay-copies.js` names those copies.

The page half runs under node (`relay_seat_adoption_harness.mjs`), loading the
viewer's modules in place (`sim/env.mjs`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "relay_seat_adoption_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class RelaySeatAdoptionTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_cameras_follow_a_seat_taken_inside_the_step(self) -> None:
        cams = self.r["cameras"]
        self.assertEqual(["foot"], cams["onFoot"])
        # Sampled on foot, seated by the step: the seat's camera, never the
        # foot camera whose `footFire` shows the hand weapon.
        self.assertEqual(["seat"], cams["seatedInStep"])
        self.assertEqual(["foot"], cams["leftInStep"])

    def test_a_seat_sent_as_its_own_object_is_its_hulls(self) -> None:
        seat = self.r["seat"]
        self.assertEqual({"inVehicle": True, "vehicleId": 541, "seatIndex": 0}, seat["driver"])
        # 542 is the Calliope's second seat: the hull 541 below it, place 1.
        self.assertEqual({"inVehicle": True, "vehicleId": 541, "seatIndex": 1}, seat["rockets"])
        self.assertFalse(seat["isHull542"])

    def test_a_pads_other_side_vehicle_is_a_copy_a_server_hull_binds(self) -> None:
        copies = self.r["copies"]
        # The baked node keeps its scene index; each R75 the page added gets a
        # name; the pool's mould and a ship's second craft (bound by its
        # baked craft's slot, `heldSlotsOf`) do not.
        self.assertEqual([["17", "HD_XA42"], ["variant:0", "R75"], ["variant:1", "R75"], ["pool:0", "Stuka"]],
                         copies["relay"])
        self.assertEqual(["17", "variant:0", "variant:1", "pool:0"], copies["stable"])
        # A room names a pad's vehicle by its pad: its index stays the scene's.
        self.assertEqual([["3", "Willy"]], copies["room"])


if __name__ == "__main__":
    unittest.main()
