"""`viewer/server-entities.js`: a hull the SERVER stands plays its engine.

Neither path that draws other players' hulls on a live server claimed the
page's vehicle sound rack, so a bot's Corsair, Sherman or Daihatsu moved in
silence (the owner's report, 2026-10-22). A retail client does not simulate a
hull someone else drives: `setNetUpdate` (0x08227da0) writes the ghosted revs
back to `PhysicsEngine+0xa0`, and `Engine::updateSound` (0x0823e930) plays the
note from `|PhysicsEngine+0xa0|`. So the entity's drive answers the rack with
the revs the server sent and with the hull's drawn motion.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import test_server_engine_spin as spin  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "server_engine_voice_harness.mjs"


class ServerEngineVoiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        saved = spin.HARNESS
        spin.HARNESS = HARNESS
        try:
            cls.out = spin.run_harness()
        finally:
            spin.HARNESS = saved

    def test_a_parked_empty_hull_is_silent(self) -> None:
        self.assertEqual(self.out["parked"], [])

    def test_a_crewed_hull_claims_the_rack_once(self) -> None:
        """Boarding claims it with a running drive, and driving on does not
        claim it again."""
        self.assertEqual(self.out["boarded"], ["claim:server:560"])
        self.assertTrue(self.out["boardedRunning"])
        self.assertEqual(self.out["driving"]["claims"], 1)

    def test_the_note_follows_the_servers_revs(self) -> None:
        self.assertEqual(self.out["driving"]["rpm"], 0.77)

    def test_the_speed_is_the_drawn_motion(self) -> None:
        """Ten metres a second along x, smoothed over a tenth of a second."""
        self.assertAlmostEqual(self.out["driving"]["speed"], 10, delta=0.2)

    def test_a_hull_left_with_its_engine_stopped_is_released(self) -> None:
        """Released once, onto the rack's shut-down tail, and not running."""
        self.assertEqual(self.out["left"], ["claim:server:560", "release:server:560"])
        self.assertFalse(self.out["leftRunning"])

    def test_a_ship_astern_plays_the_magnitude(self) -> None:
        self.assertEqual(self.out["astern"], 0.312)

    def test_an_engine_turning_over_sounds_without_crew(self) -> None:
        self.assertEqual(self.out["windingDown"], ["claim:server:837"])

    def test_a_wreck_is_cut_at_once(self) -> None:
        self.assertEqual(self.out["wrecked"], ["claim:server:837", "cut:server vehicle 837 Corsair"])

    def test_a_hull_the_server_removes_takes_its_claim(self) -> None:
        self.assertEqual(self.out["removed"], ["claim:server:562", "release:server:562"])

    def test_the_hull_the_page_drives_is_not_voiced_here(self) -> None:
        self.assertEqual(self.out["ownDrive"], [])


if __name__ == "__main__":
    unittest.main()
