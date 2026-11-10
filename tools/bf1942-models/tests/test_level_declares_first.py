"""A level's own declarations against the mod's, and the sky box by name.

Four BF1918 findings, one rule apart:

* LOAD-1/LOAD-2: a level's `Init.con` declares its templates before the
  mod's `objects/`, and a second `create` of a name makes nothing. BF1918's
  `objects/Ambiente/water1.con` and Battle of Leget's own `Sounds/water1.con`
  both declare `water1`; the level's wins, and one placement is one emitter
  (it was two, the mod's at a 25..550 m ramp).
* The same rule on a LensFlare: Montblainville's `include Lenz.con`
  re-creates `TSun` after `SkyAndSun.con` has, so Lenz.con's lines configure
  nothing. `include` itself runs its file inline (`read_init_script`).
* LOAD-33: `Sky.initSky` instances the geometry template named `SkyBox`
  (BF1942.exe 0x005be800), not the last file loaded before it: Ramskapelle
  creates its `Cloud` between the two.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.con import ObjectLibrary  # noqa: E402
from bf42.level import (  # noqa: E402
    LevelInfo,
    StaticInstance,
    discover_level_sounds,
    parse_init_con,
    parse_terrain_con,
    read_init_script,
)

LEVEL_SSC = b"""
newPatch
load water_loop.wav
loop
beginEffect
controlSource Distance
controlDestination Volume
envelope Ramp
param 10
param 40
param 1
param -1
endEffect
"""
MOD_SSC = LEVEL_SSC.replace(b"param 10\nparam 40", b"param 25\nparam 550").replace(
    b"water_loop", b"mod_water_loop")


class Files:
    """A level archive: path -> bytes, case-blind."""

    def __init__(self, files: dict[str, bytes]):
        self.files = {k.lower(): (k, v) for k, v in files.items()}

    def names(self):
        return [k for k, _ in self.files.values()]

    def find(self, path):
        hit = self.files.get(path.replace("\\", "/").lower())
        return hit[0] if hit else None

    def read(self, path):
        return self.files[path.replace("\\", "/").lower()][1]


class Pool:
    """The mod's objects archive."""

    def __init__(self, files: dict[str, bytes]):
        self.files = {k.lower(): v for k, v in files.items()}

    def find(self, path):
        return path if path.lower() in self.files else None

    def read(self, path):
        return self.files[path.lower()]


MOD_WATER_CON = (b"ObjectTemplate.create SimpleObject water1\n"
                 b"ObjectTemplate.loadSoundScript water1.ssc\n")


def mod_library() -> ObjectLibrary:
    library = ObjectLibrary()
    library.add_con("objects/Ambiente/water1.con", MOD_WATER_CON.decode())
    library.add_con("objects/Buildings/kirche.con", """
ObjectTemplate.create Bundle kirche
ObjectTemplate.addTemplate water1
ObjectTemplate.setPosition 0/12/0
""")
    return library


def mod_pool() -> Pool:
    return Pool({"objects/Ambiente/water1.con": MOD_WATER_CON,
                 "objects/Ambiente/water1.ssc": MOD_SSC,
                 "objects/Buildings/kirche.con": b""})


def leget(with_level_water: bool = True) -> Files:
    files = {"Sounds/Environment.con": b"EnvironmentSound.load Environment.ssc\nrun water1.con\n"}
    if with_level_water:
        files["Sounds/water1.con"] = (b"ObjectTemplate.create SimpleObject water1\n"
                                      b"ObjectTemplate.saveInSeparateFile 1\n"
                                      b"ObjectTemplate.loadSoundScript water1.ssc\n")
        files["Sounds/water1.ssc"] = LEVEL_SSC
    return Files(files)


class LevelSoundTemplateWinsTests(unittest.TestCase):
    def test_a_placement_the_level_declares_is_one_emitter(self):
        statics = [StaticInstance("water1", (100.0, 70.0, 200.0), (0.0, 0.0, 0.0)),
                   StaticInstance("water1", (300.0, 70.0, 400.0), (0.0, 0.0, 0.0))]
        areas = discover_level_sounds(leget(), statics, mod_library(), mod_pool()).areas
        self.assertEqual(["water1", "water1"], [a.name for a in areas])
        self.assertEqual([10.0, 40.0], [areas[0].distance_volume[0], areas[0].distance_volume[1]])

    def test_without_the_level_copy_the_mod_template_sounds(self):
        statics = [StaticInstance("water1", (100.0, 70.0, 200.0), (0.0, 0.0, 0.0))]
        areas = discover_level_sounds(leget(False), statics, mod_library(), mod_pool()).areas
        self.assertEqual(["water1_static"], [a.name for a in areas])
        self.assertEqual(25.0, areas[0].distance_volume[0])

    def test_a_level_declared_child_is_the_levels(self):
        # The mod's church carries `water1` by name; the level's copy is the
        # one the church gets, 12 m up, and the mod's script is not walked.
        statics = [StaticInstance("kirche", (10.0, 5.0, 20.0), (0.0, 0.0, 0.0))]
        areas = discover_level_sounds(leget(), statics, mod_library(), mod_pool()).areas
        self.assertEqual(["water1"], [a.name for a in areas])
        self.assertEqual([[10.0, 17.0, -20.0]], areas[0].points)


def init_info() -> LevelInfo:
    return LevelInfo(name="L", terrain=parse_terrain_con(""))


class SkyBoxByNameTests(unittest.TestCase):
    def test_the_sky_is_the_template_named_skybox(self):
        info = init_info()
        parse_init_con("""
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_Elala_m1
GeometryTemplate.create StandardMesh Cloud
GeometryTemplate.file ../bf1942/levels/aberdeen/standardMesh/cloud
Sky.initSky
Sky.addCloud
""", info)
        self.assertEqual("Sky_Elala_m1", info.sky.mesh)
        self.assertEqual("cloud", info.sky.cloud_mesh)

    def test_the_vanilla_order_is_unchanged(self):
        info = init_info()
        parse_init_con("""
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_Bocage_m1
Sky.initSky
GeometryTemplate.create StandardMesh Cloud
GeometryTemplate.file ../bf1942/levels/montblainville/standardMesh/cloud
""", info)
        self.assertEqual("Sky_Bocage_m1", info.sky.mesh)
        self.assertEqual("cloud", info.sky.cloud_mesh)

    def test_no_skybox_template_no_sky_mesh(self):
        info = init_info()
        parse_init_con("""
GeometryTemplate.create StandardMesh Cloud
GeometryTemplate.file cloud
Sky.initSky
""", info)
        self.assertEqual("", info.sky.mesh)

    def test_a_second_create_of_skybox_configures_nothing(self):
        info = init_info()
        parse_init_con("""
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_First_m1
GeometryTemplate.create StandardMesh SkyBox
GeometryTemplate.file Sky_Second_m1
Sky.initSky
""", info)
        self.assertEqual("Sky_First_m1", info.sky.mesh)


MONTBLAINVILLE_SKY = b"""ObjectTemplate.create LensFlare TSun
ObjectTemplate.setLensFlareCount 5
ObjectTemplate.setCoronaCount 2
ObjectTemplate.initLensFlares
Object.create TSun
Object.name sun
include Lenz.con
Sky.setSun sun
"""
LENZ = b"""rem *** "TSun" of primitive LensFlare ***
ObjectTemplate.create LensFlare TSun
ObjectTemplate.setLensFlareCount 11
ObjectTemplate.setCoronaCount 4
ObjectTemplate.setFlareTexture P_Ring2.tga 0
ObjectTemplate.setFlareSize 0.79 0
"""


class LensFlareFirstCreateTests(unittest.TestCase):
    def test_include_runs_its_file_inline(self):
        files = Files({"Init/SkyAndSun.con": MONTBLAINVILLE_SKY, "Init/Lenz.con": LENZ})
        text = read_init_script(files, "Init/SkyAndSun.con")
        self.assertLess(text.index("Object.create TSun"), text.index("setLensFlareCount 11"))
        self.assertLess(text.index("setLensFlareCount 11"), text.index("Sky.setSun"))
        self.assertNotIn("include", text.lower())

    def test_a_missing_include_runs_nothing(self):
        files = Files({"Init/SkyAndSun.con": MONTBLAINVILLE_SKY})
        text = read_init_script(files, "Init/SkyAndSun.con")
        self.assertNotIn("Lenz", text)
        self.assertIn("Sky.setSun sun", text)

    def test_the_second_create_of_a_flare_configures_nothing(self):
        files = Files({"Init/SkyAndSun.con": MONTBLAINVILLE_SKY, "Init/Lenz.con": LENZ})
        info = init_info()
        parse_init_con(read_init_script(files, "Init/SkyAndSun.con"), info)
        flare = info.lens_flares["TSun"]
        self.assertEqual((5, 2), (flare.flare_count, flare.corona_count))
        self.assertEqual([], [f for f in flare.flares if f.texture])
        self.assertEqual({"sun": "TSun"}, info.flare_objects)


if __name__ == "__main__":
    unittest.main()
