from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.kit import (  # noqa: E402
    BONE_SLOTS,
    PRIMARY_ITEM_INDEX,
    Kit,
    browsable,
    carried_templates,
    classify,
    collect,
    kit_parts,
    level_loadouts,
    parse_level_kits,
    primary_weapon,
)

# The real vanilla install, if this machine has one. `RealPatchTests` below
# is the end-to-end regression for the bug this module was fixed for: Wake's
# `_003` patch rebinds the US side to Marine kits, and only reading the base
# archive (the old behaviour) reports the dead `USSoldier`/`US_*` binding it
# replaced.
BF1942_LEVELS = (Path.home() / ".wine/drive_c/EA Games/Battlefield 1942/Mods"
                 "/bf1942/Archives/bf1942/levels")
WAKE_RFA = BF1942_LEVELS / "Wake.rfa"


class BoneNameTests(unittest.TestCase):
    """`setBoneName` is the whole of Refractor's kit-appearance channel."""

    def parse(self, body: str) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Items/USKit/Common/Objects.con", body)
        return library

    def test_a_kit_part_records_the_bone_it_hangs_on(self) -> None:
        library = self.parse("""
ObjectTemplate.create KitPart Medic_helm_us
ObjectTemplate.geometry Medic_helm_us
ObjectTemplate.setBoneName A
ObjectTemplate.setCopyLinksCount 0
""")
        self.assertEqual("A", library.object("Medic_helm_us").bone_name)

    def test_a_quoted_bone_keeps_its_space(self) -> None:
        # GCMOD's `Sprint2` is the only quoted bone in the install, and taking
        # the first whitespace token would silently truncate it to `"Bip01`.
        library = self.parse("""
ObjectTemplate.create ActiveKitPart Sprint2
ObjectTemplate.geometry rebel_scout_mesh
ObjectTemplate.setBoneName "Bip01 R UpperArm"
""")
        self.assertEqual("Bip01 R UpperArm", library.object("Sprint2").bone_name)

    def test_a_template_without_one_reports_none(self) -> None:
        library = self.parse("""
ObjectTemplate.create SimpleObject Crate
ObjectTemplate.geometry Crate_m1
""")
        self.assertIsNone(library.object("Crate").bone_name)

    def test_the_engine_offers_exactly_three_slots(self) -> None:
        # A census of all 16 installed mods finds `A`, `backpack` and `HipPack`
        # and nothing else. If this set grows, the viewer's slot rows and the
        # bind-rotation table both need to grow with it.
        self.assertEqual({"a", "backpack", "hippack"}, set(BONE_SLOTS))


class KitClassifyTests(unittest.TestCase):
    def test_a_plain_nation_and_class_resolve(self) -> None:
        nation, theatre, unit, cls = classify(
            "Objects/Items/USKit/Medic/Objects.con")
        self.assertEqual(("us", None, None, "medic"), (nation, theatre, unit, cls))

    def test_a_theatre_suffix_is_not_part_of_the_nation(self) -> None:
        # `GerKitdesert` is the Afrika Korps — the kits GermanDesertSoldier
        # actually wears. An expression anchored on `kit/` misses all five.
        nation, theatre, unit, cls = classify(
            "Objects/Items/GerKitdesert/Scout/Objects.con")
        self.assertEqual(("ger", "desert", None, "scout"), (nation, theatre, unit, cls))

    def test_a_unit_segment_does_not_break_the_match(self) -> None:
        # FH and FHSW file kits one folder deeper, under the unit that fields them.
        nation, theatre, unit, cls = classify(
            "objects/Items/JapKit/SNLF/1SNLF_OfficerMp18/Objects.con")
        self.assertEqual(("jap", None, "snlf", "1snlf_officermp18"),
                         (nation, theatre, unit, cls))

    def test_something_outside_the_items_tree_is_not_a_kit_path(self) -> None:
        self.assertEqual((None, None, None, None),
                         classify("Objects/Soldiers/USSoldier/Objects.con"))


class KitPartTests(unittest.TestCase):
    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        library.add_con("Objects/Items/USKit/Medic/Objects.con", """
ObjectTemplate.create Kit US_Medic
ObjectTemplate.setType Medic
ObjectTemplate.setKitTeam 2
ObjectTemplate.geometry Kit_Allies_Medic
ObjectTemplate.addTemplate Medic_helm_us
ObjectTemplate.addTemplate US_Medic_hippack
ObjectTemplate.addTemplate nochute
ObjectTemplate.addTemplate Thompson
""")
        library.add_con("Objects/Items/USKit/Common/Objects.con", """
ObjectTemplate.create KitPart Medic_helm_us
ObjectTemplate.geometry Medic_helm_us
ObjectTemplate.setBoneName A

ObjectTemplate.create KitPart US_Medic_hippack
ObjectTemplate.geometry US_Medic_hippack
ObjectTemplate.setBoneName HipPack

ObjectTemplate.create ActiveKitPart nochute
ObjectTemplate.setBoneName backpack
ObjectTemplate.OverrideAirMovementInhibitations 1
""")
        library.add_con("Objects/HandWeapons/Thompson/Objects.con", """
ObjectTemplate.create ProjectileLauncher Thompson
""")
        return library

    def test_worn_parts_are_split_from_carried_weapons(self) -> None:
        library = self.library()
        worn, carried = kit_parts(library, library.object("US_Medic"))
        self.assertEqual([("head", "Medic_helm_us"), ("hip", "US_Medic_hippack")],
                         [(part.slot, part.template) for part in worn])
        self.assertIn("Thompson", carried)

    def test_a_bone_without_a_mesh_is_behaviour_not_appearance(self) -> None:
        # EoD's `nochute` and FH's `Chutedisabler` sit on `backpack` and carry
        # nothing but a parachute flag. Listing them as worn puts a permanent
        # "not extracted" row on every EoD kit for a thing never meant to be seen.
        library = self.library()
        worn, _ = kit_parts(library, library.object("US_Medic"))
        self.assertNotIn("nochute", [part.template for part in worn])

    def test_a_geometryless_part_resolves_through_its_holder(self) -> None:
        # FH writes `ObjectTemplate.geometry` with no argument and hangs the
        # real mesh off a `<Name>Holder` child, which is how it mixes bare heads
        # and soft caps into one helmet roll.
        library = ObjectLibrary()
        library.add_con("Objects/Items/GerKit/Winter/Objects.con", """
ObjectTemplate.create Kit German_Winter
ObjectTemplate.addTemplate German_Helmets3
""")
        library.add_con("Objects/Items/GerKit/Common/Objects.con", """
ObjectTemplate.create KitPart German_Helmets3
ObjectTemplate.geometry
ObjectTemplate.setBoneName A
ObjectTemplate.addTemplate German_CapHolder
ObjectTemplate.setPosition -0.005/0/0

ObjectTemplate.create SimpleObject German_CapHolder
ObjectTemplate.geometry GerCap_M1
""")
        worn, _ = kit_parts(library, library.object("German_Winter"))
        self.assertEqual(1, len(worn))
        self.assertEqual("GerCap_M1", worn[0].geometry)
        self.assertTrue(worn[0].via_holder)

    def test_a_random_roll_keeps_every_variant(self) -> None:
        # `setRandomGeometries 3` means "pick among VCHat1..VCHat3", and the
        # bare name is deliberately absent from the library. Miss this and every
        # Viet Cong rifleman reports bare-headed.
        library = ObjectLibrary()
        library.add_con("objects/Items/VCKit/Rifleman/Objects.con", """
ObjectTemplate.create Kit VC_Rifleman
ObjectTemplate.addTemplate VCHat
ObjectTemplate.setRandomGeometries 3
""")
        library.add_con("objects/Items/BaseKit/Objects.con", """
ObjectTemplate.create KitPart VCHat1
ObjectTemplate.geometry VCHat
ObjectTemplate.setBoneName A

ObjectTemplate.create KitPart VCHat2
ObjectTemplate.geometry VCHat_green
ObjectTemplate.setBoneName A

ObjectTemplate.create KitPart VCHat3
ObjectTemplate.geometry VCHat
ObjectTemplate.setBoneName A
""")
        worn, _ = kit_parts(library, library.object("VC_Rifleman"))
        self.assertEqual(1, len(worn))
        self.assertEqual("VCHat1", worn[0].template)
        self.assertEqual(["VCHat2", "VCHat3"], worn[0].alternatives)

    def test_the_class_comes_from_setType_not_the_folder(self) -> None:
        kits = collect(self.library())
        self.assertEqual("Medic", kits["us_medic"].kit_class)
        self.assertEqual("US", kits["us_medic"].nation)
        self.assertEqual(2, kits["us_medic"].team)
        # The kit's own geometry is the mesh it becomes when dropped, not
        # something the soldier wears.
        self.assertEqual("Kit_Allies_Medic", kits["us_medic"].pickup)


class BrowsableTests(unittest.TestCase):
    def kit(self, name: str, *, levels: list[str]) -> Kit:
        return Kit(template=name, source="", nation="Viet Cong",
                   kit_class="Scout", levels=list(levels))

    def test_a_kit_no_level_binds_is_not_browsable(self) -> None:
        kits = {"a": self.kit("VC_Scout", levels=["Ia_Drang"]),
                "b": self.kit("VC_Unused", levels=[])}
        self.assertEqual(["VC_Scout"], [k.template for k in browsable(kits)])

    def test_a_parachute_twin_folds_into_its_base_kit(self) -> None:
        # EoD ships every kit twice; 115 of the 116 `_CHUTE` pairs differ from
        # their base by one flag. Folding them takes 194 bound kits to 102.
        base = self.kit("VC_Scout", levels=["Ia_Drang"])
        twin = self.kit("VC_Scout_CHUTE", levels=["Hue"])
        kept = browsable({"vc_scout": base, "vc_scout_chute": twin})
        self.assertEqual(["VC_Scout"], [k.template for k in kept])
        # The twin's maps are not lost with it — a parachute map fields the kit
        # just as much as a ground one.
        self.assertEqual(["Hue", "Ia_Drang"], sorted(kept[0].levels))

    def test_a_twin_whose_base_is_dead_survives_on_its_own(self) -> None:
        # Otherwise the only copy of that loadout disappears silently.
        base = self.kit("VC_Scout", levels=[])
        twin = self.kit("VC_Scout_CHUTE", levels=["Hue"])
        kept = browsable({"vc_scout": base, "vc_scout_chute": twin})
        self.assertEqual(["VC_Scout_CHUTE"], [k.template for k in kept])


class PrimaryWeaponTests(unittest.TestCase):
    """The weapon in hand on spawn is the kit's `HandFireArms` at `itemIndex 3`."""

    def library(self) -> ObjectLibrary:
        library = ObjectLibrary()
        # The German scout, as the kit file spells its weapons — lower-case
        # `k98Sniper` and `walterp38` — with the knife declared first, the way
        # `JapKit/Scout` orders its binoculars last and its grenade before.
        library.add_con("Objects/Items/GerKit/Scout/Objects.con", """
ObjectTemplate.create Kit German_Scout
ObjectTemplate.setType Scout
ObjectTemplate.setKitTeam 1
ObjectTemplate.geometry Kit_Axis_Scout
ObjectTemplate.addTemplate German_Helmet
ObjectTemplate.addTemplate KnifeAxis
ObjectTemplate.addTemplate k98Sniper
ObjectTemplate.addTemplate walterp38
ObjectTemplate.addTemplate Binoculars
ObjectTemplate.addTemplate GrenadeAxis
""")
        library.add_con("Objects/Items/GerKit/Common/Objects.con", """
ObjectTemplate.create KitPart German_Helmet
ObjectTemplate.geometry German_Helmet
ObjectTemplate.setBoneName A
""")
        library.add_con("Objects/HandWeapons/K98/Objects.con", """
ObjectTemplate.create HandFireArms K98
ObjectTemplate.itemIndex 3
ObjectTemplate.projectileTemplate K98Projectile

ObjectTemplate.create HandFireArms K98Sniper
ObjectTemplate.itemIndex 3
ObjectTemplate.projectileTemplate K98Projectile
""")
        library.add_con("Objects/HandWeapons/WalterP38/Objects.con", """
ObjectTemplate.create HandFireArms WalterP38
ObjectTemplate.itemIndex 2
""")
        library.add_con("Objects/HandWeapons/KnifeAxis/Objects.con", """
ObjectTemplate.create HandFireArms KnifeAxis
ObjectTemplate.itemIndex 1
""")
        library.add_con("Objects/HandWeapons/Binoculars/Objects.con", """
ObjectTemplate.create HandFireArms Binoculars
ObjectTemplate.itemIndex 5
""")
        library.add_con("Objects/HandWeapons/GrenadeAxis/Objects.con", """
ObjectTemplate.create HandFireArms GrenadeAxis
ObjectTemplate.itemIndex 4
""")
        return library

    def test_item_index_is_read_onto_the_weapon(self) -> None:
        library = self.library()
        self.assertEqual(3, library.object("K98Sniper").item_index)
        self.assertEqual(2, library.object("WalterP38").item_index)
        self.assertIsNone(library.object("German_Scout").item_index)

    def test_the_primary_is_the_slot_3_weapon_not_the_first_declared(self) -> None:
        # The knife is declared first and the pistol is a HandFireArms too;
        # neither is what the soldier appears holding.
        library = self.library()
        self.assertEqual("K98Sniper",
                         primary_weapon(library, library.object("German_Scout")))

    def test_the_primary_is_spelled_as_its_own_create_line(self) -> None:
        # The kit says `k98Sniper`; the glb is `K98Sniper.glb`, named from the
        # weapon's declaration. A case-mismatched URL is a 404.
        library = self.library()
        self.assertEqual("K98Sniper",
                         primary_weapon(library, library.object("German_Scout")))
        self.assertEqual(3, PRIMARY_ITEM_INDEX)

    def test_collect_records_the_primary_on_the_kit(self) -> None:
        kits = collect(self.library())
        self.assertEqual("K98Sniper", kits["german_scout"].primary)

    def test_two_weapons_at_slot_3_spawn_with_the_first_declared(self) -> None:
        # "The order is important, first the best weapons!" — GerKit/Assault.
        library = ObjectLibrary()
        library.add_con("Objects/Items/USKit/Assault/Objects.con", """
ObjectTemplate.create Kit Us_Assault
ObjectTemplate.addTemplate Bar1918
ObjectTemplate.addTemplate Thompson
""")
        library.add_con("Objects/HandWeapons/Bar1918/Objects.con", """
ObjectTemplate.create HandFireArms Bar1918
ObjectTemplate.itemIndex 3
""")
        library.add_con("Objects/HandWeapons/Thompson/Objects.con", """
ObjectTemplate.create HandFireArms Thompson
ObjectTemplate.itemIndex 3
""")
        self.assertEqual("Bar1918",
                         primary_weapon(library, library.object("Us_Assault")))

    def test_a_weapon_behind_a_wrapper_is_still_found(self) -> None:
        # A mod that bundles its weapons: the kit names the wrapper, the
        # wrapper names the HandFireArms.
        library = ObjectLibrary()
        library.add_con("Objects/Items/NVAKit/Assault/Objects.con", """
ObjectTemplate.create Kit NVA_Assault
ObjectTemplate.addTemplate NVA_Rifle_Bundle
""")
        library.add_con("Objects/HandWeapons/AK47/Objects.con", """
ObjectTemplate.create Bundle NVA_Rifle_Bundle
ObjectTemplate.addTemplate AK47

ObjectTemplate.create HandFireArms AK47
ObjectTemplate.itemIndex 3
""")
        self.assertEqual(["NVA_Rifle_Bundle", "AK47"],
                         carried_templates(library, library.object("NVA_Assault")))
        self.assertEqual("AK47",
                         primary_weapon(library, library.object("NVA_Assault")))

    def test_a_kit_with_nothing_at_slot_3_has_no_primary(self) -> None:
        # EoD's pilot kits: a pistol and a knife, nothing to raise on spawn.
        library = ObjectLibrary()
        library.add_con("Objects/Items/USKit/JetPilot/Objects.con", """
ObjectTemplate.create Kit US_JetPilot
ObjectTemplate.addTemplate Colt
ObjectTemplate.addTemplate KnifeAllies
""")
        library.add_con("Objects/HandWeapons/Colt/Objects.con", """
ObjectTemplate.create HandFireArms Colt
ObjectTemplate.itemIndex 2

ObjectTemplate.create HandFireArms KnifeAllies
ObjectTemplate.itemIndex 1
""")
        self.assertIsNone(primary_weapon(library, library.object("US_JetPilot")))


class LevelKitTests(unittest.TestCase):
    """`Init.con`'s `setTeamSkin` / `setKit` lines, replayed as the engine does."""

    def test_each_team_gets_its_soldier_and_a_kit_per_slot(self) -> None:
        teams = parse_level_kits("""
game.setTeamSkin 1 JapaneseSoldier
game.setKit 1 0 Jap_Scout
game.setKit 1 1 Jap_Assault
game.setKit 1 2 Jap_AT
game.setTeamSkin 2 USSoldier
game.setKit 2 0 US_Scout
game.setKit 2 2 Us_AT
""")
        self.assertEqual({1, 2}, set(teams))
        self.assertEqual("JapaneseSoldier", teams[1].soldier)
        self.assertEqual({0: "Jap_Scout", 1: "Jap_Assault", 2: "Jap_AT"}, teams[1].slots)
        self.assertEqual("USSoldier", teams[2].soldier)
        self.assertEqual({0: "US_Scout", 2: "Us_AT"}, teams[2].slots)

    def test_a_later_binding_replaces_the_slot(self) -> None:
        # Liberation_of_Caen sets team 2 twice; the Canadians never load.
        teams = parse_level_kits("""
game.setTeamSkin 2 CanadianSoldier
game.setKit 2 0 Canadian_Scout
game.setKit 2 1 Canadian_Assault
game.setTeamSkin 2 BritishSoldier
game.setKit 2 0 GB_Scout
game.setKit 2 1 GB_Assault
""")
        self.assertEqual("BritishSoldier", teams[2].soldier)
        self.assertEqual({0: "GB_Scout", 1: "GB_Assault"}, teams[2].slots)

    def test_case_and_indentation_do_not_matter(self) -> None:
        teams = parse_level_kits("   Game.SetKit 1 4 German_Engineer\n")
        self.assertEqual({4: "German_Engineer"}, teams[1].slots)
        self.assertIsNone(teams[1].soldier)

    def test_unrelated_lines_are_ignored(self) -> None:
        teams = parse_level_kits("""
game.setNumberOfTickets 1 200
game.setTeamSkin 1 GermanSoldier
rem game.setKit 1 0 Commented_Out
""")
        self.assertEqual({1: "GermanSoldier"}, {t: v.soldier for t, v in teams.items()})
        self.assertEqual({}, teams[1].slots)


def _fake_archives(content: dict[str, dict[str, bytes]], broken: frozenset[str] = frozenset()):
    """A stand-in for `RfaArchive`, keyed by filename rather than real bytes.

    See `tests/test_roster.py`'s copy of this helper for the full rationale;
    duplicated here rather than imported so each test module stays
    self-contained, matching this suite's existing convention.
    """
    class _FakeArchive:
        def __init__(self, path: Path) -> None:
            if path.name in broken:
                raise ValueError(f"synthetic corruption: {path.name}")
            self._payloads = content.get(path.name, {})
            self.entries = list(self._payloads)

        def read(self, name: str) -> bytes:
            return self._payloads[name]

    return _FakeArchive


class LevelLoadoutsPatchTests(unittest.TestCase):
    """`level_loadouts` reads a level's numbered patch over its base.

    The five vanilla Pacific `_003` layers rebind the US side from
    `USSoldier`/`US_*` to `USMarineSoldier`/`USMarine_*`; the base archive
    alone (the old behaviour) reports kits the game never actually deals.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.levels_dir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_a_patched_level_reports_the_patched_kits(self) -> None:
        (self.levels_dir / "Wake.rfa").touch()
        (self.levels_dir / "Wake_003.rfa").touch()
        content = {
            "Wake.rfa": {"bf1942/levels/Wake/Init.con": b"""
game.setTeamSkin 2 USSoldier
game.setKit 2 4 US_Engineer
"""},
            "Wake_003.rfa": {"bf1942/levels/Wake/Init.con": b"""
game.setTeamSkin 2 USMarineSoldier
game.setKit 2 4 USMarine_Engineer
"""},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            loadouts = level_loadouts([("Wake", self.levels_dir / "Wake.rfa")])

        team2 = loadouts["Wake"][2]
        self.assertEqual("USMarineSoldier", team2.soldier)
        self.assertEqual("USMarine_Engineer", team2.slots[4])

    def test_a_level_with_no_patch_is_unaffected(self) -> None:
        (self.levels_dir / "El_Alamein.rfa").touch()
        content = {
            "El_Alamein.rfa": {"bf1942/levels/El_Alamein/Init.con": b"""
game.setTeamSkin 1 GermanDesertSoldier
game.setKit 1 4 GerKitdesert_Engineer
"""},
        }
        with mock.patch("bf42.rfa.RfaArchive", _fake_archives(content)):
            loadouts = level_loadouts([("El_Alamein", self.levels_dir / "El_Alamein.rfa")])

        self.assertEqual("GermanDesertSoldier", loadouts["El_Alamein"][1].soldier)

    def test_a_level_whose_base_wont_open_is_dropped_not_crashed(self) -> None:
        (self.levels_dir / "Tobruk.rfa").touch()
        with mock.patch("bf42.rfa.RfaArchive",
                        _fake_archives({}, broken=frozenset({"Tobruk.rfa"}))):
            loadouts = level_loadouts([("Tobruk", self.levels_dir / "Tobruk.rfa")])
        self.assertEqual({}, loadouts)


@unittest.skipUnless(WAKE_RFA.exists(), "needs the BF1942 install")
class RealWakePatchTests(unittest.TestCase):
    """End-to-end against the real archives: the bug this fix was for.

    `Wake_003.rfa` sits next to `Wake.rfa` in the real install and rewrites
    `game.setTeamSkin 2` from `USSoldier` to `USMarineSoldier`. A screenshot
    of Wake's US Engineer in-game shows Marine camo sleeves and an M1 Garand,
    not the Army `USSoldier` skin the base archive alone would report.
    """

    @classmethod
    def setUpClass(cls) -> None:
        cls.loadouts = level_loadouts([("Wake", WAKE_RFA)])

    def test_team_2_is_rebound_to_the_marine_soldier(self) -> None:
        self.assertEqual("USMarineSoldier", self.loadouts["Wake"][2].soldier)

    def test_team_2_kits_are_the_marine_variants(self) -> None:
        slots = self.loadouts["Wake"][2].slots
        # US_Scout, Us_Assault, US_AT, US_Medic, US_Engineer -> their
        # USMarine_* counterparts, slots 0..4 per the task's own mapping.
        for slot in range(5):
            self.assertTrue(slots[slot].lower().startswith("usmarine"),
                            f"slot {slot} still reads {slots[slot]!r}")

    def test_team_1_is_unaffected(self) -> None:
        # Only the US side's binding was patched.
        self.assertEqual("JapaneseSoldier", self.loadouts["Wake"][1].soldier)


if __name__ == "__main__":
    unittest.main()
