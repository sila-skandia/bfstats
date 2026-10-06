"""A level's own effects, and the objects spawn effects stand up
(`viewer/effects.js`, `viewer/effect-objects.js`, `viewer/vehicle-wrecks.js`),
driven headless by `effect_objects_harness.mjs`.

The engine rules (ledger EMT-10, ARM-11): an emitter with `isSpawnEffect 1`
makes no particle, the game creates its template as a real object at the spawn
point in the emitter's frame (`Emitter::handleUpdate` lnxded 0x081e3200 ->
`GameServer::spawnObject` 0x08132440); and every armour tier, the death tier
included, is a child of its object at the authored offset with no turn of its
own (`Armor::playEffect` 0x08172960). A level's own scripts run before the
mod's (`extract_map.LevelFirst`), so the bundles it declares are its own.

The install-gated case bakes Desert Combat's No Fly Zone and kills its control
tower: the death tier names `e_air_control_tower_desWRECKPCO`, which only the
level declares, and which stands the ruined tower up where the tower stood.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_models import DEFAULT_GAME_DIR  # noqa: E402

HARNESS = Path(__file__).with_name("effect_objects_harness.mjs")
GAME = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))


def run_harness(*args: Path) -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS), *map(str, args)],
                          capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class SyntheticTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_a_levels_bundles_answer_first_while_it_is_up(self) -> None:
        library = self.results["library"]
        self.assertEqual({"own": False, "names": 2}, library["before"])
        self.assertEqual({"own": True, "shadowed": True, "modOnly": True, "names": 3},
                         library["during"])
        self.assertEqual({"own": False, "names": 2}, library["after"])

    def test_a_death_tier_plays_once_in_the_dying_objects_frame(self) -> None:
        # Before, `showDamageTier` started the death tier and `wreckVehicle`
        # stood it up a second time at the hull's origin on the ground's
        # normal, offsets lost. Now each entry plays once, on an anchor at its
        # offset, turned with the hull (ARM-11).
        plays = [p for p in self.results["deathFrame"] if p["phase"] == "death"]
        self.assertEqual(["e_ExplGas", "e_ScrapAABase", "e_ScrapAABase"],
                         [p["name"] for p in plays])
        self.assertTrue(all(p["attached"] and p["position"] is None for p in plays))
        self.assertEqual([10, 1.2, 20], plays[0]["at"]["position"])
        self.assertEqual([-1, 0, 0], plays[0]["at"]["forward"])
        # Two entries of one bundle are two places: 6.6 m and -4.599 m along
        # the hull's right (world -z here), both 3 m ahead (glb -z, world -x).
        self.assertEqual([[7, 0.1, 13.4], [7, 0.1, 24.599]],
                         [p["at"]["position"] for p in plays[1:]])

    def test_a_hull_with_no_death_tier_gets_the_stand_in_once(self) -> None:
        plays = [p for p in self.results["standIn"] if p["phase"] == "death"]
        self.assertEqual([{"name": "e_ExplGas", "attached": False, "position": [-5, 2, 7]}],
                         [{k: p[k] for k in ("name", "attached", "position")} for p in plays])


class SpawnedBodyTests(unittest.TestCase):
    """A spawned object's body is its template's (PHY-17, PHY-3): an
    `Elco80Raft`-shaped raft stood up 0.47 m under the water, where an
    `Elco80` afloat stands it, rises to the float law's rest and stays."""

    raft: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.raft = run_harness()["raft"]

    def test_a_mobile_raft_floats_up_to_the_float_laws_rest(self) -> None:
        float_ = self.raft["float"]
        self.assertEqual("float", float_["kind"])
        self.assertEqual(0.068, float_["rest"])
        # It rises, it does not snap: still under after half a second, at rest
        # within two.
        trace = dict(float_["trace"])
        self.assertLess(trace[15], -0.2)
        self.assertAlmostEqual(0.068, trace[60], delta=0.002)
        self.assertAlmostEqual(0.068, float_["end"], delta=0.001)
        self.assertEqual(1, float_["level"])

    def test_a_raft_dropped_from_above_comes_down_onto_the_water(self) -> None:
        # Pirates' dinghy would be stood up 4.4 m above the water.
        dropped = self.raft["dropped"]
        self.assertEqual("float", dropped["kind"])
        self.assertAlmostEqual(0.068, dropped["end"], delta=0.002)

    def test_without_mobile_physics_it_stays_where_it_was_stood(self) -> None:
        immobile = self.raft["immobile"]
        self.assertEqual("static", immobile["kind"])
        self.assertEqual({-0.47}, {y for _, y in immobile["trace"]})

    def test_on_dry_land_it_falls_onto_the_ground(self) -> None:
        # The hull box hangs 0.3 m under the origin: it rests 0.3 m over 3.
        for case in ("dryLand", "noWater"):
            with self.subTest(case):
                self.assertEqual("ground", self.raft[case]["kind"])
                self.assertAlmostEqual(3.3, self.raft[case]["end"], delta=0.001)


class SpawnedWorldTests(unittest.TestCase):
    """What a spawn effect stands up is an object of the world (EMT-10):
    solid in the level's collider and shootable through its damageables, the
    way a placed static is. The real collider, damage set and wreck module,
    with a ruin shaped like `air_control_tower_des_wreck` and the raft."""

    world: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.world = run_harness()["world"]

    def test_each_object_takes_an_owner_id_after_the_levels_own(self) -> None:
        self.assertEqual({"ruin": 2, "raft": 1}, self.world["owners"])
        self.assertEqual(["ground_slab", "Elco80Raft", "air_control_tower_des_wreck"],
                         self.world["ownerNodes"])
        self.assertEqual(24, self.world["trisAdded"])   # two boxes of 12

    def test_a_soldier_stands_on_the_ruin(self) -> None:
        # A 0.4 m sphere coming down onto the 20 m roof stops on it.
        self.assertEqual({"owner": 2, "y": 20.4}, self.world["boot"])

    def test_a_round_lands_on_the_ruin_and_costs_it_hit_points(self) -> None:
        self.assertEqual({"owner": 2, "x": 25, "material": 51}, self.world["round"])
        self.assertEqual({"lost": 50, "hp": 999949}, self.world["hit"])
        self.assertEqual([1, 2], self.world["damageables"])

    def test_the_floating_raft_is_met_where_it_floats_now(self) -> None:
        # Registered 0.47 m under; its hull's top is met at +0.068 + 0.5.
        self.assertEqual(0.068, self.world["raftY"])
        self.assertEqual({"owner": 1, "y": 0.568}, self.world["raftTop"])
        self.assertEqual([-30, 0.068, 30], self.world["raftPosition"])

    def test_the_damage_system_shows_its_tier_and_nothing_puts_it_back(self) -> None:
        self.assertEqual(["e_PanzFire"], self.world["tierPlays"])
        self.assertEqual(0, self.world["startedByAdopt"])
        self.assertEqual([{"owner": 1, "spawned": True, "spawnDelay": None},
                          {"owner": 2, "spawned": True, "spawnDelay": None}],
                         self.world["visuals"])


class SpawnedRemovalTests(unittest.TestCase):
    """What removes a spawned object (EMT-11): its Armor's death and then its
    template's `timeToLiveAfterDeath` (HP-19), or the round's end (HP-20).
    No spawner made it, so nothing else does."""

    removal: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.removal = run_harness()["removal"]

    def test_a_sunk_raft_is_gone_with_its_hull_and_armor(self) -> None:
        # Both rafts write `timeToLiveAfterDeath 0`.
        self.assertFalse(self.removal["raftHeld"])
        self.assertFalse(self.removal["raftInScene"])
        self.assertEqual("water", self.removal["raftHit"])
        self.assertFalse(self.removal["raftDamageable"])
        self.assertEqual(["air_control_tower_des_wreck"], self.removal["objectsAfterRaft"])

    def test_an_unhurt_ruin_stands_until_the_round_ends(self) -> None:
        self.assertTrue(self.removal["ruinAfterTenMinutes"])
        self.assertEqual({"held": 0, "objects": 0, "ruinInScene": False, "removed": 2,
                          "ruinSolid": None, "damageables": []},
                         self.removal["afterRoundEnd"])


class BoatDeathTests(unittest.TestCase):
    """A boat a round kills afloat dies in the water: the `-1` tier
    (ARM-11), which is where a PT boat's raft comes from. `reconcileDamaged`
    re-picked it as if on land, so no shot boat ever left one."""

    def test_afloat_the_water_tier_beached_the_land_one(self) -> None:
        self.assertEqual({"afloat": [-1], "beached": [0]}, run_harness()["boatDeath"])


class HullLessRemovalTests(unittest.TestCase):
    """A spawned object with no hulls gets no owner id and no damageable, so
    `adopt` starts its living tier itself; the round's end takes the object
    and must take that tier's run with it, or a burning loop outlives it."""

    def test_the_round_end_stops_the_tier_adopt_started(self) -> None:
        hullless = run_harness()["hullless"]
        self.assertEqual({"owner": -1, "tiers": 1, "stopped": 0}, hullless["before"])
        self.assertEqual(1, hullless["removed"])
        self.assertEqual(0, hullless["held"])
        self.assertEqual(["e_PanzFire"], hullless["stopped"])


class WaterDeathTierTests(unittest.TestCase):
    """Every way a hull dies picks the same death tier (ARM-11: `-1` in the
    water): a round, a bomb's splash and a crash, on vanilla's own tier
    tables (`water_death_tier_harness.mjs`). A land vehicle or a plane in the
    water dies on its own `-1` (`WaterWaterExplosion`), a plane over the sea
    and a tank on a bridge on their land tier, and a ship with no `-1` on its
    `0`. Before the round path passed the water test, only a crash could
    leave a PT boat's raft."""

    WANT = {"elcoAfloat": [-1], "elcoBeached": [0], "shermanInRiver": [-1],
            "shermanOnLand": [0], "shermanOnBridge": [0], "spitfireOverSea": [0],
            "spitfireDitched": [-1], "destroyerAfloat": [0]}

    def test_a_round_a_bomb_and_a_crash_agree(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        harness = Path(__file__).with_name("water_death_tier_harness.mjs")
        proc = subprocess.run(["node", str(harness)], capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode, proc.stderr)
        result = json.loads(proc.stdout)
        for by in ("round", "bomb", "crash"):
            self.assertEqual(self.WANT, result[by], by)


@unittest.skipUnless((GAME / "Mods" / "bf1942").is_dir(), "no Battlefield 1942 install")
class BakedRaftTests(unittest.TestCase):
    """Vanilla's `e_PTBoatWreck` as `extract_effects.py` bakes it: the raft
    carries its four floaters and the bit that makes it mobile."""

    result: dict

    @classmethod
    def setUpClass(cls) -> None:
        from bf42 import gltf
        from bf42.assemble import Assembler, Report
        from extract_models import build_library, build_pools, mod_chain
        chain = mod_chain(GAME, "bf1942")
        meshes, textures, objects, _game = build_pools(chain, [])
        library = build_library(objects)
        assembler = Assembler(meshes, textures, objects, library,
                              include_collision=False, max_texture=16)
        assembler.apply_material_diffuse = True
        assembler.additive_alpha_test = True
        builder = gltf.GlbBuilder()
        report = Report(root="effects", configuration="complex", lod=0)
        roots, cls.index = assembler.bake_effect_library(builder, ["e_PTBoatWreck"], report)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "effects.glb"
            path.write_bytes(builder.build(roots, extras={"effects": {}}))
            cls.result = run_harness(f"--raft={path}")["bakedRaft"]

    def test_the_baked_raft_floats_at_the_float_laws_rest(self) -> None:
        self.assertEqual("float", self.result["kind"])
        self.assertEqual(4, self.result["floats"])
        self.assertEqual(0.068, self.result["rest"])
        self.assertAlmostEqual(0.068, self.result["end"], delta=0.002)

    def test_the_baked_raft_carries_its_hulls(self) -> None:
        # The effects bake leaves particles hull-less; a spawned object is
        # solid, so its collision meshes are baked with it.
        self.assertGreater(self.result["hulls"], 0)


@unittest.skipUnless((GAME / "Mods" / "DesertCombat").is_dir(), "no Desert Combat install")
class NoFlyZoneTowerTests(unittest.TestCase):
    tower: dict

    @classmethod
    def setUpClass(cls) -> None:
        import extract_effects
        import scene_layers
        from bf42.assemble import _armor_effect_offset
        with tempfile.TemporaryDirectory() as tmp:
            ctx = scene_layers.LevelContext(GAME, "DesertCombat", "DC_No_Fly_Zone", out=Path(tmp))
            glb, cls.manifest = extract_effects.bake_level(ctx, max_texture=16)
            template = ctx.library.object("air_control_tower_des")
            armor = {
                "hitpoints": template.hitpoints,
                "effects": [{"hp": hp, "effect": name, "offset": _armor_effect_offset(offset)}
                            for hp, name, offset in template.armor_effects],
            }
            glb_path = Path(tmp) / "effects.glb"
            glb_path.write_bytes(glb)
            tower_path = Path(tmp) / "tower.json"
            tower_path.write_text(json.dumps({"name": template.name, "armor": armor}))
            cls.tower = run_harness(glb_path, tower_path)["tower"]

    def test_the_level_bakes_its_four_ruins(self) -> None:
        self.assertEqual(
            ["e_air_control_tower_desWRECKPCO", "e_air_hangar_bunker_WRECKPCO",
             "e_air_radardome_desWRECKPCO", "e_mil_hangar_desWRECKPCO"],
            sorted(self.manifest["bundles"]))
        self.assertEqual([], self.manifest["missing"])
        self.assertEqual(self.tower["levelBundles"], sorted(self.manifest["bundles"]))

    def test_destroying_the_tower_resolves_its_ruin(self) -> None:
        self.assertIn({"name": "e_air_control_tower_desWRECKPCO", "resolved": True,
                       "attached": True}, self.tower["deathPlays"])

    def test_the_ruin_stands_where_the_tower_stood(self) -> None:
        [ruin] = self.tower["spawned"]
        self.assertEqual("air_control_tower_des_wreck", ruin["name"])
        self.assertEqual("PlayerControlObject", ruin["kind"])
        self.assertEqual("e_air_control_tower_desWRECKPCO", ruin["spawnedBy"])
        self.assertEqual([-120, 31.5, 640], ruin["position"])
        self.assertEqual(0, ruin["headingError"])
        self.assertGreater(ruin["meshes"], 0)
        self.assertTrue(ruin["inScene"])
        self.assertEqual(1, self.tower["adopted"])

    def test_the_ruin_burns_with_its_own_tier(self) -> None:
        # 999999 hit points against one tier at 1000000: three smoke columns
        # and a fire from the first tick.
        self.assertEqual(["e_DefGunDamage"] * 3 + ["e_PanzFire"], self.tower["ruinTier"])

    def test_a_level_change_takes_the_ruin_away(self) -> None:
        self.assertEqual({"objects": 0, "inScene": 0}, self.tower["afterClear"])


if __name__ == "__main__":
    unittest.main()
