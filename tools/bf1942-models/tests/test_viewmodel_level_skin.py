"""An arms rig wears the paint of the level it is drawn on.

`extract_viewmodel.py` extracts a rig once a mod, with no level loaded, so its
textures are the ones the mod's archives answer for the paths the shaders
wrote. The game looks each file's name up under the level's
`textureManager.alternativePath` folders first (ledger LOAD-3): Forgotten
Hope's Battle of Foy adds `Texture/ENVIROMENT_WINTER`, whose `Ste_hand2` is a
glove over the hand every other level draws bare. These pin the level's half:
which textures a level repaints (`level_skin`), the file that carries them
(`build_level_skin`, `write_level_skins`) and the viewer's swap
(`viewer/level-skin.js`, under node).

The same holds for everything else mounted on a soldier with no level in its
file: his third-person body, the weapon in its hand, his kit's worn parts and
the kit he drops. The skins cover their textures too (`soldier_glbs`,
`painted_images`), the body and kit loaders wear the page's paint
(`wearPagePaint`), and `audit_mod.level_paint_findings` names a level whose
repaint the index does not hand over.
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import extract_viewmodel as ev  # noqa: E402
from bf42 import gltf  # noqa: E402
from bf42.assemble import Assembler  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from bf42.rfa import ArchivePool, write_rfa  # noqa: E402
from page_source import function_body  # noqa: E402

HARNESS = Path(__file__).resolve().parent / "level_skin_harness.mjs"
VIEWER = Path(__file__).resolve().parent.parent / "viewer"

# Battle of Foy's own list, FHSW's Init.con, in the order it is written.
FOY_PATHS = [
    "bf1942/levels/_TEXTURE_SPECIAL/texture/SPECIAL_US_UNIFORM_WINTER_ALT",
    "texture/SPECIAL_US_UNIFORM_WINTER_ALT",
    "bf1942/levels/BATTLE_OF_FOY/texture",
    "Texture/Levels/bulge",
    "Texture/ENVIROMENT_WINTER",
    "texture/GENERAL_US_WINTER",
]


def tga(red: int, green: int, blue: int) -> bytes:
    """A 2x2 uncompressed 32-bit image of one opaque colour."""
    header = struct.pack("<BBBHHBHHHHBB", 0, 0, 2, 0, 0, 0, 0, 0, 2, 2, 32, 8)
    return header + bytes([blue, green, red, 255]) * 4


def glb_doc(blob: bytes) -> dict:
    return json.loads(blob[20:20 + struct.unpack("<I", blob[12:16])[0]])


class Fixture(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        write_rfa(self.tmp / "texture.rfa", {
            "texture/Ste_hand2.tga": tga(200, 150, 120),
            "texture/Ame1_sleeve_T.tga": tga(120, 120, 100),
            "texture/M1Garand.tga": tga(60, 40, 20),
            "texture/ENVIROMENT_WINTER/Ste_hand2.tga": tga(90, 90, 100),
            "texture/GENERAL_US_WINTER/Ste_hand2.tga": tga(60, 70, 50),
            "texture/GENERAL_US_WINTER/Ame1_sleeve_T.tga": tga(80, 80, 40),
            "texture/Levels/bulge/Ger1_sleeve_T.tga": tga(230, 230, 230),
        })
        write_rfa(self.tmp / "_TEXTURE_SPECIAL.rfa", {
            "bf1942/levels/_TEXTURE_SPECIAL/texture/SPECIAL_NAVY/Ame1_sleeve_T.tga": tga(10, 20, 90),
        })
        self.textures = ArchivePool()
        self.textures.add(self.tmp / "texture.rfa")
        self.textures.mount_level(self.tmp / "_TEXTURE_SPECIAL.rfa", (".dds", ".tga"))
        self.images = ["texture/Ste_hand2.tga", "texture/Ame1_sleeve_T.tga",
                       "texture/M1Garand.tga"]

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def assembler(self) -> Assembler:
        return Assembler(ArchivePool(), self.textures, ArchivePool(), ObjectLibrary(),
                         max_texture=1024, include_collision=False)

    def rig(self, folder: Path, stem: str, images: list[str]) -> Path:
        """A stand-in rig: a glb whose images carry these names."""
        builder = gltf.GlbBuilder()
        for name in images:
            builder.add_image_png(b"\x89PNG", name=name)
        node = builder.add_node(gltf.Node(name=stem))
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{stem}.fp.glb"
        path.write_bytes(builder.build([node]))
        return path


class LevelSkinTests(Fixture):
    def test_the_gloves_are_the_first_alternative_path_holding_the_hand(self) -> None:
        # Two of Foy's folders hold a `Ste_hand2`; the one declared first is
        # drawn (the grey wool of ENVIROMENT_WINTER, not GENERAL_US_WINTER's).
        skin = ev.level_skin(self.textures, self.images, FOY_PATHS)
        self.assertEqual(skin["texture/Ste_hand2.tga"],
                         "texture/ENVIROMENT_WINTER/Ste_hand2.tga")
        self.assertEqual(skin["texture/Ame1_sleeve_T.tga"],
                         "texture/GENERAL_US_WINTER/Ame1_sleeve_T.tga")

    def test_a_texture_no_alternative_path_holds_keeps_the_rigs_own(self) -> None:
        skin = ev.level_skin(self.textures, self.images, FOY_PATHS)
        self.assertNotIn("texture/M1Garand.tga", skin)

    def test_a_level_with_no_alternative_path_repaints_nothing(self) -> None:
        self.assertEqual(ev.level_skin(self.textures, self.images, []), {})

    def test_a_level_archives_folder_is_an_alternative_path(self) -> None:
        skin = ev.level_skin(self.textures, self.images,
                             ["bf1942/levels/_TEXTURE_SPECIAL/texture/SPECIAL_NAVY"])
        self.assertEqual(skin, {
            "texture/Ame1_sleeve_T.tga":
                "bf1942/levels/_TEXTURE_SPECIAL/texture/SPECIAL_NAVY/Ame1_sleeve_T.tga"})

    def test_the_pool_is_left_with_no_level_loaded(self) -> None:
        ev.level_skin(self.textures, self.images, FOY_PATHS)
        self.assertEqual(self.textures.resolve_ext("texture/Ste_hand2", (".dds", ".tga")),
                         "texture/Ste_hand2.tga")


class RigImageTests(Fixture):
    def test_the_images_are_read_off_the_rigs_once_each(self) -> None:
        own = self.tmp / "models" / "mods" / "fh" / "viewmodels"
        vanilla = self.tmp / "models" / "viewmodels"
        self.rig(own, "USSoldier__M1Garand", ["texture/Ste_hand2.tga", "texture/M1Garand.tga"])
        self.rig(vanilla, "USSoldier__Colt", ["Texture/ste_hand2.tga", "texture/Colt_o.tga"])
        # A mod's page mounts vanilla's rigs for the pairs it inherits.
        self.assertEqual(ev.inherited_rig_dirs(own), [own, vanilla])
        self.assertEqual(ev.inherited_rig_dirs(vanilla), [vanilla])
        self.assertEqual(ev.rig_images(ev.inherited_rig_dirs(own)),
                         ["texture/Colt_o.tga", "texture/M1Garand.tga",
                          "texture/Ste_hand2.tga"])


class SkinFileTests(Fixture):
    def test_a_material_is_named_for_the_rig_image_and_holds_the_levels_file(self) -> None:
        skin = ev.level_skin(self.textures, self.images, FOY_PATHS)
        blob, kept = ev.build_level_skin("Battle_Of_Foy", skin, self.assembler())
        self.assertEqual(kept, skin)
        doc = glb_doc(blob)
        by_material = {}
        for material in doc["materials"]:
            texture = doc["textures"][material["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
            by_material[material["name"]] = doc["images"][texture["source"]]["name"]
        self.assertEqual(by_material, skin)
        # Every material is on a primitive, or a glTF loader drops it.
        used = {prim["material"] for mesh in doc["meshes"] for prim in mesh["primitives"]}
        self.assertEqual(used, set(range(len(doc["materials"]))))
        self.assertEqual(doc["extras"]["levelSkin"],
                         {"level": "Battle_Of_Foy", "textures": skin})

    def test_two_levels_that_read_one_file_each_carry_it(self) -> None:
        # One assembler builds every level's skin; a texture it has placed in
        # one document is not thereby in the next (Monster des Stahles reads
        # the sleeve Midway-1942 read before it).
        skin = ev.level_skin(self.textures, self.images, FOY_PATHS)
        assembler = self.assembler()
        first, _ = ev.build_level_skin("A", skin, assembler)
        second, _ = ev.build_level_skin("B", skin, assembler)
        for blob in (first, second):
            doc = glb_doc(blob)
            self.assertEqual(len(doc["images"]), len(skin))
            for material in doc["materials"]:
                index = material["pbrMetallicRoughness"]["baseColorTexture"]["index"]
                self.assertLess(index, len(doc["textures"]))

    def test_a_file_that_does_not_decode_is_left_out(self) -> None:
        write_rfa(self.tmp / "broken.rfa", {"texture/WINTER/M1Garand.tga": b"not an image"})
        self.textures.add(self.tmp / "broken.rfa")
        skin = ev.level_skin(self.textures, self.images, ["texture/WINTER"])
        self.assertEqual(list(skin), ["texture/M1Garand.tga"])
        blob, kept = ev.build_level_skin("L", skin, self.assembler())
        self.assertIsNone(blob)
        self.assertEqual(kept, {})

    def test_the_index_has_a_row_for_each_level_that_repaints_a_rig(self) -> None:
        out = self.tmp / "models" / "mods" / "fhsw" / "viewmodels"
        self.rig(out, "USSoldier__M1Garand", self.images)
        stale = out / "skins" / f"gone{ev.SKIN_SUFFIX}"
        stale.parent.mkdir(parents=True)
        stale.write_bytes(b"old")
        maps = [{"name": "Battle_Of_Foy", "glb": "battle_of_foy/scene.glb"},
                {"name": "Omaha", "glb": "omaha/scene.glb"}]
        paths = {"Battle_Of_Foy": FOY_PATHS, "Omaha": []}
        with mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths",
                                  side_effect=lambda _g, _m, level, _c: paths[level]):
            index = ev.write_level_skins(out, maps, game_dir=self.tmp, mod="FHSW",
                                         chain=[], textures=self.textures,
                                         assembler=self.assembler())
        self.assertEqual(json.loads((out / ev.SKIN_INDEX).read_text()), index)
        self.assertEqual(list(index["levels"]), ["battle_of_foy"])
        row = index["levels"]["battle_of_foy"]
        self.assertEqual(row["level"], "Battle_Of_Foy")
        self.assertEqual(row["textures"]["texture/Ste_hand2.tga"],
                         "texture/ENVIROMENT_WINTER/Ste_hand2.tga")
        self.assertTrue((out / row["file"]).is_file())
        self.assertFalse(stale.exists())
        # The rigs' index lists rigs only.
        self.assertEqual(ev.write_index(out), ["USSoldier__M1Garand"])


class SoldierTree(Fixture):
    """A mod's models tree beside vanilla's, with a soldier in each: bodies
    under `poses/`, a kit's helmet and pickup, the weapon it hands out, and a
    tank no soldier wears."""

    def setUp(self) -> None:
        super().setUp()
        write_rfa(self.tmp / "soldiers.rfa", {
            "texture/Amerov_Z.tga": tga(110, 100, 80),
            "texture/ahelm_r.tga": tga(70, 80, 60),
            "texture/Sherma_I.tga": tga(60, 80, 50),
            "texture/GENERAL_US_WINTER/Amerov_Z.tga": tga(90, 100, 60),
            "texture/Levels/bulge/ahelm_r.tga": tga(220, 220, 220),
            "texture/Levels/bulge/Sherma_I.tga": tga(240, 240, 240),
        })
        self.textures.add(self.tmp / "soldiers.rfa")
        self.vanilla = self.tmp / "models"
        self.models = self.vanilla / "mods" / "fhsw"
        self.out = self.models / "viewmodels"
        self.glb(self.models / "poses" / "USSoldier__M1Garand.pose.glb",
                 ["texture/Amerov_Z.tga", "texture/M1Garand.tga"])
        self.glb(self.models / "poses" / "gaits" / "canopy.glb", ["texture/chute.tga"])
        self.glb(self.vanilla / "poses" / "rigs" / "USSoldier.rig.glb",
                 ["Texture/amerov_z.tga", "texture/Hand01_r.tga"])
        self.glb(self.models / "ahelm.kit.glb", ["texture/ahelm_r.tga"])
        self.glb(self.models / "Kit_Allies_Assault.kit.glb", ["texture/kitbag.tga"])
        self.glb(self.models / "SdKfz251_1.glb", ["texture/halftrack_gun.tga"])
        self.glb(self.models / "Sherman.glb", ["texture/Sherma_I.tga"])
        (self.models / "kits.json").write_text(json.dumps({"kits": [{
            "template": "1Us_Assault", "soldiers": ["USSoldier"],
            "pickup": {"geometry": "Kit_Allies_Assault", "glb": "Kit_Allies_Assault.kit.glb"},
            "worn": [{"slot": "head", "glb": "ahelm.kit.glb",
                      "alternatives": [{"glb": "gone.kit.glb"}]},
                     {"slot": "hip", "glb": None}],
            "items": [{"template": "M1Garand"}, {"template": "SdKfz251/1"}],
        }]}))
        self.rig(self.out, "USSoldier__M1Garand", self.images)

    def glb(self, path: Path, images: list[str]) -> Path:
        builder = gltf.GlbBuilder()
        for name in images:
            builder.add_image_png(b"\x89PNG", name=name)
        node = builder.add_node(gltf.Node(name=path.stem))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(builder.build([node]))
        return path

    def skins(self, write: bool = True) -> dict:
        maps = [{"name": "Battle_Of_Foy", "glb": "battle_of_foy/scene.glb"},
                {"name": "Omaha", "glb": "omaha/scene.glb"}]
        paths = {"Battle_Of_Foy": FOY_PATHS, "Omaha": []}
        with mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths",
                                  side_effect=lambda _g, _m, level, _c: paths[level]):
            if write:
                return ev.write_level_skins(
                    self.out, maps, game_dir=self.tmp, mod="FHSW", chain=[],
                    textures=self.textures, assembler=self.assembler())["levels"]
            return ev.expected_level_skins(self.out, maps, game_dir=self.tmp,
                                           mod="FHSW", chain=[], textures=self.textures)


class SoldierImageTests(SoldierTree):
    def test_the_glbs_mounted_on_a_soldier_are_the_poses_and_what_his_kit_names(self) -> None:
        names = [str(path.relative_to(self.models)) for path in ev.soldier_glbs(self.models)]
        self.assertEqual(sorted(names), [
            "Kit_Allies_Assault.kit.glb",       # the kit he drops
            "SdKfz251_1.glb",                   # an item, its `/` spelled `_`
            "ahelm.kit.glb",                    # a worn part
            "poses/USSoldier__M1Garand.pose.glb",
            "poses/gaits/canopy.glb",
        ])
        # Not the tank, and not a part or a weapon the tree does not hold.
        self.assertNotIn("Sherman.glb", names)

    def test_a_tree_with_no_kits_json_answers_with_its_poses(self) -> None:
        names = [path.name for path in ev.soldier_glbs(self.vanilla)]
        self.assertEqual(names, ["USSoldier.rig.glb"])
        (self.models / "kits.json").write_text("{ not json")
        self.assertEqual(len(ev.soldier_glbs(self.models)), 2)
        self.assertEqual(ev.soldier_glbs(self.tmp / "nowhere"), [])

    def test_the_painted_images_are_the_rigs_and_the_soldiers_of_both_trees(self) -> None:
        images = ev.painted_images(self.out)
        self.assertEqual(images, sorted(images, key=str.lower))
        self.assertEqual({name.lower() for name in images}, {
            "texture/ste_hand2.tga", "texture/ame1_sleeve_t.tga", "texture/m1garand.tga",
            "texture/amerov_z.tga", "texture/chute.tga", "texture/ahelm_r.tga",
            "texture/kitbag.tga", "texture/halftrack_gun.tga", "texture/hand01_r.tga",
        })
        # Once each, however the two trees spell it.
        self.assertEqual(len(images), len({name.lower() for name in images}))

    def test_a_level_skin_covers_the_uniform_and_the_helmet(self) -> None:
        foy = self.skins()["battle_of_foy"]["textures"]
        self.assertEqual(foy["texture/Amerov_Z.tga"], "texture/GENERAL_US_WINTER/Amerov_Z.tga")
        self.assertEqual(foy["texture/ahelm_r.tga"], "texture/Levels/bulge/ahelm_r.tga")
        self.assertEqual(foy["texture/Ste_hand2.tga"], "texture/ENVIROMENT_WINTER/Ste_hand2.tga")
        # The tank is the level bake's to paint, not the soldiers' skin's.
        self.assertFalse(any("sherma" in name.lower() for name in foy))
        doc = glb_doc((self.out / "skins" / "battle_of_foy.skin.glb").read_bytes())
        self.assertIn("texture/Amerov_Z.tga", [m["name"] for m in doc["materials"]])


class PadVariantTests(SoldierTree):
    """The side of a pad its bake did not place is loaded from the models tree
    (`level-statics.js` `loadPadVariants`) in the mod's own paint, so the
    level's skin covers it: FHSWEurope's doomed_budapest draws its Zrinyi and
    Nimrod from `GENERAL_HUN_WINTER` (ledger LOAD-3)."""

    def setUp(self) -> None:
        super().setUp()
        self.glb(self.models / "Sherman.wreck.glb", ["texture/Sherma_wreck.tga"])
        (self.models / "models.json").write_text(json.dumps([{
            "name": "Sherman", "glb": "Sherman.glb", "variants": [
                {"glb": "Sherman.glb", "configuration": "complex", "level": None},
                {"glb": "Sherman.cockpit.glb", "configuration": "complex",
                 "firstPerson": True, "level": None},
                {"glb": "Sherman.wreck.glb", "configuration": "wreck", "level": None}],
        }]))
        self.maps = self.tmp / "maps" / "mods" / "fhsw"
        scene = self.maps / "battle_of_foy" / "scene.json"
        scene.parent.mkdir(parents=True)
        # The pad is in a mode's layer only: every layer's pads are loaded.
        scene.write_text(json.dumps({"objectSpawns": [], "modes": {"Conquest": {
            "objectSpawns": [{"templates": {"1": "Sherman", "2": "M10"}}]}}}))

    def foy(self) -> dict:
        maps = [{"name": "Battle_Of_Foy", "glb": "battle_of_foy/scene.glb",
                 "report": "battle_of_foy/scene.json"}]
        with mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths",
                                  side_effect=lambda *_: FOY_PATHS):
            return ev.expected_level_skins(self.out, maps, game_dir=self.tmp, mod="FHSW",
                                           chain=[], textures=self.textures)

    def test_the_maps_tree_sits_beside_the_models_tree(self) -> None:
        self.assertEqual(ev.maps_tree_for(self.out), self.maps)
        self.assertEqual(ev.maps_tree_for(self.vanilla / "viewmodels"), self.tmp / "maps")

    def test_a_pads_vehicles_are_its_drawn_model_and_its_wreck(self) -> None:
        catalogues = ev.model_catalogues(self.out)
        glbs = ev.pad_template_glbs(catalogues, "sherman", "battle_of_foy")
        self.assertEqual([p.name for p in glbs], ["Sherman.glb", "Sherman.wreck.glb"])
        self.assertEqual(ev.pad_template_glbs(catalogues, "M10", "battle_of_foy"), [])
        self.assertEqual(
            ev.pad_images(catalogues, self.maps / "battle_of_foy" / "scene.json", "Battle_Of_Foy"),
            ["texture/Sherma_I.tga", "texture/Sherma_wreck.tga"])

    def test_a_level_skin_covers_the_vehicles_its_pads_hand_out(self) -> None:
        foy = self.foy()["battle_of_foy"]["textures"]
        self.assertEqual(foy["texture/Sherma_I.tga"], "texture/Levels/bulge/Sherma_I.tga")
        # The soldiers' paint is still there beside it.
        self.assertEqual(foy["texture/Amerov_Z.tga"], "texture/GENERAL_US_WINTER/Amerov_Z.tga")

    def test_the_pad_vehicles_and_their_wrecks_wear_the_levels_paint(self) -> None:
        load = (VIEWER / "level-load.js").read_text()
        self.assertIn("await padSkin.wear(padGltf.scene, padDir)", load)
        self.assertLess(load.index("await padSkin.wear("), load.index("return padGltf;"))
        self.assertIn("await wearPagePaint(g.scene)", (VIEWER / "vehicle-wrecks.js").read_text())


class WorldImageTests(SoldierTree):
    """What the page draws in a level's world from glbs no bake textured and no
    soldier carries: a deployed weapon, the CTF flags, the interiors of the
    level's vehicles and the effect libraries. The client's TextureManager
    walks the level's alternative paths for every texture it loads (ledger
    LOAD-3: `0x00642340`, reached from every texture-creating slot of its
    vtable through `0x006429d0`), so the level's skin covers them too."""

    WORLD = ["texture/mortar_T.tga", "texture/flagpole_T.tga", "texture/sov_flag_T.tga",
             "texture/1P_Willy_I.tga", "texture/B17Eng_T.tga", "texture/foy_smoke.tga"]

    def setUp(self) -> None:
        super().setUp()
        write_rfa(self.tmp / "world.rfa", {
            **{name: tga(100, 100, 100) for name in self.WORLD},
            **{name.replace("texture/", "texture/Levels/bulge/"): tga(240, 240, 240)
               for name in self.WORLD},
            "texture/Sherma_cockpit.tga": tga(50, 60, 50),
        })
        self.textures.add(self.tmp / "world.rfa")
        self.glb(self.models / "DeployedMortar.glb", ["texture/mortar_T.tga"])
        (self.models / "deployables.json").write_text(json.dumps({"objects": {
            "DeployedMortar": {"glb": "DeployedMortar.glb"},
            "Gone": {"glb": "Gone.glb"}}}))
        # The pole from vanilla's tree, the cloth from the base's own template.
        self.glb(self.vanilla / "FlagPole.glb", ["texture/flagpole_T.tga"])
        self.glb(self.models / "SovietFlag.glb", ["texture/sov_flag_T.tga"])
        # An interior for a vehicle the scene places (its second copy is
        # `Willys_1`), and one for a vehicle no level of the test places.
        self.glb(self.vanilla / "Willys.cockpit.glb", ["texture/1P_Willy_I.tga"])
        self.glb(self.models / "Sherman.cockpit.glb", ["texture/Sherma_cockpit.tga"])
        self.maps = self.tmp / "maps" / "mods" / "fhsw"
        builder = gltf.GlbBuilder()
        nodes = [builder.add_node(gltf.Node(name=name)) for name in ("house_m1", "Willys_1")]
        (self.maps / "battle_of_foy").mkdir(parents=True)
        (self.maps / "battle_of_foy" / "scene.glb").write_bytes(builder.build(nodes))
        (self.maps / "battle_of_foy" / "scene.json").write_text(json.dumps({"modes": {"CTF": {
            "flagBases": [{"template": "SObase", "flag": {
                "template": "SovietFlag", "geometry": "flagso_m1"}}]}}}))
        self.glb(self.maps / "_shared" / "effects.glb", ["texture/B17Eng_T.tga"])
        self.glb(self.maps / "battle_of_foy" / "effects.glb", ["texture/foy_smoke.tga"])
        self.entry = {"name": "Battle_Of_Foy", "glb": "battle_of_foy/scene.glb",
                      "report": "battle_of_foy/scene.json", "effects": "battle_of_foy/effects.glb"}

    def expected(self, world: dict | None = None) -> dict:
        with mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths",
                                  side_effect=lambda *_: FOY_PATHS):
            return ev.expected_level_skins(self.out, [self.entry], game_dir=self.tmp,
                                           mod="FHSW", chain=[], textures=self.textures,
                                           world=world)

    def test_the_audit_names_a_world_texture_the_index_does_not_hand_over(self) -> None:
        import audit_mod
        import extract_models
        (self.maps / "maps.json").write_text(json.dumps([self.entry]))
        # The index as the soldiers' fix left it: no world images.
        with mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths", side_effect=lambda *_: FOY_PATHS), \
                mock.patch.object(ev, "world_images", return_value=[]):
            ev.write_level_skins(self.out, [self.entry], game_dir=self.tmp, mod="FHSW",
                                 chain=[], textures=self.textures, assembler=self.assembler())
        tree = audit_mod.Tree("fhsw", self.models, self.maps, self.tmp / "textures",
                              ["battle_of_foy"])
        game = types.SimpleNamespace(ok=True, chain=[], game_dir=self.tmp, mod="FHSW")
        with mock.patch.object(extract_models, "build_pools",
                               return_value=(None, self.textures, None, None)), \
                mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths", side_effect=lambda *_: FOY_PATHS):
            found = audit_mod.level_paint_findings(tree, game)
        self.assertEqual(sorted((f.cause, f.subject) for f in found),
                         sorted(("world-level-paint-missing", name) for name in self.WORLD))

    def test_the_world_images_are_the_deployables_flags_interiors_and_effects(self) -> None:
        images = ev.world_images(self.out, self.entry, ev.model_catalogues(self.out), self.maps)
        self.assertEqual({name.lower() for name in images},
                         {name.lower() for name in self.WORLD})
        # Not the Sherman's interior: no vehicle of the level is a Sherman.
        self.assertNotIn("texture/Sherma_cockpit.tga", images)

    def test_the_ctf_meshes_are_the_pages_candidates(self) -> None:
        source = (VIEWER / "ctf-page.js").read_text()
        self.assertIn(f"export const FLAG_POLE = '{ev.CTF_FLAG_POLE}';", source)
        for geometry, bundle in ev.CTF_FLAG_BUNDLES.items():
            self.assertIn(f"{geometry}: '{bundle}'", source)
        report = {"flagBases": [{"template": "GEbase", "flag": {"geometry": "flagge_m1"}}]}
        self.glb(self.models / "AnimatedGeFlag.glb", ["texture/ge.tga"])
        self.assertEqual([p.name for p in ev.ctf_glbs([self.models, self.vanilla], report)],
                         ["FlagPole.glb", "AnimatedGeFlag.glb"])

    def test_an_interior_is_found_by_the_scenes_node_name_any_case(self) -> None:
        found = ev.cockpit_glbs([self.models, self.vanilla],
                                [self.maps / "battle_of_foy" / "scene.glb"])
        self.assertEqual([p.name for p in found], ["Willys.cockpit.glb"])
        self.assertEqual(ev.cockpit_glbs([self.models], [self.tmp / "nowhere.glb"]), [])

    def test_a_level_skin_covers_what_it_draws_in_the_world(self) -> None:
        world: dict = {}
        foy = self.expected(world)["battle_of_foy"]["textures"]
        for name in self.WORLD:
            self.assertEqual(foy[name], name.replace("texture/", "texture/Levels/bulge/"), name)
        self.assertEqual(world["battle_of_foy"], {name.lower() for name in self.WORLD})
        # The soldiers' paint is still there beside it.
        self.assertEqual(foy["texture/Amerov_Z.tga"], "texture/GENERAL_US_WINTER/Amerov_Z.tga")

    def test_each_world_loader_wears_the_pages_paint(self) -> None:
        # A clone of a kept source is painted after its shading is bound: the
        # source was painted for the level it loaded on.
        for file, shade, paint in (
                ("bot-rounds.js", "page.bindDynamicShading?.(root);", "void wearPagePaint(root);"),
                ("deployables-page.js", "page.bindDynamicShading?.(node);", "void wearPagePaint(node);"),
                ("ctf-page.js", "page.bindDynamicShading?.(copy);", "void wearPagePaint(copy);"),
                ("bot-visuals.js", "const scene = skeletonClone(asset.scene);\n"
                 "    page.bindDynamicShading(scene);", "void wearPagePaint(scene);"),
                ("foot-body.js", "page.bindDynamicShading(chute);", "void wearPagePaint(chute);"),
                ("net-remote-rounds.js", "const root = skeletonClone(hand.scene);",
                 "void wearPagePaint(root);"),
                ("replay-bodies.js", "const root = skeletonClone(hand.scene);",
                 "void wearPagePaint(root);"),
                ("replay-props.js", "this.player.ctx.shadeModel?.(scene);",
                 "await wearPagePaint(scene);")):
            source = (VIEWER / file).read_text()
            self.assertIn("import { wearPagePaint } from './level-skin.js';", source, file)
            self.assertIn(paint, source, file)
            self.assertLess(source.index(shade), source.index(paint), file)
        page = (VIEWER / "map.html").read_text()
        cockpit = page[page.index("async function prepareCockpit(root)"):]
        self.assertLess(cockpit.index("await wearPagePaint(root);"),
                        cockpit.index("level.shadeCockpit(root);"))
        self.assertEqual(page.count("prepareCockpit,"), 2)
        self.assertIn("wearPagePaint(library.root), wearPagePaint(library.level?.root)", page)
        self.assertIn(".then(() => effectsLoad).then(paintEffectLibrary);", page)

    def test_a_level_switch_repaints_what_the_page_kept(self) -> None:
        load = (VIEWER / "level-load.js").read_text()
        at = load.index("level.currentDir = dir;")
        repaint = load.index("repaintPage([...page.scene.children.filter(child => "
                             "child !== level.currentRoot),\n      page.vmScene]);")
        self.assertLess(at, repaint)
        self.assertLess(load.index("page.scene.add(level.currentRoot);"), repaint)


class AuditTests(SoldierTree):
    """`audit_mod.level_paint_findings`: the install says what a level
    repaints, skins.json what the page is handed."""

    def findings(self) -> list:
        import audit_mod
        import extract_models
        tree = audit_mod.Tree("fhsw", self.models, self.tmp / "maps", self.tmp / "textures",
                              ["battle_of_foy", "omaha"])
        tree.maps.mkdir(exist_ok=True)
        (tree.maps / "maps.json").write_text(json.dumps([
            {"name": "Battle_Of_Foy", "glb": "battle_of_foy/scene.glb"},
            {"name": "Omaha", "glb": "omaha/scene.glb"},
            {"name": "Unbaked", "glb": "unbaked/scene.glb"}]))
        game = types.SimpleNamespace(ok=True, chain=[], game_dir=self.tmp, mod="FHSW")
        paths = {"Battle_Of_Foy": FOY_PATHS, "Omaha": []}
        with mock.patch.object(extract_models, "build_pools",
                               return_value=(None, self.textures, None, None)), \
                mock.patch.object(ev, "mount_chain_levels"), \
                mock.patch.object(ev, "level_alternative_paths",
                                  side_effect=lambda _g, _m, level, _c: paths[level]):
            return audit_mod.level_paint_findings(tree, game)

    def test_a_tree_with_its_skins_written_is_clean(self) -> None:
        self.skins()
        self.assertEqual(self.findings(), [])

    def test_a_body_texture_the_index_does_not_hand_over_is_named(self) -> None:
        # The index as the first-person fix left it: the arms rigs' images only.
        self.skins()
        index = json.loads((self.out / ev.SKIN_INDEX).read_text())
        row = index["levels"]["battle_of_foy"]["textures"]
        for image in ("texture/Amerov_Z.tga", "texture/ahelm_r.tga"):
            del row[image]
        (self.out / ev.SKIN_INDEX).write_text(json.dumps(index))
        found = sorted((f.cause, f.subject, f.level) for f in self.findings())
        self.assertEqual(found, [
            ("soldier-level-paint-missing", "texture/Amerov_Z.tga", "battle_of_foy"),
            ("soldier-level-paint-missing", "texture/ahelm_r.tga", "battle_of_foy"),
        ])

    def test_a_rig_texture_keeps_its_own_finding_and_no_index_is_every_one(self) -> None:
        self.skins()
        (self.out / ev.SKIN_INDEX).unlink()
        causes = sorted(f.cause for f in self.findings())
        self.assertEqual(causes.count("viewmodel-level-paint-missing"), 2)   # hand, sleeve
        self.assertEqual(causes.count("soldier-level-paint-missing"), 2)     # uniform, helmet

    def test_a_tree_of_poses_alone_is_still_held_to_its_levels(self) -> None:
        shutil.rmtree(self.out)
        causes = {f.cause for f in self.findings()}
        self.assertEqual(causes, {"soldier-level-paint-missing"})


class ViewerSkinTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True,
                              timeout=120)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stderr}")
        cls.results = json.loads(proc.stdout)

    def test_a_rig_takes_the_levels_file_for_each_image_it_names(self) -> None:
        pure = self.results["pure"]
        self.assertEqual(pure["keys"], ["texture/ame1_sleeve_t.dds", "texture/ste_hand2.dds"])
        self.assertEqual(pure["changed"], 2)
        self.assertEqual(pure["maps"], [
            "texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds",
            "texture/ENVIROMENT_WINTER/Ste_hand2.dds",   # however the rig spelled it
            "texture/M1Garand.dds",
            "texture/landmine_T.dds",                    # its file never loaded
            None,
        ])
        self.assertEqual(pure["again"], 0)

    def test_a_level_without_a_skin_leaves_the_rig_alone(self) -> None:
        self.assertEqual(self.results["noSkin"]["changed"], 0)
        self.assertEqual(self.results["noSkin"]["maps"][0], "texture/Ame1_sleeve_T.dds")
        page = self.results["page"]
        self.assertEqual((page["other"], page["none"]), (0, 0))

    def test_the_page_fetches_one_index_and_one_skin_a_level(self) -> None:
        page = self.results["page"]
        self.assertEqual((page["first"], page["second"]), (2, 2))
        self.assertEqual(page["asked"], [
            "models/mods/fhsw/viewmodels/skins.json?v=1",
            "models/mods/fhsw/viewmodels/skins/battle_of_foy.skin.glb?v=1",
        ])
        self.assertEqual(page["warned"], 0)

    def test_a_missing_index_or_a_broken_skin_never_stops_a_rig(self) -> None:
        self.assertEqual(self.results["noIndex"]["first"], 0)
        self.assertEqual(self.results["noIndex"]["warned"], 0)
        broken = self.results["brokenGlb"]
        self.assertEqual((broken["first"], broken["second"]), (0, 0))
        self.assertEqual(broken["warned"], 1)

    def test_the_rig_is_painted_before_it_is_mounted(self) -> None:
        body = function_body("fetchRig")
        self.assertIn("await levelSkin.wear(gltf.scene, page.currentDir)", body)
        self.assertLess(body.index("levelSkin.wear"), body.rindex("return { gltf, fp, rigFile }"))

    def test_one_file_for_two_images_paints_each_and_gives_each_its_own_back(self) -> None:
        shared = self.results["sharedFile"]
        self.assertEqual(shared["keys"], ["texture/hand01_r.dds", "texture/hand03_r.dds"])
        self.assertEqual(shared["copies"], 1)
        self.assertEqual((shared["changed"], shared["back"]), (2, 2))
        self.assertEqual(shared["maps"], ["texture/Hand01_r.dds", "texture/Hand03_r.dds"])

    def test_a_kept_body_is_repainted_when_the_level_changes(self) -> None:
        relevel = self.results["relevel"]
        # Foy to the Bulge: the sleeve takes the Bulge's, the glove comes off.
        self.assertEqual(relevel["bulgeMaps"][:2], [
            "texture/Levels/bulge/Ame1_sleeve_T.dds", "Texture\\STE_HAND2.dds"])
        self.assertEqual(relevel["onBulge"], 2)
        # To a level that repaints nothing: the mod's own paint.
        self.assertEqual(relevel["omahaMaps"][:2], [
            "texture/Ame1_sleeve_T.dds", "Texture\\STE_HAND2.dds"])
        # And back.
        self.assertEqual(relevel["foyMaps"][:2], [
            "texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds",
            "texture/ENVIROMENT_WINTER/Ste_hand2.dds"])

    def test_the_pages_paint_is_whatever_was_shared_and_never_throws(self) -> None:
        paint = self.results["pagePaint"]
        self.assertEqual((paint["none"], paint["shared"], paint["nothing"]), (0, 2, 0))
        self.assertEqual((paint["thrown"], paint["warned"]), (0, 1))
        self.assertEqual(paint["maps"][0], "texture/GENERAL_US_WINTER/Ame1_sleeve_T.dds")

    def test_the_last_level_asked_for_wins_whatever_lands_first(self) -> None:
        last = self.results["lastWins"]
        self.assertEqual((last["foy"], last["omaha"]), (0, 0))
        self.assertEqual(last["maps"][:2], ["texture/Ame1_sleeve_T.dds", "Texture\\STE_HAND2.dds"])

    def test_a_level_switch_repaints_everything_handed_to_it(self) -> None:
        repaint = self.results["repaint"]
        self.assertEqual((repaint["before"], repaint["after"], repaint["none"]), (4, 4, 0))
        self.assertEqual(repaint["maps"][:2], ["texture/Ame1_sleeve_T.dds", "Texture\\STE_HAND2.dds"])

    def test_two_askers_on_one_tree_share_its_index_and_textures(self) -> None:
        tree = self.results["sharedTree"]
        self.assertEqual(len(tree["asked"]), 2)
        self.assertTrue(tree["sameTexture"])

    def test_the_arms_rig_shares_the_levels_paint_with_the_page(self) -> None:
        source = (VIEWER / "arms-rig.js").read_text()
        self.assertIn("sharePagePaint(scene => levelSkin.wear(scene, page.currentDir))", source)

    def test_a_body_is_painted_before_it_is_shaded_and_again_when_handed_out(self) -> None:
        source = (VIEWER / "pose-compose.js").read_text()
        for name in ("monolithic", "compose"):
            body = source[source.index(f"async function {name}("):]
            body = body[:body.index("\n  }\n")]
            self.assertLess(body.index("await wearPagePaint("), body.index("ctx.shade?.("), name)
        self.assertIn("}).then(painted);", source)
        self.assertIn("() => load(soldier, pose)).then(painted);", source)

    def test_the_kit_loaders_wear_the_pages_paint_before_the_shading(self) -> None:
        for file, shade in (("soldier-dress.js", "ctx.shade(node)"),
                            ("kit-drops-page.js", "page.bindDynamicShading?.(scene)"),
                            ("netcode-render.js", "ctx.shadeModel?.(gltf.scene)"),
                            ("replay-assets.js", "this.ctx.shadeModel?.(gltf.scene)")):
            source = (VIEWER / file).read_text()
            self.assertIn("await wearPagePaint(", source, file)
            self.assertLess(source.index("await wearPagePaint("), source.index(shade), file)
        self.assertIn("await wearPagePaint(gltf.scene)", (VIEWER / "foot-body.js").read_text())
        self.assertIn("await wearPagePaint(gltf.scene);\n    level.bindDynamicShading(gltf.scene);",
                      (VIEWER / "map.html").read_text())


if __name__ == "__main__":
    unittest.main()
