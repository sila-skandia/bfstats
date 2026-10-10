"""`census_vehicle_weapon_sounds.py`: every vehicle weapon resolves to the
sound the game binds, never to a fallback.

Reported 2026-10-11 from a Secret Weapons replay: the Flettner's rockets made
"a strange noise". Its launcher has no sound script and its ROUND loads four
rocket-motor loops; the extractor handed them to the launcher, where the rack
held a motor on at the cockpit for six seconds. Pinned here:

* the classification (own script, the round's release one-shot, the round's
  flight, silent, unresolved), on a small synthetic library;
* the Flettner's shape is a `round-flight` weapon with no entry, and the old
  fallback is what the census calls `loop-on-launcher`;
* a bomb rack's release clack stays the rack's sound;
* on the install, XPack1 and XPack2 (every global template and every level of
  the pack, the Flettner among them) have no weapon with a problem.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import census_vehicle_weapon_sounds as census  # noqa: E402
import extract_map as em  # noqa: E402
from bf42 import con as con_mod  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402


class _Files:
    """A pool of in-memory files."""

    def __init__(self, files: dict[str, bytes]) -> None:
        self.files = {name.lower(): data for name, data in files.items()}

    def find(self, name: str):
        return name if name.replace("\\", "/").lower() in self.files else None

    def read(self, name: str) -> bytes:
        return self.files[name.replace("\\", "/").lower()]


MOTOR = b"""newPatch
load @ROOT/Sound/@RTD/rcktlp1.wav
loop
load @ROOT/Sound/@RTD/haxxar.wav
loop
"""
BAZOOKA = b"""newPatch
load @ROOT/Sound/@RTD/rcktlp1.wav
loop
newPatch
load @ROOT/Sound/@RTD/rcktfiremono.wav
"""
BOMB = b"""newPatch
load @ROOT/Sound/@RTD/shellair.wav
loop
newPatch
load @ROOT/Sound/@RTD/bmbreal1.wav
"""
CANNON = b"""newPatch
load @ROOT/Sound/@RTD/cannon.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
"""
MUTE_GUN = b"""newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
newPatch
load @ROOT/Sound/@RTD/silence.wav
loop
"""

CON = """
ObjectTemplate.create PlayerControlObject Heli
ObjectTemplate.addTemplate HeliRockets
ObjectTemplate.addTemplate HeliGun
ObjectTemplate.addTemplate HeliBomb
ObjectTemplate.addTemplate HeliPod
ObjectTemplate.addTemplate HeliTube
ObjectTemplate.addTemplate HeliMissingScript
ObjectTemplate.addTemplate HeliMute

ObjectTemplate.create FireArms HeliRockets
ObjectTemplate.projectileTemplate HeliMotorRound
ObjectTemplate.create Projectile HeliMotorRound
ObjectTemplate.loadSoundScript Sounds/Motor.ssc

ObjectTemplate.create FireArms HeliGun
ObjectTemplate.loadSoundScript Sounds/Cannon.ssc
ObjectTemplate.projectileTemplate HeliBullet
ObjectTemplate.create Projectile HeliBullet

ObjectTemplate.create FireArms HeliBomb
ObjectTemplate.projectileTemplate HeliBombRound
ObjectTemplate.create Projectile HeliBombRound
ObjectTemplate.loadSoundScript Sounds/Bomb.ssc

ObjectTemplate.create FireArms HeliPod
ObjectTemplate.projectileTemplate HeliPodRound
ObjectTemplate.create Projectile HeliPodRound
ObjectTemplate.loadSoundScript Sounds/Bazooka.ssc

ObjectTemplate.create FireArms HeliTube
ObjectTemplate.projectileTemplate HeliTubeRound
ObjectTemplate.create Projectile HeliTubeRound

ObjectTemplate.create FireArms HeliMissingScript
ObjectTemplate.loadSoundScript Sounds/NoSuchFile.ssc

ObjectTemplate.create FireArms HeliMute
ObjectTemplate.loadSoundScript Sounds/Mute.ssc
"""


def _resolve(ref, *_a, **_k):
    name = ref.replace("\\", "/").rsplit("/", 1)[-1]
    return None if name.lower() == "silence.wav" else (name, b"x")


class ClassificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.library = con_mod.ObjectLibrary()
        cls.library.add_con("Objects/Vehicles/Air/Heli/Weapons.con", CON)
        base = "Objects/Vehicles/Air/Heli/Sounds/"
        cls.objects = _Files({
            "Objects/Vehicles/Air/Heli/Weapons.con": CON.encode(),
            base + "Motor.ssc": MOTOR, base + "Bazooka.ssc": BAZOOKA,
            base + "Bomb.ssc": BOMB, base + "Cannon.ssc": CANNON,
            base + "Mute.ssc": MUTE_GUN,
        })

    def rows(self, flight=("HeliMotorRound",)):
        with mock.patch.object(em, "resolve_sound", side_effect=_resolve):
            rows = census.census(self.library, self.objects, None, ["Heli"],
                                 flight=set(flight))
        return {row.fire_arms: row for row in rows}

    def test_each_weapon_is_bound_by_where_its_sound_lives(self) -> None:
        rows = self.rows()
        self.assertEqual(
            {"HeliRockets": "round-flight", "HeliGun": "own",
             "HeliBomb": "round-shot", "HeliPod": "round-shot",
             "HeliTube": "silent", "HeliMissingScript": "unresolved",
             "HeliMute": "silent"},
            {name: row.kind for name, row in rows.items()})
        self.assertEqual([], [r for r in rows.values() if r.problems])

    def test_a_rocket_launcher_with_only_a_motor_round_is_mute(self) -> None:
        row = self.rows()["HeliRockets"]
        # No entry: nothing sounds at the muzzle, the loops are the round's.
        self.assertIsNone(row.layers)
        self.assertEqual("HeliMotorRound", row.round)

    def test_a_pod_that_has_a_launch_crack_keeps_it(self) -> None:
        self.assertEqual([("rcktfiremono.wav", False)], self.rows()["HeliPod"].layers)

    def test_a_bomb_rack_keeps_its_release_clack(self) -> None:
        self.assertEqual([("bmbreal1.wav", False)], self.rows()["HeliBomb"].layers)

    def test_a_flight_the_manifests_do_not_list_is_a_problem(self) -> None:
        self.assertEqual(["flight-unlisted"], self.rows(flight=())["HeliRockets"].problems)

    def test_the_old_fallback_is_what_the_census_calls_a_loop_on_the_launcher(self) -> None:
        """Before 2026-10-11 `_firing_patch(release=True)` returned the first
        sounding patch when the round had no one-shot, the motor loops."""
        original = em._firing_patch

        def old(patches, release=False):
            picked = original(patches, release)
            if release and not picked:
                for patch in patches:
                    samples = em._non_silence(patch.samples)
                    if samples:
                        return samples
            return picked

        with mock.patch.object(em, "_firing_patch", old):
            row = self.rows()["HeliRockets"]
        self.assertIn("loop-on-launcher", row.problems)
        self.assertEqual("round-shot", row.kind)


GAME_DIR = DEFAULT_GAME_DIR.expanduser()


@unittest.skipUnless((GAME_DIR / "Mods" / "XPack2" / "Archives" / "Objects.rfa").is_file(),
                     "no Battlefield 1942 XPack2 install")
class InstalledPackTests(unittest.TestCase):
    """Every vehicle weapon of the two packs the SW/RtR replay round plays."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.rows = {mod: census.run_mod(GAME_DIR, mod) for mod in ("XPack1", "XPack2")}

    def test_no_weapon_has_a_problem(self) -> None:
        for mod, rows in self.rows.items():
            with self.subTest(mod=mod):
                self.assertEqual([], [(r.scope, r.template, r.fire_arms, r.problems)
                                      for r in rows if r.problems])

    def test_the_flettners_rockets_are_the_rounds_motor(self) -> None:
        row = next(r for r in self.rows["XPack2"]
                   if r.fire_arms == "FlettnerRocketLauncher")
        self.assertEqual("round-flight", row.kind)
        self.assertEqual("Raid_on_Agheila", row.scope)
        self.assertIsNone(row.layers)

    def test_the_calliope_family_is_the_same(self) -> None:
        rows = {r.fire_arms: r.kind for r in self.rows["XPack2"]
                if r.fire_arms in ("Sherman_T34CalliopeBundle", "Krupp_RocketLauncher",
                                   "RocketLauncher_RocketLauncher")}
        self.assertEqual({"Sherman_T34CalliopeBundle": "round-flight",
                          "Krupp_RocketLauncher": "round-flight",
                          "RocketLauncher_RocketLauncher": "round-flight"}, rows)

    def test_the_bombs_and_the_rocket_aircraft_keep_their_one_shot(self) -> None:
        shots = [r for r in self.rows["XPack2"] if r.kind == "round-shot"]
        self.assertGreaterEqual(len(shots), 10)
        for row in shots:
            with self.subTest(weapon=row.fire_arms):
                self.assertTrue(row.layers)
                self.assertFalse(any(loop for _f, loop in row.layers))


if __name__ == "__main__":
    unittest.main()
