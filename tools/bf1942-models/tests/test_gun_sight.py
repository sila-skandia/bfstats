"""A gun with no drivetrain shows its sight.

The owner's report (2026-10-12, Forgotten Hope and FHSW): the ground guns have
no sight, the PaK 40 and the Flak among them, where retail shows the shield
from the gunner's eye and, on the next view, the sight ring with its range
ladders. The sights were exported (`pak38.cockpit.glb` and its like) and
never fetched: only a `Vehicle` grafted a cockpit, and a hull with no
drivetrain (a PaK, a Flak, vanilla's Defgun and AA guns) is framed by a
`FixedSubject`, which had nothing to swap.

Run under node through `gun_sight_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "gun_sight_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class GunSightTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_every_seats_interior_is_grafted_under_its_own_host(self) -> None:
        graft = self.results["graft"]
        self.assertEqual(["pak38", "pak38Loader"], graft["swaps"])
        # The level's second PaK is `lodpak38Cockpit_1`; the glb spells it bare.
        self.assertEqual([True, True], graft["parents"])
        self.assertEqual([True, True], graft["marked"])

    def test_a_grafted_interior_waits_behind_its_exterior(self) -> None:
        # [gunner's interior, its exterior, loader's interior]
        self.assertEqual([False, True, False], self.results["graft"]["grafted"])

    def test_the_inside_view_shows_the_seats_own_interior_and_no_other(self) -> None:
        graft = self.results["graft"]
        self.assertEqual([True, False, False], graft["gunner"])
        self.assertEqual([False, True, True], graft["loader"])
        self.assertEqual([False, True, False], graft["outside"])

    def test_a_gun_fetches_the_glb_named_for_its_control(self) -> None:
        subject = self.results["subject"]
        self.assertEqual([[True, "pak38", "function"]], subject["asked"])
        self.assertTrue(subject["loaded"])

    def test_a_guns_sight_follows_its_view(self) -> None:
        subject = self.results["subject"]
        self.assertEqual([True, False, False], subject["inside"])
        self.assertEqual([False, True, False], subject["outside"])
        self.assertEqual([False, True, True], subject["loaderSeat"])

    def test_a_distance_selected_sight_draws_only_where_the_eye_reaches_it(self) -> None:
        near = self.results["near"]
        # [the ring, its exterior]
        self.assertEqual([False, True], near["seatEye"],
                         "the ring is not hung in front of the shield in the first view")
        self.assertEqual([True, False], near["sightEye"])
        self.assertEqual([False, True], near["outside"])
        self.assertEqual([True, False], near["noEye"])

    def test_a_gun_left_before_its_sight_lands_is_seen_from_outside(self) -> None:
        self.assertEqual([False, True], self.results["left"])

    def test_a_fetch_that_fails_costs_the_sight_alone(self) -> None:
        broken = self.results["broken"]
        self.assertIsNone(broken["threw"])
        self.assertIsNone(broken["got"])
        self.assertEqual(1, broken["warned"])
        self.assertEqual(0, broken["swaps"])


if __name__ == "__main__":
    unittest.main()
