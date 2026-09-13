"""Baked propeller spin and seat-camera recovery.

An Engine template is not an animation clip: the game integrates throttle into
a rotation every frame. The extractor bakes that behaviour into a looping glTF
clip so any viewer can play it, and it must pick the right parts — the
propeller LodObject, never the landing gear that shares the same Engine parent
(`hasMobilePhysics 1` marks those as separate physics bodies).
"""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report, engine_spin_axes  # noqa: E402
from bf42.con import ObjectLibrary, ObjectTemplate, vec3_lenient  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402


def glb_document(data: bytes) -> dict:
    json_size, json_kind = struct.unpack_from("<II", data, 12)
    if json_kind != 0x4E4F534A:
        raise AssertionError("GLB does not start with a JSON chunk")
    return json.loads(data[20:20 + json_size].decode("utf-8"))


def read_accessor_vec4(document: dict, blob: bytes, accessor_index: int):
    accessor = document["accessors"][accessor_index]
    view = document["bufferViews"][accessor["bufferView"]]
    offset = view.get("byteOffset", 0)
    return [
        struct.unpack_from("<4f", blob, offset + 16 * i)
        for i in range(accessor["count"])
    ]


def glb_blob(data: bytes) -> bytes:
    json_size, = struct.unpack_from("<I", data, 12)
    bin_offset = 20 + json_size
    bin_size, bin_kind = struct.unpack_from("<II", data, bin_offset)
    if bin_kind != 0x004E4942:
        raise AssertionError("GLB has no BIN chunk")
    return data[bin_offset + 8:bin_offset + 8 + bin_size]


class YprMatrixTests(unittest.TestCase):
    """`ypr_matrix` must be the matrix twin of `quat_from_ypr`.

    Spin keyframes are authored as Refractor-space matrices and pass through
    `quat_from_matrix`; the node's static pose passes through `quat_from_ypr`.
    If the two conversions disagree, a clip's first frame visibly snaps.
    """

    def test_matrix_and_quaternion_paths_agree(self) -> None:
        for yaw, pitch, roll in [
            (0.0, 0.0, 0.0), (90.0, 0.0, 0.0), (0.0, -90.0, 0.0),
            (0.0, 0.0, 45.0), (-179.999, 0.0, 0.0), (30.0, -60.0, 120.0),
        ]:
            expected = gltf.quat_from_ypr(yaw, pitch, roll)
            actual = gltf.quat_from_matrix(gltf.ypr_matrix(yaw, pitch, roll))
            # Quaternions double-cover: q and -q are the same rotation.
            flip = 1.0 if sum(e * a for e, a in zip(expected, actual)) >= 0 else -1.0
            for e, a in zip(expected, actual):
                self.assertAlmostEqual(e, flip * a, places=5,
                                       msg=f"ypr={yaw}/{pitch}/{roll}")


class ConParsingTests(unittest.TestCase):
    def test_mobile_physics_and_continuous_rotation_are_read(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Air/Test/Objects.con",
            """
ObjectTemplate.create LandingGear GearLeft
ObjectTemplate.hasMobilePhysics 1

ObjectTemplate.create SimpleObject ParkedRotor
ObjectTemplate.setContinousRotationSpeed 0/0/3000
""",
        )
        self.assertTrue(library.object("GearLeft").has_mobile_physics)
        self.assertFalse(library.object("ParkedRotor").has_mobile_physics)
        self.assertEqual((0.0, 0.0, 3000.0),
                         library.object("ParkedRotor").continuous_rotation)

    def test_lenient_vector_pads_missing_components(self) -> None:
        # Vanilla's RadarBun_tower_M1 declares `15/0/` — a trailing empty
        # component the engine reads as zero.
        self.assertEqual((15.0, 0.0, 0.0), vec3_lenient("15/0/"))
        self.assertEqual((5.0, 0.0, 0.0), vec3_lenient("5"))


class EngineSpinAxesTests(unittest.TestCase):
    def _engine(self, minimum, maximum, speed, inputs) -> ObjectTemplate:
        engine = ObjectTemplate(name="TestEngine", kind="Engine")
        engine.min_rotation = minimum
        engine.max_rotation = maximum
        engine.max_speed = speed
        engine.inputs = inputs
        return engine

    def test_aircraft_rate_span_spins_at_declared_speed(self) -> None:
        engine = self._engine((-0.3, 0.0, -3000.0), (0.3, 0.0, 5000.0),
                              (1000.0, 0.0, 500.0), {"roll": "c_PIThrottle"})
        self.assertEqual({"roll": 500.0}, engine_spin_axes(engine))

    def test_helicopter_tail_with_degenerate_span_still_spins(self) -> None:
        # EoD tail rotors declare min == max (100/100): no usable span, but
        # the throttle binding is the tell.
        engine = self._engine((0.0, 0.0, 100.0), (0.0, 0.0, 100.0),
                              (0.0, 0.0, 10000.0), {"roll": "c_PIThrottle"})
        axes = engine_spin_axes(engine)
        self.assertIn("roll", axes)
        # 10000 deg/s aliases into noise on screen; clamped for display.
        self.assertEqual(1080.0, axes["roll"])

    def test_tank_body_lean_never_spins(self) -> None:
        # Sherman-style: throttle bound over a +/-1 degree lean span. Spinning
        # it would orbit the whole running gear around the hull.
        engine = self._engine((-1.0, 0.0, -1.0), (1.0, 0.0, 1.0),
                              (10.0, 0.0, 10.0),
                              {"yaw": "c_PIYaw", "roll": "c_PIThrottle"})
        self.assertEqual({}, engine_spin_axes(engine))

    def test_free_mouse_look_axis_is_not_a_propeller(self) -> None:
        engine = self._engine(None, None, (90.0, 0.0, 0.0),
                              {"yaw": "c_PIMouseLookX"})
        self.assertEqual({}, engine_spin_axes(engine))

    def test_non_engine_kinds_never_spin(self) -> None:
        turret = ObjectTemplate(name="Turret", kind="RotationalBundle")
        turret.min_rotation = (0.0, 0.0, -3000.0)
        turret.max_rotation = (0.0, 0.0, 5000.0)
        turret.inputs = {"roll": "c_PIThrottle"}
        self.assertEqual({}, engine_spin_axes(turret))


PLANE_CON = """
ObjectTemplate.create Bundle PlaneComplex
ObjectTemplate.addTemplate PlaneCamera
ObjectTemplate.setPosition 0.028/1.202/0.04
ObjectTemplate.addTemplate PlaneEngine
ObjectTemplate.setPosition 0.02/0.446/4.149

ObjectTemplate.create Camera PlaneCamera
ObjectTemplate.setInputToYaw c_PIMouseLookX
ObjectTemplate.setInputToPitch c_PIMouseLookY

ObjectTemplate.create Engine PlaneEngine
ObjectTemplate.addTemplate lodPlanePropeller
ObjectTemplate.setPosition 0.02/0.024/0
ObjectTemplate.addTemplate PlaneLandingGear
ObjectTemplate.setPosition -1.42/-0.665/-1.702
ObjectTemplate.setMinRotation -0.3/0/-3000
ObjectTemplate.setMaxRotation 0.3/0/5000
ObjectTemplate.setMaxSpeed 1000/0/500
ObjectTemplate.setInputToRoll c_PIThrottle

ObjectTemplate.create LodObject lodPlanePropeller
ObjectTemplate.addTemplate PlanePropellerStatic
ObjectTemplate.addTemplate PlanePropellerBlurred

ObjectTemplate.create SimpleObject PlanePropellerStatic
ObjectTemplate.geometry Plane_prp1

ObjectTemplate.create SimpleObject PlanePropellerBlurred
ObjectTemplate.geometry Plane_prp2

ObjectTemplate.create LandingGear PlaneLandingGear
ObjectTemplate.geometry Plane_wheel
ObjectTemplate.hasMobilePhysics 1

GeometryTemplate.create StandardMesh Plane_prp1
GeometryTemplate.create StandardMesh Plane_prp2
GeometryTemplate.create StandardMesh Plane_wheel
"""


def assemble(library: ObjectLibrary, root: str,
             resolvable: list[str]) -> tuple[dict, bytes, Report]:
    """Run the real tree walk with pre-seeded mesh caches (no archives)."""
    pool = ArchivePool()
    assembler = Assembler(pool, pool, pool, library)
    builder = gltf.GlbBuilder()
    triangle = gltf.Primitive(
        positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        indices=[0, 1, 2])
    for geometry_name in resolvable:
        mesh_index = builder.add_mesh(geometry_name, [triangle])
        assembler._geom_mesh[geometry_name.lower()] = (mesh_index, 1)
        assembler._geom_collisions[geometry_name.lower()] = []
    report = Report(root=root, configuration="complex", lod=0)
    node = assembler.build_node(builder, root, report)
    assert node is not None
    assembler._flush_spin_animations(builder)
    glb = builder.build([node], extras=report.as_dict())
    return glb_document(glb), glb_blob(glb), report


class PropellerBakeTests(unittest.TestCase):
    def test_prop_spins_and_landing_gear_does_not(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Plane/Objects.con", PLANE_CON)
        document, blob, report = assemble(
            library, "PlaneComplex", ["Plane_prp1", "Plane_wheel"])

        animations = document.get("animations", [])
        self.assertEqual(1, len(animations))
        self.assertEqual("spin", animations[0]["name"])

        targets = {channel["target"]["node"]
                   for channel in animations[0]["channels"]}
        names = {document["nodes"][node]["name"] for node in targets}
        self.assertEqual({"lodPlanePropeller"}, names)
        self.assertEqual(
            ["lodPlanePropeller roll 500 deg/s (from PlaneEngine)"],
            report.animated_parts)

    def test_clip_rotates_a_quarter_turn_about_the_prop_axis(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Plane/Objects.con", PLANE_CON)
        document, blob, _ = assemble(
            library, "PlaneComplex", ["Plane_prp1", "Plane_wheel"])

        animation = document["animations"][0]
        rotation_channel = next(
            channel for channel in animation["channels"]
            if channel["target"]["path"] == "rotation")
        sampler = animation["samplers"][rotation_channel["sampler"]]
        quaternions = read_accessor_vec4(document, blob, sampler["output"])

        # 500 deg/s -> full turn in 0.72 s, keys every quarter turn; the
        # first and last keys are the same orientation (a clean loop) and the
        # middle key is a half turn about Z, unchanged by the Z-mirror.
        self.assertEqual(5, len(quaternions))
        for expected, actual in zip((0.0, 0.0, 0.0, 1.0), quaternions[0]):
            self.assertAlmostEqual(expected, actual, places=5)
        half = quaternions[2]
        self.assertAlmostEqual(1.0, abs(half[2]), places=5)
        self.assertAlmostEqual(0.0, half[0], places=5)
        self.assertAlmostEqual(0.0, half[1], places=5)

    def test_continuous_rotation_bakes_without_an_engine(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/StationaryObjects/Test/Objects.con",
            """
ObjectTemplate.create SimpleObject RadarDish
ObjectTemplate.geometry Radar_M1
ObjectTemplate.setContinousRotationSpeed 15/0/

GeometryTemplate.create StandardMesh Radar_M1
""",
        )
        document, _, report = assemble(library, "RadarDish", ["Radar_M1"])
        self.assertEqual(1, len(document.get("animations", [])))
        # 15 deg/s -> 24 s per revolution.
        times_accessor = document["accessors"][
            document["animations"][0]["samplers"][0]["input"]]
        self.assertAlmostEqual(24.0, times_accessor["max"][0], places=4)
        self.assertEqual(["RadarDish continuous yaw 15 deg/s"],
                         report.animated_parts)


class CameraExportTests(unittest.TestCase):
    def test_camera_nodes_survive_with_their_seat_scope(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Tank/Objects.con",
            """
ObjectTemplate.create PlayerControlObject Tank
ObjectTemplate.addTemplate TankHull
ObjectTemplate.addTemplate TankCamera
ObjectTemplate.setPosition 0.1/1.5/0.25
ObjectTemplate.addTemplate TankMG_PCO

ObjectTemplate.create SimpleObject TankHull
ObjectTemplate.geometry Tank_Hull_M1

ObjectTemplate.create Camera TankCamera
ObjectTemplate.setInputToYaw c_PIMouseLookX

ObjectTemplate.create PlayerControlObject TankMG_PCO
ObjectTemplate.addTemplate TankCamera2
ObjectTemplate.setPosition 0/0.3/0.5
ObjectTemplate.setRotation -179.999/0/0

ObjectTemplate.create Camera TankCamera2
ObjectTemplate.setInputToYaw c_PIMouseLookX

GeometryTemplate.create StandardMesh Tank_Hull_M1
""",
        )
        document, _, report = assemble(library, "Tank", ["Tank_Hull_M1"])

        cameras = {node["name"]: node for node in document["nodes"]
                   if (node.get("extras") or {}).get("cameraView")}
        self.assertEqual({"TankCamera", "TankCamera2"}, set(cameras))
        self.assertEqual("Tank",
                         cameras["TankCamera"]["extras"]["cameraView"]["control"])
        self.assertEqual("TankMG_PCO",
                         cameras["TankCamera2"]["extras"]["cameraView"]["control"])
        # Z negated on export, like every other node translation.
        self.assertEqual([0.1, 1.5, -0.25], cameras["TankCamera"]["translation"])
        self.assertEqual({"[Tank] TankCamera", "[TankMG_PCO] TankCamera2"},
                         set(report.cameras))
        # A mesh-less, child-less camera never grows a rig slider.
        self.assertNotIn("rig", cameras["TankCamera"].get("extras", {}))

    def test_camera_alone_does_not_resurrect_an_empty_bundle(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Land/Test/Objects.con",
            """
ObjectTemplate.create Bundle EmptyBundle
ObjectTemplate.geometry Missing_M1
""",
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="EmptyBundle", configuration="complex", lod=0)
        self.assertIsNone(assembler.build_node(builder, "EmptyBundle", report))


if __name__ == "__main__":
    unittest.main()
