"""BF1918's gas and flamethrower fire, as the exporter writes them.

Both are an undrawn PlayerControlObject whose damage is a `SupplyDepot` hung
50 m up a self-turning `RotationalBundle` 50 m ahead of it
(`HandWeapons/GasGrenadeDamage/Objects.con`, `HandWeapons/Flamethrower/
Objects.con`). The fire's object is stood by an ObjectSpawner inside the
impact's EffectBundle (`Effects/e_BurningFlameEffect/effects.con`). The
fixtures below are those scripts cut to the words that matter
(`features/bf1918-extraction/README.md`, "Gas and the burning ground")."""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import effects as effects_mod  # noqa: E402
from bf42 import gltf  # noqa: E402
from bf42.assemble import (  # noqa: E402
    Assembler, Report, bundle_spin, depot_offset_at, logic_object_record, round_spawners,
)
from bf42.con import ObjectLibrary  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402

GAS = """
ObjectTemplate.create Projectile Hand-GasbombeProjectile
ObjectTemplate.timeToLive CRD_NONE/4.05/0/0
ObjectTemplate.addTemplate GasGrenadeDamageSpawner

ObjectTemplate.create ObjectSpawner GasGrenadeDamageSpawner
ObjectTemplate.setObjectTemplate 1 GasGrenadeDamage
ObjectTemplate.setObjectTemplate 2 GasGrenadeDamage
ObjectTemplate.holdObject 0
ObjectTemplate.SpawnDelayAtStart 4
ObjectTemplate.minSpawnDelay 4
ObjectTemplate.maxSpawnDelay 4
ObjectTemplate.TimeToLive 1
ObjectTemplate.Distance 20
ObjectTemplate.team 1
ObjectTemplate.damageWhenLost 0

ObjectTemplate.create PlayerControlObject GasGrenadeDamage
ObjectTemplate.hasArmor 1
ObjectTemplate.hitpoints 25
ObjectTemplate.maxhitpoints 25
ObjectTemplate.criticalDamage 25
ObjectTemplate.timetoliveafterdeath 0
ObjectTemplate.addTemplate rotator
ObjectTemplate.setPosition 0/0/50

ObjectTemplate.create RotationalBundle rotator
ObjectTemplate.addTemplate GasGrenade_area_damage_depot
ObjectTemplate.setPosition 0/50/0
ObjectTemplate.setMinRotation 0/-90/0
ObjectTemplate.setMaxRotation 0/0/0
ObjectTemplate.setMaxSpeed 0/110/0
ObjectTemplate.setAcceleration 0/10/0
ObjectTemplate.setContinousRotationSpeed 0/-100/0

ObjectTemplate.create SupplyDepot GasGrenade_area_damage_depot
ObjectTemplate.radius 8
ObjectTemplate.team 0
ObjectTemplate.setHealth -1 -3 0
ObjectTemplate.workOnVehicles 1
ObjectTemplate.workOnSoldiers 1
ObjectTemplate.addVehicleType Horse -1 -1.5 0
"""

FIRE = """
ObjectTemplate.create EffectBundle e_BurningFlameEffect
ObjectTemplate.timeToLive CRD_NONE/6/0/0
ObjectTemplate.addTemplate FireDamageSpawner

ObjectTemplate.create EffectBundle e_FlamefuelGrnd
ObjectTemplate.addTemplate e_BurningFlameEffect
ObjectTemplate.timeToLive CRD_NONE/5/0/0

ObjectTemplate.create ObjectSpawner FireDamageSpawner
ObjectTemplate.setObjectTemplate 1 FireDamage
ObjectTemplate.setObjectTemplate 2 FireDamage
ObjectTemplate.SpawnDelayAtStart 1
ObjectTemplate.minSpawnDelay 1
ObjectTemplate.maxSpawnDelay 1
ObjectTemplate.team 1

ObjectTemplate.create PlayerControlObject FireDamage
ObjectTemplate.hasArmor 1
ObjectTemplate.hitpoints 3
ObjectTemplate.maxhitpoints 3
ObjectTemplate.criticalDamage 3
ObjectTemplate.timetoliveafterdeath 0
ObjectTemplate.addTemplate rotator2
ObjectTemplate.setPosition 0/0/50

ObjectTemplate.create RotationalBundle rotator2
ObjectTemplate.addTemplate Fire_area_damage_depot
ObjectTemplate.setPosition 0/50/0
ObjectTemplate.setMinRotation 0/-90/0
ObjectTemplate.setMaxRotation 0/0/0
ObjectTemplate.setMaxSpeed 0/110/0
ObjectTemplate.setAcceleration 0/10/0
ObjectTemplate.setContinousRotationSpeed 0/-100/0

ObjectTemplate.create SupplyDepot Fire_area_damage_depot
ObjectTemplate.radius 5
ObjectTemplate.team 0
ObjectTemplate.setHealth -1 -1 0
ObjectTemplate.workOnVehicles 1
ObjectTemplate.workOnSoldiers 1
"""

# The trench mortar's cloud: the depot is a direct child, no rotator.
MORTAR = """
ObjectTemplate.create PlayerControlObject GasDamage
ObjectTemplate.hitpoints 20
ObjectTemplate.maxhitpoints 20
ObjectTemplate.criticalDamage 19.9
ObjectTemplate.hpLostWhileCriticalDamage 0.08
ObjectTemplate.addTemplate Gas_area_damage_depot
ObjectTemplate.setPosition 0/1/0

ObjectTemplate.create SupplyDepot Gas_area_damage_depot
ObjectTemplate.radius 12
ObjectTemplate.setHealth -1 -1 0
"""


def library() -> ObjectLibrary:
    lib = ObjectLibrary()
    lib.add_con("Objects/HandWeapons/GasGrenadeDamage/Objects.con", GAS)
    lib.add_con("Objects/HandWeapons/Flamethrower/Objects.con", FIRE)
    lib.add_con("Objects/Weapons/GasDamage/Objects.con", MORTAR)
    return lib


def distance(v) -> float:
    return sum(c * c for c in v) ** 0.5


class NestedDepotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lib = library()

    def test_a_depot_under_a_rotator_is_found(self) -> None:
        record = logic_object_record(self.lib, self.lib.object("GasGrenadeDamage"))
        [depot] = record["depots"]
        self.assertEqual("GasGrenade_area_damage_depot", depot["template"])
        self.assertEqual(8.0, depot["radius"])
        self.assertEqual([-1.0, -3.0, 0.0], depot["health"])
        self.assertEqual([["Horse", -1.0, -1.5, 0.0]], depot["vehicleTypes"])
        # At rest it is 50 m up, 50 m ahead (glb Z is the engine's -Z).
        self.assertEqual([0.0, 50.0, -50.0], depot["translation"])
        self.assertEqual(25.0, record["armor"]["criticalDamage"])

    def test_the_rotator_turns_pitch_alone_into_its_bounds(self) -> None:
        spin = bundle_spin(self.lib.object("rotator"))
        self.assertEqual({"rate": [0.0, -100.0, 0.0], "min": [0.0, -90.0, 0.0],
                          "max": [0.0, 0.0, 0.0]}, spin)

    def test_the_sweep_brings_the_depot_onto_the_object_in_point_nine_seconds(self) -> None:
        [depot] = logic_object_record(self.lib, self.lib.object("GasGrenadeDamage"))["depots"]
        self.assertAlmostEqual(70.71, distance(depot_offset_at(depot, 0.0)), places=2)
        # Pitch -30 at 0.3 s: 50 m round a point 50 m ahead, over the top.
        at = depot_offset_at(depot, 0.3)
        self.assertAlmostEqual(43.30, at[1], places=2)
        self.assertAlmostEqual(-25.0, at[2], places=2)
        # Still out of an 8 m reach at 0.8 s, inside it soon after.
        self.assertGreater(distance(depot_offset_at(depot, 0.8)), 8.0)
        self.assertLess(distance(depot_offset_at(depot, 0.82)), 8.0)
        for t in (0.9, 1.0, 10.0, 25.0):
            self.assertLess(distance(depot_offset_at(depot, t)), 1e-4, t)

    def test_a_direct_depot_carries_no_sweep(self) -> None:
        [depot] = logic_object_record(self.lib, self.lib.object("GasDamage"))["depots"]
        self.assertNotIn("sweep", depot)
        self.assertEqual([0.0, 1.0, 0.0], depot["translation"])
        self.assertEqual([0.0, 1.0, 0.0], depot_offset_at(depot, 5.0))

    def test_the_round_spawner_record_carries_the_logic_depot(self) -> None:
        [spawner] = round_spawners(self.lib, self.lib.object("Hand-GasbombeProjectile"))
        entry = spawner["objects"]["GasGrenadeDamage"]
        self.assertIs(False, entry["drawn"])
        self.assertEqual("GasGrenade_area_damage_depot", entry["logic"]["depots"][0]["template"])
        self.assertIn("sweep", entry["logic"]["depots"][0])
        self.assertIs(True, spawner["spawnDelayAtStart"])
        self.assertEqual(4.0, spawner["minSpawnDelay"])


class EffectSpawnerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lib = library()

    def test_bundle_tree_keeps_an_objectspawner_child(self) -> None:
        tree = effects_mod.bundle_tree(self.lib, "e_BurningFlameEffect")
        self.assertIsNotNone(tree)
        self.assertFalse(tree.empty)
        self.assertEqual(["FireDamageSpawner"], [ref.template for ref in tree.spawners])

    def test_the_bake_writes_the_spawner_on_its_bundle(self) -> None:
        pool = ArchivePool()
        assembler = Assembler(pool, pool, pool, self.lib)
        builder = gltf.GlbBuilder()
        report = Report(root="effects", configuration="complex", lod=0)
        roots, index = assembler.bake_effect_library(
            builder, ["e_BurningFlameEffect", "e_FlamefuelGrnd"], report)
        self.assertEqual(2, len(roots))
        glb = builder.build(roots, extras={"effects": index})
        length = struct.unpack_from("<I", glb, 12)[0]
        doc = json.loads(glb[20:20 + length])
        bundles = [n["extras"]["effectBundle"] for n in doc["nodes"]
                   if (n.get("extras") or {}).get("effectBundle")]
        carrying = [b for b in bundles if b.get("spawners")]
        # Once as a root, once nested in e_FlamefuelGrnd.
        self.assertEqual(2, len(carrying))
        [spawner] = carrying[0]["spawners"]
        self.assertEqual("FireDamageSpawner", spawner["template"])
        self.assertEqual({"1": "FireDamage", "2": "FireDamage"}, spawner["templates"])
        self.assertEqual(1.0, spawner["minSpawnDelay"])
        entry = spawner["objects"]["FireDamage"]
        self.assertIs(False, entry["drawn"])
        [depot] = entry["logic"]["depots"]
        self.assertEqual(5.0, depot["radius"])
        self.assertLess(distance(depot_offset_at(depot, 0.9)), 1e-4)
        self.assertTrue(all(b.get("timeToLive") for b in carrying))


if __name__ == "__main__":
    unittest.main()
