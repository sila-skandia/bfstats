from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map_dossiers as dossiers  # noqa: E402


def files(**pages: str) -> dossiers.LevelFiles:
    """A LevelFiles holding exactly the con text given, keyed as the real one keys."""
    out = dossiers.LevelFiles()
    for key, text in pages.items():
        out._files[key.replace("__", "/")] = dossiers.strip_comments(text)
    return out


PLACEMENTS = """
Object.create AxisBase
Object.absolutePosition 1792/60/1792
Object.rotation 0/0/0
"""

TEMPLATES = """
ObjectTemplate.create ControlPoint AxisBase
ObjectTemplate.team 1
"""


class MapFrameTests(unittest.TestCase):
    """Which rectangle the minimap art covers.

    The art frames the level's active combat area, not the world. Most levels
    declare none and the two coincide — which is why `x / worldSize` passed for
    so long — but 142 of the 1018 installed levels declare a sub-world one and
    every marker lands wrong on those.
    """

    def test_no_declaration_spans_the_world(self) -> None:
        self.assertEqual(
            dossiers.map_frame(files(**{"init.con": ""}), 2048.0),
            (0.0, 0.0, 2048.0, 2048.0))

    def test_berlin_declares_a_quarter_of_its_world(self) -> None:
        frame = dossiers.map_frame(
            files(**{"init.con": "Game.setActiveCombatArea 1536 1536 512 512"}), 2048.0)
        self.assertEqual(frame, (1536.0, 1536.0, 512.0, 512.0))

    def test_declaration_is_origin_plus_size_not_two_corners(self) -> None:
        """Berlin's last two values are smaller than its first two.

        Read as corners that rectangle is inside out, so origin-plus-extent is
        the only reading that can be right.
        """
        frame = dossiers.map_frame(
            files(**{"init.con": "Game.setActiveCombatArea 1536 1536 512 512"}), 2048.0)
        min_x, min_z, size_x, size_z = frame
        self.assertEqual((min_x + size_x, min_z + size_z), (2048.0, 2048.0))

    def test_a_zero_sized_declaration_falls_back_to_the_world(self) -> None:
        """Guards the division in `parse_control_points`."""
        self.assertEqual(
            dossiers.map_frame(
                files(**{"init.con": "Game.setActiveCombatArea 0 0 0 0"}), 1024.0),
            (0.0, 0.0, 1024.0, 1024.0))

    def test_no_world_size_and_no_declaration_is_unplottable(self) -> None:
        self.assertIsNone(dossiers.map_frame(files(**{"init.con": ""}), None))

    def test_a_level_with_no_init_con(self) -> None:
        self.assertEqual(dossiers.map_frame(files(), 512.0), (0.0, 0.0, 512.0, 512.0))


class ControlPointProjectionTests(unittest.TestCase):
    def _point(self, frame, placements: str = PLACEMENTS) -> dict:
        return dossiers.parse_control_points(
            files(**{"conquest__controlpoints.con": placements,
                     "conquest__controlpointtemplates.con": TEMPLATES}),
            frame)[0]

    def test_world_framing(self) -> None:
        point = self._point((0.0, 0.0, 2048.0, 2048.0))
        self.assertEqual(point["x"], 0.875)
        self.assertEqual(point["y"], 0.125)      # z inverts: screen runs top-down

    def test_berlin_framing_moves_the_same_point(self) -> None:
        """The regression this exists for.

        `1792/60/1792` sits in the middle of Berlin's combat area, but under
        the world rule it reads as the top-right corner — which is where all
        four of Berlin's flags used to land, on featureless rubble.
        """
        point = self._point((1536.0, 1536.0, 512.0, 512.0))
        self.assertEqual(point["x"], 0.5)
        self.assertEqual(point["y"], 0.5)

    def test_corners_map_to_corners(self) -> None:
        frame = (360.0, 460.0, 1229.0, 1229.0)          # Liberation of Caen
        sw = self._point(frame, "Object.create AxisBase\nObject.absolutePosition 360/0/460\n")
        self.assertEqual((sw["x"], sw["y"]), (0.0, 1.0))
        ne = self._point(frame, "Object.create AxisBase\nObject.absolutePosition 1589/0/1689\n")
        self.assertEqual((ne["x"], ne["y"]), (1.0, 0.0))

    def test_a_point_outside_the_frame_is_clamped(self) -> None:
        point = self._point((1536.0, 1536.0, 512.0, 512.0),
                            "Object.create AxisBase\nObject.absolutePosition 0/0/0\n")
        self.assertEqual((point["x"], point["y"]), (0.0, 1.0))

    def test_no_frame_means_no_coordinates(self) -> None:
        """A level with no world size still lists its flags, just unplotted."""
        point = self._point(None)
        self.assertNotIn("x", point)
        self.assertNotIn("y", point)
        self.assertEqual(point["team"], 1)

    def test_team_comes_from_the_template(self) -> None:
        self.assertEqual(self._point((0.0, 0.0, 2048.0, 2048.0))["team"], 1)


CORAL_SEA_ROOT = """
Game.setNumberOfTickets 2 100
Game.setNumberOfTickets 1 100
Game.setTicketLostPerMin 2 1000
Game.setTicketLostPerMin 1 1000
"""

CORAL_SEA_GAMETYPES = """
Game.setNumberOfTickets 2 150
Game.setNumberOfTickets 1 100
Game.setTicketLostPerMin 2 5
Game.setTicketLostPerMin 1 15
"""


class TicketScriptTests(unittest.TestCase):
    """Which `Conquest.con` the tickets and the bleed are read from.

    The server runs the level's root script and only checks that
    `GameTypes/Conquest.con` exists (ledger TKT-3). The two disagree on 8
    vanilla and pack levels' tickets; Coral Sea is one, and the parity lab
    starts it at the root's 100 / 100.
    """

    @staticmethod
    def _numbers(level: dossiers.LevelFiles) -> list[tuple]:
        return [(t["tickets"], t["ticketLossPerMin"]) for t in dossiers.parse_teams(level)]

    def test_the_root_script_wins(self) -> None:
        self.assertEqual(
            self._numbers(files(**{"conquest.con": CORAL_SEA_ROOT,
                                   "gametypes__conquest.con": CORAL_SEA_GAMETYPES})),
            [(100, 1000), (100, 1000)])

    def test_gametypes_only_when_there_is_no_root_script(self) -> None:
        self.assertEqual(
            self._numbers(files(**{"gametypes__conquest.con": CORAL_SEA_GAMETYPES})),
            [(100, 15), (150, 5)])

    def test_a_root_script_that_sets_nothing_still_wins(self) -> None:
        """The engine runs it, so the GameTypes copy's numbers never apply."""
        self.assertEqual(
            self._numbers(files(**{"conquest.con": "rem no tickets here\n",
                                   "gametypes__conquest.con": CORAL_SEA_GAMETYPES})),
            [(None, None), (None, None)])

    def test_a_parents_root_script_beats_the_mods_own_gametypes_copy(self) -> None:
        """`Game::load` asks for `<level>/conquest.con`, and a mod that ships no
        such file gets its parent's copy of the level: the underlay."""
        level = files(**{"gametypes__conquest.con": CORAL_SEA_GAMETYPES})
        level.underlay(files(**{"conquest.con": CORAL_SEA_ROOT}))
        self.assertEqual(self._numbers(level), [(100, 1000), (100, 1000)])


class PlottableTests(unittest.TestCase):
    """`controlPointsPlottable` is the site's guard against a bad projection.

    It was doing real work: Berlin's flags all bunched into one corner under
    the world rule and the check correctly refused to draw them. With the
    combat-area frame they spread out and the map becomes plottable.
    """

    @staticmethod
    def _pts(coords):
        return [{"name": str(i), "x": x, "y": y} for i, (x, y) in enumerate(coords)]

    def test_bunched_in_a_corner_is_refused(self) -> None:
        self.assertFalse(dossiers.control_points_are_plottable(
            self._pts([(0.89, 0.13), (0.88, 0.04), (0.89, 0.09), (0.83, 0.13)])))

    def test_spread_across_the_frame_is_accepted(self) -> None:
        self.assertTrue(dossiers.control_points_are_plottable(
            self._pts([(0.56, 0.50), (0.51, 0.17), (0.57, 0.38), (0.32, 0.52)])))

    def test_no_placed_points_is_refused(self) -> None:
        self.assertFalse(dossiers.control_points_are_plottable([{"name": "a"}]))


if __name__ == "__main__":
    unittest.main()
