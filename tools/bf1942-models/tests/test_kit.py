from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.kit import (  # noqa: E402
    BONE_SLOTS,
    Kit,
    browsable,
    classify,
    collect,
    kit_parts,
)


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


if __name__ == "__main__":
    unittest.main()
