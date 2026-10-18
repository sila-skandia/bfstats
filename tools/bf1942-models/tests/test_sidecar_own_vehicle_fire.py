"""The second tracer: the control-object state the server sends the controller
carries the seat's FireArms counter, and `GhostWriter._fires` turns its step
down into a `k:"f"` round for the OWN hull -- which the live page must not draw,
because it already fired that round from its own prediction (the retail client
draws its own vehicle round and uses the control state only to reconcile its
gun). `net-room.js` `isOwnVehicleShot` is what skips it live; the recording
keeps every `f` for replay."""
import json
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class OwnVehicleFireTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        out = subprocess.run(["node", str(HERE / "sidecar_own_vehicle_fire_harness.mjs")],
                             capture_output=True, text=True, check=True)
        cls.r = json.loads(out.stdout)

    def test_the_own_hull_control_record_emits_a_round(self):
        # The source of the owner's second Sherman tracer: a step down on the
        # control record (his own hull) writes a k:"f" round.
        self.assertEqual(self.r["control"]["n"], 1)
        self.assertEqual(self.r["control"]["gun"], "ShermanGunBarrel")
        self.assertEqual(self.r["control"]["id"], 100)

    def test_a_remote_hull_emits_the_same_round(self):
        # A remote's fire is a genuine draw signal (the page cannot predict it),
        # so the `f` is right there -- the page tells the two apart by the firer
        # and the hull it controls, not by dropping the row at the sidecar.
        self.assertEqual(self.r["remote"]["n"], 1)
        self.assertEqual(self.r["remote"]["gun"], "ShermanGunBarrel")


if __name__ == "__main__":
    unittest.main()
