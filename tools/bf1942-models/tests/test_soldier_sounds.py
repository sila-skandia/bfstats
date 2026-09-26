"""`extract_soldier_sounds.py`: the bail-out sound scripts, as the viewer needs them.

The numbers asserted here are the ones `viewer/parachute.js` hard-codes as its
fallback schedule, so this is also the check that the two agree — the module was
written from the script by hand and this reads the script with the parser.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extract_soldier_sounds import (
    ALL_SOLDIER_SCRIPTS, BAIL_OUT_SCRIPTS, INJURY_SCRIPTS, LANGUAGES,
    MOVEMENT_SCRIPTS, PATCH_MATERIALS, language_refs, script_manifest, time_gate,
)
from bf42.level import parse_ssc


def _ramp(seconds: float) -> str:
    """The `Volume <- Time` gate every delayed layer in these scripts carries."""
    return f"""
beginEffect
\tcontrolDestination Volume
\tcontrolSource Time
\tenvelope Ramp
\tparam {seconds}
\tparam {seconds}
\tparam 0
\tparam 1
endEffect

trigger Volume
"""


FALLING = f"""
newPatch

load @ROOT/Sound/@RTD/rcktlp1.wav
loop
volume.2

load @ROOT/Sound/@RTD/luft2.wav
loop

load @ROOT/Sound/@RTD/fhs1.wav
{_ramp(1.2)}

load @ROOT/Sound/@RTD/fhs2.wav
{_ramp(2.3)}

load @ROOT/Sound/@RTD/soprupp.wav
{_ramp(11.5)}

##############
### Scream ###
##############

newPatch
load @ROOT/Sound/@RTD/@Language/fallparachute.wav
volume .7
{_ramp(3.3)}

load @ROOT/Sound/@RTD/@Language/fallparachute2.wav
volume .7
{_ramp(3.3)}

randomPlay 1
"""


class SoldierSoundTests(unittest.TestCase):
    def test_the_falling_script_is_an_ambience_patch_then_a_voice_patch(self) -> None:
        patches = script_manifest(FALLING, "SoldierFallingHigh.ssc")
        self.assertEqual(2, len(patches))
        self.assertFalse(patches[0]["randomPlay"])
        self.assertTrue(patches[1]["randomPlay"])

    def test_every_layers_start_is_its_own_time_ramp(self) -> None:
        patches = script_manifest(FALLING, "SoldierFallingHigh.ssc")
        ambience = {l["sample"]: l["at"] for l in patches[0]["layers"]}
        self.assertEqual(
            {"rcktlp1": 0.0, "luft2": 0.0, "fhs1": 1.2, "fhs2": 2.3,
             "soprupp": 11.5}, ambience)
        voice = {l["sample"]: l["at"] for l in patches[1]["layers"]}
        self.assertEqual({"fallparachute": 3.3, "fallparachute2": 3.3}, voice)

    def test_the_easter_egg_is_in_the_ambience_patch_not_the_random_one(self) -> None:
        # `soprupp.wav` at 11.5 s is the fall-for-ages sample. It is a LAYER of
        # the first patch, so it is not one of the three the scream patch picks
        # between: it plays on every fall that lasts long enough, and nothing
        # else in the install loads it.
        patches = script_manifest(FALLING, "SoldierFallingHigh.ssc")
        self.assertIn("soprupp", [l["sample"] for l in patches[0]["layers"]])
        self.assertNotIn("soprupp", [l["sample"] for l in patches[1]["layers"]])

    def test_the_looping_wind_layers_carry_their_loop_and_volume(self) -> None:
        layers = {l["sample"]: l
                  for l in script_manifest(FALLING, "x")[0]["layers"]}
        self.assertTrue(layers["rcktlp1"]["loop"])
        self.assertAlmostEqual(0.2, layers["rcktlp1"]["volume"])
        self.assertTrue(layers["luft2"]["loop"])
        self.assertFalse(layers["fhs1"]["loop"])

    def test_a_layer_with_no_time_ramp_starts_at_zero(self) -> None:
        patch = parse_ssc("newPatch\nload @ROOT/Sound/@RTD/x.wav\n", source="x")[0]
        self.assertEqual(0.0, time_gate(patch.samples[0]))

    def test_a_distance_ramp_is_not_a_start_time(self) -> None:
        # Every layer also carries a `Volume <- Distance` ramp. Reading that
        # one as the start would put the wind 5 seconds into the fall.
        text = """
newPatch
load @ROOT/Sound/@RTD/x.wav
beginEffect
\tcontrolDestination Volume
\tcontrolSource Distance
\tenvelope Ramp
\tparam 5
\tparam 20
\tparam 1
\tparam -1
endEffect
trigger Volume
"""
        self.assertEqual(0.0, time_gate(parse_ssc(text, source="x")[0].samples[0]))

    def test_language_refs_expands_the_voice_directory(self) -> None:
        refs = language_refs("@ROOT/Sound/@RTD/@Language/fallparachute.wav")
        self.assertEqual(len(LANGUAGES), len(refs))
        self.assertEqual("@ROOT/Sound/@RTD/English/fallparachute.wav", refs[0])
        self.assertNotIn("@Language", refs[0])

    def test_a_ref_without_a_language_is_left_alone(self) -> None:
        self.assertEqual(["@ROOT/Sound/@RTD/luft2.wav"],
                         language_refs("@ROOT/Sound/@RTD/luft2.wav"))

    def test_the_three_bail_out_triggers_are_the_engines_own(self) -> None:
        # The `c_Sst*` names the parachute animation states declare, and the
        # scripts `SoldierSound.inc` loads for them.
        self.assertEqual(
            [("c_SstFallingHigh", "SoldierFallingHigh.ssc"),
             ("c_SstOpenParachute", "SoldierOpenParachute.ssc"),
             ("c_SstParachuteLand", "SoldierParachuteLand.ssc")],
            list(BAIL_OUT_SCRIPTS))

    def test_all_soldier_scripts_includes_movement_and_injury(self) -> None:
        self.assertEqual(
            [("c_SstWalk", "SoldierWalk.ssc"),
             ("c_SstRun", "SoldierRun.ssc")],
            list(MOVEMENT_SCRIPTS))
        self.assertEqual(
            [("c_SstHitDamage", "SoldierHitDamage.ssc"),
             ("c_SstFFHitDamage", "SoldierFFHitDamage.ssc"),
             ("c_SstKilled", "SoldierKilled.ssc")],
            list(INJURY_SCRIPTS))
        self.assertEqual(
            list(BAIL_OUT_SCRIPTS) + list(MOVEMENT_SCRIPTS) + list(INJURY_SCRIPTS),
            list(ALL_SOLDIER_SCRIPTS))

    def test_ten_surface_materials_match_soldier_patches(self) -> None:
        self.assertEqual(
            ("sand", "metal", "wood", "concrete", "grass", "gravel", "ice", "mud", "fabric", "harness"),
            PATCH_MATERIALS)

    def test_movement_script_with_ten_patches_is_tagged_with_materials(self) -> None:
        ten_patch_text = "\n".join("newPatch\nload @ROOT/Sound/@RTD/test.wav\n" for _ in range(10))
        patches = script_manifest(ten_patch_text, "Objects/Soldiers/Common/Sounds/High/SoldierWalk.ssc")
        self.assertEqual(10, len(patches))
        for i, p in enumerate(patches):
            self.assertEqual(PATCH_MATERIALS[i], p.get("material"))


if __name__ == "__main__":
    unittest.main()
