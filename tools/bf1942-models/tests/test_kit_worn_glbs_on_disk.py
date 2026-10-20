"""Every part a kit of a baked level wears has its mesh on disk.

`extract_kits.py` writes one `<Part>.kit.glb` per worn geometry and records it
in `kits.json`; a part it fails to build is listed with `"glb": null`, and the
soldier spawns without it. On FHSWEurope's 203 Hill (2026-10-15) both sides'
caps were null: `Rus_RJcap_m2` and `JapNichirocap` are `KitPart`s only the
level's own `objects/` declares, drawing meshes only its `StandardMesh/`
holds, and the kit extractor mounted the levels' textures but not their
meshes (`extract_kits.part_pools` now puts the declaring level's archives
behind the chain's, the models step's `home_levels` rule). 28 of the 30 null
parts on FHSWEurope's 66 levels came back.

Trees with a `maps.json` are checked, on the kits their baked levels bind or
lay on a pad, levels' own copies (`levelVariants`) included. A part the mod's
data cannot draw goes in `NO_MESH` with why; a tree not re-extracted since a
fix goes in `PENDING` with the parts it still lacks, so the guard holds the
rest of it today.
"""

from __future__ import annotations

import json
import unittest

from tests.test_weapon_sounds_on_disk import ASSETS

TREES = {"vanilla": ("models", "maps"),
         "xpack1": ("models/mods/xpack1", "maps/mods/xpack1"),
         "xpack2": ("models/mods/xpack2", "maps/mods/xpack2"),
         "desertcombat": ("models/mods/desertcombat", "maps/mods/desertcombat"),
         "dc_final": ("models/mods/dc_final", "maps/mods/dc_final"),
         "fh": ("models/mods/fh", "maps/mods/fh"),
         "fhsw": ("models/mods/fhsw", "maps/mods/fhsw"),
         "fhsweurope": ("models/mods/fhsweurope", "maps/mods/fhsweurope")}

# tree -> {"<Part>@<level>" (lower case): why the mod's data draws nothing}
NO_MESH: dict[str, dict[str, str]] = {
    "fhsweurope": {
        "alpini_helmets1@battle_of_nikolayevka-1943":
            "the level's copy draws itHelmet_hane_m1, whose .sm no archive of "
            "the chain or the level holds (the level ships only its _green and "
            "_white meshes)",
        "polish_officer_cap@gv_battle_of_ilza-1939":
            "the level declares the geometry; the only polish_officer_cap.sm is "
            "in hell_in_warsaw's archive, which this level does not name",
        "tenguomen_cap@cebu-1945":
            "the level copies Operation_Kikusui_day2's YakuzaTengu scripts but "
            "not its files: TenguOmen_m1.sm and TenguOmen.dds are only in "
            "Kikusui day 2's archive, which this level does not load",
        "fre_britt_bacpac@invasion_of_france":
            "FHSW's Common/Objects.con gives the KitPart fre_Britt_Bacpac the geometry "
            "fre_Britt_Bacpac, which no GeometryTemplate in the chain declares (only "
            "US_Britt_Bacpac exists)",
        "fre_britt_bacpac@liberation_of_strasbourg-1944":
            "FHSW's Common/Objects.con gives the KitPart fre_Britt_Bacpac the geometry "
            "fre_Britt_Bacpac, which no GeometryTemplate in the chain declares (only "
            "US_Britt_Bacpac exists)",
    },
}

# tree -> the parts it lacked when the level-mesh fix landed (2026-10-15),
# before its kits step was run again. The same parts came back on FHSWEurope.
PENDING: dict[str, set[str]] = {
    "fhsw": {"german_navycap@arctic_convoy-1942", "german_hippackq@alaska-1948",
             "rnofficercap@arctic_convoy-1942", "redhut_m1@battle_of_pavlov-1942",
             "watchcap@arctic_convoy-1942", "randomgerman_helmets1@todtenbruch-1944",
             "randomgerman_helmets1@soletschnogorsk-1941",
             "redhut_m1@stalingrad_redsquare"},
    "fh": {"german_deserthelmets6@ramelle_neuville-1944",
           "randomgerman_helmets1@soletschnogorsk-1941",
           "randomgerman_helmets1@todtenbruch-1944"},
}


def missing_parts(kits: dict, levels: set[str]) -> set[str]:
    """`<part>@<level>` (lower case) for every worn part with no glb that a
    kit hands out on one of `levels`."""
    missing: set[str] = set()

    def note(worn: list[dict], on: set[str]) -> None:
        for part in worn:
            if not part.get("glb") and part.get("geometry"):
                missing.update(f"{part['template'].lower()}@{level}" for level in on)

    for kit in kits.get("kits", []):
        on = {level.lower() for level in [*(kit.get("levels") or []), *(kit.get("pads") or [])]}
        on &= levels
        own: set[str] = set()
        for variant in kit.get("levelVariants") or []:
            mine = {level.lower() for level in variant.get("levels") or []} & levels
            if "worn" in variant:
                note(variant["worn"], mine)
                own |= mine
        note(kit.get("worn") or [], on - own)
    return missing


@unittest.skipUnless(ASSETS, "no extracted viewer assets on this machine")
class KitWornGlbsOnDiskTests(unittest.TestCase):
    def test_every_worn_part_of_a_baked_level_has_a_mesh(self) -> None:
        checked = 0
        for tree, (models, maps) in TREES.items():
            kits_path, maps_path = ASSETS / models / "kits.json", ASSETS / maps / "maps.json"
            if not (kits_path.exists() and maps_path.exists()):
                continue
            checked += 1
            levels = {entry["name"].lower() for entry in json.loads(maps_path.read_text())}
            allowed = set(NO_MESH.get(tree, {})) | PENDING.get(tree, set())
            missing = sorted(missing_parts(json.loads(kits_path.read_text()), levels) - allowed)
            with self.subTest(tree=tree):
                self.assertEqual([], missing,
                                 f"{tree}: worn parts with no glb; run the tree's kits "
                                 "step (mod_pipeline.py run --mod <M> --only-steps kits "
                                 "--force-steps) and read its log for the part")
        if not checked:
            self.skipTest("no tree with kits.json and maps.json")

    def test_a_level_variant_s_part_counts_on_its_own_levels_only(self) -> None:
        kits = {"kits": [{"levels": ["Hill", "Kursk"], "worn": [
            {"template": "Rus_RJcap_m2", "geometry": "Rus_RJcap2", "glb": None}],
            "levelVariants": [{"levels": ["Kursk"], "worn": [
                {"template": "Rus_RJcap_m2", "geometry": "Rus_RJcap2",
                 "glb": "Rus_RJcap_m2@kursk.kit.glb"}]}]}]}
        self.assertEqual({"rus_rjcap_m2@hill"}, missing_parts(kits, {"hill", "kursk"}))


if __name__ == "__main__":
    unittest.main()
