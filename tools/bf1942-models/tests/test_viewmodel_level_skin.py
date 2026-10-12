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
"""

from __future__ import annotations

import json
import shutil
import struct
import subprocess
import sys
import tempfile
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


if __name__ == "__main__":
    unittest.main()
