"""A server recording's projectile flights in the round replay.

The server recorder writes every projectile's flight (`pn` names it, `pj`
places it each sample, `pd` ends it; features/server-replay-recorder), which
no client is sent for a shell or a rocket. replay-recording.js reads them
into `rec.flights` and links each to the `f` that fired it and the `i` (the
server's collision) that ended it, by time and place; replay-flights.js draws
the shells, rockets and bombs along them and the gun fires no round of its
own (features/replay-feature-sweep-2026-11-01, entry 2).

Run under node through `replay_flights_harness.mjs`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent / "replay_flights_harness.mjs"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class ReplayFlightTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    # --- parsing ---------------------------------------------------------------------

    def test_a_flight_runs_from_its_pn_to_its_pd(self) -> None:
        parsed = self.results["parsed"]
        self.assertEqual(parsed["hz"], 30)
        self.assertEqual(parsed["spans"][0], [10.002, 10.101])
        self.assertEqual(parsed["samples"][0], 3)

    def test_a_pooled_key_flies_more_than_once(self) -> None:
        parsed = self.results["parsed"]
        self.assertEqual(parsed["keys"][:2], [7, 7])
        self.assertEqual(parsed["spans"][1], [20.002, 20.068])

    def test_a_place_with_no_pn_is_a_flight_of_no_template(self) -> None:
        parsed = self.results["parsed"]
        self.assertEqual(parsed["keys"][4], 11)
        self.assertEqual(parsed["tmpls"][4], "")

    def test_a_flight_open_at_the_end_of_the_file_ends_with_it(self) -> None:
        self.assertEqual(self.results["parsed"]["spans"][5], [59.9, 60.0])

    def test_a_damaged_place_is_left_out_and_counted(self) -> None:
        self.assertEqual(self.results["parsed"]["count"], 6)
        self.assertEqual(self.results["parsed"]["skipped"], 1)

    def test_a_client_file_has_no_flights(self) -> None:
        self.assertEqual(self.results["client"], {"flights": 0, "shotFlight": None})

    # --- linking ---------------------------------------------------------------------

    def test_a_flight_links_to_the_shot_that_fired_it_both_ways(self) -> None:
        linked = self.results["linked"]
        self.assertTrue(linked["shellShot"])
        self.assertTrue(linked["againShot"])

    def test_a_fake_round_and_a_shot_along_another_line_fire_no_flight(self) -> None:
        linked = self.results["linked"]
        self.assertIsNone(linked["fakeShot"])
        self.assertFalse(linked["fakeHasFlight"])
        self.assertIsNone(linked["acrossShot"])
        self.assertFalse(linked["sidewaysHasFlight"])

    def test_the_impact_is_the_collision_from_the_flights_own_muzzle(self) -> None:
        # Two `i` at the end; the nearer names another gun's fire origin.
        linked = self.results["linked"]
        self.assertEqual(linked["shellImpactT"], 10.1)
        self.assertEqual(linked["shellImpactOrigin"], [100, 10, 100])
        self.assertTrue(linked["impactBack"])
        self.assertIsNone(linked["againImpact"])

    def test_the_links_stay_out_of_json_and_spreads(self) -> None:
        self.assertFalse(self.results["linked"]["fireJson"])
        self.assertFalse(self.results["linked"]["spread"])

    def test_the_drawn_path_runs_from_the_muzzle_to_the_impact(self) -> None:
        path = self.results["path"]
        self.assertEqual(path["keys"], 5)
        self.assertEqual(path["created"], 9.969)
        self.assertEqual(path["destroyed"], 10.1)
        self.assertEqual(path["atStart"], [100, 10, 100])
        self.assertEqual(path["atEnd"], [100, 10, 113])

    def test_a_flight_with_no_collision_ends_at_its_last_sample(self) -> None:
        path = self.results["path"]
        self.assertTrue(path["acrossKeys"])
        self.assertEqual(path["againDestroyed"], 20.035)
        self.assertEqual(path["openDestroyed"], 59.9)

    # --- the page's guns -------------------------------------------------------------

    def test_only_a_body_round_of_the_same_template_is_left_to_the_server(self) -> None:
        self.assertEqual(self.results["flies"], {
            "shell": True, "bullet": False, "otherRound": False, "noFlight": False, "client": False,
        })

    def test_the_gun_still_flashes_sounds_and_kicks(self) -> None:
        fired = self.results["fired"]
        self.assertEqual(fired["calls"], [["onShot", 1], ["flash", True]])
        self.assertTrue(fired["soundHeld"])
        self.assertEqual(fired["sinceRound"], 0)
        self.assertTrue(fired["kicked"])

    # --- drawing ---------------------------------------------------------------------

    def test_a_flight_is_placed_in_the_view_frame_nose_along_it(self) -> None:
        view = self.results["view"]
        self.assertEqual(view["at"], [100, 10, -106.6])
        self.assertEqual(view["heading"], [0, 0, -1])
        self.assertIsNone(view["before"])
        self.assertIsNone(view["after"])

    def test_a_round_stopped_on_its_last_sample_keeps_its_heading(self) -> None:
        # Without it the collision's surface was never looked for, and a
        # Panzershreck round into a Sherman played no effect.
        self.assertEqual(self.results["standing"], {"impact": True, "heading": [0, 0, -1]})

    def test_the_drawn_round_is_where_the_flight_is(self) -> None:
        drawn = self.results["drawn"]
        self.assertEqual(drawn["drawnCount"], 4)
        self.assertEqual(drawn["flagged"], [True, True, True, True, False, False])
        self.assertEqual(drawn["mid"], [{"tmpl": "ShermanProjectile", "at": [100, 10, -108.1]}])
        self.assertEqual(drawn["afterHit"], 0)

    def test_the_end_effect_plays_once_at_the_collision_and_not_across_a_seek(self) -> None:
        self.assertEqual(self.results["drawn"]["played"], [{"name": "e_ExplShell", "at": [100, 10, -113]}])

    def test_a_flak_shell_bursting_in_the_air_plays_its_end_of_life_effect(self) -> None:
        # No `i` records a proximity or clock burst; drawn without a shot,
        # the flight ends at its last sample, (0, 110, 0).
        self.assertEqual(self.results["flak"], [{"name": "e_FlakBig", "at": [0, 110, 0]}])

    def test_nodes_are_pooled_and_taken_down(self) -> None:
        self.assertEqual(self.results["drawn"]["nodes"], 1)
        self.assertEqual(self.results["drawn"]["afterDispose"], 0)


if __name__ == "__main__":
    unittest.main()
