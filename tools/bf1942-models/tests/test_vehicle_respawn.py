"""A pad's hull after a respawn (`viewer/vehicle-wrecks.js` `respawnVehicle`,
`viewer/level-statics.js` `parkVehicle` and `stepVehiclePads`,
`viewer/hull-bodies.js` `syncVehicleSpawnOwnership`, `viewer/aircraft.js`
`aircraftSpec`), driven headless by `vehicle_respawn_harness.mjs`.

The engine's respawn is a fresh object at the ObjectSpawner (ledger SPAWN-28),
gear down (PHY-25), and not while a live human on foot stands within 2 m of
the point (SPAWN-14). The page reuses the old hull's node, so it has to put
the node back as the level placed it. Feedback #7 (a hull anyone had driven
came back invisible but enterable) and #9 (a plane shot down gear-up came back
gear-up and was measured into the ground), features/browser-play-feedback-
2026-11-06.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("vehicle_respawn_harness.mjs")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout.strip().splitlines()[-1])


class VehicleRespawnTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_driven_hull_comes_back_drawn_on_its_pad(self) -> None:
        r = self.results["respawn"]
        self.assertTrue(r["atLoad"]["tankShown"])
        self.assertTrue(r["atLoad"]["planeShown"])
        # Driving takes it out of `spawners` (Vehicle's constructor).
        self.assertEqual("level", r["driven"]["tankParent"])
        self.assertEqual("level", r["driven"]["planeParent"])
        after = r["after"]
        # The wreck cleared and the pad dropped it before the delay ran out.
        self.assertTrue(after["hiddenWhileGone"])
        # 20 s from the death, not from the wreck's clearing (SPAWN-10, SPAWN-11).
        self.assertAlmostEqual(20.0, after["respawnedAt"], delta=0.1)
        self.assertEqual([True, True], after["live"])
        self.assertEqual("spawners", after["tankParent"])
        self.assertEqual("spawners", after["planeParent"])
        self.assertTrue(after["tankShown"], "the respawned tank is not drawn")
        self.assertTrue(after["planeShown"], "the respawned plane is not drawn")
        self.assertEqual(0, after["tankOnPad"])
        self.assertEqual(0, after["planeOnPad"])
        self.assertEqual([100, 100], after["hp"])
        self.assertEqual([True, True], after["frozen"])

    def test_every_rigged_part_is_back_at_its_rest(self) -> None:
        after = self.results["respawn"]["after"]
        self.assertTrue(after["gearAtRest"])
        self.assertTrue(after["elevatorAtRest"])
        self.assertTrue(after["turretAtRest"])
        self.assertTrue(after["wheelAtRest"])

    def test_a_respawned_plane_stands_on_the_gear_it_had_at_load(self) -> None:
        r = self.results["respawn"]
        self.assertEqual(1.8, r["atLoad"]["clearance"])
        self.assertEqual(r["atLoad"]["clearance"], r["driven"]["flightClearance"])
        self.assertEqual(r["atLoad"]["clearance"], r["after"]["nextClearance"])
        self.assertEqual(r["atLoad"]["wheelAnchorY"], r["after"]["nextWheelAnchorY"])

    def test_a_plane_parked_gear_up_is_surveyed_at_rest(self) -> None:
        r = self.results["parkedGearUp"]
        self.assertEqual(r["restClearance"], r["gearUpClearance"])
        self.assertEqual(r["restAnchorY"], r["gearUpAnchorY"])
        # The survey leaves the pose it found.
        self.assertTrue(r["poseKept"])

    def test_a_pad_waits_for_the_human_to_step_off(self) -> None:
        r = self.results["clearance"]
        # SPAWN-14: a land hull is held back while he stands within 2 m ...
        self.assertFalse(r["held"]["tankBack"])
        # ... a sea hull is not.
        self.assertTrue(r["held"]["boatBack"])
        # 3 m off, the hull stands on the pad's next frame.
        self.assertTrue(r["stepsOff"]["tankBack"])
        self.assertTrue(r["tankShown"])


if __name__ == "__main__":
    unittest.main()
