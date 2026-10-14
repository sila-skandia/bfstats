"""A mode static seated in a heightmap cut also stands in a layer that would
otherwise leave the cut open (`extract_map.py` `cut_cover_modes`). A deliberate
departure from retail on the owner's request: FHSWEurope Omaha Charlie sector's
CoOp places none of the Conquest trenches that cover its 42 m pits
(`features/fhswe-mechanics-audit`, "Omaha Charlie sector")."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
from bf42.level import HEIGHT_UNITS, Heightmap, StaticInstance  # noqa: E402


def heightmap_with_pit(dim=64, spacing=4.0, ground=42.0, pit=(20, 28)) -> Heightmap:
    """Flat ground with a square pit cut to 0 over cells pit[0]..pit[1]."""
    scale = 65535.0 / (HEIGHT_UNITS * 1.0)
    samples = []
    for iz in range(dim):
        for ix in range(dim):
            inside = pit[0] <= ix <= pit[1] and pit[0] <= iz <= pit[1]
            samples.append(0 if inside else int(ground * scale))
    return Heightmap(dim=dim, spacing=spacing, y_scale=1.0, samples=samples)


def info(static_objects=()):
    return SimpleNamespace(modes={"Conquest": None, "SinglePlayer": None},
                           static_objects=list(static_objects))


def trench(x, z, y=40.0):
    return StaticInstance(template="sw_trench", position=(x, y, z), rotation=(0, 0, 0))


class CutCoverModesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.hm = heightmap_with_pit()

    def test_a_trench_seated_in_a_pit_another_layer_leaves_open_stands_there_too(self) -> None:
        out, widened = extract_map.cut_cover_modes(info(), self.hm, None,
                                                   [(trench(96, 96), ["Conquest"])])
        self.assertEqual(1, widened)
        self.assertIsNone(out[0][1])

    def test_a_static_on_flat_ground_keeps_its_layer(self) -> None:
        out, widened = extract_map.cut_cover_modes(info(), self.hm, None,
                                                   [(trench(200, 200, y=42.0), ["Conquest"])])
        self.assertEqual(0, widened)
        self.assertEqual(["Conquest"], out[0][1])

    def test_a_static_flying_over_a_pit_is_not_seated_in_it(self) -> None:
        out, widened = extract_map.cut_cover_modes(info(), self.hm, None,
                                                   [(trench(96, 96, y=60.0), ["Conquest"])])
        self.assertEqual(0, widened)

    def test_a_cut_the_other_layer_covers_itself_is_left_alone(self) -> None:
        mode_statics = [(trench(96, 96), ["Conquest"]), (trench(96, 96), ["SinglePlayer"])]
        out, widened = extract_map.cut_cover_modes(info(), self.hm, None, mode_statics)
        self.assertEqual(0, widened)
        self.assertEqual(["Conquest"], out[0][1])

    def test_a_shared_static_over_the_cut_covers_every_layer(self) -> None:
        out, widened = extract_map.cut_cover_modes(info([trench(96, 96)]), self.hm, None,
                                                   [(trench(96, 96), ["Conquest"])])
        self.assertEqual(0, widened)

    def test_a_single_layer_level_is_untouched(self) -> None:
        one = SimpleNamespace(modes={"Conquest": None}, static_objects=[])
        out, widened = extract_map.cut_cover_modes(one, self.hm, None,
                                                   [(trench(96, 96), ["Conquest"])])
        self.assertEqual(0, widened)


if __name__ == "__main__":
    unittest.main()
