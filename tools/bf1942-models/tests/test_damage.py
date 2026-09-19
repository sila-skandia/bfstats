from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.damage import (  # noqa: E402
    SETTINGS_SCRIPT,
    Weapon,
    collect_weapons,
    load_tables,
)
from bf42.rfa import find_game_dir, find_levels_dir  # noqa: E402

# A miniature Game.rfa: the settings script `Run`s the define file and one
# weapon table, and names one expansion weapon that is not shipped, exactly as
# vanilla 1.6 does for the ten XPack weapons.
GAME_SCRIPTS = {
    "Bf1942/Game/materialManagerSettings.con": """
Run materialManagerdefine.con

rem *** Ground ***
MaterialManager.attGroup 0
MaterialManager.defGroup 50
MaterialManager.damageMod 0.01

run damage_system/Sherman
run\tdamage_system/GrenadeAxis
run Collision_Armor/HeavyArmor
run damage_system/Bombs
""",
    "Bf1942/Game/materialManagerdefine.con": """
rem *** Armor ***

MaterialManager.material 50
MaterialManager.materialAttGroup 50
MaterialManager.materialDefGroup 50
MaterialManager.materialDamage 1

MaterialManager.material 54
MaterialManager.materialAttGroup 54
MaterialManager.materialDefGroup 54
MaterialManager.materialDamage 1

rem *********************************
REM **** ALLIED LIGHT TANK ********
MaterialManager.material 236
MaterialManager.materialAttGroup 236
MaterialManager.materialDefGroup 236
MaterialManager.materialDamage 10

rem **** Sherman splash ****
MaterialManager.material 206
MaterialManager.materialAttGroup 206
MaterialManager.materialDefGroup 206
MaterialManager.materialDamage 8

rem *** Terrain ***
MaterialManager.material 2
MaterialManager.materialAttGroup 2
MaterialManager.materialDefGroup 2
MaterialManager.materialDamage 30
MaterialManager.materialFriction 0.8
MaterialManager.materialElasticity 0
MaterialManager.materialResistance 0.02

rem *** Paved road ***
MaterialManager.material 15
MaterialManager.materialAttGroup 15
MaterialManager.materialDefGroup 15
MaterialManager.materialDamage 30
MaterialManager.materialFriction 1.1
MaterialManager.materialElasticity 0
MaterialManager.materialResistance 0.01

rem Grenades
MaterialManager.material 70
MaterialManager.materialAttGroup 70
MaterialManager.materialDefGroup 70
MaterialManager.materialDamage 30
MaterialManager.materialFriction 2.0
MaterialManager.materialElasticity 2.0
MaterialManager.materialResistance 2.0

rem an alias whose groups differ from its id
MaterialManager.material 300
MaterialManager.materialAttGroup 236
MaterialManager.materialDefGroup 50
MaterialManager.materialDamage 10

rem a defensive line the ancient authors left running -- must not load
BeginRem
MaterialManager.material 227
MaterialManager.materialAttGroup 227
MaterialManager.materialDefGroup 227
MaterialManager.materialDamage 999
EndRem
""",
    "bf1942/game/damage_system/sherman.con": """
rem ***** Sherman gun explosion SPLASH DAMAGE *****
MaterialManager.attGroup 206
MaterialManager.defGroup 50
MaterialManager.damageMod 1.5
MaterialManager.setEffectTemplate e_ExplArmor

rem ***** Sherman gun explosion - DIRECT DAMAGE *****
MaterialManager.attGroup 236
MaterialManager.defGroup 50
MaterialManager.damageMod 10
MaterialManager.setEffectTemplate e_ExplArmor

MaterialManager.attGroup 236
MaterialManager.defGroup 54
MaterialManager.damageMod 1
MaterialManager.setEffectTemplate e_ExplArmor

rem a cell that exists only to hang an effect on -- damageMod stays 1.0
MaterialManager.attGroup 236
MaterialManager.defGroup 90
MaterialManager.setEffectTemplate e_collision_metal

BeginRem
rem an abandoned rewrite of the Sherman-vs-90 cell -- must not load
MaterialManager.attGroup 236
MaterialManager.defGroup 90
MaterialManager.damageMod 500
EndRem
""",
    "Bf1942/Game/Collision_Armor/HeavyArmor.con": """
MaterialManager.attGroup 50
MaterialManager.defGroup 54
MaterialManager.damageMod 0.1
""",
    "bf1942/game/damage_system/bombs.con": """
MaterialManager.attGroup 202
MaterialManager.setCell 50 7
MaterialManager.setCell 54 2
""",
}


def resolve(name: str) -> bytes | None:
    lowered = name.lower()
    for key, text in GAME_SCRIPTS.items():
        if key.lower() == lowered:
            return text.encode("latin-1")
    return None


class LoadTablesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tables = load_tables(resolve)

    def test_run_chain_is_followed_and_missing_targets_are_recorded(self) -> None:
        self.assertEqual(
            [
                SETTINGS_SCRIPT,
                "bf1942/game/materialManagerdefine.con",
                "bf1942/game/damage_system/Sherman.con",
                "bf1942/game/Collision_Armor/HeavyArmor.con",
                "bf1942/game/damage_system/Bombs.con",
            ],
            self.tables.scripts,
        )
        self.assertEqual(
            ["bf1942/game/damage_system/GrenadeAxis.con"],
            self.tables.missing_scripts,
        )

    def test_beginrem_endrem_block_is_skipped_case_insensitively(self) -> None:
        # material 227 is declared only inside a BeginRem/EndRem block; a
        # parser that only skips single `rem` lines would load it (and the
        # phantom cell it would create), which is exactly ledger V4 #16.
        self.assertNotIn(227, self.tables.materials)

    def test_beginrem_endrem_block_does_not_overwrite_a_real_cell(self) -> None:
        # The block in Sherman.con tries to rewrite the (236, 90) cell to 500
        # after it was already created at 1.0 by `setEffectTemplate`; the
        # rewrite must never apply.
        self.assertEqual(1.0, self.tables.modifier(236, 90))

    def test_setcell_writes_the_current_attgroup_against_its_own_argument(self) -> None:
        # `MaterialManager.setCell <defGroup> <damageMod>`: the defGroup comes
        # from setCell's own first argument, not from a `defGroup` cursor line
        # (bombs.con never sets one).
        self.assertEqual(7.0, self.tables.modifier(202, 50))
        self.assertEqual(2.0, self.tables.modifier(202, 54))

    def test_effect_only_cell_defaults_to_one_not_zero(self) -> None:
        # `setEffectTemplate` with no `damageMod` line still creates the cell
        # (`getCreateCell`), and `MMCell::MMCell` seeds a created cell at 1.0 —
        # not the 0.0 a truly absent pair returns.
        self.assertEqual(1.0, self.tables.modifier(236, 90))
        self.assertEqual("e_collision_metal", self.tables.effects[(236, 90)])
        # A pair with no cell at all is still None, not 0.0 or 1.0.
        self.assertIsNone(self.tables.modifier(236, 999))

    def test_material_elasticity_and_resistance_are_read_and_optional(self) -> None:
        self.assertAlmostEqual(0.0, self.tables.materials[2].elasticity)
        self.assertAlmostEqual(0.02, self.tables.materials[2].resistance)
        self.assertIsNone(self.tables.materials[236].elasticity)
        self.assertIsNone(self.tables.materials[236].resistance)

    def test_as_dict_omits_elasticity_and_resistance_unless_authored(self) -> None:
        data = self.tables.as_dict()
        self.assertEqual(0.0, data["materials"]["2"]["elasticity"])
        self.assertEqual(0.02, data["materials"]["2"]["resistance"])
        self.assertNotIn("elasticity", data["materials"]["236"])
        self.assertNotIn("resistance", data["materials"]["236"])

    def test_material_definition_carries_groups_damage_and_heading(self) -> None:
        tank_round = self.tables.materials[236]
        self.assertEqual((236, 236, 10.0), (tank_round.att_group, tank_round.def_group, tank_round.damage))
        self.assertEqual("ALLIED LIGHT TANK", tank_round.label)
        # A decorative rem line of asterisks is not a heading.
        self.assertEqual("Armor", self.tables.materials[50].label)

    def test_material_friction_is_read_and_defaults_to_one(self) -> None:
        # PHY-2: `MaterialManager.materialFriction` is the Coulomb
        # coefficient `ResponsePhysics::addFriction` spends. Only the terrain
        # materials (plus grenades and stairs) author it; everything else
        # keeps the `Material` constructor's 1.0, which is also what an id
        # the define file never mentions falls back to through material 0.
        self.assertAlmostEqual(0.8, self.tables.materials[2].friction)
        self.assertAlmostEqual(1.1, self.tables.materials[15].friction)
        self.assertAlmostEqual(1.0, self.tables.materials[50].friction)
        self.assertEqual(0.8, self.tables.materials[2].as_dict()["friction"])
        self.assertEqual(1.0, self.tables.materials[236].as_dict()["friction"])

    def test_the_grenade_material_carries_the_one_authored_elasticity(self) -> None:
        # COL-2. `getElasticityForMaterial` (lnxded 0x081751f0) reads
        # `Material+0x10` and `getResistanceForMaterial` (0x08175230) `+0x14`.
        # The constructor defaults are elasticity 0 and resistance 0.01, and
        # a material that declares neither is emitted WITHOUT the words (see
        # the two tests above): the fallback lives with the consumer --
        # `contact-response.js`'s `materialProperty` and `crash-damage.js`'s
        # `definedField` -- and it is the constructor's, NOT friction's 1.0.
        self.assertAlmostEqual(0.0, self.tables.materials[2].elasticity)
        self.assertAlmostEqual(0.02, self.tables.materials[2].resistance)
        self.assertAlmostEqual(0.01, self.tables.materials[15].resistance)
        # Material 70 "Grenades" is the one vanilla material with a non-zero
        # elasticity, and 2.0 is exactly the value that makes the pair mean
        # 1.0 against any surface -- so `v * (1 - e) / 2` is zero and a
        # grenade cancels its into-surface velocity rather than rebounding.
        grenade = self.tables.materials[70]
        self.assertAlmostEqual(2.0, grenade.elasticity)
        self.assertAlmostEqual(2.0, grenade.friction)
        self.assertAlmostEqual(2.0, grenade.resistance)
        emitted = grenade.as_dict()
        self.assertEqual(2.0, emitted["elasticity"])
        self.assertEqual(2.0, emitted["resistance"])

    def test_modifier_is_keyed_by_group_not_material_id(self) -> None:
        self.assertEqual(10.0, self.tables.modifier(236, 50))
        self.assertEqual(1.0, self.tables.modifier(236, 54))
        # Material 300 aliases att group 236 and def group 50.
        self.assertEqual(1.0, self.tables.modifier(300, 54))
        self.assertEqual(10.0, self.tables.modifier(236, 300))
        self.assertIsNone(self.tables.modifier(236, 99))

    def test_direct_damage_follows_the_documented_formula(self) -> None:
        # Sherman gun into the Sherman's rear: 10 base * 10 mod = 100, a one-shot kill.
        self.assertAlmostEqual(100.0, self.tables.direct_damage(236, 50))
        # Front plate at 60 degrees: 10 * 1 * cos(60) = 5.
        self.assertAlmostEqual(5.0, self.tables.direct_damage(236, 54, angle_degrees=60))
        self.assertAlmostEqual(
            10.0 * math.cos(math.radians(30)) * 0.5,
            self.tables.direct_damage(236, 54, angle_degrees=-30, distance_mod=0.5),
        )
        self.assertIsNone(self.tables.direct_damage(236, 99))
        self.assertIsNone(self.tables.direct_damage(999, 50))

    def test_splash_damage_falls_off_linearly_to_the_radius(self) -> None:
        self.assertAlmostEqual(12.0, self.tables.splash_damage(206, 50))
        self.assertAlmostEqual(6.0, self.tables.splash_damage(206, 50, distance=4, radius=8))
        self.assertAlmostEqual(0.0, self.tables.splash_damage(206, 50, distance=9, radius=8))
        self.assertIsNone(self.tables.splash_damage(206, 54))

    def test_effects_are_kept_per_pair(self) -> None:
        self.assertEqual("e_ExplArmor", self.tables.effects[(236, 50)])

    def test_as_dict_groups_modifiers_by_attack_group(self) -> None:
        data = self.tables.as_dict()
        self.assertEqual({"50": 10.0, "54": 1.0, "90": 1.0}, data["modifiers"]["236"])
        self.assertEqual(10.0, data["materials"]["236"]["damage"])
        self.assertEqual(["bf1942/game/damage_system/GrenadeAxis.con"], data["missingScripts"])


class CollectWeaponsTests(unittest.TestCase):
    SCRIPTS = {
        "Objects/Vehicles/Land/Sherman/Weapons.con": """
ObjectTemplate.create FireArms ShermanGunBarrel
ObjectTemplate.projectileTemplate ShermanProjectile
ObjectTemplate.magSize 30
ObjectTemplate.velocity 100
ObjectTemplate.reloadtime 0.35
ObjectTemplate.roundOfFire 0.35

ObjectTemplate.create Projectile ShermanProjectile
ObjectTemplate.damageType 1
ObjectTemplate.material 236
ObjectTemplate.material2 206
""",
        "Objects/HandWeapons/Colt/Objects.con": """
ObjectTemplate.create HandFireArms Colt
ObjectTemplate.projectileTemplate ColtProjectile
ObjectTemplate.velocity 400
ObjectTemplate.minDamage 0.5
ObjectTemplate.distToStartLoseDamage 20
ObjectTemplate.distToMinDamage 40
""",
        "Objects/HandWeapons/Common/Weapons.con": """
ObjectTemplate.create Projectile ColtProjectile
ObjectTemplate.material 214

ObjectTemplate.create Projectile OrphanProjectile
ObjectTemplate.material 250
ObjectTemplate.radius 20
""",
    }

    def setUp(self) -> None:
        self.weapons = {weapon.name: weapon for weapon in collect_weapons(self.SCRIPTS)}

    def test_launcher_is_joined_to_its_projectile(self) -> None:
        gun = self.weapons["ShermanGunBarrel"]
        self.assertEqual("ShermanProjectile", gun.projectile)
        self.assertEqual(("Sherman", "land"), (gun.owner, gun.category))
        self.assertEqual((236, 206, 1), (gun.material, gun.material2, gun.damage_type))
        self.assertEqual((30, 100.0, 0.35), (gun.mag_size, gun.velocity, gun.reload_time))

    def test_projectile_in_common_file_takes_the_launcher_folder_as_owner(self) -> None:
        colt = self.weapons["Colt"]
        self.assertEqual("ColtProjectile", colt.projectile)
        self.assertEqual("Colt", colt.owner)
        self.assertEqual("handweapon", colt.category)
        self.assertEqual(214, colt.material)

    def test_distance_falloff_is_read_from_the_launcher_when_the_projectile_lacks_it(self) -> None:
        colt = self.weapons["Colt"]
        self.assertEqual((0.5, 20.0, 40.0),
                         (colt.min_damage, colt.dist_to_start_lose_damage, colt.dist_to_min_damage))
        self.assertEqual(1.0, colt.distance_mod(10))
        self.assertAlmostEqual(0.75, colt.distance_mod(30))
        self.assertEqual(0.5, colt.distance_mod(60))
        # No declaration means the term is 1 at any range.
        self.assertEqual(1.0, self.weapons["ShermanGunBarrel"].distance_mod(500))

    def test_unlaunched_projectile_is_listed_under_its_own_name(self) -> None:
        orphan = self.weapons["OrphanProjectile"]
        self.assertEqual("OrphanProjectile", orphan.projectile)
        self.assertEqual(20.0, orphan.radius)
        self.assertEqual("Common", orphan.owner)

    def test_as_dict_omits_unset_fields(self) -> None:
        data = Weapon(name="X", projectile="X", owner="O", category="land", source="s").as_dict()
        self.assertEqual({"name", "projectile", "owner", "category", "source"}, set(data))


# The real vanilla install, if this machine has one -- same pattern as
# `test_kit.py`'s `WAKE_RFA`. Loads `Bf1942/Game/MaterialManagerSettings.con`
# and everything it `run`s, straight out of `Archives/bf1942/Game.rfa`.
BF1942_ARCHIVES = (Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
                   "/bf1942/Archives")
GAME_RFA = BF1942_ARCHIVES / "bf1942" / "Game.rfa"


@unittest.skipUnless(GAME_RFA.exists(), "needs the BF1942 install")
class VanillaMaterialManagerTests(unittest.TestCase):
    """V4 #14/#16: 158 materials, 5,153 cells -- not R4's original 155/5,165.

    The gap is exactly the two bugs this track fixes: 18 phantom cells parsed
    out of `BeginRem`/`EndRem` blocks, and 6 real cells `MaterialManager.setCell`
    writes that the old parser never saw at all.
    """

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import ArchivePool, find_archives_dir, find_game_dir

        game_dir = find_game_dir(BF1942_ARCHIVES)
        pool = ArchivePool()
        pool.add_dir(game_dir, ("game",))

        def resolve(name: str) -> bytes | None:
            return pool.read(name) if name in pool else None

        cls.tables = load_tables(resolve)

    def test_vanilla_loads_158_materials_and_5153_cells(self) -> None:
        self.assertEqual(158, len(self.tables.materials))
        self.assertEqual(5153, len(self.tables.modifiers))

    def test_vehicle_hull_materials_are_armour_1_0(self) -> None:
        for material_id in (45, 50, 51, 52, 60, 61, 63):
            self.assertAlmostEqual(1.0, self.tables.materials[material_id].damage,
                                   msg=f"material {material_id}")

    def test_groups_120_and_166_differ_from_their_ids(self) -> None:
        self.assertEqual((119, 119), (self.tables.materials[120].att_group,
                                      self.tables.materials[120].def_group))
        self.assertEqual((165, 165), (self.tables.materials[166].att_group,
                                      self.tables.materials[166].def_group))

    def test_hull_vs_hull_cells_match_the_spec(self) -> None:
        # collision-response.md #9.4: (45|50|51|52) <-> (60|61|63) both ways at
        # 0.1, and material 90 pays nothing as a defender.
        for att, deff in ((45, 60), (45, 61), (45, 63), (50, 60), (50, 61), (50, 63),
                          (60, 45), (61, 45), (63, 45), (50, 45), (51, 45), (52, 45)):
            self.assertAlmostEqual(0.1, self.tables.modifier(att, deff),
                                   msg=f"({att}, {deff})")
        for att in (45, 50, 51, 52):
            self.assertIsNone(self.tables.modifier(att, 90))


class ArchiveLayoutTests(unittest.TestCase):
    def test_game_and_levels_folders_are_found_case_insensitively(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            archives = Path(tmp) / "Archives"
            (archives / "BF1942" / "Levels").mkdir(parents=True)
            self.assertEqual(archives / "BF1942", find_game_dir(archives))
            self.assertEqual(archives / "BF1942" / "Levels", find_levels_dir(archives))
            self.assertIsNone(find_game_dir(Path(tmp)))
            self.assertIsNone(find_levels_dir(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
