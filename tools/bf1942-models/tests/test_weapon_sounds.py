from __future__ import annotations

import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_weapon_sounds  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from bf42.level import parse_ssc  # noqa: E402
from extract_weapon_sounds import (  # noqa: E402
    extract_weapon_sound,
    fire_delay,
    fire_sample,
    muzzle_gain,
)


def pcm_wav(seconds: float = 0.05, rate: int = 44100) -> bytes:
    """A real, minimal 16-bit mono PCM wav — ffmpeg has to accept it."""
    frames = int(rate * seconds)
    data = b"".join(struct.pack("<h", (i * 137) % 4096 - 2048)
                    for i in range(frames))
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)) + data)


# The three shapes the armoury's fire slot actually takes, trimmed to what the
# picker reads. A single-shot rifle stacks its report with the time-gated bolt
# foley and a distance-only echo layer; an automatic declares the slot silent
# and loops at the end; the knife time-gates everything and randomPlays.

RIFLE_SCRIPT = """
#templateLevel HIGH
newPatch
### Fire ###
load @ROOT/Sound/@RTD/k98LR.wav
priority 10
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 1
	param 1
	param 1
	param -1
endEffect

load @ROOT/Sound/@RTD/snpreload.wav
priority 1
trigger Volume
beginEffect
	controlDestination Volume
	controlSource Time
	envelope Ramp
	param 0.77
	param 0.77
	param 0
	param 1
endEffect

load @ROOT/Sound/@RTD/k98mono.wav
priority 8
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 1
	param 1
	param 0
	param 1
endEffect
"""

AUTOMATIC_SCRIPT = """
#templateLevel HIGH
newPatch
### Fire ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
### Reload ###
load @ROOT/Sound/@RTD/rl1thomp.wav
trigger Volume

newPatch
### Fire Loop ###
load @ROOT/Sound/@RTD/thompmlp.wav
loop
stop FinishSample
priority 10
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 1
	param 1
	param 1
	param -1
endEffect

load @ROOT/Sound/@RTD/thompmlp.wav
loop
priority 8
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 1
	param 1
	param 0
	param 1
endEffect

load @ROOT/Sound/@RTD/patronrelease.wav
"""

KNIFE_SCRIPT = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/knf1.wav
trigger Volume
randomStartPitch 0.05 / 0.05
beginEffect
	controlDestination Volume
	controlSource Time
	envelope Ramp
	param 0.4
	param 0.4
	param 0
	param 1
endEffect

load @ROOT/Sound/@RTD/knf2.wav
trigger Volume
beginEffect
	controlDestination Volume
	controlSource Time
	envelope Ramp
	param 0.4
	param 0.4
	param 0
	param 1
endEffect
randomPlay 1
"""


class FireSampleTests(unittest.TestCase):
    """Which sample of a hand-weapon script one shot actually plays."""

    def test_a_rifle_takes_its_immediate_muzzle_layer(self) -> None:
        # Not the time-gated bolt foley, and not the echo layer whose
        # distance ramp only opens away from the muzzle.
        sample, slot = fire_sample(parse_ssc(RIFLE_SCRIPT, level="high"))
        self.assertEqual("@ROOT/Sound/@RTD/k98LR.wav", sample.file)
        self.assertEqual("fire", slot)

    def test_an_automatic_falls_through_to_the_fire_loop(self) -> None:
        # The silent Fire slot means "held trigger", and the real reload
        # foley in slot two must not be mistaken for the report — which is
        # exactly what the vehicle path's first-non-silence rule would do.
        sample, slot = fire_sample(parse_ssc(AUTOMATIC_SCRIPT, level="high"))
        self.assertEqual("@ROOT/Sound/@RTD/thompmlp.wav", sample.file)
        self.assertEqual("fireLoop", slot)
        self.assertEqual(10, sample.priority)

    def test_only_looped_samples_are_taken_from_the_loop_patch(self) -> None:
        # The one-shot scattered into the loop patch (the include re-entry
        # the ShellBounce/MGdist dispatchers cause) never wins the pick.
        sample, _ = fire_sample(parse_ssc(AUTOMATIC_SCRIPT, level="high"))
        self.assertTrue(sample.loop)

    def test_a_time_gated_only_patch_still_fires_with_its_delay(self) -> None:
        # The knife's swish is 0.4 s into the swing; the gate is data, not a
        # reason to be quiet.
        sample, slot = fire_sample(parse_ssc(KNIFE_SCRIPT, level="high"))
        self.assertEqual("@ROOT/Sound/@RTD/knf1.wav", sample.file)
        self.assertEqual("fire", slot)
        self.assertAlmostEqual(0.4, fire_delay(sample))

    def test_an_entirely_silent_script_says_so(self) -> None:
        script = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/silence.wav
volume 0
"""
        sample, reason = fire_sample(parse_ssc(script, level="high"))
        self.assertIsNone(sample)
        self.assertEqual("every patch is silence", reason)

    def test_no_patches_says_so_too(self) -> None:
        sample, reason = fire_sample([])
        self.assertIsNone(sample)
        self.assertEqual("script declares no patches", reason)


class MuzzleGainTests(unittest.TestCase):
    def test_distance_ramps_are_evaluated_at_zero(self) -> None:
        patches = parse_ssc(RIFLE_SCRIPT, level="high")
        report, _foley, echo = patches[0].samples
        self.assertAlmostEqual(1.0, muzzle_gain(report))
        self.assertAlmostEqual(0.0, muzzle_gain(echo))

    def test_a_time_gate_silences_the_trigger_instant_only(self) -> None:
        foley = parse_ssc(RIFLE_SCRIPT, level="high")[0].samples[1]
        self.assertAlmostEqual(0.0, muzzle_gain(foley))
        self.assertAlmostEqual(1.0, muzzle_gain(foley, at_time=None))
        self.assertAlmostEqual(1.0, muzzle_gain(foley, at_time=1.0))

    def test_an_unknown_control_source_leaves_the_gain_alone(self) -> None:
        # The same rule engine-audio.js follows: evaluating an unknowable
        # ramp at zero would silence the layer outright.
        script = """
newPatch
load @ROOT/Sound/@RTD/a.wav
beginEffect
	controlDestination Volume
	controlSource Extern #map<Engine::Rpm>
	envelope Ramp
	param 0
	param 1
	param 0
	param 1
endEffect
"""
        sample = parse_ssc(script)[0].samples[0]
        self.assertAlmostEqual(1.0, muzzle_gain(sample))


class PoolStub:
    """The two lookups `extract_weapon_sound` makes against Objects.rfa."""

    def __init__(self, files: dict[str, str]) -> None:
        self.files = files

    def find(self, path: str) -> str | None:
        return path if path in self.files else None

    def read(self, path: str) -> bytes:
        return self.files[path].encode("latin-1")


THOMPSON_CON = """
ObjectTemplate.create HandFireArms Thompson
ObjectTemplate.loadSoundScript Sounds/Thompson.ssc
"""


class ExtractWeaponSoundTests(unittest.TestCase):
    """One weapon end to end, with the wav resolution stubbed."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.out = Path(self._tmp.name) / "sounds"
        self.library = ObjectLibrary()
        self.library.add_con("Objects/HandWeapons/Thompson/Objects.con",
                             THOMPSON_CON)
        self.objects = PoolStub({
            "Objects/HandWeapons/Thompson/Sounds/Thompson.ssc":
                AUTOMATIC_SCRIPT,
        })

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _extract(self):
        def fake_transcode(data: bytes, dest: Path) -> None:
            dest.write_bytes(b"mp3" + data[:4])
        # `_sound_layers` resolves through `extract_map`'s own names (it is
        # the vehicle-gun path reused), so the stub has to land there too --
        # patching only `extract_weapon_sounds.resolve_sound` would leave the
        # layer pass talking to a Mock it cannot treat as an ArchivePool.
        with mock.patch.object(extract_weapon_sounds, "resolve_sound",
                               return_value=("thompmlp.wav", pcm_wav())), \
             mock.patch.object(extract_weapon_sounds, "transcode_to_mp3",
                               side_effect=fake_transcode), \
             mock.patch("extract_map.resolve_sound",
                        return_value=("thompmlp.wav", pcm_wav())), \
             mock.patch("extract_map.transcode_to_mp3",
                        side_effect=fake_transcode):
            return extract_weapon_sound("Thompson", self.library,
                                        self.objects, mock.Mock(), self.out)

    def test_the_mp3_is_named_for_the_weapon_not_the_wav(self) -> None:
        # Bazooka and Panzershreck share rktfireST.wav; per-weapon names are
        # what lets the viewer ask for `sounds/<Name>.mp3` and nothing else.
        entry, reason = self._extract()
        self.assertIsNone(reason)
        self.assertEqual("Thompson.mp3", entry["file"])
        self.assertTrue((self.out / "Thompson.mp3").is_file())

    def test_the_entry_carries_what_the_viewer_plays_with(self) -> None:
        entry, _ = self._extract()
        self.assertEqual("thompmlp.wav", entry["wav"])
        self.assertEqual("fireLoop", entry["slot"])
        self.assertTrue(entry["loop"])
        self.assertEqual("Objects/HandWeapons/Thompson/Sounds/Thompson.ssc",
                         entry["script"])
        self.assertNotIn("delay", entry)

    def test_the_entry_ships_the_whole_firing_patch_for_a_bystander(self) -> None:
        # The first-person pick is one sample; `world-fire.js` plays the
        # patch's layers so the near/far `Volume <- Distance` hand-over
        # survives. This is the field that a pre-layers manifest lacks and
        # the fallback ramp stands in for.
        entry, _ = self._extract()
        self.assertIn("layers", entry)
        self.assertGreaterEqual(len(entry["layers"]), 1)
        layer = entry["layers"][0]
        self.assertIn("file", layer)
        self.assertIn("modulators", layer)
        self.assertIn("volume", layer)

    def test_an_existing_mp3_is_not_rewritten(self) -> None:
        self.out.mkdir(parents=True)
        (self.out / "Thompson.mp3").write_bytes(b"already here")
        self._extract()
        self.assertEqual(b"already here",
                         (self.out / "Thompson.mp3").read_bytes())

    def test_a_weapon_without_a_script_is_reported_quiet(self) -> None:
        # The binoculars: a real HandFireArms, no loadSoundScript. Being
        # named in the manifest is what separates "quiet by design" from
        # "the extraction missed one".
        self.library.add_con("Objects/HandWeapons/Binoculars/Objects.con",
                             "ObjectTemplate.create HandFireArms Binoculars")
        entry, reason = extract_weapon_sound(
            "Binoculars", self.library, self.objects, mock.Mock(), self.out)
        self.assertIsNone(entry)
        self.assertEqual("no loadSoundScript", reason)

    def test_a_missing_wav_is_a_reason_not_a_crash(self) -> None:
        with mock.patch.object(extract_weapon_sounds, "resolve_sound",
                               return_value=None):
            entry, reason = extract_weapon_sound(
                "Thompson", self.library, self.objects, mock.Mock(), self.out)
        self.assertIsNone(entry)
        self.assertIn("wav not in sound archives", reason)


@unittest.skipUnless(extract_weapon_sounds.ffmpeg_available(),
                     "ffmpeg not installed")
class RealTranscodeTests(unittest.TestCase):
    def test_the_fire_sample_comes_out_as_a_real_mp3(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "sounds"
            library = ObjectLibrary()
            library.add_con("Objects/HandWeapons/Thompson/Objects.con",
                            THOMPSON_CON)
            objects = PoolStub({
                "Objects/HandWeapons/Thompson/Sounds/Thompson.ssc":
                    AUTOMATIC_SCRIPT,
            })
            with mock.patch.object(extract_weapon_sounds, "resolve_sound",
                                   return_value=("thompmlp.wav", pcm_wav())), \
                 mock.patch("extract_map.resolve_sound",
                            return_value=("thompmlp.wav", pcm_wav())):
                entry, reason = extract_weapon_sound(
                    "Thompson", library, objects, mock.Mock(), out)
            self.assertIsNone(reason)
            target = out / entry["file"]
            self.assertTrue(target.is_file())
            self.assertGreater(target.stat().st_size, 0)
            head = target.read_bytes()[:3]
            self.assertIn(head[:2], (b"ID", b"\xff\xfb", b"\xff\xf3"))


if __name__ == "__main__":
    unittest.main()
