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
from extract_map import _firing_patch  # noqa: E402


class WeaponPatchTests(unittest.TestCase):
    """Which patch of a weapon script a held trigger actually plays."""

    # Aircraft MG shape: middle slots silent, Fire Loop is the first sound.
    MG_SCRIPT = """
#templateLevel HIGH
newPatch
### Fire ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
### Reload ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
### Fire Loop ###
load @ROOT/Sound/@RTD/CAMG1.wav
minDistance 2
loop
volume .7
"""

    # Stationary MG42 / Browning: Release and MG-distance one-shots sit
    # *before* Fire Loop. First-non-silence used to ship the distant report.
    STATIONARY_MG_SCRIPT = """
#templateLevel HIGH
newPatch
### Fire ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
### Reload ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
### Release ###
load @ROOT/Sound/@RTD/rifle-distance1.wav
volume 1

newPatch
### Shell Bounce ###
load @ROOT/Sound/@RTD/patronrelease.wav
volume 0.6

newPatch
### MG distance ###
load @ROOT/Sound/@RTD/mgdist1.wav
volume 1

newPatch
### Fire Loop ###
load @ROOT/Sound/@RTD/MG42_fire.wav
loop
volume 1
load @ROOT/Sound/@RTD/patronrelease.wav
volume 0.6
load @ROOT/Sound/@RTD/mgdist1.wav
volume 1
"""

    def test_firing_patch_skips_the_silent_patches(self) -> None:
        patches = parse_ssc(self.MG_SCRIPT, level="high")
        samples = _firing_patch(patches)
        self.assertEqual(["@ROOT/Sound/@RTD/CAMG1.wav"],
                         [s.file for s in samples])
        self.assertTrue(samples[0].loop)
        self.assertAlmostEqual(0.7, samples[0].volume)

    def test_firing_patch_prefers_fire_loop_over_earlier_one_shots(self) -> None:
        samples = _firing_patch(parse_ssc(self.STATIONARY_MG_SCRIPT, level="high"))
        self.assertEqual(["@ROOT/Sound/@RTD/MG42_fire.wav"],
                         [s.file for s in samples])
        self.assertTrue(samples[0].loop)

    def test_a_weapon_whose_first_patch_fires_takes_the_first_patch(self) -> None:
        # A single-shot gun puts the report in the Fire patch; the same rule
        # reaches the other answer without a special case.
        script = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/ShermanFire.wav
volume 1

newPatch
load @ROOT/Sound/@RTD/silence.wav
volume 0
"""
        samples = _firing_patch(parse_ssc(script, level="high"))
        self.assertEqual(["@ROOT/Sound/@RTD/ShermanFire.wav"],
                         [s.file for s in samples])

    def test_an_entirely_silent_script_yields_nothing(self) -> None:
        script = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/silence.wav
volume 0
"""
        self.assertEqual([], _firing_patch(parse_ssc(script, level="high")))


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


class BlockCommentTests(unittest.TestCase):
    """`/* */` is `beginSkip` under another name.

    One flag in the engine (`BF1942.exe` 0x007f9a80), tested before any
    directive, so the rules are the engine's rather than C's: the unit is the
    line, the close test runs first and unconditionally, and an opener needs no
    terminator. 849 shipped scripts use the markers and 373 never close one.
    """

    def test_samples_inside_a_block_comment_are_not_patch_data(self) -> None:
        # `M1Garand/Sounds/High.ssc` as it ships: the muzzle layer, then five
        # samples commented out between the stereo report and the positional
        # layers that follow.
        script = """
newPatch
load @ROOT/Sound/@RTD/M1Garand_Fire_4.wav
volume 10
stereo
/*
load @ROOT/Sound/@RTD/snpreload.wav
minDistance 1
load @ROOT/Sound/@RTD/SoMewa1.wav
priority 0
*/
load @ROOT/Sound/@RTD/M1Garand_Far.wav
minDistance 200
"""
        samples = parse_ssc(script)[0].samples
        self.assertEqual(["M1Garand_Fire_4.wav", "M1Garand_Far.wav"],
                         [s.file.rsplit("/", 1)[-1] for s in samples])
        self.assertEqual(200.0, samples[1].min_distance)

    def test_a_commented_effect_does_not_modulate_its_sample(self) -> None:
        # `Elco80_Engine_Water.ssc`: the bubble layer's Engine Pitch effect is
        # commented out, so the loop must carry the distance ramp alone. Read
        # as live it picked up a throttle-tracking pitch it was never given.
        script = """
newPatch
load @ROOT/Sound/@RTD/PT_boat_bubbles.wav
loop
volume 0.4
/*
beginEffect
	controlDestination Pitch
	controlSource Default
	envelope Linear
	param 0.5
	param 0.45
endEffect
*/
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 10
	param 20
endEffect
"""
        sample = parse_ssc(script)[0].samples[0]
        self.assertEqual([("volume", "distance")],
                         [(e.destination, e.source) for e in sample.effects])

    def test_an_unclosed_block_comment_runs_to_the_end(self) -> None:
        # `LynxHorn.ssc`: a horn, then `/*` and a whole copy-pasted jeep engine
        # with no terminator anywhere. Honking must not start an engine.
        script = """
newPatch
load @ROOT/Sound/@RTD/BlackMedal_Horn.wav
minDistance 20
/*
load @ROOT/Sound/@RTD/Willyengine3.wav
loop
newPatch
load @ROOT/Sound/@RTD/willyenginestp.wav
"""
        patches = parse_ssc(script)
        self.assertEqual(1, len(patches))
        self.assertEqual(["@ROOT/Sound/@RTD/BlackMedal_Horn.wav"],
                         [s.file for s in patches[0].samples])

    def test_a_close_with_no_opener_is_eaten_and_nothing_else(self) -> None:
        # `KettenKradEngine.ssc` ships a bare `*/` mid-file — an edit left it
        # behind. The engine clears an already-clear flag and drops the line;
        # the layers on both sides are live.
        script = """
newPatch
load @ROOT/Sound/@RTD/start.wav
*/
load @ROOT/Sound/@RTD/main.wav
loop
"""
        self.assertEqual(["@ROOT/Sound/@RTD/start.wav",
                          "@ROOT/Sound/@RTD/main.wav"],
                         [s.file for s in parse_ssc(script)[0].samples])

    def test_the_marked_line_goes_whole_and_a_one_liner_opens_nothing(self) -> None:
        # The close test matching first means a self-contained `/* ... */`
        # never sets the flag — but the line it sits on is still dropped
        # entire, trailing marker or not.
        script = """
newPatch
load @ROOT/Sound/@RTD/kept.wav
load @ROOT/Sound/@RTD/lost.wav /* half a thought */
volume .5
"""
        samples = parse_ssc(script)[0].samples
        self.assertEqual(["@ROOT/Sound/@RTD/kept.wav"],
                         [s.file for s in samples])
        # `volume .5` is after the comment and still live: no skip was opened.
        self.assertAlmostEqual(0.5, samples[0].volume)

    def test_a_skip_swallows_include_and_template_level(self) -> None:
        # The filter runs before every directive, so neither the `#include`
        # nor the tier switch inside the block has any effect.
        tree = {
            "a.ssc": """
newPatch
load @ROOT/Sound/@RTD/real.wav
/*
#templateLevel LOW
#include b.ssc
*/
load @ROOT/Sound/@RTD/tail.wav
""",
            "b.ssc": "load @ROOT/Sound/@RTD/included.wav\n",
        }
        patches = parse_ssc(tree["a.ssc"], level="high",
                            include=tree.get, source="a.ssc")
        self.assertEqual(1, len(patches))
        self.assertEqual(["@ROOT/Sound/@RTD/real.wav",
                          "@ROOT/Sound/@RTD/tail.wav"],
                         [s.file for s in patches[0].samples])

    def test_an_unclosed_skip_inside_an_include_keeps_skipping_after_it(self) -> None:
        # The flag is one global reset only when the whole parse ends, not a
        # per-file state, so it survives the return from an include.
        tree = {
            "a.ssc": """
newPatch
load @ROOT/Sound/@RTD/real.wav
#include b.ssc
load @ROOT/Sound/@RTD/after.wav
""",
            "b.ssc": """
/*
load @ROOT/Sound/@RTD/dead.wav
""",
        }
        patches = parse_ssc(tree["a.ssc"], level="high",
                            include=tree.get, source="a.ssc")
        self.assertEqual(["@ROOT/Sound/@RTD/real.wav"],
                         [s.file for s in patches[0].samples])

    def test_the_two_spellings_share_one_flag(self) -> None:
        # `beginSkip` and `/*` set the same flag and `endSkip` and `*/` clear
        # it, so the markers pair across spellings.
        script = """
newPatch
load @ROOT/Sound/@RTD/a.wav
beginSkip
load @ROOT/Sound/@RTD/dead.wav
*/
load @ROOT/Sound/@RTD/b.wav
"""
        self.assertEqual(["@ROOT/Sound/@RTD/a.wav", "@ROOT/Sound/@RTD/b.wav"],
                         [s.file for s in parse_ssc(script)[0].samples])


class IncludeLevelScopeTests(unittest.TestCase):
    """`#templateLevel` is scoped to the file that declares it.

    The Thompson is the proof. Its `High.ssc` includes `MGdist.ssc`, which is
    a HIGH/MEDIUM/LOW dispatcher of its own and ends on LOW — read as pure
    text, every line after that include is LOW, the Fire Loop patch among
    them, and an SMG has no fire sound at the quality the game actually
    plays. So an include starts at the including file's tier, may switch
    tiers internally, and the includer's tier resumes when it returns.
    """

    WEAPON_HIGH = """
newPatch
### Fire ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
#include MGdist.ssc

newPatch
### Fire Loop ###
load @ROOT/Sound/@RTD/thompmlp.wav
loop
stop FinishSample
"""

    MGDIST_DISPATCHER = """
#templateLevel HIGH
load @ROOT/Sound/@RTD/mgdist1.wav
#templateLevel LOW
load @ROOT/Sound/@RTD/silence.wav
"""

    TREE = {
        "Objects/HandWeapons/Thompson/Sounds/High.ssc": WEAPON_HIGH,
        "Objects/HandWeapons/Thompson/Sounds/MGdist.ssc": MGDIST_DISPATCHER,
    }

    def parse(self, level: str | None = "high"):
        source = "Objects/HandWeapons/Thompson/Sounds/High.ssc"
        return parse_ssc(self.TREE[source], level=level,
                         include=self.TREE.get, source=source)

    def test_the_patch_after_a_dispatching_include_keeps_the_tier(self) -> None:
        patches = self.parse("high")
        self.assertEqual(3, len(patches))
        self.assertEqual(["thompmlp.wav"],
                         [s.file.rsplit("/", 1)[-1]
                          for s in patches[2].samples])
        self.assertTrue(patches[2].samples[0].loop)

    def test_the_include_still_switches_its_own_tiers(self) -> None:
        # Scoping the level must not stop the included dispatcher from
        # dispatching: its HIGH section joins the open patch, its LOW
        # section is filtered out.
        patches = self.parse("high")
        self.assertEqual(["mgdist1.wav"],
                         [s.file.rsplit("/", 1)[-1]
                          for s in patches[1].samples])

    def test_the_include_inherits_the_tier_at_the_include_line(self) -> None:
        # `#templateLevel MEDIUM` then `#include Medium.ssc`: a file with no
        # tier of its own is filed under the includer's — the Corsair's
        # EngineLow.ssc has worked this way all along.
        tree = {
            "a.ssc": "#templateLevel MEDIUM\n#include b.ssc\n",
            "b.ssc": "newPatch\nload @ROOT/Sound/@RTD/med.wav\n",
        }
        patches = parse_ssc(tree["a.ssc"], level="medium",
                            include=tree.get, source="a.ssc")
        self.assertEqual(["@ROOT/Sound/@RTD/med.wav"],
                         [s.file for s in patches[0].samples])


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


class BuildingSoundTests(unittest.TestCase):
    """Building sounds harvested from loadSoundScript in static templates."""

    def test_windmill_sound_extracted(self):
        """A windmill with loadSoundScript in its rotator produces a point sound."""
        from bf42.con import ObjectLibrary
        from bf42.rfa import ArchivePool

        # Mock ObjectLibrary with windmill template tree
        library = ObjectLibrary()
        # Parent bundle
        library.add_con("Objects/Statics/windmill.con", """
ObjectTemplate.create Bundle euwindmill
ObjectTemplate.addTemplate euwindmillWings
""")
        # Child rotator with sound script
        library.add_con("Objects/Statics/windmill.con", """
ObjectTemplate.create RotationalBundle euwindmillWings
ObjectTemplate.loadSoundScript Sounds/windmill.ssc
""")

        # Mock ArchivePool that can find the .con and .ssc
        class MockPool:
            def find(self, path):
                if "windmill.con" in path.lower() or "windmill.ssc" in path.lower():
                    return path
                return None

            def read(self, path):
                if "windmill.con" in path.lower():
                    return b"""
ObjectTemplate.create RotationalBundle euwindmillWings
ObjectTemplate.loadSoundScript Sounds/windmill.ssc
"""
                elif "windmill.ssc" in path.lower():
                    return b"""
newPatch
load windmill_loop.wav
volume 0.4
loop
beginEffect
controlSource Distance
controlDestination Volume
envelope Ramp
param 8.0
param 30.0
param 0.4
param -0.4
endEffect
"""
                return b""

        objects = MockPool()

        # Mock level files (no area sounds)
        class MockFiles:
            def find(self, path):
                return None
            def names(self):
                return []
            def read(self, path):
                return b""

        mock_files = MockFiles()

        # Static instance of windmill
        statics = [
            StaticInstance(
                template="euwindmill",
                position=(100.0, 5.0, 200.0),
                rotation=(0.0, 0.0, 0.0),
            )
        ]

        sounds = discover_level_sounds(mock_files, statics, library, objects)

        # Should find one building sound
        building_sounds = [s for s in sounds.areas if "_static" in s.name]
        self.assertEqual(1, len(building_sounds))

        sound = building_sounds[0]
        self.assertEqual("windmill_loop.wav", sound.file)
        self.assertAlmostEqual(0.4, sound.volume)
        self.assertEqual(8.0, sound.near_distance)
        self.assertEqual(30.0, sound.far_distance)
        # Point emitter at windmill position (Z negated for glTF)
        self.assertEqual([[100.0, 5.0, -200.0]], sound.points)

    def test_multiple_instances_same_template(self):
        """Multiple windmills share template but each emits own point sound."""
        from bf42.con import ObjectLibrary

        library = ObjectLibrary()
        library.add_con("Objects/Statics/windmill.con", """
ObjectTemplate.create Bundle euwindmill
ObjectTemplate.addTemplate euwindmillWings

ObjectTemplate.create RotationalBundle euwindmillWings
ObjectTemplate.loadSoundScript Sounds/windmill.ssc
""")

        class MockPool:
            def find(self, path):
                return path if "windmill" in path.lower() else None
            def read(self, path):
                if ".ssc" in path.lower():
                    return b"""
newPatch
load windmill.wav
volume 0.5
loop
"""
                return b"""
ObjectTemplate.create RotationalBundle euwindmillWings
ObjectTemplate.loadSoundScript Sounds/windmill.ssc
"""

        class MockFiles:
            def find(self, _): return None
            def names(self): return []
            def read(self, _): return b""

        statics = [
            StaticInstance("euwindmill", (10.0, 0.0, 20.0), (0.0, 0.0, 0.0)),
            StaticInstance("euwindmill", (30.0, 0.0, 40.0), (0.0, 0.0, 0.0)),
            StaticInstance("euwindmill", (50.0, 0.0, 60.0), (0.0, 0.0, 0.0)),
        ]

        sounds = discover_level_sounds(MockFiles(), statics, library, MockPool())
        building_sounds = [s for s in sounds.areas if "_static" in s.name]

        # Should have 3 point sounds, one per windmill
        self.assertEqual(3, len(building_sounds))
        positions = [s.points[0] for s in building_sounds]
        expected = [[10.0, 0.0, -20.0], [30.0, 0.0, -40.0], [50.0, 0.0, -60.0]]
        self.assertEqual(sorted(expected), sorted(positions))

    def test_no_sound_without_library(self):
        """Without library/objects, building sounds are not extracted."""
        class MockFiles:
            def find(self, _): return None
            def names(self): return []
            def read(self, _): return b""

        statics = [
            StaticInstance("euwindmill", (100.0, 5.0, 200.0), (0.0, 0.0, 0.0))
        ]

        # Call without library/objects (backward compat)
        sounds = discover_level_sounds(MockFiles(), statics)
        building_sounds = [s for s in sounds.areas if "_static" in s.name]
        self.assertEqual(0, len(building_sounds))


if __name__ == "__main__":
    unittest.main()
