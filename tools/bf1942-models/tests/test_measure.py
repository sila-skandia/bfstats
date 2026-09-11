from __future__ import annotations

import math
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import measure  # noqa: E402
from bf42.gltf import GlbBuilder, Node, Primitive, quat_from_ypr  # noqa: E402


def box(half_x: float, half_y: float, half_z: float) -> Primitive:
    """An axis-aligned box centred on the origin, as a POSITION-bearing primitive."""
    corners = [
        (x, y, z)
        for x in (-half_x, half_x)
        for y in (-half_y, half_y)
        for z in (-half_z, half_z)
    ]
    return Primitive(positions=corners, indices=[0, 1, 2])


def write(builder: GlbBuilder, roots: list[int]) -> Path:
    path = Path(tempfile.mkdtemp()) / "measured.glb"
    path.write_bytes(builder.build(roots))
    return path


class BoundsTests(unittest.TestCase):
    def test_a_single_box_measures_its_own_extent(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("hull", [box(3.0, 1.0, 0.75)])
        root = builder.add_node(Node(name="Hull", mesh=mesh))

        bounds = measure.bounds(write(builder, [root]))

        self.assertAlmostEqual(6.0, bounds["length"], places=3)
        self.assertAlmostEqual(1.5, bounds["width"], places=3)
        self.assertAlmostEqual(2.0, bounds["height"], places=3)
        self.assertAlmostEqual(9.0, bounds["footprint"], places=3)

    def test_length_is_the_longer_ground_axis_whichever_it_is(self) -> None:
        # Same box turned across the other horizontal axis measures the same.
        builder = GlbBuilder()
        mesh = builder.add_mesh("hull", [box(0.75, 1.0, 3.0)])
        root = builder.add_node(Node(name="Hull", mesh=mesh))

        bounds = measure.bounds(write(builder, [root]))

        self.assertAlmostEqual(6.0, bounds["length"], places=3)
        self.assertAlmostEqual(1.5, bounds["width"], places=3)

    def test_a_child_offset_extends_the_box(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("part", [box(1.0, 1.0, 1.0)])
        child = builder.add_node(Node(name="Turret", translation=(0.0, 4.0, 0.0), mesh=mesh))
        root = builder.add_node(Node(name="Hull", mesh=mesh, children=[child]))

        bounds = measure.bounds(write(builder, [root]))

        # -1 from the hull up to +5 on top of the raised child.
        self.assertAlmostEqual(6.0, bounds["height"], places=3)
        self.assertAlmostEqual(2.0, bounds["length"], places=3)

    def test_a_rotated_child_sweeps_its_corners(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("barrel", [box(4.0, 0.1, 0.1)])
        turned = builder.add_node(
            Node(name="Barrel", rotation=quat_from_ypr(90.0, 0.0, 0.0), mesh=mesh))
        root = builder.add_node(Node(name="Hull", children=[turned]))

        bounds = measure.bounds(write(builder, [root]))

        # A yaw of 90 degrees puts the 8 m barrel across the other ground axis;
        # either way the longer horizontal extent is still 8 m.
        self.assertAlmostEqual(8.0, bounds["length"], places=2)
        self.assertAlmostEqual(0.2, bounds["width"], places=2)

    def test_collision_nodes_are_not_part_of_the_silhouette(self) -> None:
        builder = GlbBuilder()
        visible = builder.add_mesh("hull", [box(1.0, 1.0, 1.0)])
        hull = builder.add_mesh("hit", [box(10.0, 10.0, 10.0)])
        hit = builder.add_node(Node(name="ShermanCollision0", mesh=hull))
        root = builder.add_node(Node(name="Hull", mesh=visible, children=[hit]))

        bounds = measure.bounds(write(builder, [root]))

        self.assertAlmostEqual(2.0, bounds["length"], places=3)

    def test_radius_is_half_the_box_diagonal(self) -> None:
        builder = GlbBuilder()
        mesh = builder.add_mesh("hull", [box(1.5, 2.0, 3.0)])
        root = builder.add_node(Node(name="Hull", mesh=mesh))

        bounds = measure.bounds(write(builder, [root]))

        expected = math.dist((0, 0, 0), (3.0, 4.0, 6.0)) / 2
        self.assertAlmostEqual(expected, bounds["radius"], places=3)

    def test_a_file_that_is_not_a_glb_measures_nothing(self) -> None:
        path = Path(tempfile.mkdtemp()) / "not.glb"
        path.write_bytes(b"nope")
        self.assertIsNone(measure.bounds(path))

    def test_a_missing_file_measures_nothing(self) -> None:
        self.assertIsNone(measure.bounds(Path("/nonexistent/model.glb")))

    def test_a_scene_with_no_geometry_measures_nothing(self) -> None:
        builder = GlbBuilder()
        root = builder.add_node(Node(name="Empty"))
        self.assertIsNone(measure.bounds(write(builder, [root])))


if __name__ == "__main__":
    unittest.main()
