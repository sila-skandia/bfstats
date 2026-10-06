"""A hand weapon's burst edges in `weapons.json`: what a stop and a reload play.

`extract_weapon_sounds._burst_edges` has written the release tails since
75edb204 (ledger SND-12, SND-15, SND-16), but no tree on this PC had been
re-extracted since, and nothing pinned the shape: 0 of 54 Desert Combat
entries carried `release`. The script below is DC's own `M16.ssc` trimmed to
one load per idea: the six slots, the Reload patch's time-gated foley that
only the shooter hears (`Volume <- Distance` 1 below a metre, 0 above), the
`M16_release` tail, three casings rolled one per release (`randomPlay`), a
silent MG-distance slot and the near/far Fire Loop.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_weapon_sounds  # noqa: E402
from bf42.con import ObjectLibrary  # noqa: E402
from extract_weapon_sounds import extract_weapon_sound  # noqa: E402


def _near(param3: float = 1, param4: float = -1) -> str:
    return f"""beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 1
	param 1
	param {param3}
	param {param4}
endEffect
"""


def _at(seconds: float) -> str:
    return f"""beginEffect
	controlDestination Volume
	controlSource Time
	envelope Ramp
	param {seconds}
	param {seconds}
	param 0
	param 1
endEffect
"""


M16_SCRIPT = f"""
#templateLevel HIGH
newPatch
### Fire ###
load @ROOT/Sound/@RTD/M16_dist.wav
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 50
	param 100
	param 0
	param 1
endEffect

newPatch
### Reload ###
load @ROOT/Sound/@RTD/rl2mp18.wav
{_at(0.55)}{_near()}
load @ROOT/Sound/@RTD/SoFa1.wav
volume 0.4
randomStartPitch 0.03 / 0
{_at(0.7)}{_near()}
load @ROOT/Sound/@RTD/rl1mp18.wav
{_at(1.5)}{_near()}

newPatch
### Release ###
load @ROOT/Sound/@RTD/M16_release.wav
randomStartPitch 0.05 / 0
beginEffect
	controlDestination Volume
	controlSource Distance
	envelope Ramp
	param 50
	param 150
	param 1
	param -1
endEffect

newPatch
### Shell Bounce ###
load @ROOT/Sound/@RTD/patronrelease.wav
volume 0.6
{_at(0.2)}
load @ROOT/Sound/@RTD/patronrelease2.wav
volume 0.6
{_at(0.2)}
load @ROOT/Sound/@RTD/patronrelease3.wav
volume 0.6
{_at(0.2)}randomPlay 1

newPatch
### MG distance ###
load @ROOT/Sound/@RTD/silence.wav
volume 0

newPatch
### Fire Loop ###
load @ROOT/Sound/@RTD/M16_loop_ST.wav
loop
volume 0.75
{_near()}
load @ROOT/Sound/@RTD/M16_loop_m.wav
loop
{_near(0, 1)}
"""

M16_CON = """
ObjectTemplate.create HandFireArms M16
ObjectTemplate.loadSoundScript Sounds/M16.ssc
"""


class PoolStub:
    def __init__(self, files: dict[str, str]) -> None:
        self.files = files

    def find(self, path: str) -> str | None:
        return path if path in self.files else None

    def read(self, path: str) -> bytes:
        return self.files[path].encode("latin-1")


def _resolve(ref: str, *_args):
    """Every wav resolves, under its own name."""
    return ref.replace("\\", "/").rsplit("/", 1)[-1], b"RIFF" + ref.encode()


class M16BurstEdgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.out = Path(self._tmp.name) / "sounds"
        self.library = ObjectLibrary()
        self.library.add_con("Objects/HandWeapons/M16/Objects.con", M16_CON)
        self.objects = PoolStub({
            "Objects/HandWeapons/M16/Sounds/M16.ssc": M16_SCRIPT})

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def extract(self) -> dict:
        def fake_transcode(data: bytes, dest: Path) -> None:
            dest.write_bytes(b"mp3" + data)
        with mock.patch.object(extract_weapon_sounds, "resolve_sound",
                               side_effect=_resolve), \
             mock.patch.object(extract_weapon_sounds, "transcode_to_mp3",
                               side_effect=fake_transcode), \
             mock.patch("extract_map.resolve_sound", side_effect=_resolve), \
             mock.patch("extract_map.transcode_to_mp3",
                        side_effect=fake_transcode):
            entry, reason = extract_weapon_sound(
                "M16", self.library, self.objects, mock.Mock(), self.out)
        self.assertIsNone(reason)
        return entry

    def test_the_report_is_the_fire_loop(self) -> None:
        entry = self.extract()
        self.assertEqual("fireLoop", entry["slot"])
        self.assertEqual("M16_loop_ST.wav", entry["wav"])

    def test_a_stop_plays_the_release_tail_and_one_casing(self) -> None:
        # SND-12: Release (2) and Shell Bounce (3) on every stop. The casings
        # roll one load of three (SND-15), so the group keeps its count.
        release = {group["slot"]: group for group in self.extract()["release"]}
        self.assertEqual({2, 3}, set(release))
        self.assertEqual(["M16_release.wav"],
                         [pick["wav"] for pick in release[2]["picks"]])
        self.assertEqual("M16.r2.0.mp3", release[2]["picks"][0]["file"])
        self.assertTrue((self.out / "M16.r2.0.mp3").is_file())
        casings = release[3]
        self.assertTrue(casings["randomPlay"])
        self.assertEqual(3, casings["loads"])
        self.assertEqual([0, 1, 2], [pick["load"] for pick in casings["picks"]])
        # The casings land 0.2 s after the stop, as their Time gate says.
        self.assertEqual({0.2}, {pick["delay"] for pick in casings["picks"]})

    def test_a_silent_mg_distance_slot_ships_nothing(self) -> None:
        self.assertNotIn(4, [group["slot"] for group in self.extract()["release"]])


if __name__ == "__main__":
    unittest.main()
