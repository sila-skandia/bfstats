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
    parse_sound_scripts,
    parse_ssc,
    resolve_ssc_path,
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


# The Corsair's engine script as it ships, reduced to the three-band RPM core
# plus one distance-timbre layer, so the layering, the include chain and the
# modulators can be asserted without shipping 9 KB of fixture.
ENGINE_DISPATCHER = """
#templateLevel HIGH
	#include EngineHigh.ssc
#templateLevel MEDIUM
	#include EngineMedium.ssc
#templateLevel LOW
	#include EngineLow.ssc
"""

ENGINE_HIGH = """
#include ../../../Common/Sounds/EngineMap.ssc

newPatch

#include ../../Common/Sounds/Dive.ssc

############
### Main ###
############
load @ROOT/Sound/@RTD/mstngnrun.wav
loop
minDistance 20
randomStartPitch .05/.05
priority 9
*** Engine Pitch ***
beginEffect
	controlDestination Pitch
	controlSource Extern #map<Engine::Rpm>
	envelope Ramp
	param 0
	param .6
	param 0.70
	param 0.30
endEffect
*** Engine Volume Start ***
beginEffect
	controlDestination Volume
	controlSource Extern #map<Engine::Rpm>
	envelope Ramp
	param 0
	param 0.6
	param 1
	param -1
endEffect

#################
### cockpit L ###
#################
load @ROOT/Sound/@RTD/b17hirpm.wav
loop
volume 0.8
relativePosition .9/.3/-4.2
stereo
dopplerOff
priority 6

###################
### Engine Stop ###
###################
load @ROOT/Sound/@RTD/willyenginestp.wav
minDistance 2
trigger Release
stop FinishSample
"""

ENGINE_LOW = """
newPatch
load @ROOT/Sound/@RTD/mstngnrun.wav
loop
volume .6
"""

ENGINE_MAP = """
#beginMap Engine
	Rpm
	DiveAngle
#endMap
"""

DIVE = """
#include ../../../Common/Sounds/EngineMap.ssc

load @ROOT/Sound/@RTD/airplanedive.wav
loop
minDistance 10
beginEffect
	controlDestination Pitch
	controlSource Extern #map<Engine::DiveAngle>
	envelope Ramp
	param 0.2
	param 1
	param 0.95
	param 0.05
	param 2
	param 2
endEffect
"""

ENGINE_TREE = {
    "Objects/Vehicles/Air/Corsair/Sounds/CorsairEngine.ssc": ENGINE_DISPATCHER,
    "Objects/Vehicles/Air/Corsair/Sounds/EngineHigh.ssc": ENGINE_HIGH,
    "Objects/Vehicles/Air/Corsair/Sounds/EngineLow.ssc": ENGINE_LOW,
    "Objects/Vehicles/Common/Sounds/EngineMap.ssc": ENGINE_MAP,
    "Objects/Vehicles/Air/Common/Sounds/Dive.ssc": DIVE,
}

CORSAIR_ENGINE_SCRIPT = "Objects/Vehicles/Air/Corsair/Sounds/CorsairEngine.ssc"


def engine_tree_reader(path: str) -> str | None:
    return ENGINE_TREE.get(path)


class VehicleSoundScriptTests(unittest.TestCase):
    """The `.ssc` features a vehicle needs and map ambience never did."""

    def parse(self, level: str = "high"):
        return parse_ssc(ENGINE_TREE[CORSAIR_ENGINE_SCRIPT], level=level,
                         include=engine_tree_reader, source=CORSAIR_ENGINE_SCRIPT)

    def test_resolve_include_climbs_out_of_the_including_folder(self) -> None:
        self.assertEqual(
            "Objects/Vehicles/Common/Sounds/EngineMap.ssc",
            resolve_ssc_path(
                "Objects/Vehicles/Air/Corsair/Sounds/EngineHigh.ssc",
                "../../../Common/Sounds/EngineMap.ssc"),
        )
        self.assertEqual(
            "Objects/Vehicles/Air/Corsair/Sounds/EngineHigh.ssc",
            resolve_ssc_path(CORSAIR_ENGINE_SCRIPT, "EngineHigh.ssc"),
        )
        # Backslashes are the authoring convention and `.` segments occur.
        self.assertEqual(
            "Objects/Sounds/x.ssc",
            resolve_ssc_path("Objects/Sounds/y.ssc", ".\\x.ssc"),
        )

    def test_every_load_in_a_patch_is_a_layer(self) -> None:
        # The old parser kept one file per patch, so a second `load` overwrote
        # the first and every engine layer past the idle loop was lost.
        patches = self.parse()
        self.assertEqual(1, len(patches))
        self.assertEqual(
            ["airplanedive.wav", "mstngnrun.wav", "b17hirpm.wav",
             "willyenginestp.wav"],
            [s.file.rsplit("/", 1)[-1] for s in patches[0].samples],
        )

    def test_include_is_textual_and_joins_the_open_patch(self) -> None:
        # `#include Dive.ssc` sits between `newPatch` and the next `load`, so
        # the dive scream is a layer of the engine patch, not a patch of its
        # own — and the doubly-included EngineMap must not open one either.
        patches = self.parse()
        self.assertEqual(1, len(patches))
        dive = patches[0].samples[0]
        self.assertEqual("@ROOT/Sound/@RTD/airplanedive.wav", dive.file)
        self.assertEqual(10.0, dive.min_distance)

    def test_template_level_selects_a_quality_tier_not_an_rpm_band(self) -> None:
        # The trap this feature had to survive: CorsairEngine.ssc is only a
        # dispatcher, and HIGH/MEDIUM/LOW are the Options -> Sound detail
        # setting. The RPM layering lives *inside* each tier.
        self.assertEqual(4, len(self.parse("high")[0].samples))
        low = self.parse("low")
        self.assertEqual(1, len(low))
        self.assertEqual(["mstngnrun.wav"],
                         [s.file.rsplit("/", 1)[-1] for s in low[0].samples])
        # MEDIUM's include is absent from the fixture: a missing file is
        # skipped rather than fatal, which is what a mod's partial tree does.
        self.assertEqual([], self.parse("medium"))

    def test_unfiltered_parse_tags_patches_with_their_tier(self) -> None:
        patches = parse_ssc(ENGINE_TREE[CORSAIR_ENGINE_SCRIPT],
                            include=engine_tree_reader,
                            source=CORSAIR_ENGINE_SCRIPT)
        self.assertEqual(["high", "low"], [p.level for p in patches])

    def test_effects_carry_destination_source_envelope_and_params(self) -> None:
        core = self.parse()[0].samples[1]
        self.assertEqual("@ROOT/Sound/@RTD/mstngnrun.wav", core.file)
        self.assertEqual(2, len(core.effects))
        pitch, volume = core.effects
        self.assertEqual("pitch", pitch.destination)
        self.assertEqual("extern", pitch.source)
        self.assertEqual("Engine::Rpm", pitch.extern)
        self.assertEqual("ramp", pitch.envelope)
        # 0.70 -> 1.00 across Rpm 0 -> 0.6: p3 is the floor, p4 the signed delta.
        self.assertEqual([0.0, 0.6, 0.70, 0.30], pitch.params)
        self.assertEqual("volume", volume.destination)
        self.assertEqual([0.0, 0.6, 1.0, -1.0], volume.params)

    def test_six_param_ramp_keeps_the_surplus_pair(self) -> None:
        dive = self.parse()[0].samples[0]
        self.assertEqual([0.2, 1.0, 0.95, 0.05, 2.0, 2.0], dive.effects[0].params)
        self.assertEqual("Engine::DiveAngle", dive.effects[0].extern)

    def test_sample_directives(self) -> None:
        samples = self.parse()[0].samples
        core, cockpit, stop = samples[1], samples[2], samples[3]
        self.assertTrue(core.loop)
        self.assertEqual(20.0, core.min_distance)
        self.assertEqual(9, core.priority)
        self.assertEqual((0.05, 0.05), core.random_start_pitch)
        self.assertFalse(core.doppler_off)
        self.assertAlmostEqual(0.8, cockpit.volume)
        self.assertEqual((0.9, 0.3, -4.2), cockpit.relative_position)
        self.assertTrue(cockpit.stereo)
        self.assertTrue(cockpit.doppler_off)
        self.assertEqual("release", stop.trigger)
        self.assertEqual("finishsample", stop.stop)
        self.assertFalse(stop.loop)

    def test_legacy_single_voice_view_mirrors_the_first_layer(self) -> None:
        # Map ambience reads these scalars; they must keep describing the
        # patch's first sample, distance ramp included.
        script = """
newPatch
load @ROOT/Sound/@RTD/wind.wav
loop
volume .6
minDistance 10
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 40
	param 80
	param 1
	param -1
endEffect
load @ROOT/Sound/@RTD/gust.wav
volume .2
"""
        patch = parse_ssc(script)[0]
        self.assertEqual("@ROOT/Sound/@RTD/wind.wav", patch.file)
        self.assertTrue(patch.loop)
        self.assertAlmostEqual(0.6, patch.volume)
        self.assertEqual(10.0, patch.min_distance)
        self.assertEqual(40.0, patch.near_distance)
        self.assertEqual(80.0, patch.far_distance)
        self.assertEqual(1.0, patch.ramp_start_val)
        self.assertEqual(-1.0, patch.ramp_delta_val)
        self.assertEqual(2, len(patch.samples))

    def test_tolerates_the_typos_that_ship_in_vanilla(self) -> None:
        # `endeffec`, `pram`, `volume.2` and the `####` banners are all real
        # and the engine ignores them rather than choking; a mistyped endEffect
        # must not swallow the rest of the patch.
        script = """
############
newPatch
load @ROOT/Sound/@RTD/a.wav
volume.2
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	pram 5
	pram 10
endeffec
load @ROOT/Sound/@RTD/b.wav
randomPlay 1
"""
        patch = parse_ssc(script)[0]
        self.assertAlmostEqual(0.2, patch.samples[0].volume)
        self.assertEqual([5.0, 10.0], patch.samples[0].effects[0].params)
        self.assertEqual(2, len(patch.samples))
        self.assertTrue(patch.random_play)

    def test_begin_skip_comments_out_the_rest_of_the_file(self) -> None:
        script = """
newPatch
load @ROOT/Sound/@RTD/left.wav
beginSkip
load @ROOT/Sound/@RTD/right.wav
"""
        self.assertEqual(["@ROOT/Sound/@RTD/left.wav"],
                         [s.file for s in parse_ssc(script)[0].samples])


class SoundScriptBindingTests(unittest.TestCase):
    def test_parse_sound_scripts_binds_per_template(self) -> None:
        # One Physics.con binds four scripts to four different children, so the
        # engine's script can only be found by matching the engine's own name.
        con = """
ObjectTemplate.create Engine CorsairEngine
ObjectTemplate.setMaxRotation 0.3/0/5000
ObjectTemplate.loadSoundScript Sounds/CorsairEngine.ssc

ObjectTemplate.create Wing CorsairFlapLeftOuter
ObjectTemplate.loadSoundScript ../Common/Sounds/HullLeft.ssc

rem ObjectTemplate.create Wing CorsairIgnored
ObjectTemplate.create Wing CorsairFlapRightOuter
ObjectTemplate.loadSoundScript ..\\Common\\Sounds\\HullRight.ssc
"""
        scripts = parse_sound_scripts(con)
        self.assertEqual(("engine", "Sounds/CorsairEngine.ssc"),
                         scripts["corsairengine"])
        self.assertEqual(("wing", "../Common/Sounds/HullLeft.ssc"),
                         scripts["corsairflapleftouter"])
        self.assertEqual(("wing", "../Common/Sounds/HullRight.ssc"),
                         scripts["corsairflaprightouter"])
        self.assertNotIn("corsairignored", scripts)


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
