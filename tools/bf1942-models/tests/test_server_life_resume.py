"""A page that joins while the server already has its player alive.

The sidecar stays connected to the server across a page reload, so the
server's soldier never dies; the reloaded page must take that life up where
it stands rather than open the spawn screen (a real server ignores a spawn
request from a live player, and the page stood a body with the screen's kit
at the server's position: Engineer on the page, Anti-Tank on the server).
`viewer/server-life.js` holds the decisions, driven headless by
`server_life_harness.mjs`. The laws:

* a resume is a live row with a pose, on a page with no body, a world up,
  not flying, not mid-request and with no life yet on this level -- a seated
  row resumes too (the seat is taken by the seated path that follows);
* the kit template maps to the deploy row by the level's own slots for the
  player's side, case-insensitively; a kit not his side's row is a carried
  (picked-up) kit filed under the row of its class; an unknown one is null;
* the life is filed under the nearest land flag of his side with spawns;
* `net-sidecar.js` keeps the pickup's kit net id, so a kit object that comes
  after its `pickupKit` (the order of the sidecar's mid-life snapshot) still
  names the kit, and keeps it once read.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "server_life_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ServerLifeResumeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_reloaded_page_resumes_a_live_server_soldier(self) -> None:
        decide = self.results["decide"]
        self.assertIs(True, decide["reload"])
        self.assertIs(True, decide["seated"])

    def test_the_normal_spawn_paths_are_left_alone(self) -> None:
        decide = self.results["decide"]
        for case in ("dead", "noRow", "hasBody", "asked", "waiting", "joined", "pilot",
                     "notReady", "noPose"):
            with self.subTest(case=case):
                self.assertIs(False, decide[case])

    def test_the_kit_is_the_servers(self) -> None:
        kit = self.results["kit"]
        self.assertEqual({"row": "antitank", "kit": "UsMarine_AT", "carried": False}, kit["ownAT"])
        self.assertEqual({"row": "engineer", "kit": "USMarine_Engineer", "carried": False}, kit["ownCase"])
        self.assertEqual({"row": "scout", "kit": "Jap_Scout", "carried": False}, kit["axisScout"])

    def test_a_picked_up_kit_is_carried_under_its_class(self) -> None:
        kit = self.results["kit"]
        self.assertEqual({"row": "medic", "kit": "Jap_Medic", "carried": True}, kit["pickedUpEnemy"])
        self.assertEqual({"row": "engineer", "kit": "German_Engineer", "carried": True}, kit["otherLevelKit"])

    def test_an_unknown_kit_maps_to_nothing(self) -> None:
        kit = self.results["kit"]
        self.assertIsNone(kit["unknown"])
        self.assertIsNone(kit["none"])
        self.assertIsNone(kit["noFile"])

    def test_the_life_is_filed_under_the_nearest_land_flag_of_his_side(self) -> None:
        flag = self.results["flag"]
        self.assertEqual(2, flag["allied"])   # Village, not the nearer carrier or capture point
        self.assertEqual(0, flag["axis"])     # his own side's, though the Airfield is nearer
        self.assertEqual(-1, flag["none"])
        self.assertEqual(0, flag["onlyShip"])

    def test_a_kit_object_after_its_pickup_still_names_the_kit(self) -> None:
        sidecar = self.results["sidecar"]
        self.assertIsNone(sidecar["beforeObject"])
        self.assertEqual("UsMarine_AT", sidecar["afterObject"])
        self.assertEqual("UsMarine_AT", sidecar["afterDespawn"])
        self.assertEqual("USMarine_Engineer", sidecar["secondPickup"])


if __name__ == "__main__":
    unittest.main()
