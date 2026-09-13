from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.level import (  # noqa: E402
    LevelFiles,
    PlacedAreaSound,
    StaticInstance,
    discover_level_sounds,
    parse_area_con,
    parse_ssc,
)


class SoundScriptTests(unittest.TestCase):
    def test_parse_ssc_ambient_patch(self) -> None:
        script = """
#templateLevel HIGH

newPatch
############
### Near ###
############
load @ROOT/Sound/@RTD/windcalm.wav
loop
minDistance 10
randomStartPitch 0.25 / 0.0
volume .6
priority -10

#templateLevel MEDIUM

newPatch
load @ROOT/Sound/@RTD/windcalm.wav
loop
minDistance 10
volume .6
"""
        patches = parse_ssc(script)
        self.assertEqual(2, len(patches))
        self.assertEqual("high", patches[0].level)
        self.assertEqual("@ROOT/Sound/@RTD/windcalm.wav", patches[0].file)
        self.assertTrue(patches[0].loop)
        self.assertAlmostEqual(0.6, patches[0].volume)
        self.assertEqual(10.0, patches[0].min_distance)

    def test_parse_ssc_distance_ramp(self) -> None:
        script = """
#templateLevel HIGH

newPatch
load @ROOT/Sound/@RTD/Water_waves.wav
loop
minDistance 1
volume .6
*** Distance Volume ***
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 40
	param 80
	param 1
	param -1	
endEffect
"""
        patches = parse_ssc(script)
        self.assertEqual(1, len(patches))
        self.assertEqual(40.0, patches[0].near_distance)
        self.assertEqual(80.0, patches[0].far_distance)


class AreaObjectTests(unittest.TestCase):
    def test_parse_area_con_with_polyline(self) -> None:
        con = """
rem *** island1 ***
ObjectTemplate.create AreaObject island1
ObjectTemplate.saveInSeparateFile 1
ObjectTemplate.loadSoundScript Coastline.ssc
ObjectTemplate.triggerRadius 40
ObjectTemplate.addLinePoint 208.825/-149.005
ObjectTemplate.addLinePoint 199.537/-141.444
"""
        tmpl = parse_area_con(con)
        self.assertIsNotNone(tmpl)
        self.assertEqual("island1", tmpl.name)
        self.assertEqual("areaobject", tmpl.kind)
        self.assertEqual("Coastline.ssc", tmpl.ssc_file)
        self.assertEqual(40.0, tmpl.trigger_radius)
        self.assertEqual(2, len(tmpl.line_points))
        self.assertAlmostEqual(208.825, tmpl.line_points[0][0])
        self.assertAlmostEqual(-149.005, tmpl.line_points[0][1])

    def test_parse_simple_object_point_emitter(self) -> None:
        con = """
rem *** Siren ***
ObjectTemplate.create SimpleObject Siren
ObjectTemplate.saveInSeparateFile 1
ObjectTemplate.triggerRadius 200
ObjectTemplate.loadSoundScript Siren.ssc
"""
        tmpl = parse_area_con(con)
        self.assertIsNotNone(tmpl)
        self.assertEqual("Siren", tmpl.name)
        self.assertEqual("simpleobject", tmpl.kind)
        self.assertEqual("Siren.ssc", tmpl.ssc_file)
        self.assertEqual(200.0, tmpl.trigger_radius)
        self.assertEqual(0, len(tmpl.line_points))


class MockLevelFiles:
    def __init__(self, entries: dict[str, str]) -> None:
        self._entries = {k.lower(): v.encode("latin-1") for k, v in entries.items()}

    def find(self, rel: str) -> str | None:
        k = rel.replace("\\", "/").lower()
        return rel if k in self._entries else None

    def read(self, rel: str) -> bytes:
        k = rel.replace("\\", "/").lower()
        if k not in self._entries:
            raise KeyError(rel)
        return self._entries[k]

    def names(self) -> list[str]:
        return list(self._entries.keys())


class SoundDiscoveryTests(unittest.TestCase):
    def test_discover_level_sounds_mapping(self) -> None:
        mock_files = MockLevelFiles({
            "Sounds/Environment.con": "EnvironmentSound.load Environment.ssc\nrun island1.con\n",
            "Sounds/Environment.ssc": """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/windcalm.wav
loop
volume 0.6
""",
            "Sounds/island1.con": """
ObjectTemplate.create AreaObject island1
ObjectTemplate.loadSoundScript Coastline.ssc
ObjectTemplate.triggerRadius 40
ObjectTemplate.addLinePoint 10.0/-20.0
ObjectTemplate.addLinePoint 30.0/-40.0
""",
            "Sounds/Coastline.ssc": """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/Water_waves.wav
loop
volume 0.5
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 40
	param 80
	param 1
	param -1
endEffect
""",
        })

        statics = [
            StaticInstance(
                template="island1",
                position=(100.0, 95.0, 200.0),
                rotation=(0.0, 0.0, 0.0),
            )
        ]

        sounds = discover_level_sounds(mock_files, statics)
        self.assertIsNotNone(sounds.ambient)
        self.assertEqual("@ROOT/Sound/@RTD/windcalm.wav", sounds.ambient.file)
        self.assertAlmostEqual(0.6, sounds.ambient.volume)

        self.assertEqual(1, len(sounds.areas))
        area = sounds.areas[0]
        self.assertEqual("island1", area.name)
        self.assertEqual("@ROOT/Sound/@RTD/Water_waves.wav", area.file)
        self.assertAlmostEqual(0.5, area.volume)
        self.assertEqual(40.0, area.near_distance)
        self.assertEqual(80.0, area.far_distance)

        # Refractor (100 + 10, 95, 200 - 20) = (110, 95, 180) -> glTF [110, 95, -180]
        self.assertEqual(2, len(area.points))
        self.assertEqual([110.0, 95.0, -180.0], area.points[0])
        # Refractor (100 + 30, 95, 200 - 40) = (130, 95, 160) -> glTF [130, 95, -160]
        self.assertEqual([130.0, 95.0, -160.0], area.points[1])

    def test_discover_level_sounds_singular_sound_folder(self) -> None:
        # Kasserine_Pass ships Sound/ (singular) instead of Sounds/, with a
        # custom Sound\ambfx.wav inside the level rfa. Discovery must fall
        # back to Sound/ for the environment con, the ssc lookups, and the
        # area-con scan.
        mock_files = MockLevelFiles({
            "Sound/Environment.con": "EnvironmentSound.load Environment.ssc\n",
            "Sound/Environment.ssc": """
#templateLevel HIGH
newPatch
load Sound\\ambfx.wav
loop
volume 0.7
""",
            "Sound/coast.con": """
ObjectTemplate.create AreaObject coast
ObjectTemplate.loadSoundScript Coastline.ssc
ObjectTemplate.triggerRadius 40
ObjectTemplate.addLinePoint 10.0/-20.0
""",
            "Sound/Coastline.ssc": """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/Water_waves.wav
loop
volume 0.5
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 40
	param 80
	param 1
	param -1
endEffect
""",
        })

        statics = [
            StaticInstance(
                template="coast",
                position=(100.0, 95.0, 200.0),
                rotation=(0.0, 0.0, 0.0),
            )
        ]

        sounds = discover_level_sounds(mock_files, statics)
        self.assertIsNotNone(sounds.ambient)
        self.assertEqual("Sound/ambfx.wav", sounds.ambient.file)
        self.assertAlmostEqual(0.7, sounds.ambient.volume)

        self.assertEqual(1, len(sounds.areas))
        area = sounds.areas[0]
        self.assertEqual("coast", area.name)
        self.assertEqual("@ROOT/Sound/@RTD/Water_waves.wav", area.file)
        self.assertEqual(40.0, area.near_distance)
        self.assertEqual(80.0, area.far_distance)
        self.assertEqual([110.0, 95.0, -180.0], area.points[0])


if __name__ == "__main__":
    unittest.main()
