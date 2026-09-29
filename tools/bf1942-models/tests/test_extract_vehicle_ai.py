"""`extract_vehicle_ai.py`: the anti-aircraft flag is the unit's Armament.

`setIsAntiAircraft` sits on an `aiTemplatePlugIn` of kind Armament
(`AA_AlliesArmament`), never on a `weaponTemplate`. ConsoleClass550 (lnxded
0x08504dd0) writes it to `AITemplateArmament+0x5` and
`IPIArmamentReal::isAntiAircraft` (0x085e9b00) reads it back through the
unit's plug-in 4. The viewer used to look for it on the AI weapons, found it
on none, and every AA gun scored an aircraft as a non-AA gun does: not at all
past 150 m or above 15 m/s.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_vehicle_ai import GAME, basic_temp, control_info, extract, is_anti_aircraft, parse_objects_con  # noqa: E402

AA_ALLIES = """
rem *** Plugins ***
aiTemplatePlugIn.create Unit AA_AlliesUnit
aiTemplatePlugIn.setStrategicStrength 1 2

aiTemplatePlugIn.create Armament AA_AlliesArmament
aiTemplatePlugIn.setIsAntiAircraft 1

aiTemplatePlugIn.create Physical AA_AlliesPhysical
aiTemplatePlugIn.setStrType LightArmour

aiTemplate.create AA_Allies
aiTemplate.addPlugIn AA_AlliesUnit
aiTemplate.addPlugIn AA_AlliesArmament
aiTemplate.addPlugIn AA_AlliesPhysical

aiTemplatePlugIn.create Armament ShermanArmament

aiTemplate.create Sherman
aiTemplate.addPlugIn ShermanArmament
"""


class AntiAircraftTests(unittest.TestCase):
    def setUp(self):
        self.parsed = parse_objects_con(AA_ALLIES)

    def test_the_aa_guns_armament_is_anti_aircraft(self):
        self.assertTrue(is_anti_aircraft(self.parsed["templates"]["aa_allies"],
                                         self.parsed["plugIns"]))

    def test_an_armament_without_the_word_is_not(self):
        self.assertFalse(is_anti_aircraft(self.parsed["templates"]["sherman"],
                                          self.parsed["plugIns"]))

    def test_no_template_is_not(self):
        self.assertFalse(is_anti_aircraft(None, self.parsed["plugIns"]))


SHERMAN_TOP_MG = """
aiTemplatePlugIn.create ControlInfo ShermanTopMgCtrl
aiTemplatePlugIn.lookHorizontalControl      PIMouseLookX
aiTemplatePlugIn.lookVerticalControl        PIMouseLookY
rem aiTemplatePlugIn.pitchSensitivity           0.021817
aiTemplatePlugIn.pitchSensitivity           0.21817
aiTemplatePlugIn.rollSensitivity           -0.21817
aiTemplatePlugIn.pitchScale                 5.0
aiTemplatePlugIn.rollScale                  5.0
aiTemplatePlugIn.setCameraRelativeMinRotationDeg -360/-45/0
aiTemplatePlugIn.setCameraRelativeMaxRotationDeg 360/10/0

aiTemplatePlugIn.create ControlInfo DefGunCtrl
aiTemplatePlugIn.pitchScale                 0.1
aiTemplatePlugIn.rollScale                  0.1

aiTemplate.create ShermanTopMG
aiTemplate.addPlugIn ShermanTopMgCtrl

aiTemplate.create Defgun
aiTemplate.addPlugIn DefGunCtrl

aiTemplate.create Crate
"""


class ControlInfoTests(unittest.TestCase):
    """`mouseControlLookAtDirection` 0x08627b90 scales its counts by the
    seat's `pitchScale` / `rollScale` and signs them by the sensitivities."""

    def setUp(self):
        self.parsed = parse_objects_con(SHERMAN_TOP_MG)

    def test_the_seats_aim_numbers_and_camera_limits(self):
        c = control_info(self.parsed["templates"]["shermantopmg"], self.parsed["plugIns"])
        self.assertEqual(c["pitchSensitivity"], 0.21817)
        self.assertEqual(c["rollSensitivity"], -0.21817)
        self.assertEqual(c["pitchScale"], 5.0)
        self.assertEqual(c["rollScale"], 5.0)
        self.assertEqual(c["lookVerticalControl"], "PIMouseLookY")
        self.assertEqual(c["cameraMinDeg"], [-360.0, -45.0, 0.0])
        self.assertEqual(c["cameraMaxDeg"], [360.0, 10.0, 0.0])

    def test_a_gun_with_its_own_scale(self):
        c = control_info(self.parsed["templates"]["defgun"], self.parsed["plugIns"])
        self.assertEqual(c["pitchScale"], 0.1)
        self.assertEqual(c["rollScale"], 0.1)
        self.assertNotIn("pitchSensitivity", c)

    def test_a_template_without_one(self):
        self.assertIsNone(control_info(self.parsed["templates"]["crate"], self.parsed["plugIns"]))


FLAK = """
aiTemplatePlugIn.create Unit Flak38Unit
aiTemplatePlugIn.setStrategicStrength 0 0
aiTemplatePlugIn.setStrategicStrength 1 2
aiTemplatePlugIn.setUseNoPathfindingToGetToObject 1

aiTemplate.create Flak38
aiTemplate.addPlugIn Flak38Unit
aiTemplate.addType ITUnit
aiTemplate.addType ITGround
aiTemplate.addType ITFixed
aiTemplate.basicTemp 9
"""


class BasicTempTests(unittest.TestCase):
    """`calculateVehicleUrgency` 0x08583b10 adds `Information+0x14`, the unit's
    `aiTemplate.basicTemp` (ConsoleClass489 0x084ffe60 -> AITemplate+0x14 ->
    the `InformationReal` ctor 0x085e8730), not a strategic strength."""

    def test_the_templates_basic_temp_and_types(self):
        t = parse_objects_con(FLAK)["templates"]["flak38"]
        self.assertEqual(basic_temp(t), 9.0)
        self.assertEqual(t["types"], ["ITUnit", "ITGround", "ITFixed"])

    def test_none_without_a_template(self):
        self.assertIsNone(basic_temp(None))


@unittest.skipUnless((GAME / "bf1942" / "Archives" / "Objects.rfa").exists(), "no BF1942 install")
class VanillaExtractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vehicles = extract("bf1942")["vehicles"]

    def test_the_fixed_guns_carry_their_basic_temp(self):
        v = self.vehicles
        self.assertEqual(v["AA_Allies"]["basicTemp"], 9.0)
        self.assertEqual(v["Flak_38"]["seatsAi"]["flak38"]["basicTemp"], 9.0)
        self.assertTrue(v["Flak_38"]["useNoPathfinding"])
        self.assertEqual(v["Sherman"]["seatsAi"]["shermanBrowning_PCO1"]["basicTemp"], 5.0)
        self.assertIn("ITAir", v["Spitfire"]["types"])

    def test_the_stationary_guns_are_units(self):
        v = self.vehicles
        self.assertEqual(v["Stationary_Browning"]["class"], "Stationary")
        self.assertIn("BrowningUnlimited", v["Stationary_Browning"]["seatsAi"]["Stationary_Browning"]["aiWeapons"])
        self.assertIn("Stationary_mg42", v["Stationary_MG42"]["seatsAi"])


def _fake_archives(content: dict[str, dict[str, bytes]]):
    """A stand-in for `RfaArchive` keyed by filename (as `tests/test_kit.py`)."""
    class _FakeArchive:
        def __init__(self, path: Path) -> None:
            self._payloads = content.get(path.name, {})
            self.entries = list(self._payloads)

        def read(self, name: str) -> bytes:
            return self._payloads[name]

    return _FakeArchive


def _unit(folder: str, root: str, ai: str, *, seats: tuple[str, ...] = (),
          entry: bool = True, gun: str | None = None) -> dict[str, bytes]:
    """One unit folder: its Objects.con (a root PCO, extra seats, a door) and
    its AI/Objects.con (a Unit plug-in with a strategic strength)."""
    objects = [f"ObjectTemplate.create PlayerControlObject {root}",
               f"ObjectTemplate.aiTemplate {ai}"]
    for seat in seats:
        objects += [f"ObjectTemplate.addTemplate {seat}",
                    f"ObjectTemplate.create PlayerControlObject {seat}",
                    f"ObjectTemplate.aiTemplate {ai}"]
        if gun:
            objects.append(f"ObjectTemplate.addTemplate {gun}")
    if entry:
        objects.append(f"ObjectTemplate.create EntryPoint {root}Entry")
    ai_con = [f"aiTemplatePlugIn.create Unit {ai}Unit",
              "aiTemplatePlugIn.setStrategicStrength 1 2",
              f"aiTemplate.create {ai}", f"aiTemplate.addPlugIn {ai}Unit"]
    return {f"{folder}/Objects.con": "\n".join(objects).encode(),
            f"{folder}/AI/Objects.con": "\n".join(ai_con).encode()}


class ChainExtractTests(unittest.TestCase):
    """The table is the mod chain's, read the way the engine mounts it.

    Desert Combat names its archive `OBJECTS.rfa`, which the old single
    `Objects.rfa`/`objects.rfa` probe never opened on Linux, and DC Final's
    own `objects.rfa` holds only the 22 units it adds: without its parents'
    archives it lost the 54 it inherits. Units a level declares in its own
    archive (Urban Siege's `Nimitz`) come after, and only what can be boarded.
    """

    def extract(self) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp)
            child = game / "Mods" / "Child"
            parent = game / "Mods" / "Parent"
            (child / "Archives").mkdir(parents=True)
            levels = parent / "Archives" / "bf1942" / "levels"
            levels.mkdir(parents=True)
            (child / "init.con").write_text("game.addModPath Mods/Child/\n"
                                            "game.addModPath Mods/Parent/\n")
            (child / "Archives" / "OBJECTS.rfa").touch()
            (parent / "Archives" / "Objects.rfa").touch()
            (levels / "Siege.rfa").touch()
            gun = ("objects/Weapons/Gun/Objects.con",
                   b"ObjectTemplate.create FireArms Gun\nObjectTemplate.aiTemplate GunAI\n")
            content = {
                "OBJECTS.rfa": {
                    **_unit("objects/vehicles/land/Humvee", "Humvee", "HumveeAI",
                            seats=("Humvee_gunner",), gun="Gun"),
                    # The child's own copy of a gun the parent also declares.
                    "objects/Weapons/Gun/AI/Weapons.con":
                        b"weaponTemplate.create GunAI\nweaponTemplate.maxRange 300\n",
                    gun[0]: gun[1],
                },
                "Objects.rfa": {
                    **_unit("Objects/Vehicles/Sea/Carrier", "Carrier", "CarrierAI",
                            seats=("Carrier_CIWS",)),
                    "Objects/Weapons/Gun/AI/Weapons.con":
                        b"weaponTemplate.create GunAI\nweaponTemplate.maxRange 100\n",
                },
                "Siege.rfa": {
                    "bf1942/levels/Siege/Init.con": b"",
                    # A redeclared carrier with a variant only this level has.
                    **_unit("bf1942/levels/Siege/objects/Carrier", "Carrier", "CarrierAI",
                            seats=("Carrier_CIWS", "Carrier_Siege")),
                    **_unit("bf1942/levels/Siege/objects/Truck", "Truck", "TruckAI"),
                    # A building: AI and a hit-point PCO, but no door.
                    **_unit("bf1942/levels/Siege/Objects/Factory", "Factory", "FactoryAI",
                            entry=False),
                },
            }
            with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
                return extract("Child", game_dir=game)["vehicles"]

    def test_the_uppercase_archive_and_the_parents_units(self):
        v = self.extract()
        self.assertEqual("land", v["Humvee"]["class"])
        self.assertEqual("Sea", v["Carrier"]["class"])

    def test_the_nearest_mods_weapon_template_wins(self):
        seat = self.extract()["Humvee"]["seatsAi"]["Humvee_gunner"]
        self.assertEqual(300.0, seat["aiWeapons"]["GunAI"]["maxRange"])

    def test_a_levels_own_boardable_unit_is_added_and_a_building_is_not(self):
        v = self.extract()
        self.assertEqual("Siege", v["Truck"]["level"])
        self.assertNotIn("Factory", v)

    def test_a_levels_redeclared_unit_with_new_seats_is_kept_beside(self):
        v = self.extract()
        self.assertNotIn("level", v["Carrier"])
        self.assertIn("Carrier_Siege", v["Carrier@Siege"]["seats"])


DC = GAME / "DesertCombat"


@unittest.skipUnless(DC.is_dir() and (GAME / "DC_Final").is_dir(), "no Desert Combat install")
class DesertCombatExtractTests(unittest.TestCase):
    def test_desert_combat_reads_its_uppercase_archive(self):
        v = extract("DesertCombat")["vehicles"]
        for name in ("M1A1", "T72", "AH64", "Nimitz"):
            self.assertIn(name, v)
        self.assertEqual("DC_Urban_Siege", v["Nimitz@DC_Urban_Siege"]["level"])
        self.assertIn("Nimitz_Static_Heli_UrbS", v["Nimitz@DC_Urban_Siege"]["seats"])

    def test_dc_final_keeps_what_it_inherits(self):
        v = extract("DC_Final")["vehicles"]
        # Its own objects.rfa, Desert Combat's and vanilla's.
        for name in ("Humvee", "Patriot", "M1A1", "T72", "Sherman"):
            self.assertIn(name, v)
        self.assertEqual("DC_Al_Nas", v["nx_M-923"]["level"])


@unittest.skipUnless((GAME / "bf1942" / "Archives" / "Objects.rfa").exists(), "no BF1942 install")
class VanillaLevelUnitTests(unittest.TestCase):
    def test_levels_only_add_caens_pak40(self):
        chain_only = extract("bf1942", levels=False)["vehicles"]
        full = extract("bf1942")["vehicles"]
        self.assertEqual({"Pak40"}, set(full) - set(chain_only))
        self.assertEqual("Liberation_of_Caen", full["Pak40"]["level"])
        for name, record in chain_only.items():
            self.assertEqual(record, full[name])


if __name__ == "__main__":
    unittest.main()
