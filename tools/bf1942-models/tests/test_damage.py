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

rem an alias whose groups differ from its id
MaterialManager.material 300
MaterialManager.materialAttGroup 236
MaterialManager.materialDefGroup 50
MaterialManager.materialDamage 10
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
""",
    "Bf1942/Game/Collision_Armor/HeavyArmor.con": """
MaterialManager.attGroup 50
MaterialManager.defGroup 54
MaterialManager.damageMod 0.1
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
            ],
            self.tables.scripts,
        )
        self.assertEqual(
            ["bf1942/game/damage_system/GrenadeAxis.con"],
            self.tables.missing_scripts,
        )

    def test_material_definition_carries_groups_damage_and_heading(self) -> None:
        tank_round = self.tables.materials[236]
        self.assertEqual((236, 236, 10.0), (tank_round.att_group, tank_round.def_group, tank_round.damage))
        self.assertEqual("ALLIED LIGHT TANK", tank_round.label)
        # A decorative rem line of asterisks is not a heading.
        self.assertEqual("Armor", self.tables.materials[50].label)

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
        self.assertEqual({"50": 10.0, "54": 1.0}, data["modifiers"]["236"])
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
