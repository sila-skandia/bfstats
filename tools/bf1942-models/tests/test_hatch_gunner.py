"""A tank's hatch gunner can be shot, driven headless by
`hatch_gunner_harness.mjs` (browser-play feedback #6, 2026-11-06: "sometimes
you can't kill the machinegun guy on the tank").

The rule is the engine's (ledger SEAT-37,
bf1942_lnxded.static): `SeatObject::enter` 0x083208d0 parents the soldier to
the seat and calls `setUseSeat` but never sets object flag bit 0, the one bit
that keeps a soldier out of the round's contact test, so every seat that
reaches a SeatObject leaves its man hittable. A seat with none (a tank's
driver) is entered by `PlayerControlObject::enter` 0x08316f00, which sets it
(`updateFlags(1, 0)` at 0x08317372). `c_SeatShowHalfBodySoldier` only makes
`setUseSeat` 0x08271950 disable the `Bip01 Pelvis` bone tree: the legs go,
the torso stays out of the hatch, and
`SkeletonCollisionMesh::getDistanceToGeometry` 0x083aeb10 tests its capsules
like any other. The page used to answer no body for every half-body seat,
so every tank's hatch MG gunner was unkillable, by the human and by the bots.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).with_name("hatch_gunner_harness.mjs")

HALF_BODY = ("Chi-ha_BrowningSeat", "ShermanBrowningSeat", "PanzerIVBrowningSeat")
WHOLE_BODY = ("HanomagMG42Seat", "WillySeat")
TORSO = ["Bip01_Head", "Bip01_Spine2", "Bip01_L_Forearm", "Bip01_R_Forearm"]
LEGS = ["Bip01_L_Calf", "Bip01_R_Calf", "Bip01_L_Foot", "Bip01_R_Foot"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class HatchGunnerTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def seat(self, name: str) -> dict:
        return self.results["seats"][name]

    # --- a bot in the seat ------------------------------------------------------

    def test_a_hatch_gunner_is_drawn_as_half_a_body(self) -> None:
        for name in HALF_BODY:
            with self.subTest(seat=name):
                self.assertTrue(self.seat(name)["drawn"])
                self.assertTrue(self.seat(name)["halfBody"])

    def test_a_hatch_gunner_is_a_target(self) -> None:
        for name in HALF_BODY + WHOLE_BODY:
            with self.subTest(seat=name):
                self.assertIsNotNone(self.seat(name)["body"])

    def test_a_bots_round_kills_a_hatch_gunner(self) -> None:
        for name in HALF_BODY + WHOLE_BODY:
            with self.subTest(seat=name):
                self.assertEqual({"target": "gunner", "damage": 40}, self.seat(name)["botChest"])

    def test_the_humans_round_meets_his_chest_and_his_head(self) -> None:
        for name in HALF_BODY + WHOLE_BODY:
            with self.subTest(seat=name):
                chest = self.seat(name)["humanChest"]
                head = self.seat(name)["humanHead"]
                self.assertEqual(("gunner", "Bip01_Spine2", 41, True),
                                 (chest["target"], chest["bone"], chest["material"], chest["seated"]))
                self.assertEqual(("gunner", "Bip01_Head", 40),
                                 (head["target"], head["bone"], head["material"]))

    def test_the_hull_face_stops_a_round_before_him(self) -> None:
        # `roundBodyCast` counts only a body nearer than what the collider met.
        for name in HALF_BODY + WHOLE_BODY:
            with self.subTest(seat=name):
                self.assertIsNone(self.seat(name)["humanChestBehindHull"])

    def test_a_half_body_keeps_its_torso_capsules_and_loses_its_legs(self) -> None:
        for name in HALF_BODY:
            with self.subTest(seat=name):
                self.assertEqual(TORSO, self.seat(name)["capsules"])
        for name in WHOLE_BODY:
            with self.subTest(seat=name):
                self.assertEqual(TORSO + LEGS, self.seat(name)["capsules"])

    def test_hidden_legs_do_not_stand_out_round_his_waist(self) -> None:
        # The scale that hides the legs folds their capsules onto the pelvis,
        # at the hatch rim; kept, they would meet a round under the torso.
        for name in HALF_BODY:
            with self.subTest(seat=name):
                self.assertIsNone(self.seat(name)["humanBelowTorso"])
                self.assertEqual("Bip01_L_Calf", self.seat(name)["legsKeptBelowTorso"]["bone"])
        # A whole body's legs are where his seat's clip puts them.
        self.assertEqual("Bip01_L_Calf", self.seat("WillySeat")["humanBelowTorso"]["bone"])

    def test_a_tank_driver_is_neither_drawn_nor_hit(self) -> None:
        driver = self.seat("ShermanDriver")
        self.assertFalse(driver["drawn"])
        self.assertIsNone(driver["body"])
        self.assertEqual([], driver["capsules"])
        for shot in ("botChest", "humanChest", "humanHead", "humanBelowTorso"):
            with self.subTest(shot=shot):
                self.assertIsNone(driver[shot])

    # --- his seat's body still loading ---------------------------------------------

    def test_while_his_body_loads_he_is_the_stand_in_on_his_seat(self) -> None:
        loading = self.results["loading"]["ShermanBrowningSeat"]
        # The sphere's centre (one metre over the feet) on the SeatObject.
        self.assertEqual({"x": 0, "y": 1, "z": 0}, loading["body"])
        self.assertIsNone(loading["capsules"])
        self.assertEqual({"target": "gunner", "damage": 40}, loading["botChest"])

    def test_a_driver_stays_out_of_reach_while_loading(self) -> None:
        loading = self.results["loading"]["ShermanDriver"]
        self.assertIsNone(loading["body"])
        self.assertIsNone(loading["botChest"])

    # --- the human in the hatch ---------------------------------------------------

    def test_a_bot_can_shoot_the_human_out_of_a_hatch(self) -> None:
        drawn = self.results["human"]["drawn"]
        self.assertIsNotNone(drawn["body"])
        self.assertEqual(TORSO, drawn["capsules"])
        self.assertEqual({"target": "local", "damage": 40}, drawn["botChest"])

    def test_the_human_is_a_stand_in_on_his_seat_while_it_loads(self) -> None:
        loading = self.results["human"]["loading"]
        self.assertEqual({"x": 0, "y": 1, "z": 0}, loading["body"])
        self.assertEqual({"target": "local", "damage": 40}, loading["botChest"])


if __name__ == "__main__":
    unittest.main()
