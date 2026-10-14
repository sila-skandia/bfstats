"""`extract_collision_meshes.py` `collect_part_mobility`: which vehicle parts
write `hasMobilePhysics 1` (ledger HP-21: only those meet the sea)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_collision_meshes import collect_part_mobility  # noqa: E402


def template(name, geometry=None, mobile=False, children=()):
    return NS(name=name, geometry=geometry, has_mobile_physics=mobile,
              children=[NS(template=c) for c in children], source="objects/vehicles/x.con")


class PartMobilityTests(unittest.TestCase):
    def setUp(self) -> None:
        objs = {t.name.lower(): t for t in [
            template("Catfish", mobile=True, children=["lodCatfish", "Catfish_floater_m1", "Catfish_Wheel"]),
            template("lodCatfish", children=["CatfishCockpitExternal"]),
            template("CatfishCockpitExternal", geometry="catfish_hull_m1"),
            template("Catfish_floater_m1", geometry="catfish_floater_m1"),
            template("Catfish_Wheel", geometry="wheel_m1", mobile=True),
        ]}
        self.library = NS(objects=objs, object=lambda n: objs.get(n.lower()))

    def test_a_static_part_with_geometry_is_0_and_a_mobile_one_1(self) -> None:
        table = collect_part_mobility(self.library, [self.library.object("Catfish")])
        self.assertEqual(0, table["catfish_floater_m1"])
        self.assertEqual(1, table["catfish_wheel"])
        self.assertEqual(0, table["catfishcockpitexternal"])

    def test_a_template_without_geometry_is_not_listed(self) -> None:
        table = collect_part_mobility(self.library, [self.library.object("Catfish")])
        self.assertNotIn("catfish", table)
        self.assertNotIn("lodcatfish", table)


if __name__ == "__main__":
    unittest.main()
