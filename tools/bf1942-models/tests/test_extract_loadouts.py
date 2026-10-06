from __future__ import annotations

import contextlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.kit import TeamLoadout, collect, parse_level_kits  # noqa: E402
from extract_loadouts import build_manifest, read_chain, read_chain_levels  # noqa: E402


class LoadoutManifestTests(unittest.TestCase):
    """The file the map page loads: kits by declared name, levels by directory."""

    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Items/JapKit/AntiTank/Objects.con", """
 ObjectTemplate.create Kit Jap_AT
 ObjectTemplate.setType AT
 ObjectTemplate.setKitTeam 1
 ObjectTemplate.setKitName 2 "RESPAWN_AT"
 ObjectTemplate.addTemplate Panzershreck
 ObjectTemplate.addTemplate WalterP38
 ObjectTemplate.addTemplate KnifeAxis
""")
        library.add_con("Objects/Items/USKit/AntiTank/Objects.con", """
 ObjectTemplate.create Kit Us_AT
 ObjectTemplate.setType AT
 ObjectTemplate.setKitTeam 2
 ObjectTemplate.setKitName 2 "RESPAWN_AT"
 ObjectTemplate.addTemplate Bazooka
 ObjectTemplate.addTemplate Colt
""")
        library.add_con("Objects/Items/USKit/Medic/Objects.con", """
ObjectTemplate.create Kit US_Medic
ObjectTemplate.setType Medic
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate Thompson
""")
        library.add_con("Objects/HandWeapons/Panzershreck/Objects.con", """
ObjectTemplate.create HandFireArms Panzershreck
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/Bazooka/Objects.con", """
ObjectTemplate.create HandFireArms Bazooka
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/Thompson/Objects.con", """
ObjectTemplate.create HandFireArms Thompson
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/WalterP38/Objects.con", """
ObjectTemplate.create HandFireArms WalterP38
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/Colt/Objects.con", """
ObjectTemplate.create HandFireArms Colt
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/KnifeAxis/Objects.con", """
ObjectTemplate.create HandFireArms KnifeAxis
ObjectTemplate.itemIndex 1
""")
        return library

    def manifest(self, init: str, level: str = "Wake",
                 lexicon: dict | None = None) -> dict:
        library = self.library()
        kits = collect(library)
        return build_manifest(library, kits, {level: parse_level_kits(init)},
                              "bf1942", lexicon)

    def test_levels_are_keyed_by_the_directory_the_map_extractor_writes(self) -> None:
        manifest = self.manifest("""
game.setTeamSkin 1 JapaneseSoldier
game.setKit 1 2 Jap_AT
game.setTeamSkin 2 USSoldier
game.setKit 2 2 us_at
game.setKit 2 3 US_Medic
""", level="Wake")
        self.assertEqual(["wake"], list(manifest["levels"]))
        wake = manifest["levels"]["wake"]
        self.assertEqual("JapaneseSoldier", wake["1"]["soldier"])
        self.assertEqual({"2": "Jap_AT"}, wake["1"]["slots"])
        # The level spelled `us_at`; the slot names the kit as declared, which
        # is the key the page uses into `kits`.
        self.assertEqual({"2": "Us_AT", "3": "US_Medic"}, wake["2"]["slots"])

    def test_kits_carry_their_primary_and_class(self) -> None:
        manifest = self.manifest("""
game.setKit 1 2 Jap_AT
game.setKit 2 2 Us_AT
""")
        self.assertEqual("Panzershreck", manifest["kits"]["Jap_AT"]["primary"])
        self.assertEqual("Anti-tank", manifest["kits"]["Jap_AT"]["class"])
        self.assertEqual("Japanese", manifest["kits"]["Jap_AT"]["nation"])
        self.assertEqual(1, manifest["kits"]["Jap_AT"]["team"])
        self.assertEqual("Bazooka", manifest["kits"]["Us_AT"]["primary"])
        self.assertEqual(["Bazooka", "Colt"], manifest["kits"]["Us_AT"]["items"])
        self.assertEqual(3, manifest["primaryItemIndex"])
        self.assertEqual("bf1942", manifest["mod"])

    def test_kit_name_carries_the_key_and_the_lexicon_resolves_it(self) -> None:
        # `setKitName 2 "RESPAWN_AT"` is a lexicon key, not a string: the
        # manifest keeps the key and resolves it through the mod chain's
        # lexicon, the same file the SkirmishMenu titles run through.
        manifest = self.manifest(
            "game.setKit 1 2 Jap_AT\ngame.setKit 2 2 Us_AT\n",
            lexicon={"RESPAWN_AT": "ANTI-TANK"})
        for name in ("Jap_AT", "Us_AT"):
            self.assertEqual(
                {"index": 2, "key": "RESPAWN_AT", "text": "ANTI-TANK"},
                manifest["kits"][name]["kitName"])

    def test_a_kit_name_key_the_lexicon_lacks_keeps_a_null_text(self) -> None:
        # The key is still emitted — the page falls back to its own layout's
        # resolved string — but the text is null rather than a guess.
        manifest = self.manifest("game.setKit 1 2 Jap_AT\n", lexicon={})
        self.assertEqual(
            {"index": 2, "key": "RESPAWN_AT", "text": None},
            manifest["kits"]["Jap_AT"]["kitName"])

    def test_without_a_lexicon_the_key_is_emitted_and_text_is_null(self) -> None:
        manifest = self.manifest("game.setKit 1 2 Jap_AT\n")
        self.assertEqual(
            {"index": 2, "key": "RESPAWN_AT", "text": None},
            manifest["kits"]["Jap_AT"]["kitName"])

    def test_only_kits_a_level_binds_are_listed(self) -> None:
        # US_Medic is declared but no level names it here.
        manifest = self.manifest("game.setKit 1 2 Jap_AT\n")
        self.assertEqual(["Jap_AT"], list(manifest["kits"]))

    def test_a_kit_the_library_lacks_keeps_its_name_in_the_slot(self) -> None:
        # Visible in the file rather than dropped: the page treats an unknown
        # kit as no primary and falls back.
        manifest = self.manifest("game.setKit 2 1 Canadian_Assault\n")
        self.assertEqual({"1": "Canadian_Assault"}, manifest["levels"]["wake"]["2"]["slots"])
        self.assertNotIn("Canadian_Assault", manifest["kits"])

    def test_an_empty_sweep_still_writes_a_well_formed_file(self) -> None:
        manifest = build_manifest(self.library(), {}, {}, "bf1942")
        self.assertEqual({}, manifest["kits"])
        self.assertEqual({}, manifest["levels"])

    def test_a_team_with_a_soldier_and_no_kits_is_kept(self) -> None:
        manifest = build_manifest(
            self.library(), collect(self.library()),
            {"Berlin": {1: TeamLoadout(soldier="GermanSoldier")}}, "bf1942")
        self.assertEqual({"soldier": "GermanSoldier", "slots": {}},
                         manifest["levels"]["berlin"]["1"])

    def test_kit_carries_healthbar_icons_weapon_icons_and_soldier_hitpoints(self) -> None:
        # Objects/Items/JapKit/AntiTank/Objects.con and
        # Objects/Soldiers/JapaneseSoldier/Objects.con, trimmed to the words
        # this round adds.
        library = ObjectLibrary()
        library.add_con("Objects/Items/JapKit/AntiTank/Objects.con", """
ObjectTemplate.create Kit Jap_AT
ObjectTemplate.setType AT
ObjectTemplate.setKitTeam 1
ObjectTemplate.setHealthBarIcon "Ingame/Healthbar_empty_at_64x64.tga"
ObjectTemplate.setHealthBarFullIcon "Ingame/Healthbar_full_at_64x64.tga"
ObjectTemplate.setKitIcon 1 "kits/Icon_antitank_jap_selected.tga"
ObjectTemplate.addTemplate Panzershreck
ObjectTemplate.addTemplate WalterP38
ObjectTemplate.addTemplate KnifeAxis
ObjectTemplate.addWeaponIcon "Weapon/Icon_panzershreck.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_walterp38.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_knifeaxis.tga"
""")
        library.add_con("Objects/HandWeapons/Panzershreck/Objects.con", """
ObjectTemplate.create HandFireArms Panzershreck
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/WalterP38/Objects.con", """
ObjectTemplate.create HandFireArms WalterP38
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/KnifeAxis/Objects.con", """
ObjectTemplate.create HandFireArms KnifeAxis
ObjectTemplate.itemIndex 1
""")
        library.add_con("Objects/Soldiers/JapaneseSoldier/Objects.con", """
ObjectTemplate.create BFSoldier JapaneseSoldier
ObjectTemplate.hitpoints 30
ObjectTemplate.maxhitpoints 30
""")
        kits = collect(library)
        manifest = build_manifest(library, kits, {
            "Wake": parse_level_kits(
                "game.setTeamSkin 1 JapaneseSoldier\n"
                "game.setKit 1 2 Jap_AT\n")},
            "bf1942")

        row = manifest["kits"]["Jap_AT"]
        self.assertEqual("Ingame/Healthbar_empty_at_64x64.tga", row["healthBarIcon"])
        self.assertEqual("Ingame/Healthbar_full_at_64x64.tga", row["healthBarFullIcon"])
        self.assertEqual({"index": 1, "icon": "kits/Icon_antitank_jap_selected.tga"},
                         row["kitIcon"])
        self.assertEqual(
            ["Weapon/Icon_panzershreck.tga", "Weapon/Icon_walterp38.tga",
             "Weapon/Icon_knifeaxis.tga"],
            row["weaponIcons"])
        self.assertEqual(30.0, row["hitpoints"])
        self.assertEqual(30.0, row["maxHitpoints"])
        # Untouched by this round.
        self.assertEqual("Japanese", row["nation"])
        self.assertEqual("Panzershreck", row["primary"])

    def test_a_kit_with_none_of_the_new_hud_words_reports_them_as_absent(self) -> None:
        # US_Medic in the shared fixture declares none of setHealthBarIcon /
        # setKitIcon / addWeaponIcon, and no level binds it to a soldier here.
        manifest = self.manifest("game.setKit 2 3 US_Medic\n")
        row = manifest["kits"]["US_Medic"]

        self.assertIsNone(row["healthBarIcon"])
        self.assertIsNone(row["kitIcon"])
        self.assertIsNone(row["kitName"])
        self.assertEqual([], row["weaponIcons"])
        self.assertIsNone(row["hitpoints"])
        self.assertIsNone(row["maxHitpoints"])


class PadKitManifestTests(unittest.TestCase):
    """`build_manifest(pads=)`: a kit a level's ObjectSpawners lay on a pad has
    a row, so the page can make the pad and arm whoever takes the kit. DC 0.7
    hands out its M82 and Stinger kits no other way (kit-pickups)."""

    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Items/USKit/Sniper_hvy/Objects.con", """
ObjectTemplate.create Kit US_Sniper_hvy
ObjectTemplate.setType Scout
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate M82Sniper
""")
        library.add_con("Objects/Items/USKit/Sniper/Objects.con", """
ObjectTemplate.create Kit US_Sniper
ObjectTemplate.setType Scout
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate M25Sniper
""")
        library.add_con("Objects/HandWeapons/M82Sniper/Objects.con", """
ObjectTemplate.create HandFireArms M82Sniper
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/M25Sniper/Objects.con", """
ObjectTemplate.create HandFireArms M25Sniper
ObjectTemplate.itemIndex 3
""")
        for soldier, hitpoints in (("IraqSoldier", 30), ("USSoldier", 40), ("USSoldierB", 50)):
            library.add_con(f"Objects/Soldiers/{soldier}/Objects.con", f"""
ObjectTemplate.create BFSoldier {soldier}
ObjectTemplate.hitpoints {hitpoints}
ObjectTemplate.maxhitpoints {hitpoints}
""")
        return library

    def build(self, pads: dict | None) -> dict:
        library = self.library()
        loadouts = {
            # Sorted first: a pad here, and the bound sniper kit on a pad too.
            "Aaa": parse_level_kits("game.setTeamSkin 1 IraqSoldier\n"
                                    "game.setTeamSkin 2 USSoldier\n"),
            "Zzz": parse_level_kits("game.setTeamSkin 1 IraqSoldier\n"
                                    "game.setTeamSkin 2 USSoldierB\n"
                                    "game.setKit 2 0 US_Sniper\n"),
        }
        return build_manifest(library, collect(library), loadouts, "M", pads=pads)

    def test_a_kit_only_a_pad_names_gets_a_row(self) -> None:
        manifest = self.build({"Aaa": {"us_sniper_hvy": "US_Sniper_Hvy", "ust": "UST"}})
        row = manifest["kits"]["US_Sniper_hvy"]
        self.assertEqual("M82Sniper", row["primary"])
        # The hit points of the level's soldier on the kit's own side (2).
        self.assertEqual(40.0, row["hitpoints"])
        # No slot names it: the levels' slots are as they were.
        self.assertEqual({}, manifest["levels"]["aaa"]["2"]["slots"])
        self.assertNotIn("UST", manifest["kits"])

    def test_without_pads_it_has_none(self) -> None:
        self.assertNotIn("US_Sniper_hvy", self.build(None)["kits"])

    def test_a_bound_kit_keeps_its_slots_row(self) -> None:
        # A pad on an earlier level does not change the row the slot gives:
        # its soldier stays the slot's (USSoldierB, 50), not Aaa's.
        with_pad = self.build({"Aaa": {"us_sniper": "US_Sniper"}})
        without = self.build(None)
        self.assertEqual(without["kits"]["US_Sniper"], with_pad["kits"]["US_Sniper"])
        self.assertEqual(50.0, with_pad["kits"]["US_Sniper"]["hitpoints"])


class KitWeaponSlotTests(unittest.TestCase):
    """The kit's inventory as the number keys raise it: each carried weapon's
    `itemIndex` slot with the weapon-bar icon at the same position of the
    kit's slot-ordered `addWeaponIcon` row."""

    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Items/USKit/Medic/Objects.con", """
ObjectTemplate.create Kit US_Medic
ObjectTemplate.setType Medic
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate Thompson
ObjectTemplate.addTemplate Colt
ObjectTemplate.addTemplate KnifeAllies
ObjectTemplate.addTemplate MedPack
ObjectTemplate.addTemplate GrenadeAllies
ObjectTemplate.addWeaponIcon "Weapon/Icon_alliesKnife.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_colt.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_thompson.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_grenadeallies.tga"
ObjectTemplate.addWeaponIcon "Weapon/Icon_medpack.tga"
""")
        for name, index in (("Thompson", 3), ("Colt", 2), ("KnifeAllies", 1),
                            ("MedPack", 5), ("GrenadeAllies", 4)):
            library.add_con(f"Objects/HandWeapons/{name}/Objects.con", f"""
ObjectTemplate.create HandFireArms {name}
ObjectTemplate.itemIndex {index}
""")
        return library

    def manifest(self) -> dict:
        library = self.library()
        return build_manifest(library, collect(library),
                              {"Wake": parse_level_kits("game.setKit 2 3 US_Medic\n")},
                              "bf1942")

    def test_weapons_are_listed_in_slot_order_with_slot_icons(self) -> None:
        # The vanilla US_Medic file declares Thompson, Colt, Knife, MedPack,
        # Grenade but its icons run knife, colt, thompson, grenade, medpack:
        # the icon row is slot-ordered, not declaration-ordered, so the icon
        # pairs with the weapon at the same position of the sorted list.
        row = self.manifest()["kits"]["US_Medic"]
        self.assertEqual(
            [(1, "KnifeAllies", "Weapon/Icon_alliesKnife.tga"),
             (2, "Colt", "Weapon/Icon_colt.tga"),
             (3, "Thompson", "Weapon/Icon_thompson.tga"),
             (4, "GrenadeAllies", "Weapon/Icon_grenadeallies.tga"),
             (5, "MedPack", "Weapon/Icon_medpack.tga")],
            [(w["slot"], w["weapon"], w["icon"])
             for w in row["weapons"]])
        # The primary is the slot-3 entry, as the engine selects on spawn.
        self.assertEqual("Thompson", row["primary"])

    def test_a_weapon_without_an_item_index_is_not_selectable(self) -> None:
        library = self.library()
        library.add_con("Objects/HandWeapons/Parachute/Objects.con", """
ObjectTemplate.create HandFireArms Parachute
""")
        library.object("US_Medic").children.append(type(
            library.object("US_Medic").children[0])(template="Parachute"))
        manifest = build_manifest(library, collect(library),
                                  {"Wake": parse_level_kits("game.setKit 2 3 US_Medic\n")},
                                  "bf1942")
        weapons = manifest["kits"]["US_Medic"]["weapons"]
        self.assertNotIn("Parachute", [w["weapon"] for w in weapons])
        # And the icons still line up: the unselectable item consumed no icon.
        self.assertEqual(
            ["Weapon/Icon_alliesKnife.tga", "Weapon/Icon_colt.tga"],
            [w["icon"] for w in weapons[:2]])

    def test_a_kit_with_fewer_icons_than_weapons_leaves_none_null(self) -> None:
        library = self.library()
        kit = library.object("US_Medic")
        kit.kit_weapon_icons = ["Weapon/Icon_alliesKnife.tga"]
        manifest = build_manifest(library, collect(library),
                                  {"Wake": parse_level_kits("game.setKit 2 3 US_Medic\n")},
                                  "bf1942")
        weapons = manifest["kits"]["US_Medic"]["weapons"]
        self.assertEqual("Weapon/Icon_alliesKnife.tga", weapons[0]["icon"])
        self.assertIsNone(weapons[1]["icon"])
        self.assertIsNone(weapons[4]["icon"])


class RandomItemLoadoutTests(unittest.TestCase):
    """FHSW's rolled kit items (ledger KIT-1): the bundle stays in the kit's
    lists under its own name, its roll is written beside them for the page,
    and every variant a spawn can hold has its AI entry."""

    def manifest(self) -> dict:
        library = ObjectLibrary()
        library.add_con("Objects/Items/BritKit/5TankCommander/Objects.con", """
ObjectTemplate.create Kit 5GB_TankCommander
ObjectTemplate.setType Engineer
ObjectTemplate.setKitTeam 2
ObjectTemplate.addTemplate RandomGBTankcommander
ObjectTemplate.setRandomGeometries 3
ObjectTemplate.addTemplate KnifeAllies
""")
        library.add_con("Objects/HandWeapons/!_PACK_COMMON/Compressed.con", """
ObjectTemplate.create HandFireArms RandomGBTankcommander1
ObjectTemplate.itemIndex 3
ObjectTemplate.aiTemplate No2_ID3AI
ObjectTemplate.create HandFireArms RandomGBTankcommander2
ObjectTemplate.itemIndex 3
ObjectTemplate.aiTemplate StenMK5_ID3AI
ObjectTemplate.create HandFireArms KnifeAllies
ObjectTemplate.itemIndex 1
ObjectTemplate.create BFSoldier FrenchSoldier
""")
        library.add_con("Objects/HandWeapons/!_PACK_COMMON/Ai/Weapons.con", """
weaponTemplate.create No2_ID3AI
weaponTemplate.maxRange 30
weaponTemplate.create StenMK5_ID3AI
weaponTemplate.maxRange 60
""")
        init = "game.setTeamSkin 2 frenchsoldier\ngame.setKit 2 4 5GB_TankCommander\n"
        return build_manifest(library, collect(library),
                              {"Counterattack-1950": parse_level_kits(init)}, "FHSW")

    def test_the_bundle_is_the_primary_and_holds_its_variants_slot(self) -> None:
        row = self.manifest()["kits"]["5GB_TankCommander"]
        self.assertEqual("RandomGBTankcommander", row["primary"])
        self.assertEqual([(1, "KnifeAllies"), (3, "RandomGBTankcommander")],
                         [(w["slot"], w["weapon"]) for w in row["weapons"]])

    def test_the_roll_is_written_in_order_with_its_variants(self) -> None:
        row = self.manifest()["kits"]["5GB_TankCommander"]
        self.assertEqual([{"template": "RandomGBTankcommander", "count": 3,
                           "variants": ["RandomGBTankcommander1", "RandomGBTankcommander2",
                                        None]}], row["random"])

    def test_every_variant_has_its_own_ai_entry(self) -> None:
        ai = self.manifest()["aiWeapons"]
        self.assertEqual("No2_ID3AI", ai["RandomGBTankcommander1"]["aiTemplate"])
        self.assertEqual("StenMK5_ID3AI", ai["RandomGBTankcommander2"]["aiTemplate"])
        self.assertNotIn("RandomGBTankcommander", ai)

    def test_the_team_soldier_is_spelled_as_its_template(self) -> None:
        # `setTeamSkin 2 frenchsoldier`; the files are `FrenchSoldier__...`.
        level = self.manifest()["levels"]["counterattack-1950"]
        self.assertEqual("FrenchSoldier", level["2"]["soldier"])


def _fake_archives(content: dict[str, dict[str, bytes]]):
    """A stand-in for `RfaArchive` keyed by filename (as `tests/test_kit.py`)."""
    class _FakeArchive:
        def __init__(self, path: Path) -> None:
            self._payloads = content.get(path.name, {})
            self.entries = list(self._payloads)

        def read(self, name: str) -> bytes:
            return self._payloads[name]

    return _FakeArchive


class LevelDeclaredKitTests(unittest.TestCase):
    """A kit only a level's own archive declares is bound like any other.

    DC Final's DC_First_Light binds `Iraq_AA2`/`US_AA2` to slot 0 and
    declares both in `bf1942/levels/DC_First_Light/objects/AntiAir2/`; read
    from `Objects.rfa` alone, the slot named a kit the file did not list and
    the page dealt its fallback instead.
    """

    def test_the_levels_own_kit_is_listed_with_its_primary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            mod = Path(tmp) / "Mods" / "M"
            levels = mod / "Archives" / "bf1942" / "levels"
            levels.mkdir(parents=True)
            (mod / "Archives" / "objects.rfa").touch()
            (levels / "L.rfa").touch()
            content = {
                "objects.rfa": {
                    "Objects/HandWeapons/Stinger/Objects.con":
                        b"ObjectTemplate.create HandFireArms Stinger\n"
                        b"ObjectTemplate.itemIndex 3\n",
                },
                "L.rfa": {
                    "bf1942/levels/L/Init.con":
                        b"game.setTeamSkin 2 USSoldier\n"
                        b"game.setKit 2 0 US_AA2\n"
                        b"run objects/AntiAir2/Objects\n",
                    "bf1942/levels/L/objects/AntiAir2/Objects.con":
                        b"ObjectTemplate.create Kit US_AA2\n"
                        b"ObjectTemplate.setType AT\n"
                        b"ObjectTemplate.addTemplate Stinger\n",
                },
            }
            with _archives(content):
                library, loadouts = read_chain([mod])
            manifest = build_manifest(library, collect(library), loadouts, "M")
        self.assertEqual("US_AA2", manifest["levels"]["l"]["2"]["slots"]["0"])
        self.assertEqual("Stinger", manifest["kits"]["US_AA2"]["primary"])


def _archives(content: dict[str, dict[str, bytes]]):
    """Both readers of level archives (the pool's and `LevelFiles`') on
    `_fake_archives`."""
    fake = _fake_archives(content)
    stack = contextlib.ExitStack()
    stack.enter_context(mock.patch("bf42.rfa.RfaArchive", fake))
    stack.enter_context(mock.patch("bf42.level.RfaArchive", fake))
    return stack


class LevelLoadTests(unittest.TestCase):
    """A level load declares what its `Init.con` runs, first (LOAD-1, LOAD-2,
    LOAD-5): DC Final's Lost Village nopara hands out its own kits, each with
    a `nochute`; First Light its own `US_AT3`, with a Landmine; Lost Village,
    which ships the same kit files and runs none of them, the mod's."""

    MOD_KIT = (b"ObjectTemplate.create Kit US_AT3\n"
               b"ObjectTemplate.setType AT\n"
               b"ObjectTemplate.setKitTeam 2\n"
               b"ObjectTemplate.addTemplate SMAW\n")
    OWN_KIT = MOD_KIT + (b"ObjectTemplate.addTemplate Landmine\n"
                         b"ObjectTemplate.addTemplate nochute\n")
    NOCHUTE = (b"ObjectTemplate.create ActiveKitPart nochute\n"
               b"ObjectTemplate.setBoneName backpack\n"
               b"ObjectTemplate.overrideAirMovementInhibitations 1\n")

    def manifest(self, levels: dict[str, dict[str, bytes]]) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            mod = Path(tmp) / "Mods" / "M"
            level_dir = mod / "Archives" / "bf1942" / "levels"
            level_dir.mkdir(parents=True)
            (mod / "Archives" / "objects.rfa").touch()
            content = {"objects.rfa": {
                "Objects/Items/USKit/AntiArmor3/Objects.con": self.MOD_KIT,
                "Objects/HandWeapons/SMAW/Objects.con":
                    b"ObjectTemplate.create HandFireArms SMAW\n"
                    b"ObjectTemplate.itemIndex 3\n",
                "Objects/HandWeapons/Landmine/Objects.con":
                    b"ObjectTemplate.create HandFireArms Landmine\n"
                    b"ObjectTemplate.itemIndex 5\n",
            }}
            for name, files in levels.items():
                (level_dir / f"{name}.rfa").touch()
                content[f"{name}.rfa"] = {f"bf1942/levels/{name}/{path}": data
                                          for path, data in files.items()}
            with _archives(content):
                census, loadouts, own = read_chain_levels([mod])
                # A level's own load materializes lazily (`LevelLoad`), so
                # the manifest is built with the archives still in place -
                # as the real run does.
                return build_manifest(census.library, collect(census.library), loadouts,
                                      "M", level_loads=own, read=census.read)

    def test_a_level_that_runs_its_own_kit_hands_it_out(self) -> None:
        manifest = self.manifest({
            "Own": {
                "Init.con": b"game.setKit 2 2 US_AT3\nrun Objects/Objects\n",
                "Objects/Objects.con": b"run AntiArmor3/Objects\nrun Common/Objects\n",
                "Objects/AntiArmor3/Objects.con": self.OWN_KIT,
                "Objects/Common/Objects.con": self.NOCHUTE,
            },
            "Plain": {"Init.con": b"game.setKit 2 2 US_AT3\n"},
        })
        self.assertEqual(["SMAW"], manifest["kits"]["US_AT3"]["items"])
        self.assertNotIn("overrideAirMovementInhibitations", manifest["kits"]["US_AT3"])
        own = manifest["levelKits"]["own"]["US_AT3"]
        # The flag is behaviour, not an item (`kit.kit_parts`).
        self.assertEqual(["SMAW", "Landmine"], own["items"])
        self.assertEqual([3, 5], [weapon["slot"] for weapon in own["weapons"]])
        self.assertIs(True, own["overrideAirMovementInhibitations"])
        self.assertEqual({"own"}, set(manifest["levelKits"]))
        # The slot still names the kit as the mod spells it.
        self.assertEqual("US_AT3", manifest["levels"]["own"]["2"]["slots"]["2"])

    def test_a_kit_file_nothing_runs_declares_nothing(self) -> None:
        manifest = self.manifest({
            "Shipped": {
                "Init.con": b"game.setKit 2 2 US_AT3\ngame.setKit 2 0 US_Only\n"
                            b"run Objects/Objects\n",
                "Objects/Objects.con": b"remrun AntiArmor3/Objects\n",
                "Objects/AntiArmor3/Objects.con": self.OWN_KIT,
                "Objects/Only/Objects.con": b"ObjectTemplate.create Kit US_Only\n",
            },
        })
        self.assertNotIn("levelKits", manifest)
        self.assertEqual(["SMAW"], manifest["kits"]["US_AT3"]["items"])
        # Declared only by a script the level never runs: the slot keeps the
        # raw name and no kit row answers it.
        self.assertEqual("US_Only", manifest["levels"]["shipped"]["2"]["slots"]["0"])
        self.assertNotIn("US_Only", manifest["kits"])


def _game_dir() -> Path | None:
    import os
    from extract_models import DEFAULT_GAME_DIR
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    return game if (game / "Mods" / "DesertCombat").is_dir() else None


def _retail_manifest(mod: str) -> dict:
    """`extract_loadouts.py --mod <mod>`'s manifest, without the lexicon."""
    from extract_loadouts import read_chain_levels
    from extract_models import mod_chain
    census, loadouts, level_loads = read_chain_levels(mod_chain(_game_dir(), mod))
    return build_manifest(census.library, collect(census.library), loadouts, mod,
                          level_loads=level_loads, read=census.read)


@unittest.skipIf(_game_dir() is None, "no Desert Combat install")
class RetailAiWeaponTests(unittest.TestCase):
    """Every `weaponTemplate.create` is in a `<weapon>/AI/Weapons.con`, which
    `loadAllConFiles` runs on an AI level (LOAD-8). With `/ai/` dropped, DC
    kept 7 of its 44 entries and vanilla 6, all from level copies."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.dc = _retail_manifest("DesertCombat")["aiWeapons"]
        cls.vanilla = _retail_manifest("bf1942")

    def test_desert_combat_keeps_every_firearms_ai(self) -> None:
        self.assertGreaterEqual(len(self.dc), 44)
        self.assertEqual({"aiTemplate": "AK47AI", "burst": 1, "deviation": 5.0,
                          "deviationCorrectionTime": 10.0, "indirect": 0,
                          "minRange": 0.0, "maxRange": 175.0,
                          "weaponActivate": "PIMenuSelect3", "weaponFire": "PIFire",
                          "strength": {"Infantry": 5.0, "LightArmour": 1.0,
                                       "HeavyArmour": 0.0, "NavalArmour": 0.0,
                                       "Submarine": 0.0, "Air": 2.0},
                          "soundSphereRadius": 120.0, "healing": False},
                         self.dc["AK47"])
        self.assertEqual("StingerRPG", self.dc["Stinger"]["aiTemplate"])
        # The tree's file, made 09-30 before `/ai/` was dropped, when present:
        # every entry it has comes back the same.
        tree = (Path(__file__).resolve().parents[1] / "viewer" / "maps" / "mods"
                / "desertcombat" / "_shared" / "loadouts.json")
        if tree.is_file():
            import json
            for name, entry in json.loads(tree.read_text())["aiWeapons"].items():
                self.assertEqual(entry, self.dc.get(name), name)

    def test_vanilla_gives_every_carried_item_that_names_an_ai_template(self) -> None:
        ai = self.vanilla["aiWeapons"]
        self.assertEqual(24, len(ai))
        held = {item for row in self.vanilla["kits"].values() for item in row["items"]}
        # The other four carry no `ObjectTemplate.aiTemplate`.
        self.assertEqual({"Binoculars", "Detonator", "ExpPack", "Landmine"}, held - set(ai))
        # The mod's own file, not Kasserine Pass's level copy (Infantry 10),
        # which was the only one left with `/ai/` dropped.
        self.assertEqual(2.0, ai["Bazooka"]["strength"]["Infantry"])
        self.assertEqual("K98AI", ai["K98"]["aiTemplate"])


class PadKitLevelLoadTests(unittest.TestCase):
    """`read_chain_levels(pads=)`: a level that runs its own copy of a kit
    its pads place hands that copy out; a vehicle its pads place opens no
    load of its own (DC 0.7's Bragg declares its `UST` carriers, and each
    such load is a library build that changes no row)."""

    def run_levels(self, levels: dict[str, dict[str, bytes]], pads: dict) -> tuple:
        with tempfile.TemporaryDirectory() as tmp:
            mod = Path(tmp) / "Mods" / "M"
            level_dir = mod / "Archives" / "bf1942" / "levels"
            level_dir.mkdir(parents=True)
            (mod / "Archives" / "objects.rfa").touch()
            content = {"objects.rfa": {
                "Objects/Items/USKit/AntiArmor3/Objects.con": LevelLoadTests.MOD_KIT,
                "Objects/HandWeapons/SMAW/Objects.con":
                    b"ObjectTemplate.create HandFireArms SMAW\n"
                    b"ObjectTemplate.itemIndex 3\n",
                "Objects/HandWeapons/Landmine/Objects.con":
                    b"ObjectTemplate.create HandFireArms Landmine\n"
                    b"ObjectTemplate.itemIndex 5\n",
            }}
            for name, files in levels.items():
                (level_dir / f"{name}.rfa").touch()
                content[f"{name}.rfa"] = {f"bf1942/levels/{name}/{path}": data
                                          for path, data in files.items()}
            with _archives(content):
                census, loadouts, own = read_chain_levels([mod], pads=pads)
                manifest = build_manifest(census.library, collect(census.library), loadouts,
                                          "M", level_loads=own, read=census.read, pads=pads)
            return set(own), manifest

    def test_a_pad_kit_the_level_declares_is_its_own_copy(self) -> None:
        own, manifest = self.run_levels({
            "PadOwn": {
                "Init.con": b"game.setTeamSkin 2 USSoldier\nrun Objects/Objects\n",
                "Objects/Objects.con": b"run AntiArmor3/Objects\n",
                "Objects/AntiArmor3/Objects.con": LevelLoadTests.OWN_KIT[
                    :LevelLoadTests.OWN_KIT.index(b"ObjectTemplate.addTemplate nochute")],
            },
        }, pads={"PadOwn": {"us_at3": "us_at3"}})
        self.assertEqual({"PadOwn"}, own)
        self.assertEqual(["SMAW"], manifest["kits"]["US_AT3"]["items"])
        self.assertEqual(["SMAW", "Landmine"],
                         manifest["levelKits"]["padown"]["US_AT3"]["items"])

    def test_a_vehicle_on_a_pad_opens_no_load_of_its_own(self) -> None:
        own, manifest = self.run_levels({
            "Carrier": {
                "Init.con": b"game.setTeamSkin 2 USSoldier\ngame.setKit 2 2 US_AT3\n"
                            b"run Objects/Objects\n",
                "Objects/Objects.con":
                    b"ObjectTemplate.create PlayerControlObject UST\n",
            },
        }, pads={"Carrier": {"ust": "UST", "us_at3": "US_AT3"}})
        self.assertEqual(set(), own)
        self.assertNotIn("levelKits", manifest)
        self.assertNotIn("UST", manifest["kits"])


if __name__ == "__main__":
    unittest.main()
