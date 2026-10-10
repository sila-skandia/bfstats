"""The engine rules behind DC Final's silent guns and one-bird forests.

Four rules, each read out of the client and recorded in the ledger:

* SSC-6: an `#include` under another `#templateLevel` is never opened, so a
  MEDIUM file's own HIGH sections cannot leak into the HIGH parse.
* SND-13: every round triggers the Fire (0) and Fire Loop (5) slots, looping
  or not; a gun whose Fire Loop loops nothing still plays it per round.
* SND-12: with both silent, a single shot is heard on its release (slots 2..4).
* SND-15: `randomPlay` belongs to the load it follows, and a patch picks only
  when its LAST load carries it; the roll counts `silence.wav` loads.

Plus the naming rule that keeps two different wavs of one name apart
(`extract_map.SampleNames`) without splitting two copies of one wav.
"""

from __future__ import annotations

import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
import extract_weapon_sounds  # noqa: E402
from bf42.level import parse_ssc, picked_voice  # noqa: E402
from bf42.rfa import ArchivePool  # noqa: E402
from extract_map import (  # noqa: E402
    RELEASE_AFTER, SampleNames, _firing_patch, _sound_layers, sample_writer,
)
from extract_weapon_sounds import fire_sample  # noqa: E402


def names(samples) -> list[str]:
    return [s.file.rsplit("/", 1)[-1] for s in samples]


def six_slots(fire_loop: str, fire: str = "load @ROOT/Sound/@RTD/silence.wav") -> str:
    """A six-slot gun script: Fire, Reload, Release, Shell Bounce, MG distance,
    Fire Loop, with the casings in slot 3 as DC Final's MG42 has them."""
    return f"""
#templateLevel HIGH
newPatch
{fire}
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/patronrelease_heavy1.wav
load @ROOT/Sound/@RTD/patronrelease_heavy2.wav
randomPlay 1
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
{fire_loop}
"""


# DC Final `Stationary_weapons/Mg42/Sounds/High.ssc`, trimmed: no `loop` on
# the Fire Loop's shot-and-tail.
DCF_MG42 = six_slots("""load @ROOT/Sound/@RTD/mg_temp.wav
stereo
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 3
	param 3
	param 1
	param -1
endEffect
load @ROOT/Sound/@RTD/mg_temp.wav
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 3
	param 3
	param 0
	param 1
endEffect""")

# DC 0.7's M203: five slots, no Fire Loop, the report in MG distance.
DC_M203 = """
#templateLevel HIGH
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/M203_reload.wav
newPatch
load @ROOT/Sound/@RTD/patronrelease.wav
volume 0.6
load @ROOT/Sound/@RTD/patronrelease2.wav
volume 0.6
randomPlay 1
newPatch
load @ROOT/Sound/@RTD/mgdist1.wav
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 50
	param 60
	param 0
	param 1
endEffect
newPatch
load @ROOT/Sound/@RTD/M203_fire_m.wav
load @ROOT/Sound/@RTD/M203_fire_m.wav
"""


class TierIncludeTests(unittest.TestCase):
    """SSC-6: an include the wanted tier never reaches is never opened."""

    TREE = {
        "Browning.ssc": ("#templateLevel HIGH\n#include High.ssc\n"
                         "#templateLevel MEDIUM\n#include Medium.ssc\n"),
        "High.ssc": ("newPatch\nload @ROOT/Sound/@RTD/silence.wav\n"
                     "newPatch\nload @ROOT/Sound/@RTD/brownmlp.wav\nloop\n"),
        # Medium.ssc's own include opens a HIGH section, as vanilla's
        # ShellBounce.ssc does.
        "Medium.ssc": "#include Shells.ssc\n",
        "Shells.ssc": ("#templateLevel HIGH\nload @ROOT/Sound/@RTD/patron1.wav\n"
                       "randomPlay 1\n#templateLevel LOW\n"
                       "load @ROOT/Sound/@RTD/silence.wav\n"),
    }

    def test_a_medium_file_adds_nothing_at_high(self) -> None:
        patches = parse_ssc(self.TREE["Browning.ssc"], level="high",
                            include=self.TREE.get, source="Browning.ssc")
        self.assertEqual(2, len(patches))
        self.assertEqual(["brownmlp.wav"], names(patches[1].samples))
        self.assertFalse(patches[1].random_play)

    def test_the_same_file_is_read_at_its_own_tier(self) -> None:
        patches = parse_ssc(self.TREE["Browning.ssc"], level="medium",
                            include=self.TREE.get, source="Browning.ssc")
        self.assertEqual([], [s for p in patches for s in p.samples
                              if s.file.endswith("brownmlp.wav")])


class RandomPlayTests(unittest.TestCase):
    """SND-15: the last load decides."""

    def patch(self, body: str):
        return parse_ssc("newPatch\n" + body)[0]

    def test_a_pick_closed_by_randomplay_picks(self) -> None:
        patch = self.patch("load a.wav\nload b.wav\nrandomPlay 1\n")
        self.assertTrue(patch.random_play)

    def test_a_load_after_it_turns_the_pick_off(self) -> None:
        # The M1 Garand: a shell-bounce include ending in `randomPlay 1`, then
        # its near and far reports. Every layer plays.
        patch = self.patch("load report.wav\nload patron1.wav\nload patron2.wav\n"
                           "randomPlay 1\nload near.wav\nload far.wav\n")
        self.assertFalse(patch.random_play)
        self.assertEqual(1, patch.samples[2].random_play)

    def test_one_load_cannot_pick(self) -> None:
        # `value < loads so far`: 1 < 1 is false, the patch plays its load.
        self.assertFalse(self.patch("load a.wav\nrandomPlay 1\n").random_play)

    def test_bare_randomplay_is_atoi_of_nothing(self) -> None:
        self.assertFalse(self.patch("load a.wav\nload b.wav\nrandomPlay\n").random_play)

    def test_randomplay_before_any_load_is_ignored(self) -> None:
        self.assertFalse(self.patch("randomPlay 1\nload a.wav\nload b.wav\n").random_play)


class PickedVoiceTests(unittest.TestCase):
    """M4: DC Final's trees roll their bird once each, silence included."""

    BIRDS = "#templateLevel HIGH\nnewPatch\n" + "".join(
        f"load @ROOT/Sound/@RTD/Env_Birds{i}.wav\nloop\nvolume 0.6\n"
        f"beginEffect\ncontrolDestination Volume\ncontrolSource Distance\n"
        f"envelope Ramp\nparam 1\nparam {8 + i}\nparam 1\nparam -1\nendEffect\n"
        for i in range(1, 9)) + "load @ROOT/Sound/@RTD/silence.wav\n" * 19 + "randomPlay 1\n"

    def test_the_patch_is_a_pick(self) -> None:
        patch = parse_ssc(self.BIRDS)[0]
        self.assertTrue(patch.random_play)
        self.assertEqual(27, len(patch.samples))

    def test_most_trees_are_quiet_and_the_rest_carry_different_birds(self) -> None:
        patch = parse_ssc(self.BIRDS)[0]
        picks = [picked_voice(patch, f"tree|{i}.00|0.00|{i * 3}.00") for i in range(2000)]
        heard = [p for p in picks if p is not None]
        # 8 of 27 slots sound: 29.6 %.
        self.assertAlmostEqual(8 / 27, len(heard) / len(picks), delta=0.04)
        self.assertEqual(8, len({p.file for p in heard}))

    def test_a_pick_carries_its_own_layer(self) -> None:
        patch = parse_ssc(self.BIRDS)[0]
        voice = next(v for v in (picked_voice(patch, f"k{i}") for i in range(200))
                     if v is not None and v.file.endswith("Env_Birds7.wav"))
        self.assertTrue(voice.loop)
        self.assertEqual(15.0, voice.far_distance)
        self.assertEqual([1.0, 15.0, 1.0, -1.0], [voice.near_distance, voice.far_distance,
                                                  voice.ramp_start_val, voice.ramp_delta_val])

    def test_the_same_tree_rolls_the_same_bird(self) -> None:
        patch = parse_ssc(self.BIRDS)[0]
        first = picked_voice(patch, "tree|1.00|2.00|3.00")
        again = picked_voice(patch, "tree|1.00|2.00|3.00")
        self.assertEqual(first and first.file, again and again.file)


class FiringSlotTests(unittest.TestCase):
    """SND-13 and SND-12: which of a gun's slots a round plays."""

    def test_a_fire_loop_that_loops_nothing_is_still_the_round(self) -> None:
        samples = _firing_patch(parse_ssc(DCF_MG42, level="high"))
        self.assertEqual(["mg_temp.wav", "mg_temp.wav"], names(samples))
        self.assertFalse(any(s.loop for s in samples))

    def test_a_script_without_slot_five_is_heard_on_release(self) -> None:
        samples = _firing_patch(parse_ssc(DC_M203, level="high"))
        self.assertEqual(["patronrelease.wav", "patronrelease2.wav", "mgdist1.wav",
                          "M203_fire_m.wav", "M203_fire_m.wav"], names(samples))

    def test_a_looping_fire_loop_is_unchanged(self) -> None:
        script = six_slots("load @ROOT/Sound/@RTD/brownmlp.wav\nloop\n"
                           "load @ROOT/Sound/@RTD/patron1.wav\n")
        self.assertEqual(["brownmlp.wav"],
                         names(_firing_patch(parse_ssc(script, level="high"))))

    def test_a_sounding_fire_slot_is_unchanged(self) -> None:
        script = six_slots("load @ROOT/Sound/@RTD/mg_temp.wav\n",
                           fire="load @ROOT/Sound/@RTD/k98.wav")
        self.assertEqual(["k98.wav"], names(_firing_patch(parse_ssc(script, level="high"))))

    def test_a_projectile_script_keeps_its_one_shot_release(self) -> None:
        script = ("newPatch\nload @ROOT/Sound/@RTD/shellair.wav\nloop\n"
                  "newPatch\nload @ROOT/Sound/@RTD/bmbreal1.wav\n"
                  "load @ROOT/Sound/@RTD/bmbreal3.wav\nrandomPlay 1\n")
        self.assertEqual(["bmbreal1.wav", "bmbreal3.wav"],
                         names(_firing_patch(parse_ssc(script), release=True)))


    def test_a_projectile_script_of_loops_alone_gives_the_weapon_no_sound(self) -> None:
        """The Flettner's, the Calliope's, Krupp's and the rocket platform's
        round load four motor loops and no one-shot: the loops are the
        round's flight, not the launcher's report (2026-10-11, the helicopter
        that roared a rocket motor at its own cockpit for six seconds)."""
        script = ("newPatch\nload @ROOT/Sound/@RTD/rcktlp1.wav\nloop\n"
                  "load @ROOT/Sound/@RTD/rcktlp2.wav\nloop\n"
                  "load @ROOT/Sound/@RTD/haxxar.wav\nloop\n")
        patches = parse_ssc(script)
        self.assertEqual([], _firing_patch(patches, release=True))
        # A weapon's own script of one looping patch is still its fire loop.
        self.assertEqual(["rcktlp1.wav", "rcktlp2.wav", "haxxar.wav"],
                         names(_firing_patch(patches)))


class LayerPickKeysTests(unittest.TestCase):
    """M5: a `randomPlay` patch's layers say so; no other layer changes."""

    def layers(self, script: str, release: bool = False):
        patches = parse_ssc(script)
        with mock.patch.object(extract_map, "resolve_sound",
                               side_effect=lambda ref, *_a, **_k: (ref.rsplit("/", 1)[-1], b"x")):
            return _sound_layers(_firing_patch(patches, release=release), None,
                                 lambda resolved: resolved[0], None, patches)

    def test_a_bomb_release_carries_its_pick(self) -> None:
        script = ("newPatch\nload @ROOT/Sound/@RTD/shellair.wav\nloop\n"
                  "newPatch\nload @ROOT/Sound/@RTD/bmbreal1.wav\n"
                  "load @ROOT/Sound/@RTD/silence.wav\n"
                  "load @ROOT/Sound/@RTD/bmbreal3.wav\nrandomPlay 1\n")
        layers = self.layers(script, release=True)
        self.assertEqual([("bmbreal1.wav", 1, True, 0, 3), ("bmbreal3.wav", 1, True, 2, 3)],
                         [(l["file"], l["patch"], l["randomPlay"], l["slot"], l["slots"])
                          for l in layers])

    def test_a_layered_patch_gets_no_new_key(self) -> None:
        layers = self.layers("newPatch\nload @ROOT/Sound/@RTD/a.wav\nloop\n"
                             "load @ROOT/Sound/@RTD/b.wav\nloop\n")
        self.assertEqual([], [k for l in layers for k in ("patch", "randomPlay", "slot", "slots")
                              if k in l])


class PoolStub(ArchivePool):
    """An `ArchivePool` answering from a dict of `{path: bytes}`."""

    def __init__(self, files: dict[str, bytes]) -> None:
        super().__init__()
        self.files = files

    def names(self) -> list[str]:
        return list(self.files)

    def try_read(self, name: str) -> bytes | None:
        return self.files.get(name.lower()) or self.files.get(name)


class SampleNameTests(unittest.TestCase):
    """M1: two recordings of one name get two files, one recording one."""

    AH64 = b"RIFF ah-64 rotor"
    MI24 = b"RIFF mi-24 rotor"
    ROOT = b"RIFF root copy"

    def pool(self) -> PoolStub:
        return PoolStub({
            "sound/44khz/desertcombat/ah64/helicopter_far.wav": self.AH64,
            "sound/44khz/desertcombat/mi24/helicopter_far.wav": self.MI24,
            "sound/44khz/desertcombat/uh60/helicopter_far.wav": self.AH64,
            "sound/22khz/desertcombat/ah64/helicopter_far.wav": b"22k",
            "sound/44khz/enginewhine.wav": self.ROOT,
            "sound/44khz/f14/enginewhine.wav": b"f-14",
            "sound/44khz/mg_temp.wav": b"only one",
        })

    def test_folders_with_different_recordings_are_told_apart(self) -> None:
        names_ = SampleNames(self.pool())
        ah = names_.stem("Helicopter_far.wav", self.AH64)
        mi = names_.stem("Helicopter_far.wav", self.MI24)
        self.assertNotEqual(ah, mi)
        self.assertEqual(f"Helicopter_far~{hashlib.sha1(self.AH64).hexdigest()[:8]}", ah)

    def test_two_copies_of_one_recording_share_a_name(self) -> None:
        # The UH-60 folder holds the AH-64's bytes: one buffer on the page, so
        # the coherent-twin guards still see the pair.
        names_ = SampleNames(self.pool())
        self.assertEqual(names_.stem("Helicopter_far.wav", self.AH64),
                         names_.stem("Helicopter_far.wav", self.AH64))

    def test_the_rate_root_copy_keeps_the_bare_name(self) -> None:
        names_ = SampleNames(self.pool())
        self.assertEqual("enginewhine", names_.stem("enginewhine.wav", self.ROOT))
        self.assertTrue(names_.stem("enginewhine.wav", b"f-14").startswith("enginewhine~"))

    def test_a_name_with_one_recording_is_left_alone(self) -> None:
        names_ = SampleNames(self.pool())
        self.assertEqual("mg_temp", names_.stem("mg_temp.wav", b"only one"))
        # Matched without case, spelled as the script spells it.
        self.assertEqual("MG_TEMP", names_.stem("MG_TEMP.wav", b"only one"))

    def test_a_level_copy_that_matches_nothing_is_qualified(self) -> None:
        names_ = SampleNames(self.pool())
        self.assertTrue(names_.stem("mg_temp.wav", b"the level's own").startswith("mg_temp~"))

    def test_without_a_pool_every_name_is_bare(self) -> None:
        self.assertEqual("Helicopter_far", SampleNames(None).stem("Helicopter_far.wav", b"x"))
        self.assertEqual("Helicopter_far", SampleNames(mock.Mock()).stem("Helicopter_far.wav", b"x"))

    def test_the_writer_keeps_both_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            shared = Path(tmp) / "_shared" / "sounds"
            write = sample_writer(shared, Path(tmp) / "level", "wav", self.pool())
            ah = write(("Helicopter_far.wav", self.AH64))
            mi = write(("Helicopter_far.wav", self.MI24))
            self.assertNotEqual(ah, mi)
            self.assertEqual(self.AH64, (Path(tmp) / "level" / ah).resolve().read_bytes())
            self.assertEqual(self.MI24, (Path(tmp) / "level" / mi).resolve().read_bytes())


class HandWeaponSlotTests(unittest.TestCase):
    """H2: DC's CAR-15, Skorpion and grenade launchers have a report."""

    def test_the_car15_fires_its_fire_loop_per_shot(self) -> None:
        script = six_slots("load @ROOT/Sound/@RTD/Car15s_ST.wav\nvolume 0.5\nstereo\n"
                           "load @ROOT/Sound/@RTD/Car15s_m.wav\n")
        sample, slot = fire_sample(parse_ssc(script, level="high"))
        self.assertEqual("fireLoop", slot)
        self.assertEqual("Car15s_m.wav", sample.file.rsplit("/", 1)[-1])
        self.assertFalse(sample.loop)

    def test_the_m203_is_heard_on_release(self) -> None:
        sample, slot = fire_sample(parse_ssc(DC_M203, level="high"))
        self.assertEqual("release", slot)
        self.assertEqual("M203_fire_m.wav", sample.file.rsplit("/", 1)[-1])

    def test_the_release_report_carries_its_delay(self) -> None:
        library = extract_weapon_sounds.con_mod.ObjectLibrary()
        library.add_con("Objects/HandWeapons/M203/Objects.con",
                        "ObjectTemplate.create HandFireArms M203\n"
                        "ObjectTemplate.loadSoundScript Sounds/M203.ssc\n")
        objects = mock.Mock()
        objects.find.side_effect = lambda p: p if p.endswith("M203.ssc") else None
        objects.read.side_effect = lambda p: DC_M203.encode("latin-1")
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(extract_weapon_sounds, "resolve_sound",
                                  return_value=("M203_fire_m.wav", b"RIFF")), \
                mock.patch("extract_map.resolve_sound",
                           return_value=("M203_fire_m.wav", b"RIFF")), \
                mock.patch.object(extract_weapon_sounds, "transcode_to_mp3",
                                  side_effect=lambda d, dest: dest.write_bytes(d)), \
                mock.patch("extract_map.transcode_to_mp3",
                           side_effect=lambda d, dest: dest.write_bytes(d)):
            entry, reason = extract_weapon_sounds.extract_weapon_sound(
                "M203", library, objects, mock.Mock(), Path(tmp))
        self.assertIsNone(reason)
        self.assertEqual("release", entry["slot"])
        self.assertAlmostEqual(RELEASE_AFTER, entry["delay"])

    def test_a_randomplay_fire_loop_ships_its_alternates(self) -> None:
        # DC Final's CAR-15: `Car15s_ST` or `Car15s_ST2`, one per round.
        script = six_slots("load @ROOT/Sound/@RTD/Car15s_ST.wav\nvolume 0.75\n"
                           "load @ROOT/Sound/@RTD/Car15s_ST2.wav\nvolume 0.75\n"
                           "randomPlay 1\n")
        library = extract_weapon_sounds.con_mod.ObjectLibrary()
        library.add_con("Objects/HandWeapons/Car-15/Objects.con",
                        "ObjectTemplate.create HandFireArms CAR-15\n"
                        "ObjectTemplate.loadSoundScript Sounds/CAR-15.ssc\n")
        objects = mock.Mock()
        objects.find.side_effect = lambda p: p if p.endswith("CAR-15.ssc") else None
        objects.read.side_effect = lambda p: script.encode("latin-1")

        def resolve(ref, *_a, **_k):
            base = ref.rsplit("/", 1)[-1]
            return base, base.encode()

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(extract_weapon_sounds, "resolve_sound", side_effect=resolve), \
                mock.patch("extract_map.resolve_sound", side_effect=resolve), \
                mock.patch.object(extract_weapon_sounds, "transcode_to_mp3",
                                  side_effect=lambda d, dest: dest.write_bytes(d)), \
                mock.patch("extract_map.transcode_to_mp3",
                           side_effect=lambda d, dest: dest.write_bytes(d)):
            entry, _ = extract_weapon_sounds.extract_weapon_sound(
                "CAR-15", library, objects, mock.Mock(), Path(tmp))
            self.assertEqual(["CAR-15.mp3", "CAR-15.1.mp3"], entry["randomPlay"])
            self.assertEqual(b"Car15s_ST2.wav", (Path(tmp) / "CAR-15.1.mp3").read_bytes())
        self.assertEqual("fireLoop", entry["slot"])

    def test_a_pick_that_moved_rewrites_the_mp3(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "M203.mp3"
            target.write_bytes(b"old reload")
            with mock.patch.object(extract_weapon_sounds, "transcode_to_mp3",
                                   side_effect=lambda d, dest: dest.write_bytes(d)):
                extract_weapon_sounds._write_mp3(b"new report", target, stale=False)
                self.assertEqual(b"old reload", target.read_bytes())
                inode = target.stat().st_ino
                extract_weapon_sounds._write_mp3(b"new report", target, stale=True)
            self.assertEqual(b"new report", target.read_bytes())
            self.assertEqual(inode, target.stat().st_ino, "rewritten in place, links and all")


if __name__ == "__main__":
    unittest.main()
