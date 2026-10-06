"""Three Desert Combat words, after the engine reads that settled them.

`features/dc-engine-reads/README.md`. Each word was read in both binaries
before anything was built:

  BOMB-13  `blastAmmoCount` is a bool at `FireArmsTemplate+0x348`: a salvo
           costs one round. Read with `istream >> bool`, so Desert Combat's
           `5` and `2` are refused (CON-17) and reach the glb as nothing.
  GUN-17   `automaticYaw/PitchStabilization` are stored and never read, so
           nothing is exported for them and a gun keeps turning with its hull.
  COL-16..18  `hasCollisionPhysics` decides which hulls the engine tests.

The viewer half of BOMB-13 is `test_bomb_release.py` (BOMB-13 group).
"""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from bf42 import gltf  # noqa: E402
from bf42.assemble import (Assembler, CollisionScope, Report,  # noqa: E402
                           collision_scope_for)
from bf42.con import ObjectLibrary, engine_bool  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402


def glb_nodes(data: bytes) -> dict:
    json_size, _ = struct.unpack_from("<II", data, 12)
    document = json.loads(data[20:20 + json_size].decode("utf-8"))
    return {n["name"]: n for n in document["nodes"]}


def assemble(con: str, root: str, meshes: dict[str, list] | None = None) -> dict:
    """Build `root` from `con` with stand-in meshes; the nodes by name.

    `meshes` maps a geometry name to the collision layers it carries, as
    `(layer, role)` pairs; every geometry gets a one-triangle render mesh.
    """
    library = ObjectLibrary()
    library.add_con("Objects/Test/Objects.con", con)
    pool = ArchivePool()
    assembler = Assembler(pool, pool, pool, library)
    builder = gltf.GlbBuilder()
    triangle = gltf.Primitive(
        positions=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        indices=[0, 1, 2])
    for name, layers in (meshes or {}).items():
        mesh_index = builder.add_mesh(name, [triangle])
        assembler._geom_mesh[name.lower()] = (mesh_index, 1)
        assembler._geom_collisions[name.lower()] = [
            (builder.add_mesh(f"{name} col{layer}", [triangle]), layer, role)
            for layer, role in layers]
        # The collision-alternative ranking counts faces per geometry.
        assembler._geom_collision_faces[name.lower()] = len(layers)
    report = Report(root=root, configuration="complex", lod=0)
    node = assembler.build_node(builder, root, report)
    assert node is not None
    return glb_nodes(builder.build([node], extras=report.as_dict()))


# --- BOMB-13 / CON-17 ----------------------------------------------------------

# The words under test as Desert Combat 0.7 writes them
# (`Objects/HandWeapons/Remington/Objects.con`,
# `Objects/Vehicles/Air/A10/Weapons.con`), plus a two-barrel stand-in written
# with the bare spelling.
WEAPONS_CON = """
ObjectTemplate.create PlayerControlObject A10
ObjectTemplate.addTemplate A10Guns
ObjectTemplate.addTemplate Remington

ObjectTemplate.create FireArms A10Guns
ObjectTemplate.projectileTemplate AvengerProjectile
ObjectTemplate.magSize 1350
ObjectTemplate.roundOfFire 20
ObjectTemplate.addFireArmsPosition 0/0/4.4 0/0/0
ObjectTemplate.setBlastAmmoCount 5

ObjectTemplate.create HandFireArms Remington
ObjectTemplate.projectileTemplate 9mm_Projectile
ObjectTemplate.magSize 8
ObjectTemplate.roundOfFire 1
ObjectTemplate.addFireArmsPosition 0/0/0 1.25/-0.8/0
ObjectTemplate.addFireArmsPosition 0/0/0 0.5/-0.7/0
ObjectTemplate.setBlastAmmoCount 1

ObjectTemplate.create FireArms CanisterGun
ObjectTemplate.addFireArmsPosition 0/0/0 1/0/0
ObjectTemplate.addFireArmsPosition 0/0/0 -1/0/0
ObjectTemplate.blastAmmoCount 1

ObjectTemplate.create Projectile AvengerProjectile
ObjectTemplate.create Projectile 9mm_Projectile
"""


class BlastAmmoCountTests(unittest.TestCase):

    def test_the_bool_read_takes_zero_and_one_only(self) -> None:
        # `num_get<char>::do_get(bool&)` (lnxded 0x08679888): an integer, kept
        # only when it is 0 or 1. A digit run a non-digit ends is its digits.
        self.assertIs(True, engine_bool("1"))
        self.assertIs(False, engine_bool("0"))
        self.assertIs(True, engine_bool("1.2"))
        self.assertIs(True, engine_bool(" 1 "))
        for refused in ("5", "2", "-1", "c_True", "", "yes"):
            self.assertIsNone(engine_bool(refused), refused)

    def test_both_spellings_reach_the_word(self) -> None:
        # CON-15: the console strips `set`.
        library = ObjectLibrary()
        library.add_con("Weapons.con", WEAPONS_CON)
        self.assertIs(True, library.object("Remington").blast_ammo_count)
        self.assertIs(True, library.object("CanisterGun").blast_ammo_count)

    def test_desert_combats_five_is_refused(self) -> None:
        library = ObjectLibrary()
        library.add_con("Weapons.con", WEAPONS_CON)
        self.assertIsNone(library.object("A10Guns").blast_ammo_count)

    def test_the_firing_block_carries_it(self) -> None:
        nodes = assemble(WEAPONS_CON, "A10")
        self.assertIs(True, nodes["Remington"]["extras"]["fireArms"]["blastAmmoCount"])
        self.assertNotIn("blastAmmoCount", nodes["A10Guns"]["extras"]["fireArms"])


# --- GUN-17 --------------------------------------------------------------------

# A gunner's yaw and pitch bundles shaped like Desert Combat's Humvee gunner,
# carrying the two stabilization words it declares.
GUNNER_CON = """
ObjectTemplate.create PlayerControlObject Humvee_Gunner
ObjectTemplate.addTemplate Humvee_GunBase

ObjectTemplate.create RotationalBundle Humvee_GunBase
ObjectTemplate.setMaxSpeed 1.5/0/0
ObjectTemplate.setAcceleration 1000/0/0
ObjectTemplate.setInputToYaw c_PIMouseLookX
ObjectTemplate.setAutomaticYawStabilization 1
ObjectTemplate.addTemplate Humvee_Gun

ObjectTemplate.create RotationalBundle Humvee_Gun
ObjectTemplate.setMaxSpeed 0/1.5/0
ObjectTemplate.setAcceleration 0/1000/0
ObjectTemplate.setMinRotation 0/-20/0
ObjectTemplate.setMaxRotation 0/45/0
ObjectTemplate.setInputToPitch c_PIMouseLookY
ObjectTemplate.setAutomaticPitchStabilization 1
ObjectTemplate.geometry Humvee_Gun_M1
"""


class StabilizationTests(unittest.TestCase):

    def test_nothing_is_exported_for_the_stabilization_words(self) -> None:
        # GUN-17: neither binary reads them, so the rig is the plain rig: the
        # bundles' angles compose under the hull, which turns the gun with it.
        nodes = assemble(GUNNER_CON, "Humvee_Gunner", {"Humvee_Gun_M1": []})
        blob = json.dumps(nodes).lower()
        self.assertNotIn("stabiliz", blob)
        self.assertIn("rig", nodes["Humvee_GunBase"]["extras"])


# --- COL-16..COL-18 ------------------------------------------------------------

# Placed statics shaped like the ones the census turned up: a wall each way
# round, a house shaped like vanilla's `afr_house1_ste` (a geometry-less Bundle
# saying 1 over a LodObject whose detailed alternative says nothing), a
# kit-rack bundle, a bundle that says 0 over a part that says 1, and a
# vehicle, which keeps the old rule.
STATICS_CON = """
ObjectTemplate.create SimpleObject SolidWall
ObjectTemplate.geometry Wall_M1
ObjectTemplate.setHasCollisionPhysics 1

ObjectTemplate.create SimpleObject GhostWall
ObjectTemplate.geometry Wall_M1
ObjectTemplate.hasCollisionPhysics 0

ObjectTemplate.create SimpleObject SilentWall
ObjectTemplate.geometry Wall_M1

LodSelectorTemplate.create DistanceSelector HouseSelector
LodSelectorTemplate.addLodDistance 70

ObjectTemplate.create Bundle House_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate lodHouse

ObjectTemplate.create LodObject lodHouse
ObjectTemplate.lodSelector HouseSelector
ObjectTemplate.addTemplate HouseInterior
ObjectTemplate.addTemplate HouseExterior

ObjectTemplate.create Bundle HouseInterior
ObjectTemplate.geometry House_m1
ObjectTemplate.addTemplate Table_m1
ObjectTemplate.setPosition 1/0/0
ObjectTemplate.addTemplate Crate_m1
ObjectTemplate.setPosition -1/0/0

ObjectTemplate.create SimpleObject HouseExterior
ObjectTemplate.geometry House_m2

ObjectTemplate.create SimpleObject Table_m1
ObjectTemplate.geometry Table_m1

ObjectTemplate.create SimpleObject Crate_m1
ObjectTemplate.geometry Crate_m1
ObjectTemplate.setHasCollisionPhysics 1

ObjectTemplate.create Bundle GhostShed
ObjectTemplate.setHasCollisionPhysics 0
ObjectTemplate.geometry Shed_m1
ObjectTemplate.addTemplate Crate_m1

ObjectTemplate.create Bundle Armory
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.geometry Rack_m1
ObjectTemplate.addTemplate RackedRifle

ObjectTemplate.create SimpleObject RackedRifle
ObjectTemplate.geometry Rifle_m1

ObjectTemplate.create Bundle Barracks_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate lodBarracks

ObjectTemplate.create LodObject lodBarracks
ObjectTemplate.lodSelector HouseSelector
ObjectTemplate.addTemplate BarracksInterior
ObjectTemplate.addTemplate BarracksExterior

ObjectTemplate.create Bundle BarracksInterior
ObjectTemplate.geometry Barracks_m1

ObjectTemplate.create SimpleObject BarracksExterior
ObjectTemplate.geometry Barracks_m2

ObjectTemplate.create Bundle MineCrate
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.geometry Crate_m1
ObjectTemplate.addTemplate CrateMine

ObjectTemplate.create Projectile CrateMine
ObjectTemplate.geometry Mine_m1

ObjectTemplate.create PlayerControlObject Jeep
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate JeepHull
ObjectTemplate.addTemplate JeepCockpit

ObjectTemplate.create SimpleObject JeepHull
ObjectTemplate.geometry Hull_m1
ObjectTemplate.setHasCollisionPhysics 1

ObjectTemplate.create SimpleObject JeepCockpit
ObjectTemplate.geometry Cockpit_m1
"""

# Every geometry carries one collision layer except the far house mesh, which,
# like `afr_house1_ste_m2`, ships none.
STATIC_MESHES = {name: [(1, "both")] for name in (
    "Wall_M1", "House_m1", "Table_m1", "Crate_m1", "Shed_m1", "Rack_m1",
    "Rifle_m1", "Hull_m1", "Cockpit_m1", "Mine_m1")}
STATIC_MESHES["House_m2"] = []
# Desert Combat's `mil_barracks_m2` carries more collision than its `_m1`.
STATIC_MESHES["Barracks_m1"] = [(1, "both")]
STATIC_MESHES["Barracks_m2"] = [(0, "both"), (1, "both")]


def hulls(root: str) -> list[str]:
    """The templates a placed `root` ships collision nodes for."""
    nodes = assemble(STATICS_CON, root, STATIC_MESHES)
    return sorted(n["extras"]["sourceTemplate"] for n in nodes.values()
                  if (n.get("extras") or {}).get("collision"))


class CollisionGateTests(unittest.TestCase):

    def test_the_bare_spelling_reaches_the_word(self) -> None:
        # MERGE GUARD. The gate above trusts `has_collision_physics`, and
        # Desert Combat writes the bare `hasCollisionPhysics` on 1,473 lines
        # (CON-15: the same word). Until `con.py` reads that spelling (the
        # con-reader package), DC's ammo boxes (x489 placements), medic lockers
        # (x207), supply huts, warehouses and hangars would lose their hulls in
        # the next bake. This fails until then, on purpose: merge con-reader's
        # change first, and bake only when this passes.
        library = ObjectLibrary()
        library.add_con("Objects/Test/Objects.con", """
ObjectTemplate.create Bundle Ammobox
ObjectTemplate.hasCollisionPhysics 1
""")
        self.assertIs(True, library.object("Ammobox").has_collision_physics)

    def test_a_root_that_says_one_keeps_its_hull(self) -> None:
        self.assertEqual(["SolidWall"], hulls("SolidWall"))

    def test_a_root_that_says_zero_ships_no_hull(self) -> None:
        # Bare spelling: the same word (CON-15).
        self.assertEqual([], hulls("GhostWall"))

    def test_a_root_that_says_nothing_ships_no_hull(self) -> None:
        # The template default is off (COL-16).
        self.assertEqual([], hulls("SilentWall"))

    def test_a_house_collides_with_the_mesh_its_root_borrows(self) -> None:
        # COL-18: `HouseInterior` declares nothing but lends the root its
        # LOD-0 mesh; the table under it says nothing and does not collide;
        # the crate says 1 and does.
        self.assertEqual(["Crate_m1", "HouseInterior"], hulls("House_m1"))

    def test_the_engine_tests_the_first_alternative_not_the_richest(self) -> None:
        # Desert Combat's `mil_barracks_m1`: the far mesh has the bigger hull,
        # and the old export shipped it beside the near one. The engine tests a
        # LodObject at its highest LOD, the first alternative, and only that.
        self.assertEqual(["BarracksInterior"], hulls("Barracks_m1"))

    def test_nothing_under_a_root_that_says_zero_collides(self) -> None:
        # COL-17: the broadphase never finds the root, so not even the crate
        # that says 1 is tested.
        self.assertEqual([], hulls("GhostShed"))

    def test_a_racks_weapons_do_not_collide(self) -> None:
        # Desert Combat's `Armory_*` kit racks: the rack says 1, the weapons
        # displayed in it say nothing.
        self.assertEqual(["Armory"], hulls("Armory"))

    def test_a_projectile_keeps_its_hull(self) -> None:
        # `ProjectileTemplate()` sets the bit itself, which an unset word on
        # the template cannot show: the old rule stands for it.
        self.assertEqual(["CrateMine", "MineCrate"], hulls("MineCrate"))

    def test_a_vehicle_keeps_every_hull(self) -> None:
        # Not moved over yet: the old rule for a PlayerControlObject root.
        self.assertEqual(["JeepCockpit", "JeepHull"], hulls("Jeep"))

    def test_the_lent_mesh_is_the_first_alternative(self) -> None:
        library = ObjectLibrary()
        library.add_con("Objects/Test/Objects.con", STATICS_CON)
        scope = collision_scope_for(library, library.object("House_m1"))
        self.assertEqual(CollisionScope(collides=True, lent="houseinterior"), scope)
        self.assertIsNone(collision_scope_for(library, library.object("Jeep")))
        self.assertEqual(CollisionScope(collides=False),
                         collision_scope_for(library, library.object("GhostShed")))

    def test_a_dist_compare_lod_lends_from_deeper_down(self) -> None:
        # `internalFindChildOfLodSelectorCID`: the first child is not a
        # LodObject, so the search goes depth-first for a DistCompareSelector
        # one, and stops at a PlayerControlObject.
        library = ObjectLibrary()
        library.add_con("Objects/Test/Objects.con", """
LodSelectorTemplate.create DistCompareSelector CabSelector
ObjectTemplate.create Bundle Cab
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate CabFrame
ObjectTemplate.create Bundle CabFrame
ObjectTemplate.addTemplate lodCab
ObjectTemplate.create LodObject lodCab
ObjectTemplate.lodSelector CabSelector
ObjectTemplate.addTemplate CabInside
ObjectTemplate.addTemplate CabOutside
ObjectTemplate.create SimpleObject CabInside
ObjectTemplate.geometry CabInside_m1
ObjectTemplate.create SimpleObject CabOutside
ObjectTemplate.geometry CabOutside_m1

ObjectTemplate.create Bundle Gunpit
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate PitGun
ObjectTemplate.addTemplate CabFrame
ObjectTemplate.create PlayerControlObject PitGun
""")
        self.assertEqual("cabinside",
                         collision_scope_for(library, library.object("Cab")).lent)
        # The gun comes first and ends the search along its siblings.
        self.assertIsNone(collision_scope_for(library, library.object("Gunpit")).lent)


# The two cases the scope tests above settle only on paper, through the real
# build: a borrowed mesh found deep under a part that says nothing, and a root
# with a mesh of its own over a LodObject, which borrows nothing.
DEEP_CON = STATICS_CON + """
LodSelectorTemplate.create DistCompareSelector CabSelector

ObjectTemplate.create Bundle Cab
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.addTemplate CabFrame

ObjectTemplate.create Bundle CabFrame
ObjectTemplate.addTemplate lodCab

ObjectTemplate.create LodObject lodCab
ObjectTemplate.lodSelector CabSelector
ObjectTemplate.addTemplate CabInside
ObjectTemplate.addTemplate CabOutside

ObjectTemplate.create SimpleObject CabInside
ObjectTemplate.geometry House_m1

ObjectTemplate.create SimpleObject CabOutside
ObjectTemplate.geometry Barracks_m2

ObjectTemplate.create Bundle Tower_m1
ObjectTemplate.setHasCollisionPhysics 1
ObjectTemplate.geometry Shed_m1
ObjectTemplate.addTemplate lodHouse
"""


class CollisionGateBuildTests(unittest.TestCase):

    def deep(self, root: str) -> list[str]:
        nodes = assemble(DEEP_CON, root, STATIC_MESHES)
        return sorted(n["extras"]["sourceTemplate"] for n in nodes.values()
                      if (n.get("extras") or {}).get("collision"))

    def test_a_mesh_lent_from_deep_down_ships_under_a_silent_part(self) -> None:
        # COL-18's second try: `CabFrame` says nothing and is no LodObject, so
        # the search finds `lodCab` under it, and its first alternative's mesh
        # is the root's. The far alternative, never tested, ships nothing.
        self.assertEqual(["CabInside"], self.deep("Cab"))

    def test_a_root_with_a_mesh_of_its_own_borrows_nothing(self) -> None:
        # `getFaceCollision` takes the root's own geometry and never calls
        # `findLodGeometry`, so the house under it is just a part: its first
        # alternative says nothing and is not tested; the crate inside it says
        # 1 and is.
        self.assertEqual(["Crate_m1", "Tower_m1"], self.deep("Tower_m1"))


class CollisionHarnessTests(unittest.TestCase):
    """The exporter's decision, through the real collider.

    Three walls stand 4 m apart down +x: the one nearest says
    `hasCollisionPhysics 0`, the next says nothing, the last says 1. Whether each
    is solid is whatever the exporter shipped a collision node for, and a round
    and a soldier-sized sphere fired down +x through `collision_harness.mjs`
    must both stop at the last one.
    """

    def test_a_zero_wall_does_not_block(self) -> None:
        import shutil
        import subprocess
        import tempfile
        from test_collision import HARNESS, PARTS
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        walls = [
            {"x": 8, "material": 92, "collision": bool(hulls("GhostWall"))},
            {"x": 12, "material": 85, "collision": bool(hulls("SilentWall"))},
            {"x": 16, "material": 80, "collision": bool(hulls("SolidWall"))},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            (work / "package.json").write_text('{"type": "module"}')
            for part in PARTS:
                shutil.copyfile(part, work / part.name)
            shutil.copyfile(HARNESS, work / "harness.mjs")
            (work / "hcp_walls.json").write_text(json.dumps(walls))
            proc = subprocess.run(["node", str(work / "harness.mjs")],
                                  capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode, proc.stderr)
        result = json.loads(proc.stdout)["hasCollisionPhysics"]
        # One wall in the index, two triangles.
        self.assertEqual(2, result["triangles"])
        self.assertEqual({"x": 16, "material": 80}, result["round"])
        self.assertEqual({"material": 80}, result["body"])


if __name__ == "__main__":
    unittest.main()
