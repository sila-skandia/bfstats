from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf, skin, stdmesh  # noqa: E402
from bf42.assemble import Assembler, Report, browse_rig  # noqa: E402
from bf42.con import ObjectLibrary, ObjectTemplate  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402


def glb_document(data: bytes) -> dict:
    json_size, json_kind = struct.unpack_from("<II", data, 12)
    if json_kind != 0x4E4F534A:
        raise AssertionError("GLB does not start with a JSON chunk")
    return json.loads(data[20:20 + json_size].decode("utf-8"))


class CollisionExportTests(unittest.TestCase):
    def test_collision_faces_are_grouped_by_material_with_metadata(self) -> None:
        layer = stdmesh.CollisionLayer(
            unknown=(0, 5),
            vertices=[
                (0.0, 0.0, 0.0),
                (1.0, 0.0, 0.0),
                (1.0, 1.0, 0.0),
                (0.0, 1.0, 0.0),
            ],
            vertex_unknown=[1.0] * 4,
            faces=[
                stdmesh.CollisionFace((0, 1, 2), 50, 0),
                stdmesh.CollisionFace((0, 2, 3), 52, 4),
            ],
        )
        coarse = stdmesh.CollisionLayer(
            unknown=(0, 5),
            vertices=layer.vertices[:3],
            vertex_unknown=[1.0] * 3,
            faces=[stdmesh.CollisionFace((0, 1, 2), 43, 0)],
        )
        mesh = stdmesh.StandardMesh(
            name="TestHull",
            version=10,
            bounds_min=(0.0, 0.0, 0.0),
            bounds_max=(1.0, 1.0, 0.0),
            collision_layers=[coarse, layer],
            lods=[],
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, ObjectLibrary())
        builder = gltf.GlbBuilder()
        report = Report(root="Test", configuration="complex", lod=0)

        collision_meshes = assembler._collision_mesh_indices(
            builder, "TestHull", mesh, report)
        mesh_index, layer_index, role = collision_meshes[0]
        root = builder.add_node(gltf.Node(
            name="Test collision",
            mesh=mesh_index,
            extras={"collision": True, "collisionRole": role},
        ))
        document = glb_document(builder.build([root], extras=report.as_dict()))

        self.assertEqual(1, layer_index)
        self.assertEqual("detailed", role)
        self.assertEqual(2, report.collision_triangles)
        self.assertEqual([50, 52], sorted(set(report.collision_materials)))
        self.assertEqual(
            [50, 52],
            [
                primitive["extras"]["defenseMaterial"]
                for primitive in document["meshes"][0]["primitives"]
            ],
        )
        self.assertTrue(document["nodes"][0]["extras"]["collision"])

    def test_include_collision_false_does_not_attach_nodes(self) -> None:
        pool = ArchivePool()
        assembler = Assembler(
            pool, pool, pool, ObjectLibrary(), include_collision=False)
        builder = gltf.GlbBuilder()
        report = Report(root="Test", configuration="complex", lod=0)
        mesh = stdmesh.StandardMesh(
            name="TestHull", version=10,
            bounds_min=(0.0, 0.0, 0.0), bounds_max=(1.0, 1.0, 0.0),
            collision_layers=[], lods=[],
        )
        assembler._geom_collisions["testhull"] = assembler._collision_mesh_indices(
            builder, "TestHull", mesh, report) if assembler.include_collision else []
        self.assertEqual([], assembler._geom_collisions["testhull"])
        self.assertEqual(0, report.collision_parts)


class InvisiblePartTests(unittest.TestCase):
    def test_create_invisible_parts_are_omitted_without_loading_geometry(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Sea/Test/Objects.con",
            """
ObjectTemplate.create Bundle Boat
ObjectTemplate.addTemplate Hull
ObjectTemplate.addTemplate LandEngine

ObjectTemplate.create SimpleObject Hull
ObjectTemplate.geometry TestHull

ObjectTemplate.create Engine LandEngine
ObjectTemplate.addTemplate HiddenWheel

ObjectTemplate.create Spring HiddenWheel
ObjectTemplate.geometry Willy_WheelR_M1
ObjectTemplate.createInvisible 1

GeometryTemplate.create StandardMesh TestHull
GeometryTemplate.create StandardMesh Willy_WheelR_M1
""",
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="Boat", configuration="complex", lod=0)

        self.assertIsNone(assembler.build_node(builder, "HiddenWheel", report))
        self.assertIsNone(assembler.build_node(builder, "LandEngine", report))
        self.assertEqual([], report.missing_meshes)
        self.assertNotIn("Willy_WheelR_M1", report.missing_geometry_templates)


class FirstPersonLodTests(unittest.TestCase):
    def test_distance_lod_falls_back_from_cockpit_mesh_to_third_person(self) -> None:
        library = ObjectLibrary()
        library.add_con(
            "Objects/Vehicles/Sea/Test/Objects.con",
            """
ObjectTemplate.create RotationalBundle Helm
ObjectTemplate.addTemplate lodHelm
ObjectTemplate.setMinRotation 0/0/-60
ObjectTemplate.setMaxRotation 0/0/60
ObjectTemplate.setInputToRoll c_PIYaw

ObjectTemplate.create LodObject lodHelm
ObjectTemplate.addTemplate HighHelm
ObjectTemplate.addTemplate LowHelm

ObjectTemplate.create SimpleObject HighHelm
ObjectTemplate.geometry 1P_PT_Str_M1

ObjectTemplate.create AnimatedBundle LowHelm
ObjectTemplate.geometry PT_Steering_M1

GeometryTemplate.create StandardMesh 1P_PT_Str_M1
GeometryTemplate.create StandardMesh PT_Steering_M1
""",
        )
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="Helm", configuration="complex", lod=0)

        self.assertIsNone(assembler.build_node(builder, "HighHelm", report))
        self.assertEqual([], report.missing_meshes)

        assembler.build_node(builder, "lodHelm", report)
        self.assertIn("PT_Steering_M1", report.missing_meshes)
        self.assertNotIn("1P_PT_Str_M1", report.missing_meshes)
        self.assertEqual(["lodHelm -> LowHelm"], report.selected_lod_alternatives)


class BrowseRigTests(unittest.TestCase):
    def test_helm_loses_steer_when_the_vehicle_has_no_visible_springs(self) -> None:
        helm = ObjectTemplate(name="PT_Steering", kind="RotationalBundle")
        helm.min_rotation = (0.0, 0.0, -60.0)
        helm.max_rotation = (0.0, 0.0, 60.0)
        helm.inputs = {"roll": "c_PIYaw"}

        self.assertIsNone(browse_rig(helm, has_visible_springs=False))
        self.assertEqual(
            "c_PIYaw",
            browse_rig(helm, has_visible_springs=True)["axes"]["roll"]["input"],
        )

    def test_aircraft_engine_keeps_throttle_without_springs(self) -> None:
        engine = ObjectTemplate(name="StukaEngine", kind="Engine")
        engine.min_rotation = (0.0, 0.0, -3000.0)
        engine.max_rotation = (0.0, 0.0, 3000.0)
        engine.inputs = {"roll": "c_PIThrottle"}

        rig = browse_rig(engine, has_visible_springs=False)

        self.assertEqual("rate", rig["axes"]["roll"]["driver"])


if __name__ == "__main__":
    unittest.main()


class AlphaBleedTests(unittest.TestCase):
    """Foliage RGB must survive filtering into its transparent texels."""

    def test_opaque_colour_dilates_into_transparent_texels(self) -> None:
        from bf42.assemble import Assembler

        # 3x1: one opaque green texel beside two transparent black ones.
        rgba = bytes([0, 200, 0, 255]) + bytes([0, 0, 0, 0]) * 2
        out = Assembler._bleed_alpha(3, 1, rgba, passes=2)

        self.assertEqual((0, 200, 0, 255), tuple(out[0:4]))
        # Neighbour takes the opaque colour; alpha is never touched.
        self.assertEqual((0, 200, 0, 0), tuple(out[4:8]))
        self.assertEqual(0, out[11])
        self.assertNotEqual((0, 0, 0), tuple(out[8:11]))

    def test_fully_opaque_image_is_returned_unchanged(self) -> None:
        from bf42.assemble import Assembler

        rgba = bytes([10, 20, 30, 255]) * 4
        self.assertIs(rgba, Assembler._bleed_alpha(2, 2, rgba))

    def test_fully_transparent_image_does_not_hang(self) -> None:
        from bf42.assemble import Assembler

        rgba = bytes([0, 0, 0, 0]) * 4
        self.assertEqual(bytes(rgba), Assembler._bleed_alpha(2, 2, rgba))

    def test_specular_alpha_skin_is_never_overwritten(self) -> None:
        """Opaque `_I` skins keep reflectivity in alpha (68-254 measured).

        Those texels are content, not cutout background: bleeding across them
        erased whole aircraft liveries (Wake's parked planes rendered as flat
        bled colour). Only near-zero alpha may be treated as cut away.
        """
        from bf42.assemble import Assembler

        # One fully opaque texel beside painted texels at semi alpha.
        rgba = bytes([255, 0, 0, 255]) + bytes([0, 0, 255, 119]) * 3
        out = Assembler._bleed_alpha(4, 1, rgba)

        self.assertEqual(bytes(rgba), bytes(out))


def pack_skn(vertices: list[tuple], bones: list[str]) -> bytes:
    out = bytearray()
    out += struct.pack("<II", 1, len(vertices))
    for rest, influences in vertices:
        out += struct.pack("<3f", *rest)
        out.append(len(influences))
        for bone, weight, offset in influences:
            out += struct.pack("<H", bone)
            out += struct.pack("<f", weight)
            out += struct.pack("<3f", *offset)
    out += struct.pack("<H", len(bones))
    for name in bones:
        raw = name.encode("latin-1") + b"\0"
        out += struct.pack("<H", len(raw))
        out += raw
    return bytes(out)


def apply_bind(rotation, translation, offset):
    return tuple(
        sum(rotation[i][j] * offset[j] for j in range(3)) + translation[i]
        for i in range(3)
    )


class SoldierPartAlignmentTests(unittest.TestCase):
    """Hands AND the head are plugged into the 3P body's bind pose.

    Every `ComplexHead` skin assumes `Bip01 Spine3` in the exporter's default
    standing pose, while the body skin binds the same bone a few cm forward
    and lower (measured on GermanSoldier: head assumes (0, -0.013, 1.504),
    body binds (0.003, 0.018, 1.451)). Emitting the head unaligned leaves it
    floating high and behind the neck stump — the alignment must map the
    head's Spine3-weighted collar verts exactly onto the body's bind.
    """

    IDENTITY = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
    # 15 deg about X: the head skin's chest is straighter than the body's.
    _c, _s = 0.9659258263, 0.2588190451
    TILT = ((1.0, 0.0, 0.0), (0.0, _c, -_s), (0.0, _s, _c))
    HEAD_SPINE3 = (0.0, -0.0132, 1.5038)   # head skin's assumed bind
    BODY_SPINE3 = (0.0033, 0.0177, 1.4507)  # where the body actually binds it
    OFFSETS = [(0.0, 0.0, 0.0), (0.05, 0.0, 0.0), (0.0, 0.04, 0.0), (0.0, 0.0, 0.03)]

    def _skin(self, rotation, translation, bone, path):
        verts = [
            (apply_bind(rotation, translation, offset), [(0, 1.0, offset)])
            for offset in self.OFFSETS
        ]
        return skin.parse(pack_skn(verts, [bone]), path)

    def _assembler(self) -> Assembler:
        library = ObjectLibrary()
        library.add_con("Objects/Soldiers/Test/Objects.con", """
ObjectTemplate.create BFSoldier TestSoldier
ObjectTemplate.addTemplate TestComplexHead1
ObjectTemplate.addTemplate Test3PBody
ObjectTemplate.addTemplate TestRightHand

ObjectTemplate.create AnimatedBundle TestComplexHead1
ObjectTemplate.geometry Soldier/TestFace

ObjectTemplate.create AnimatedBundle Test3PBody
ObjectTemplate.geometry Soldier/TestBody

ObjectTemplate.create AnimatedBundle TestRightHand
ObjectTemplate.geometry Soldier/TestRightHand
""")
        library.add_con("Objects/Soldiers/Test/Geometries.con", """
GeometryTemplate.create AnimatedMesh Soldier/TestFace
GeometryTemplate.setSkin animations/TestFace.skn

GeometryTemplate.create AnimatedMesh Soldier/TestBody
GeometryTemplate.setSkin animations/TestBody.skn

GeometryTemplate.create AnimatedMesh Soldier/TestRightHand
GeometryTemplate.setSkin animations/TestRightHand.skn
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        # The .skn archives are not on disk in a unit test; seed the cache the
        # same way `_read_skin` would fill it.
        assembler._skin_cache = {
            "animations/testface.skn": self._skin(
                self.IDENTITY, self.HEAD_SPINE3, "Bip01 Spine3", "face.skn"),
            "animations/testbody.skn": self._skin(
                self.TILT, self.BODY_SPINE3, "Bip01 Spine3", "body.skn"),
            "animations/testrighthand.skn": self._skin(
                self.IDENTITY, (-0.3147, 0.2447, 1.2255), "Bip01 R Forearm",
                "hand.skn"),
        }
        return assembler

    def test_head_collar_lands_exactly_on_the_bodys_spine3_bind(self) -> None:
        assembler = self._assembler()
        library = assembler.library
        body = assembler._soldier_body_skin(library.object("TestSoldier"))
        self.assertIsNotNone(body)

        aligned = assembler._part_alignment(library.object("TestComplexHead1"), body)

        self.assertIsNotNone(aligned)
        r_rel, t_rel, bone = aligned
        self.assertEqual("Bip01 Spine3", bone)
        # A collar vertex authored in the head's bind must land where the
        # body's bind puts the same bone-local point.
        for offset in self.OFFSETS:
            source = apply_bind(self.IDENTITY, self.HEAD_SPINE3, offset)
            expected = apply_bind(self.TILT, self.BODY_SPINE3, offset)
            mapped = apply_bind(r_rel, t_rel, source)
            for got, want in zip(mapped, expected):
                self.assertAlmostEqual(want, got, places=5)

    def test_the_body_itself_is_never_re_aligned(self) -> None:
        assembler = self._assembler()
        library = assembler.library
        body = assembler._soldier_body_skin(library.object("TestSoldier"))

        self.assertIsNone(assembler._part_alignment(library.object("Test3PBody"), body))

    def test_hands_still_align_through_the_forearm(self) -> None:
        assembler = self._assembler()
        library = assembler.library
        body = assembler._soldier_body_skin(library.object("TestSoldier"))
        # The body must expose the forearm too for the hand to have a shared
        # bone; rebuild it as a two-bone skin.
        forearm_bind = (self.TILT, (-0.3435, 0.1004, 1.3097))
        verts = [
            (apply_bind(self.TILT, self.BODY_SPINE3, offset), [(0, 1.0, offset)])
            for offset in self.OFFSETS
        ] + [
            (apply_bind(*forearm_bind, offset), [(1, 1.0, offset)])
            for offset in self.OFFSETS
        ]
        two_bone = skin.parse(
            pack_skn(verts, ["Bip01 Spine3", "Bip01 R Forearm"]), "body2.skn")
        assembler._skin_cache["animations/testbody.skn"] = two_bone
        body = assembler._soldier_body_skin(library.object("TestSoldier"))

        aligned = assembler._part_alignment(library.object("TestRightHand"), body)

        self.assertIsNotNone(aligned)
        self.assertEqual("Bip01 R Forearm", aligned[2])


class FireArmsBakeTests(unittest.TestCase):
    """Meshless plane guns must survive as muzzle nodes with firing extras."""

    GUNS_CON = """
ObjectTemplate.create Bundle PlaneComplex
ObjectTemplate.addTemplate PlaneBody
ObjectTemplate.addTemplate PlaneGuns
ObjectTemplate.setPosition 0/0/1

ObjectTemplate.create SimpleObject PlaneBody
ObjectTemplate.geometry Plane_hull

ObjectTemplate.create FireArms PlaneGuns
ObjectTemplate.visibleBarrelTemplate e_TestMuzz
ObjectTemplate.projectileTemplate PlaneProjectile
ObjectTemplate.setTracerTemplate Tracer_Projectile CRD_NONE/3/0/0
ObjectTemplate.magSize 900
ObjectTemplate.velocity 400
ObjectTemplate.roundOfFire 12
ObjectTemplate.addFireArmsPosition 2.6/0.21/1.8 -1.6/0/0
ObjectTemplate.addFireArmsPosition -2.6/0.21/1.8 1.6/0/0

ObjectTemplate.create Projectile Tracer_Projectile
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.tracerScaler 50.0

ObjectTemplate.create EffectBundle e_TestMuzz
ObjectTemplate.addTemplate em_TestMuzz

ObjectTemplate.create Emitter em_TestMuzz
ObjectTemplate.template fx_TestMuzz
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0

ObjectTemplate.create Particle fx_TestMuzz
ObjectTemplate.geometry Muzz_m1
ObjectTemplate.timeToLive CRD_NONE/0.07/0/0
ObjectTemplate.sizeOverTime 0/0.12|100/9.4

GeometryTemplate.create StandardMesh Plane_hull
GeometryTemplate.create StandardMesh Muzz_m1
"""

    def _assemble(self, con_text: str | None = None):
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Air/Plane/Weapons.con",
                        con_text or self.GUNS_CON)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        for geometry_name in ("Plane_hull", "Muzz_m1"):
            mesh_index = builder.add_mesh(geometry_name, [triangle])
            assembler._geom_mesh[geometry_name.lower()] = (mesh_index, 1)
            assembler._geom_collisions[geometry_name.lower()] = []
        report = Report(root="PlaneComplex", configuration="complex", lod=0)
        node = assembler.build_node(builder, "PlaneComplex", report)
        assert node is not None
        return glb_document(builder.build([node], extras=report.as_dict())), report

    def test_meshless_guns_survive_with_muzzles_and_stats(self) -> None:
        document, report = self._assemble()
        nodes = {node["name"]: node for node in document["nodes"]}

        guns = nodes["PlaneGuns"]
        fire = guns["extras"]["fireArms"]
        self.assertEqual(12.0, fire["roundOfFire"])
        self.assertEqual(900, fire["magSize"])
        self.assertEqual(400.0, fire["velocity"])
        self.assertEqual(2, fire["muzzles"])
        self.assertEqual(
            {"template": "Tracer_Projectile", "interval": 3,
             "timeToLive": 3.0, "scaler": 50.0},
            fire["tracer"])
        # The gun bundle's own placement (0/0/1 -> glTF z=-1) survives.
        self.assertEqual([0.0, 0.0, -1.0], guns["translation"])

        muzzle_names = [name for name in nodes if "muzzle" in name]
        self.assertEqual(2, len(muzzle_names))
        first = nodes["PlaneGuns muzzle 1"]
        self.assertEqual({"index": 0}, first["extras"]["muzzle"])
        # Refractor 2.6/0.21/1.8 -> glTF Z negated.
        self.assertEqual([2.6, 0.21, -1.8], first["translation"])

        # The flash chain resolved down to the Particle mesh emitter node.
        flash = nodes["em_TestMuzz"]
        self.assertEqual("mesh", flash["extras"]["effect"]["kind"])
        self.assertAlmostEqual(0.07, flash["extras"]["effect"]["timeToLive"])
        self.assertEqual([[0.0, 0.12], [100.0, 9.4]],
                         flash["extras"]["effect"]["sizeOverTime"])
        self.assertIn("mesh", flash)
        self.assertEqual(1, len(report.fire_arms))

    def test_meshless_projectile_types_as_bullet_without_a_baked_body(self) -> None:
        # PlaneProjectile resolves but has no geometry — invisible in game
        # bar the tracer rounds, so nothing gets baked to fly.
        document, _ = self._assemble(self.GUNS_CON + """
ObjectTemplate.create Projectile PlaneProjectile
ObjectTemplate.timeToLive CRD_NONE/3/0/0
ObjectTemplate.gravityModifier 0
""")
        nodes = {node["name"]: node for node in document["nodes"]}

        fire = nodes["PlaneGuns"]["extras"]["fireArms"]
        self.assertEqual(
            {"template": "PlaneProjectile", "kind": "bullet", "trail": None,
             "timeToLive": 3.0, "gravity": 0.0},
            fire["projectile"])
        self.assertNotIn("PlaneGuns projectile", nodes)

    def test_unresolved_projectile_still_types_as_bullet(self) -> None:
        document, _ = self._assemble(self.GUNS_CON)
        fire = next(node for node in document["nodes"]
                    if node["name"] == "PlaneGuns")["extras"]["fireArms"]
        self.assertEqual(
            {"template": "PlaneProjectile", "kind": "bullet", "trail": None},
            fire["projectile"])


class ProjectileBakeTests(unittest.TestCase):
    """Shells and rockets carry a typed spec and a baked hidden body."""

    ROCKET_CON = """
ObjectTemplate.create FireArms RocketRamp
ObjectTemplate.projectileTemplate TestRocket
ObjectTemplate.visibleDummyProjectileTemplate TestRocketDummy
ObjectTemplate.velocity 45
ObjectTemplate.roundOfFire 1
ObjectTemplate.addFireArmsPosition -1.15/-0.188/0 0/0/0

ObjectTemplate.create SimpleObject TestRocketDummy
ObjectTemplate.geometry Rocket_m1

ObjectTemplate.create Projectile TestRocket
ObjectTemplate.geometry Rocket_m1
ObjectTemplate.timeToLive CRD_NONE/20/0/0
ObjectTemplate.startEffectTemplate e_TestFume
ObjectTemplate.addTemplate TestRocket_Engine

ObjectTemplate.create Engine TestRocket_Engine
ObjectTemplate.setEngineType c_ETRocket

ObjectTemplate.create EffectBundle e_TestFume
ObjectTemplate.addTemplate Em_TestFume_Smoke
ObjectTemplate.addTemplate Em_TestFume_Fire

ObjectTemplate.create Emitter Em_TestFume_Smoke
ObjectTemplate.template Fx_TestFume_Smoke
ObjectTemplate.timeToLive CRD_NONE/7/0/0

ObjectTemplate.create SpriteParticle Fx_TestFume_Smoke
ObjectTemplate.timeToLive CRD_NORMAL/1.5/1.53/0
ObjectTemplate.size CRD_NONE/1.2/0/0
ObjectTemplate.sizeOverTime 0/0.4|16/0.5|100/0.75
ObjectTemplate.texture e_muzs1_I

ObjectTemplate.create Emitter Em_TestFume_Fire
ObjectTemplate.template Fx_TestFume_Fire

ObjectTemplate.create SpriteParticle Fx_TestFume_Fire
ObjectTemplate.timeToLive CRD_NONE/0.2/0.2/0
ObjectTemplate.size CRD_NONE/0.8/0/0
ObjectTemplate.texture e_fire4

GeometryTemplate.create StandardMesh Rocket_m1
"""

    def _assemble(self, root: str):
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Land/Test/Weapons.con", self.ROCKET_CON)
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        mesh_index = builder.add_mesh("Rocket_m1", [triangle])
        assembler._geom_mesh["rocket_m1"] = (mesh_index, 1)
        assembler._geom_collisions["rocket_m1"] = []
        report = Report(root=root, configuration="complex", lod=0)
        node = assembler.build_node(builder, root, report)
        assert node is not None
        return glb_document(builder.build([node], extras=report.as_dict())), report

    def test_rocket_projectile_is_typed_and_baked_under_the_gun(self) -> None:
        document, report = self._assemble("RocketRamp")
        nodes = {node["name"]: node for node in document["nodes"]}

        fire = nodes["RocketRamp"]["extras"]["fireArms"]
        self.assertEqual("TestRocket", fire["projectile"]["template"])
        self.assertEqual("rocket", fire["projectile"]["kind"])
        self.assertEqual(20.0, fire["projectile"]["timeToLive"])
        # The longest-lived sprite is the trail the eye follows — the smoke,
        # not the 0.2 s fire tongue.
        self.assertEqual(
            {"texture": "e_muzs1_I", "timeToLive": 1.5, "size": 1.2,
             "sizeOverTime": [[0.0, 0.4], [16.0, 0.5], [100.0, 0.75]]},
            fire["projectile"]["trail"])

        body = nodes["RocketRamp projectile"]
        self.assertEqual(
            {"template": "TestRocketDummy", "geometry": "Rocket_m1"},
            body["extras"]["projectileMesh"])
        self.assertIn("mesh", body)
        # Baked under the FireArms node, next to the muzzles.
        self.assertIn(
            document["nodes"].index(body),
            nodes["RocketRamp"]["children"])

    def test_shell_without_rocket_engine_types_as_shell(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Vehicles/Land/Test/Weapons.con", """
ObjectTemplate.create FireArms ShellGun
ObjectTemplate.projectileTemplate TestShell
ObjectTemplate.velocity 100

ObjectTemplate.create Projectile TestShell
ObjectTemplate.geometry Rocket_m1
ObjectTemplate.timeToLive CRD_NONE/10/0/0

GeometryTemplate.create StandardMesh Rocket_m1
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        assembler._geom_mesh["rocket_m1"] = (builder.add_mesh("Rocket_m1", [triangle]), 1)
        assembler._geom_collisions["rocket_m1"] = []
        report = Report(root="ShellGun", configuration="complex", lod=0)
        node = assembler.build_node(builder, "ShellGun", report)
        document = glb_document(builder.build([node], extras=report.as_dict()))
        nodes = {n["name"]: n for n in document["nodes"]}

        fire = nodes["ShellGun"]["extras"]["fireArms"]
        self.assertEqual("shell", fire["projectile"]["kind"])
        self.assertIsNone(fire["projectile"]["trail"])
        self.assertIn("ShellGun projectile", nodes)


class EmitterMotionBakeTests(unittest.TestCase):
    """Emitter drift along the direction of fire rides the effect extras."""

    def test_speed_and_offset_in_dof_are_exported(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Effects/e_TestMuzz/Effects.con", """
ObjectTemplate.create EffectBundle e_TestMuzz
ObjectTemplate.addTemplate Em_TestSmoke

ObjectTemplate.create Emitter Em_TestSmoke
ObjectTemplate.template Fx_TestSmoke
ObjectTemplate.timeToLive CRD_NONE/0.1/0/0
ObjectTemplate.relativePositionInDof CRD_NONE/-0.4/0/0
ObjectTemplate.positionalSpeedInDof CRD_UNIFORM/-5/-10/0

ObjectTemplate.create SpriteParticle Fx_TestSmoke
ObjectTemplate.timeToLive CRD_NONE/0.5/0.5/0
ObjectTemplate.texture e_muz1_I
ObjectTemplate.destBlendMode BMOne
""")
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, library)
        builder = gltf.GlbBuilder()
        report = Report(root="e_TestMuzz", configuration="complex", lod=0)
        # The sprite texture is not on disk in a unit test; seed the quad the
        # same way `_sprite_quad_mesh` would fill its cache.
        triangle = gltf.Primitive(
            positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
            indices=[0, 1, 2])
        assembler._sprite_mesh_cache["e_muz1_i"] = builder.add_mesh(
            "fx quad", [triangle])
        bundle = library.object("e_TestMuzz")

        emitters = assembler._effect_emitter_nodes(builder, bundle, report)

        self.assertEqual(1, len(emitters))
        document = glb_document(builder.build(emitters, extras=report.as_dict()))
        effect = document["nodes"][0]["extras"]["effect"]
        self.assertEqual(-0.4, effect["offsetInDof"])
        self.assertEqual(-5.0, effect["speedInDof"])


if __name__ == "__main__":
    unittest.main()
