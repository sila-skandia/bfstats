"""A player who mans a stationary gun in a round replay of a mod level.

The 2026-10-11 report on a Secret Weapons + Road to Rome round: "at 0:11 they
enter a machine gun, and their player model entirely disappears" -- and the
gun with it, and in first person there was no HUD. A replay built each hull
from `<models root>/<Template>.glb` with the mod's own root alone, and a mod's
model tree holds what the mod adds or changes. The Stationary MG42, the flak
gun, the AA mount, the Willy and every hand weapon of that round are vanilla's
files: a 404 under `models/mods/xpack2/` (401 of the 415 templates the two
trees share, on the published site). No model, no hull; no hull, no seat for
the soldier, no sight for the camera and no gun for the HUD.

`replay_manned_gun_harness.mjs` is one node run over the viewer's own modules:
a mod tree that holds only what the mod adds, and every manned emplacement of
the three trees entered by a soldier through the page's hull, body, camera
and HUD modules.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_manned_gun_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MannedGunFallbackTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_template_the_mod_tree_lacks_is_vanillas(self) -> None:
        names = self.results["fallback"]["names"]
        # The mod's own file, vanilla's file where the mod has none (and at
        # vanilla's own catalogue's variant for the level), its wreck the same
        # way, and nothing where neither tree has it.
        self.assertEqual(names[0], "models/mods/xpack2/Flettner.glb")
        self.assertEqual(names[1], "models/Stationary_mg42.Raid_on_Agheila.glb")
        self.assertEqual(names[2], "models/flak38.glb")
        self.assertEqual(names[3], "models/Stationary_mg42.wreck.glb")
        self.assertIsNone(names[4])

    def test_the_mods_tree_is_asked_first(self) -> None:
        fallback = self.results["fallback"]
        self.assertEqual(fallback["flettnerFrom"], ["models/mods/xpack2/Flettner.glb?cb=1"])
        self.assertEqual(fallback["modelUrls"], ["models/mods/xpack2/flak38.glb", "models/flak38.glb"])
        # A vanilla page has the one root.
        self.assertEqual(fallback["vanillaOnly"], ["models/flak38.glb"])

    def test_a_hand_weapon_of_a_mod_round_is_vanillas(self) -> None:
        self.assertTrue(self.results["handGun"]["loaded"])
        self.assertEqual(self.results["handGun"]["urls"],
                         ["models/mods/xpack2/Colt.glb?cb=1", "models/Colt.glb?cb=1"])


class MannedGunEmplacementTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()["emplacements"]
        if cls.results.get("skipped"):
            raise unittest.SkipTest("the model trees are not on this machine")

    def rows(self) -> list[dict]:
        return self.results["rows"]

    def test_every_emplacement_is_built_into_a_hull_and_crewed(self) -> None:
        self.assertGreaterEqual(len(self.rows()), 9)
        for row in self.rows():
            with self.subTest(row["tmpl"]):
                self.assertTrue(row["model"], "no model: the gun and its gunner are not drawn")
                self.assertTrue(row["hull"]["visible"])
                self.assertEqual(row["hull"]["kind"], "gun")
                self.assertEqual(row["hull"]["crew"], 1)
                self.assertEqual(row["actor"]["vehicle"], row["tmpl"])
                self.assertTrue(row["actor"]["seated"])

    def test_the_gunner_is_drawn_where_the_seat_draws_one(self) -> None:
        expected = self.results["expected"]
        for row in self.rows():
            with self.subTest(row["tmpl"]):
                if expected[row["tmpl"]]["body"]:
                    self.assertTrue(row["body"]["seated"], "the gunner is not drawn in his seat")
                    self.assertTrue(row["body"]["visible"])
                    self.assertEqual(row["body"]["half"], bool(expected[row["tmpl"]].get("half")))
                else:
                    # SEAT-25: a seat with no SeatObject draws nobody (the
                    # Defgun's, the radar towers', the Wasserfall's).
                    self.assertFalse(row["body"]["seated"])

    def test_first_person_is_the_seat_camera_and_the_guns_hud(self) -> None:
        for row in self.rows():
            with self.subTest(row["tmpl"]):
                self.assertEqual(row["pov"]["sight"], "seat")
                self.assertEqual(row["pov"]["hud"], "seat")
                self.assertGreaterEqual(row["pov"]["guns"], 1)
                self.assertTrue(row["pov"]["atEye"], "the camera is not at the seat's own camera")


if __name__ == "__main__":
    unittest.main()
