"""The client's voice rules, as the extractor records them and the page plays them.

`trigger Volume` flags the Volume effect declared last above it (BF1942.exe
0x00801380 -> 0x008017e0, ledger SND-37), so which effect a sample waits on is
the order of its lines, and the extractor has to carry it: vanilla's
`Objects/Common/Sounds/Projectile_High.ssc` puts the line after the `Time`
effect on `bulletair1` and between `Distance` and `Time` on the other six.

The node half (`test_sound_voice_rules.mjs`) plays it, with the buffer's eight
instances and the world-fire and passing-round pools; a `test_*.mjs` without a
wrapper is invisible to `unittest discover` and `verify.sh`.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42.level import parse_ssc  # noqa: E402
import extract_map  # noqa: E402

SCRIPT = Path(__file__).with_name("test_sound_voice_rules.mjs")

# Two of vanilla's seven `Projectile_High.ssc` loads, verbatim in shape.
PROJECTILE_HIGH = """newPatch
load @ROOT/Sound/@RTD/bulletair1.wav
minDistance 5
priority -1
dopplerOff

*** Distance Volume ***
beginEffect
\tcontrolDestination Volume
\tcontrolSource Distance
\tenvelope Ramp
\tparam 10
\tparam 10
\tparam 1
\tparam -1
endEffect

*** Time Volume ***
beginEffect
\tcontrolDestination Volume
\tcontrolSource Time
\tenvelope Ramp
\tparam 0.075
\tparam 0.075
\tparam 0
\tparam 1
endEffect

trigger Volume

load @ROOT/Sound/@RTD/bulletair2.wav
minDistance 5
priority -1
dopplerOff

*** Distance Volume ***
beginEffect
\tcontrolDestination Volume
\tcontrolSource Distance
\tenvelope Ramp
\tparam 10
\tparam 10
\tparam 1
\tparam -1
endEffect
trigger Volume
*** Time Volume ***
beginEffect
\tcontrolDestination Volume
\tcontrolSource Time
\tenvelope Ramp
\tparam 0.075
\tparam 0.075
\tparam 0
\tparam 1
endEffect

load @ROOT/Sound/@RTD/bulletair3.wav
beginEffect
\tcontrolDestination Pitch
\tcontrolSource Distance
\tenvelope Linear
\tparam 1
\tparam 0
endEffect
trigger Volume

randomPlay 1
"""


class TriggerFlagTests(unittest.TestCase):
    def setUp(self) -> None:
        self.samples = parse_ssc(PROJECTILE_HIGH)[0].samples

    def flags(self, sample) -> list[tuple[str, str, bool]]:
        return [(e.destination, e.source, e.trigger) for e in sample.effects]

    def test_the_line_flags_the_volume_effect_declared_last_above_it(self) -> None:
        self.assertEqual([("volume", "distance", False), ("volume", "time", True)],
                         self.flags(self.samples[0]))
        self.assertEqual([("volume", "distance", True), ("volume", "time", False)],
                         self.flags(self.samples[1]))

    def test_a_pitch_effect_is_never_flagged(self) -> None:
        self.assertEqual([("pitch", "distance", False)], self.flags(self.samples[2]))
        self.assertEqual("volume", self.samples[2].trigger)

    def test_the_layer_record_carries_the_flag_on_its_effect_only(self) -> None:
        mods = [extract_map._modulator_report(e) for e in self.samples[1].effects]
        self.assertEqual([True, None], [m.get("trigger") for m in mods])
        self.assertEqual({"dest", "source", "envelope", "params"}, set(mods[1]))

    def test_the_effects_manifest_carries_it_too(self) -> None:
        from bf42 import effects
        from bf42.level import SoundPatch
        patch = SoundPatch(level="high", file="", samples=self.samples[:2])
        layers = effects.sound_layers([patch], lambda f: f, lambda f: f)
        self.assertEqual([None, True], [m.get("trigger") for m in layers[0]["modulators"]])
        self.assertEqual([True, None], [m.get("trigger") for m in layers[1]["modulators"]])


class VoiceRulesNodeTests(unittest.TestCase):
    def test_the_node_suite_passes(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(
            ["node", str(SCRIPT)], capture_output=True, text=True, timeout=300)
        self.assertEqual(0, proc.returncode,
                         f"{SCRIPT.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
