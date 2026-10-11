"""Which cloth meshes a control point bakes (`extract_map.flag_cloth_variants`).

Retail swaps the whole mesh per owner (`setTeamGeometry <team> <mesh>`), so the
bake carries every mesh the template names, once each, and the viewer shows the
holder's (`viewer/flag-cloth-teams.js`, `tests/flag_cloth_swap_harness.mjs`).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.level import ControlPointTemplate  # noqa: E402
from extract_map import flag_cloth_variants  # noqa: E402


def template(**geometry) -> ControlPointTemplate:
    tpl = ControlPointTemplate(name="point")
    tpl.team_geometry = {int(k[1:]): v for k, v in geometry.items()}
    return tpl


class FlagClothVariantTests(unittest.TestCase):
    def test_the_starting_owners_mesh_is_the_main_and_the_other_side_an_alternate(self) -> None:
        main, alts = flag_cloth_variants(template(t1="flagge_m1", t2="flagfr_m1"), 2)
        self.assertEqual("flagfr_m1", main)
        self.assertEqual([("flagge_m1", (1,))], alts)

    def test_a_neutral_point_without_team_zero_geometry_has_no_main(self) -> None:
        main, alts = flag_cloth_variants(template(t1="flagge_m1", t2="flagit_m1"), 0)
        self.assertIsNone(main)
        self.assertEqual([("flagge_m1", (1,)), ("flagit_m1", (2,))], alts)

    def test_a_mesh_two_owners_wear_is_baked_once(self) -> None:
        main, alts = flag_cloth_variants(template(t0="flagso_m1", t1="flagso_m1", t2="flagus_m1"), 0)
        self.assertEqual("flagso_m1", main)
        self.assertEqual([("flagus_m1", (2,))], alts)

    def test_a_blank_owner_names_nothing(self) -> None:
        main, alts = flag_cloth_variants(template(t1="", t2="flagus_m1"), 1)
        self.assertIsNone(main)
        self.assertEqual([("flagus_m1", (2,))], alts)


if __name__ == "__main__":
    unittest.main()
