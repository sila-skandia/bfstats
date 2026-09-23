"""`viewer/seat-view.js` and `viewer/server-settings.js` under node.

Which views C reaches from a seat -- every seat, the driver's and the AA
gunner's alike -- gated by the seat Camera's own `CVM*` words and the two
server switches `ServerSettings.con` writes, and where an aircraft's nose cam
stands (`OutsideHudOffset`, surveyed straight out of `Objects.rfa`).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("seat_view_harness.mjs")
MODULES = {
    "seat-view.js": VIEWER / "seat-view.js",
    "server-settings.js": VIEWER / "server-settings.js",
}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SeatViewTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- the cycle -----------------------------------------------------------

    def test_the_order_is_inside_to_outside(self) -> None:
        self.assertEqual(["cockpit", "nose", "chase", "front", "flyby"],
                         self.results["order"])

    def test_the_mode_ids_are_the_engines_and_the_nose_is_mode_3(self) -> None:
        ids = self.results["modeIds"]
        self.assertEqual(3, ids["cockpit"])
        self.assertEqual(3, ids["nose"])
        self.assertEqual(12, ids["chase"])
        self.assertEqual(13, ids["front"])
        self.assertEqual(14, ids["flyby"])

    def test_a_seat_that_declares_nothing_gets_the_whole_cycle(self) -> None:
        # Every vanilla vehicle seat: the driver's, the passenger's, the AA
        # gunner's. `CameraTemplate::CameraTemplate()` seeds the four on.
        self.assertEqual(["cockpit", "chase", "front", "flyby"],
                         self.results["plainSeat"])

    def test_a_seat_with_a_nose_cam_gets_it_second(self) -> None:
        self.assertEqual(["cockpit", "nose", "chase", "front", "flyby"],
                         self.results["plainSeatWithNose"])

    def test_extern_trace_alone_does_not_narrow_the_cycle(self) -> None:
        # The ten artillery seats.
        self.assertEqual(["cockpit", "chase", "front", "flyby"],
                         self.results["externTraceOnly"])

    def test_a_locked_camera_cycles_nothing(self) -> None:
        # FinnWars' 67, and `SoldierCamera`'s shape.
        self.assertEqual(["cockpit"], self.results["lockedInside"])

    def test_one_word_off_drops_one_mode_any_case(self) -> None:
        self.assertEqual(["cockpit", "chase", "front"], self.results["noFlyby"])

    def test_external_views_off_leaves_the_inside_views(self) -> None:
        # `game.serverExternalViews 0`: the nose cam is not an external view.
        self.assertEqual(["cockpit", "nose"], self.results["externalViewsOff"])

    def test_nose_cam_off_leaves_the_external_views(self) -> None:
        # `game.serverAllowNoseCam 0`.
        self.assertEqual(["cockpit", "chase", "front", "flyby"],
                         self.results["noseCamOff"])

    def test_both_off_is_the_cockpit_alone(self) -> None:
        self.assertEqual(["cockpit"], self.results["bothOff"])

    # --- the nose cam ----------------------------------------------------------

    def test_the_table_is_every_aircraft_camera_in_the_installed_game(self) -> None:
        # 13 vanilla, 2 Road to Rome, 7 Secret Weapons: surveyed out of the
        # archives, and nothing but aircraft declares the word.
        self.assertEqual(22, self.results["noseCount"])
        table = self.results["noseCamTable"]
        self.assertEqual([0, -0.4, 4.45], table["CorsairCamera"])
        self.assertEqual([0, 0, 2.5], table["B17_Camera"])
        self.assertNotIn("ShermanCamera", table)

    def test_the_offset_is_z_mirrored_into_gltf(self) -> None:
        # Refractor +Z forward becomes glTF -Z, like every exported position.
        self.assertEqual([0, -0.4, -4.45], self.results["noseCorsair"])

    def test_the_lookup_is_case_insensitive_and_strips_the_instance_suffix(self) -> None:
        self.assertEqual([0, -0.4, -4.45], self.results["noseCorsairLower"])
        self.assertEqual([0, -0.4, -4.45], self.results["noseCorsairSuffixed"])

    def test_the_exporters_own_number_wins_over_the_table(self) -> None:
        self.assertEqual([0, 0, -2.5], self.results["noseDeclared"])

    def test_a_seat_without_the_word_has_no_nose_cam(self) -> None:
        self.assertIsNone(self.results["noseTank"])
        self.assertIsNone(self.results["noseNull"])

    # --- the server switches -----------------------------------------------------

    def test_the_defaults_are_the_shipped_server_settings(self) -> None:
        # `game.serverExternalViews 1`, `game.serverAllowNoseCam 1`, and the
        # page's own soldier switch on.
        self.assertEqual({"externalViews": True, "allowNoseCam": True,
                          "soldierExternalViews": True},
                         self.results["readDefaults"])

    def test_storage_is_read_and_junk_in_it_ignored(self) -> None:
        self.assertEqual({"externalViews": False, "allowNoseCam": True,
                          "soldierExternalViews": True},
                         self.results["readStored"])

    def test_the_query_string_wins_over_storage(self) -> None:
        self.assertEqual({"externalViews": True, "allowNoseCam": False,
                          "soldierExternalViews": False},
                         self.results["readParamsOverStored"])

    def test_the_old_foot3p_spelling_still_works(self) -> None:
        self.assertTrue(self.results["readFoot3pOldSpelling"]["soldierExternalViews"])

    def test_a_throwing_storage_reads_as_empty(self) -> None:
        self.assertEqual(self.results["readDefaults"], self.results["readBadStorage"])

    def test_truthy_params(self) -> None:
        t = self.results["truthy"]
        self.assertTrue(t["one"])
        self.assertTrue(t["empty"])      # `?foot3p` alone is on
        self.assertFalse(t["zero"])
        self.assertFalse(t["off"])
        self.assertFalse(t["no"])
        self.assertIsNone(t["missing"])

    def test_a_live_write_persists_fires_once_and_refuses_unknown_keys(self) -> None:
        live = self.results["live"]
        self.assertFalse(live["externalViews"])
        self.assertEqual([["externalViews", False]], live["fired"])
        self.assertEqual({"externalViews": False, "allowNoseCam": True,
                          "soldierExternalViews": True}, live["stored"])
        self.assertNotIn("nonsense", live["json"])


if __name__ == "__main__":
    unittest.main()
