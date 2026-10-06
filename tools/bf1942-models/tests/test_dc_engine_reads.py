"""Three Desert Combat words, after the engine reads that settled them.

`features/dc-engine-reads/README.md`. Each word was read in both binaries
before anything was built:

  BOMB-13  `blastAmmoCount` is a bool at `FireArmsTemplate+0x348`: a salvo
           costs one round. Read with `istream >> bool`, so Desert Combat's
           `5` and `2` are refused (CON-16) and reach the glb as nothing.
  GUN-17   `automaticYaw/PitchStabilization` are stored and never read, so
           nothing is exported for them and a gun keeps turning with its hull.
  COL-15..17  `hasCollisionPhysics` decides which hulls the engine tests.

The viewer half of BOMB-13 is `test_bomb_release.py` (BOMB-13 group).
"""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler, Report  # noqa: E402
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


# --- BOMB-13 / CON-16 ----------------------------------------------------------

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


if __name__ == "__main__":
    unittest.main()
