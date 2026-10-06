"""A vehicle's part sounds in `sounds.vehicles[].parts` (ledger SND-19..SND-22).

Only an Engine's and the FireArms' scripts used to ship, so a turret traversed,
a landing gear folded and DC's tracks rolled in silence, in every mod: DC binds
61 gear scripts and 148 RotationalBundle ones, vanilla 14 and 82. The
extractor now ships every part of a class whose own rule the viewer plays
(`extract_map.PART_SOUND_KINDS`), keyed by its node, every patch in script
order. The fixture is DC's M1A1 (a traversing tower, an elevating gun base, an
animated track) with an A-10's gear leg and flap, trimmed to one load each.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402

LIBRARY = {
    "Objects/Vehicles/Land/M1A1/Objects.con": """
ObjectTemplate.create PlayerControlObject M1A1
ObjectTemplate.addTemplate M1A1Tower
ObjectTemplate.addTemplate M1A1TrackL
ObjectTemplate.addTemplate M1A1Lights
ObjectTemplate.create RotationalBundle M1A1Tower
ObjectTemplate.loadSoundScript Sounds/M1A1Tower.ssc
ObjectTemplate.addTemplate M1A1GunBase
ObjectTemplate.create RotationalBundle M1A1GunBase
ObjectTemplate.create AnimatedBundle M1A1TrackL
ObjectTemplate.loadSoundScript Sounds/M1A1TrackL.ssc
ObjectTemplate.create SimpleObject M1A1Lights
ObjectTemplate.loadSoundScript Sounds/Lights.ssc
""",
    "Objects/Vehicles/Air/A10/Objects.con": """
ObjectTemplate.create PlayerControlObject A10
ObjectTemplate.addTemplate A10_Gear_Front
ObjectTemplate.addTemplate A10FlapLeftOuter
ObjectTemplate.create LandingGear A10_Gear_Front
ObjectTemplate.loadSoundScript ../Common/Sounds/LandingGear.ssc
ObjectTemplate.create Wing A10FlapLeftOuter
ObjectTemplate.loadSoundScript ../Common/Sounds/HullLeft.ssc
""",
}


def _ramp(source: str, a: float, b: float, base: float, delta: float, dest: str = "Volume") -> str:
    return f"""beginEffect
	controlDestination {dest}
	controlSource {source}
	envelope Ramp
	param {a}
	param {b}
	param {base}
	param {delta}
endEffect
"""


SCRIPTS = {
    "Objects/Vehicles/Land/M1A1/Sounds/M1A1Tower.ssc": f"""
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/DesertCombat/M1A1/m1turretservo.wav
loop
{_ramp('Default', 0.1, 20, 0, 1)}{_ramp('Default', 0, 10, 0.5, 0.1, 'Pitch')}""",
    "Objects/Vehicles/Land/M1A1/Sounds/M1A1TrackL.ssc": f"""
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/DesertCombat/moderntreads.wav
loop
{_ramp('Speed', 0, 10, 0, 1)}""",
    "Objects/Vehicles/Land/M1A1/Sounds/Lights.ssc": """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/hum.wav
loop
""",
    "Objects/Vehicles/Air/Common/Sounds/LandingGear.ssc": """
#templateLevel HIGH
newPatch
### Gear up ###
load @ROOT/Sound/@RTD/lghi.wav
loop
load @ROOT/Sound/@RTD/LG2.wav
trigger Release

newPatch
### Gear down ###
load @ROOT/Sound/@RTD/silence.wav
""",
    "Objects/Vehicles/Air/Common/Sounds/HullLeft.ssc": f"""
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/arplcrnk.wav
loop
{_ramp('Acceleration', 10, 30, 0, 1)}""",
}


class Pool:
    def __init__(self, files: dict[str, str]) -> None:
        self.files = {k.lower(): v for k, v in files.items()}

    def find(self, path: str) -> str | None:
        path = path.replace("\\", "/").lower()
        return path if path in self.files else None

    def read(self, path: str) -> bytes:
        return self.files[path].encode("latin-1")


def _resolve(ref, *_args):
    return ref.replace("\\", "/").rsplit("/", 1)[-1], b"RIFF"


class PartScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self.library = ObjectLibrary()
        for path, text in LIBRARY.items():
            self.library.add_con(path, text)
        self.objects = Pool(SCRIPTS)

    def table(self, template: str) -> dict:
        with mock.patch("extract_map.resolve_sound", side_effect=_resolve):
            entries = extract_map.extract_vehicle_sounds(
                self.library, self.objects, None, [template],
                lambda resolved: f"../_shared/sounds/{resolved[0]}")
        self.assertEqual(1, len(entries))
        return entries[0]

    def test_the_part_scripts_under_a_hull_by_class(self) -> None:
        found = extract_map.find_part_scripts(self.library, "M1A1")
        self.assertEqual([("M1A1Tower", "RotationalBundle",
                           "Objects/Vehicles/Land/M1A1/Sounds/M1A1Tower.ssc"),
                          ("M1A1TrackL", "AnimatedBundle",
                           "Objects/Vehicles/Land/M1A1/Sounds/M1A1TrackL.ssc")], found)

    def test_a_hull_with_only_parts_still_gets_an_entry(self) -> None:
        # The M1A1 here has no Engine and no gun: its parts alone sound.
        entry = self.table("M1A1")
        self.assertEqual((entry["engine"], entry["layers"]), (None, []))
        parts = {part["node"]: part for part in entry["parts"]}
        self.assertEqual({"M1A1Tower", "M1A1TrackL"}, set(parts))
        tower = parts["M1A1Tower"]
        self.assertEqual("RotationalBundle", tower["kind"])
        self.assertFalse(tower["attachToListener"])
        [servo] = tower["patches"][0]
        self.assertEqual("../_shared/sounds/m1turretservo.wav", servo["file"])
        self.assertTrue(servo["loop"])
        self.assertEqual({("volume", "default"), ("pitch", "default")},
                         {(m["dest"], m["source"]) for m in servo["modulators"]})

    def test_a_class_outside_the_rules_ships_nothing(self) -> None:
        # A SimpleObject's script is a level object's business, not a part's.
        self.assertNotIn("M1A1Lights", {p["node"] for p in self.table("M1A1")["parts"]})

    def test_a_landing_gear_keeps_its_two_patches_in_order(self) -> None:
        # SND-21 tells the two apart by index: patch 0 travels up, patch 1
        # comes down. A silent patch ships as [] so the index survives.
        gear = next(p for p in self.table("A10")["parts"] if p["kind"] == "LandingGear")
        self.assertEqual("A10_Gear_Front", gear["node"])
        self.assertEqual(2, len(gear["patches"]))
        up, down = gear["patches"]
        self.assertEqual(["lghi.wav", "LG2.wav"], [l["file"].rsplit("/", 1)[-1] for l in up])
        self.assertEqual("release", up[1]["trigger"])
        self.assertEqual([], down)

    def test_a_flap_ships_its_creak(self) -> None:
        flap = next(p for p in self.table("A10")["parts"] if p["kind"] == "Wing")
        self.assertEqual("A10FlapLeftOuter", flap["node"])
        self.assertEqual("acceleration", flap["patches"][0][0]["modulators"][0]["source"])


if __name__ == "__main__":
    unittest.main()
