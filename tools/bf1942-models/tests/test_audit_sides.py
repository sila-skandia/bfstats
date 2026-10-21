"""`audit_sides.py` (`audit_mod.py --audit loadouts armoury nations flagcloth`):
each check on a small tree with the defect the owner found on FHSWEurope's
Ulsnes planted (2026-10-21): Einunna Bridge's kits dealt on Ulsnes, a shotgun
with no sound, a bot grenade the bots never threw, the Instant Battle preview
flying the wrong flag, and a flag cloth the level reskins. No install needed:
each level is `LevelSource.from_texts`, the image index a set.
"""

from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import audit_mod as A  # noqa: E402
import audit_sides as S  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402

CHAIN_CON = """
ObjectTemplate.create HandFireArms Krag
ObjectTemplate.create HandFireArms Mp40
ObjectTemplate.geometry Mp40_m1
GeometryTemplate.create StandardMesh Mp40_m1
ObjectTemplate.create HandFireArms Deploy_Cavalry_HandFireArms
ObjectTemplate.create HandFireArms MillsGrenade
ObjectTemplate.create HandFireArms KnifeAllies
ObjectTemplate.create Kit NR_MILORG_AT
ObjectTemplate.addTemplate Krag
ObjectTemplate.addTemplate KnifeAllies
"""

INIT = """
game.setTeamSkin 1 GermanSoldier
game.setTeamSkin 2 MILORGSoldier
game.setKit 1 0 German_Officer
game.setKit 2 0 NR_MILORG_Officer
game.setKit 2 2 NR_MILORG_AT
beginrem
game.setKit 2 2 US_AT
endrem
"""

# Ulsnes's own copy of the AT kit: a Krag, not the shotgun
LEVEL_KITS = """
ObjectTemplate.create HandFireArms Hagle
ObjectTemplate.create Kit NR_MILORG_AT
ObjectTemplate.addTemplate Krag
ObjectTemplate.addTemplate KnifeAllies
ObjectTemplate.addWeaponIcon Weapon/Icon_alliesKnife.tga
ObjectTemplate.addWeaponIcon Weapon/Icon_noicon.tga
ObjectTemplate.addWeaponIcon Weapon/Icon_m98.tga
"""


class StubGame:
    ok = True

    def __init__(self, sources=None, images=None):
        self._lib = ObjectLibrary()
        self._lib.add_con("objects/test/objects.con", CHAIN_CON)
        self._sides_levels = sources or {}
        self._sides_images = images

    def library(self):
        return self._lib


def write(p: Path, data) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data))


def write_glb(p: Path, doc: dict) -> None:
    blob = json.dumps(doc).encode()
    blob += b" " * (-len(blob) % 4)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"glTF" + struct.pack("<II", 2, 12 + 8 + len(blob))
                  + struct.pack("<II", len(blob), 0x4E4F534A) + blob)


def weapon_glb(round_: dict, throw: dict | None = None) -> dict:
    fa = {"projectile": round_, "input": "c_PIFire", "velocity": 20.0}
    if throw:
        fa["throw"] = throw
    return {"extras": {"weapon": {"roundOfFire": 1}},
            "nodes": [{"name": "w", "extras": {"fireArms": fa}}]}


BULLET = {"template": "6,5mmProjectile", "kind": "bullet",
          "damage": {"hasCollisionEffect": True, "dieAfterColl": True}}
GRENADE_DMG = {"radius": 15.0, "material2": 207, "damageType": 1,
               "hasCollisionEffect": False, "dieAfterColl": False, "hasOnTimeEffect": True}


def at_row(items, icons, weapons):
    return {"items": items, "weaponIcons": icons, "weapons": weapons, "random": []}


class SideTree(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.tree = A.Tree("fhsweurope", root / "models", root / "maps", root / "textures",
                           ["ulsnes"])
        write(self.tree.maps / "maps.json",
              [{"name": "ulsnes", "glb": "ulsnes/scene.glb", "loading": {"x": 1}},
               {"name": "notexported", "glb": "notexported/scene.glb"}])
        icons = ["Weapon/Icon_alliesKnife.tga", "Weapon/Icon_noicon.tga", "Weapon/Icon_m98.tga"]
        self.lo = {
            "levels": {"ulsnes": {
                "1": {"soldier": "GermanSoldier", "slots": {"0": "German_Officer"}},
                "2": {"soldier": "MILORGSoldier",
                      "slots": {"0": "NR_MILORG_Officer", "2": "NR_MILORG_AT"}}}},
            "kits": {
                "German_Officer": at_row(["Mp40"], ["Weapon/Icon_mp40.tga"],
                                         [{"slot": 1, "weapon": "Mp40",
                                           "icon": "Weapon/Icon_mp40.tga"}]),
                "NR_MILORG_Officer": at_row(["MillsGrenade"], [], []),
                # Einunna Bridge's: the shotgun on the AT row
                "NR_MILORG_AT": at_row(["Hagle", "KnifeAllies"], icons,
                                       [{"slot": 1, "weapon": "KnifeAllies",
                                         "icon": "Weapon/Icon_alliesKnife.tga"},
                                        {"slot": 3, "weapon": "Hagle",
                                         "icon": "Weapon/Icon_noicon.tga"}])},
        }
        write(self.tree.maps / "_shared" / "loadouts.json", self.lo)
        # vanilla's trees, which a mod tree falls back on, are this test's own
        self._viewer = S.VIEWER
        S.VIEWER = root / "viewer"
        S._listing_cache.clear()
        self.src = S.LevelSource.from_texts(
            INIT, [("bf1942/levels/ulsnes/objects/kits.con", LEVEL_KITS)])

    def tearDown(self):
        S.VIEWER = self._viewer
        S._listing_cache.clear()
        self.tmp.cleanup()

    def run_audit(self, fn, **kw):
        game = StubGame({"ulsnes": self.src}, **kw)
        return fn(self.tree, game, {}, A.Finding)


class Loadouts(SideTree):
    def test_the_level_s_own_kit_copy_must_be_the_dealt_row(self):
        rows = self.run_audit(S.run_loadouts)
        stale = [r for r in rows if r.cause == "level-kit-row-stale"]
        self.assertEqual(["NR_MILORG_AT"], [r.subject for r in stale])
        self.assertIn("hagle", stale[0].detail)
        self.assertEqual("blocker", stale[0].severity)

    def test_a_level_kits_row_of_the_level_s_copy_is_clean(self):
        self.lo["levelKits"] = {"ulsnes": {"NR_MILORG_AT": at_row(
            ["Krag", "KnifeAllies"],
            ["Weapon/Icon_alliesKnife.tga", "Weapon/Icon_noicon.tga", "Weapon/Icon_m98.tga"],
            [{"slot": 1, "weapon": "KnifeAllies", "icon": "Weapon/Icon_alliesKnife.tga"},
             {"slot": 3, "weapon": "Krag", "icon": "Weapon/Icon_m98.tga"}])}}
        write(self.tree.maps / "_shared" / "loadouts.json", self.lo)
        causes = {r.cause for r in self.run_audit(S.run_loadouts)}
        self.assertNotIn("level-kit-row-stale", causes)

    def test_an_icon_paired_by_position_not_slot_is_named(self):
        rows = [r for r in self.run_audit(S.run_loadouts)
                if r.cause == "kit-weapon-icon-misaligned"]
        self.assertEqual(["NR_MILORG_AT"], [r.subject for r in rows])

    def test_a_slot_or_soldier_init_con_does_not_bind_is_named(self):
        self.lo["levels"]["ulsnes"]["2"]["soldier"] = "USSoldier"
        self.lo["levels"]["ulsnes"]["2"]["slots"]["2"] = "US_AT"   # the beginrem one
        write(self.tree.maps / "_shared" / "loadouts.json", self.lo)
        causes = {r.cause: r for r in self.run_audit(S.run_loadouts)}
        self.assertIn("loadout-soldier-mismatch", causes)
        self.assertIn("NR_MILORG_AT", causes["loadout-slot-mismatch"].detail)

    def test_an_exported_level_with_no_row_deals_fallback_kits(self):
        del self.lo["levels"]["ulsnes"]
        write(self.tree.maps / "_shared" / "loadouts.json", self.lo)
        causes = {r.cause for r in self.run_audit(S.run_loadouts)}
        self.assertEqual({"loadout-level-missing"}, causes)


class Armoury(SideTree):
    def setUp(self):
        super().setUp()
        m = self.tree.models
        write_glb(m / "Hagle.glb", weapon_glb({**BULLET, "template": "ShotgunProjectile"}))
        write_glb(m / "KnifeAllies.glb", {"nodes": []})
        write_glb(m / "Mp40.glb", weapon_glb(BULLET))
        # a thrown round of a kind neither the bots nor the human fly
        write_glb(m / "MillsGrenade.glb", weapon_glb(
            {"template": "MillsGrenadeProjectile", "kind": "lump",
             "damage": {**GRENADE_DMG, "hasOnTimeEffect": False, "radius": 0}},
            {"fireDelay": 1.0}))
        write(m / "sounds" / "weapons.json", {"weapons": {"Mp40": {}, "MillsGrenade": {}},
                                              "silent": {}})
        write(self.tree.maps / "_shared" / "damage.json", {"projectiles": {
            "6,5mmprojectile": {}, "shotgunprojectile": {}, "millsgrenadeprojectile": {}}})
        write(m / "viewmodels" / "index.json",
              ["MILORGSoldier__Hagle", "GermanSoldier__Hagle", "MILORGSoldier__Mp40",
               "GermanSoldier__Mp40", "MILORGSoldier__MillsGrenade",
               "GermanSoldier__MillsGrenade", "MILORGSoldier__KnifeAllies",
               "GermanSoldier__KnifeAllies"])

    def causes(self):
        return {(r.cause, r.subject) for r in self.run_audit(S.run_armoury)}

    def test_a_weapon_only_a_level_declares_with_no_sound_fires_silently(self):
        self.assertIn(("weapon-no-sound", "Hagle"), self.causes())

    def test_a_quiet_weapon_the_extractor_read_is_accepted(self):
        write(self.tree.models / "sounds" / "weapons.json",
              {"weapons": {"Mp40": {}, "MillsGrenade": {}},
               "silent": {"Hagle": "no loadSoundScript"}})
        rows = {r.subject: r for r in self.run_audit(S.run_armoury)}
        self.assertEqual("weapon-sound-absent-from-install", rows["Hagle"].cause)
        self.assertEqual("info", rows["Hagle"].severity)

    def test_a_grenade_round_the_bots_cannot_fly_is_a_blocker(self):
        self.assertIn(("thrown-round-not-flown", "MillsGrenade"), self.causes())
        write_glb(self.tree.models / "MillsGrenade.glb", weapon_glb(
            {"template": "MillsGrenadeProjectile", "kind": "shell", "damage": GRENADE_DMG},
            {"fireDelay": 1.0}))
        self.assertNotIn(("thrown-round-not-flown", "MillsGrenade"), self.causes())

    def test_a_bodiless_fuse_round_is_flown(self):
        # FHSWEurope's APLandmineT1: a `bullet` with a fuse, which the bots
        # fly since 2026-10-21 (bot-rounds.js launchesDrawnRound)
        write_glb(self.tree.models / "MillsGrenade.glb", weapon_glb(
            {"template": "MillsGrenadeProjectile", "kind": "bullet", "damage": GRENADE_DMG},
            {"fireDelay": 1.0}))
        self.assertNotIn(("thrown-round-not-flown", "MillsGrenade"), self.causes())

    def test_a_thrown_knife_is_a_ray_for_everyone(self):
        write_glb(self.tree.models / "MillsGrenade.glb", weapon_glb(BULLET, {"fireDelay": 0.43}))
        self.assertNotIn(("thrown-round-not-flown", "MillsGrenade"), self.causes())

    def test_a_missing_model_and_a_case_mismatch(self):
        (self.tree.models / "Mp40.glb").rename(self.tree.models / "MP40.glb")
        self.assertIn(("weapon-model-case-mismatch", "Mp40"), self.causes())
        (self.tree.models / "MP40.glb").unlink()
        S._listing_cache.clear()
        self.assertIn(("weapon-no-model", "Mp40"), self.causes())

    def test_a_weapon_that_draws_nothing_has_no_glb_by_design(self):
        self.lo["kits"]["German_Officer"]["items"].append("Deploy_Cavalry_HandFireArms")
        write(self.tree.maps / "_shared" / "loadouts.json", self.lo)
        rows = {r.subject: r for r in self.run_audit(S.run_armoury)
                if r.cause != "weapon-no-rig"}
        self.assertEqual("weapon-draws-nothing", rows["Deploy_Cavalry_HandFireArms"].cause)
        self.assertEqual("info", rows["Deploy_Cavalry_HandFireArms"].severity)

    def test_a_round_the_damage_table_lacks_and_a_missing_rig(self):
        write(self.tree.maps / "_shared" / "damage.json", {"projectiles": {
            "6,5mmprojectile": {}, "millsgrenadeprojectile": {}}})
        write(self.tree.models / "viewmodels" / "index.json", ["MILORGSoldier__Mp40"])
        causes = self.causes()
        self.assertIn(("round-not-in-damage-table", "Hagle"), causes)
        self.assertIn(("weapon-no-rig", "Mp40"), causes)

    def test_a_melee_weapon_with_no_firearms_is_not_a_gun(self):
        self.assertFalse({c for c in self.causes() if c[1] == "KnifeAllies"})

    def test_fuse_rule_matches_the_page(self):
        self.assertTrue(S.is_fuse_round(GRENADE_DMG))
        # a flak shell: blast at the end of life, but it dies on contact
        self.assertFalse(S.is_fuse_round({**GRENADE_DMG, "hasCollisionEffect": True}))
        # a smoke grenade: no radius, no splash
        self.assertFalse(S.is_fuse_round({**GRENADE_DMG, "radius": 0}))


class Nations(SideTree):
    def setUp(self):
        super().setUp()
        hud = self.tree.maps / "_shared" / "hud"
        write(hud / "pack.json", {"files": ["soldier-icons.json", "hud.json",
                                            "menu/menu-levels.json", "conp_nr.png",
                                            "flag_ticket_nr.png", "icon_flag_nr.png",
                                            "menu/textures/icon_flag_nr.png"]})
        write(hud / "soldier-icons.json", {"milorgsoldier": {"nation": "nr"},
                                           "germansoldier": {"nation": "ger"}})
        write(hud / "hud.json", {"sprites": {n: {"file": f"{n}.png"} for n in
                                             ("conp_nr", "flag_ticket_nr", "icon_flag_nr")}})
        for n in ("conp_nr", "flag_ticket_nr", "icon_flag_nr", "menu/textures/icon_flag_nr"):
            (hud / f"{n}.png").parent.mkdir(parents=True, exist_ok=True)
            (hud / f"{n}.png").write_bytes(b"png")
        self.menu = {"levels": [{"dir": "ulsnes",
                                 "axis": {"skin": "GermanSoldier", "nation": "ger"},
                                 "allied": {"skin": "MILORGSoldier", "nation": "us",
                                            "flag": "icon_flag_us", "nationSource": "level"}}]}
        write(hud / "menu" / "menu-levels.json", self.menu)

    def test_the_preview_flying_the_flag_mesh_s_nation_is_named(self):
        causes = {(r.cause, r.subject) for r in self.run_audit(S.run_nations)}
        self.assertIn(("menu-side-nation-mismatch", "allied"), causes)
        self.assertIn(("menu-flag-texture-missing", "icon_flag_us"), causes)

    def test_a_nation_sprite_vanilla_lacks_too_is_named(self):
        causes = {(r.cause, r.subject) for r in self.run_audit(S.run_nations)}
        # German sprites resolve to vanilla's pack, which this tree lacks
        self.assertIn(("hud-nation-sprite-missing", "conp_ger"), causes)
        self.assertNotIn(("hud-nation-sprite-missing", "conp_nr"), causes)


class FlagCloth(SideTree):
    def scene(self, image):
        return {"nodes": [{"name": "c", "mesh": 0,
                           "extras": {"kind": "flagCloth", "point": "austsida",
                                      "mesh": "flagus_m1"}}],
                "meshes": [{"primitives": [{"material": 0}]}],
                "materials": [{"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}}],
                "textures": [{"extensions": {"EXT_texture_webp": {"source": 0}}}],
                "images": [{"name": image}]}

    def test_a_cloth_the_alternative_path_reskins_must_bake_that_texture(self):
        self.src.alt_paths = ["Texture/NOR_ALTERNATIVE"]
        images = S.ImageIndex.__new__(S.ImageIndex)
        images.names = {"texture/nor_alternative/flags_o", "texture/flags_o"}
        write_glb(self.tree.maps / "ulsnes" / "scene.glb", self.scene("texture/flags_o.dds"))
        rows = self.run_audit(S.run_flagcloth, images=images)
        self.assertEqual(["flag-cloth-alt-texture-not-baked"], [r.cause for r in rows])
        write_glb(self.tree.maps / "ulsnes" / "scene.glb",
                  self.scene("texture/NOR_ALTERNATIVE/flags_o.dds"))
        self.assertEqual([], self.run_audit(S.run_flagcloth, images=images))

    def test_an_alternative_path_without_the_texture_changes_nothing(self):
        self.src.alt_paths = ["Texture/Winter"]
        images = S.ImageIndex.__new__(S.ImageIndex)
        images.names = {"texture/flags_o"}
        write_glb(self.tree.maps / "ulsnes" / "scene.glb", self.scene("texture/flags_o.dds"))
        self.assertEqual([], self.run_audit(S.run_flagcloth, images=images))


if __name__ == "__main__":
    unittest.main()
