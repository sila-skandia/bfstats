from __future__ import annotations

import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402
from bf42.level import SpawnTemplate  # noqa: E402


def pcm_wav(seconds: float = 0.05, rate: int = 44100) -> bytes:
    """A real, minimal 16-bit mono PCM wav — ffmpeg has to accept it."""
    frames = int(rate * seconds)
    data = b"".join(struct.pack("<h", (i * 137) % 4096 - 2048)
                    for i in range(frames))
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt "
            + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(data)) + data)


ffmpeg_available = extract_map.ffmpeg_available


class SharedSoundWriteTests(unittest.TestCase):
    """`extract_sounds`'s inner `write`, reached through the public function.

    The level has no ambient, areas or vehicles, so the report comes back empty
    — these drive `write` via the ambient path with a stub resolver instead,
    which is the only part of the pipeline these tests care about.
    """

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.out_dir = self.root / "maps" / "a_shau"
        self.out_dir.mkdir(parents=True)
        self.shared = self.root / "maps" / "_shared" / "sounds"

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_paths_are_measured_from_where_the_level_will_live(self) -> None:
        """The staging-depth regression.

        `extract_maps_all.py` writes each level to `<staging>/<level>/<level>`
        and moves it into the tree afterwards. Measuring the sound path from
        the write location produced `../../../_shared/sounds/x.mp3` for a path
        that has to be `../_shared/sounds/x.mp3` — every sample 404ing once
        published, while resolving fine on the extracting machine.
        """
        staging = self.root / "staging" / "a_shau" / "a_shau"
        staging.mkdir(parents=True)
        final = self.root / "maps" / "a_shau"

        info = mock.Mock()
        info.sounds.ambient.file = "Sound/wind.wav"
        info.sounds.ambient.volume = 0.6
        info.sounds.areas = []
        with mock.patch.object(extract_map, "resolve_sound",
                               return_value=("wind.wav", pcm_wav())):
            report = extract_map.extract_sounds(
                info, mock.Mock(), mock.Mock(), staging,
                shared_dir=self.shared, audio_format="wav", final_dir=final)

        self.assertEqual(report["ambient"]["file"], "../_shared/sounds/wind.wav")

    def _write(self, audio_format: str = "wav"):
        """Return the `write` closure with everything else stubbed out."""
        captured = {}

        def fake_extract(info, level_files, sounds, out_dir, **kw):
            real = extract_map.extract_sounds
            return real(info, level_files, sounds, out_dir, **kw)

        # Drive the real function with a level that resolves one ambient file.
        info = mock.Mock()
        info.sounds.ambient.file = "Sound/wind.wav"
        info.sounds.ambient.volume = 0.6
        info.sounds.areas = []
        with mock.patch.object(extract_map, "resolve_sound",
                               return_value=("wind.wav", pcm_wav())):
            report = extract_map.extract_sounds(
                info, mock.Mock(), mock.Mock(), self.out_dir,
                shared_dir=self.shared, audio_format=audio_format)
        captured["report"] = report
        return report

    def test_wav_lands_in_the_shared_dir_not_the_level(self) -> None:
        report = self._write("wav")
        self.assertTrue((self.shared / "wind.wav").is_file())
        self.assertFalse((self.out_dir / "sounds").exists())
        self.assertEqual(report["ambient"]["file"], "../_shared/sounds/wind.wav")

    def test_the_path_is_relative_so_the_viewer_resolves_it_as_a_url(self) -> None:
        # The viewer builds `${MAPS_BASE}/${dir}/${relPath}`; a leading `../`
        # is what lifts the sample out of the level directory and into the
        # mod's shared one. An absolute path here would 404.
        report = self._write("wav")
        rel = report["ambient"]["file"]
        self.assertFalse(rel.startswith("/"))
        self.assertTrue(rel.startswith("../"))
        self.assertNotIn("\\", rel)

    def test_an_existing_sample_is_not_rewritten(self) -> None:
        # The shared directory is written by every level in the mod, in
        # parallel. A second writer must leave the first one's bytes alone.
        self.shared.mkdir(parents=True)
        (self.shared / "wind.wav").write_bytes(b"already here")
        self._write("wav")
        self.assertEqual((self.shared / "wind.wav").read_bytes(), b"already here")

    def test_no_partial_files_are_left_behind(self) -> None:
        self._write("wav")
        leftovers = [p.name for p in self.shared.iterdir()
                     if ".part" in p.name or p.name.endswith(".wav.wav")]
        self.assertEqual(leftovers, [])

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_mp3_transcode_rewrites_the_extension_and_shrinks_the_file(self) -> None:
        report = self._write("mp3")
        self.assertEqual(report["ambient"]["file"], "../_shared/sounds/wind.mp3")
        self.assertTrue((self.shared / "wind.mp3").is_file())
        self.assertFalse((self.shared / "wind.wav").is_file())

    def test_a_transcode_failure_fails_the_level_rather_than_shipping_wav(self) -> None:
        # Deliberately no fallback. Writing the wav instead would silently
        # reintroduce the 3.2 GB the shared directory exists to remove, and a
        # sample ffmpeg cannot read is a corrupt source whose wav is equally
        # corrupt. Failing the level is a handled outcome in the batch driver.
        with mock.patch.object(extract_map, "transcode_to_mp3",
                               side_effect=extract_map.TranscodeError("boom")):
            with self.assertRaises(extract_map.TranscodeError):
                self._write("mp3")
        self.assertFalse((self.shared / "wind.wav").exists())


def spawn_template(name: str, vehicles: dict[int, str],
                   team_on_vehicle: bool = False) -> SpawnTemplate:
    return SpawnTemplate(name=name, vehicles=dict(vehicles),
                         team_on_vehicle=team_on_vehicle)


def gameplay(spawners: dict[str, SpawnTemplate],
             placed: list[tuple[str, int | None]]):
    """A mode layer: its spawner templates, and the pads it puts them on."""
    layer = mock.Mock()
    layer.object_spawn_templates = {k.lower(): v for k, v in spawners.items()}
    layer.object_spawns = [mock.Mock(template=name, team=team)
                           for name, team in placed]
    return layer


class SpawnedVehicleListTests(unittest.TestCase):
    """The list `sounds.vehicles` is built from.

    Both bugs here made the *viewer* silent rather than the extractor loud: a
    vehicle the scene contains with no entry in the report gets no engine
    patch, and because the guns hang off the same entry, no gun patch either —
    `setupEngineAudio` logs "no engine sound for X" and returns.
    """

    def level(self, modes: dict, default: str = "Conquest"):
        info = mock.Mock()
        info.modes = modes
        info.spawn_templates = modes[default].object_spawn_templates
        info.spawn_objects = modes[default].object_spawns
        return info

    def test_a_vehicle_only_a_non_default_mode_places_is_listed(self) -> None:
        # Berlin's Tiger and four of Wake's vehicles were missing exactly this
        # way: the scene is the union over modes (`union_object_spawns`) while
        # the sound list walked the default mode alone.
        info = self.level({
            "Conquest": gameplay(
                {"HeavyTankSpawner": spawn_template("HeavyTankSpawner",
                                                    {1: "T34", 2: "T34"})},
                [("HeavyTankSpawner", 1)]),
            "Tdm": gameplay(
                {"HeavyTankSpawner": spawn_template("HeavyTankSpawner",
                                                    {1: "Tiger", 2: "Tiger"})},
                [("HeavyTankSpawner", 1)]),
        })
        self.assertEqual(extract_map.spawned_vehicle_templates(info),
                         ["T34", "Tiger"])

    def test_both_teams_of_a_spawner_are_listed(self) -> None:
        # `spawn_vehicle` answers "which one stands here now" and prefers team
        # 2, so Bocage's PanzerIV and Stalingrad's Hanomag — the Axis half of a
        # spawner whose Allied half shipped — never reached the report.
        info = self.level({"Conquest": gameplay(
            {"MediumTankSpawner": spawn_template("MediumTankSpawner",
                                                 {1: "PanzerIV", 2: "Sherman"})},
            [("MediumTankSpawner", None)])})
        self.assertEqual(extract_map.spawned_vehicle_templates(info),
                         ["Sherman", "PanzerIV"])

    def test_a_team_on_vehicle_spawner_still_contributes_both_teams(self) -> None:
        # `teamOnVehicle` locks the pad to nothing: it is a bool saying the
        # spawner stamps its team onto what it spawns, and either half can
        # stand here depending on the instance's own `Object.setteam`. Read as
        # an owner team it dropped the other half, which is how Midway's
        # fletcher and enterprise lost their engine sounds.
        info = self.level({"Conquest": gameplay(
            {"FleetSpawner": spawn_template("FleetSpawner",
                                            {1: "hatsuzuki", 2: "fletcher"},
                                            team_on_vehicle=True)},
            [("FleetSpawner", None)])})
        self.assertEqual(extract_map.spawned_vehicle_templates(info),
                         ["fletcher", "hatsuzuki"])

    def test_the_default_mode_order_is_preserved_and_additions_append(self) -> None:
        # So a re-extraction (or the `--sounds-only` patch) grows an existing
        # scene.json rather than reshuffling it, which is what keeps the diff
        # readable and the review honest.
        info = self.level({
            "Conquest": gameplay(
                {"A": spawn_template("A", {2: "Willy"}),
                 "B": spawn_template("B", {2: "Kubelwagen"})},
                [("A", None), ("B", None)]),
            "Tdm": gameplay(
                {"A": spawn_template("A", {2: "Willy"}),
                 "C": spawn_template("C", {2: "Priest"})},
                [("C", None), ("A", None)]),
        })
        self.assertEqual(extract_map.spawned_vehicle_templates(info),
                         ["Willy", "Kubelwagen", "Priest"])

    def test_dedupe_is_case_insensitive(self) -> None:
        # `ObjectSpawnTemplates.con` is: one mode writes `panzeriv`, another
        # `PanzerIV`, and two entries for one vehicle is two sets of layers
        # decoded twice in the viewer.
        info = self.level({
            "Conquest": gameplay(
                {"A": spawn_template("A", {2: "panzeriv"})}, [("A", None)]),
            "Tdm": gameplay(
                {"A": spawn_template("A", {2: "PanzerIV"})}, [("A", None)]),
        })
        self.assertEqual(extract_map.spawned_vehicle_templates(info), ["panzeriv"])

    def test_an_unknown_spawner_template_is_skipped(self) -> None:
        info = self.level({"Conquest": gameplay(
            {"A": spawn_template("A", {2: "Willy"})},
            [("A", None), ("NotDeclared", None)])})
        self.assertEqual(extract_map.spawned_vehicle_templates(info), ["Willy"])

    def test_a_vehicle_held_by_another_vehicles_spawner_is_listed(self) -> None:
        # Wake's Daihatsus: no level pad names them, the Hatsuzuki carries them
        # on its own `HatsuzukiDaihatsuSpawner` child, and the scene bakes them
        # in as held hulls. Unlisted, the landing craft a bot drives off the
        # destroyer had no engine sound.
        info = self.level({"Conquest": gameplay(
            {"FleetSpawner": spawn_template("FleetSpawner", {1: "hatsuzuki"})},
            [("FleetSpawner", None)])})
        ref = mock.Mock()
        templates = {
            "hatsuzuki": mock.Mock(is_spawner=False, children=[ref]),
            "hatsuzukidaihatsuspawner": mock.Mock(
                is_spawner=True, spawner_vehicles={1: "Daihatsu"}),
            "daihatsu": mock.Mock(is_spawner=False, children=[]),
        }
        library = mock.Mock()
        library.object = lambda name: templates.get(name.lower())
        with mock.patch.object(extract_map.con_mod, "instance_template_name",
                               return_value="HatsuzukiDaihatsuSpawner"):
            self.assertEqual(extract_map.spawned_vehicle_templates(info, library),
                             ["hatsuzuki", "Daihatsu"])
        # Without the library the list is the level's pads alone, as before.
        self.assertEqual(extract_map.spawned_vehicle_templates(info), ["hatsuzuki"])


class LevelLocalSampleTests(unittest.TestCase):
    """A vehicle sample the level ships for itself must still resolve.

    `_sound_layers` drops a layer whose sample resolves to nothing, silently.
    It used to pass `None` where `resolve_sound` takes the level archive, so it
    only ever searched the mod's shared `Sound*.rfa` — and Liberation of Caen
    keeps `pak40fireST.wav`/`pak40fire.wav` inside its own archive, so the
    anti-tank gun shipped with no muzzle blast at all and nothing audible until
    its 0.85 s reverb tail (measured: the whole patch rendered at RMS 0.0000,
    against 0.1954 once the two layers come back).
    """

    def sample(self, file: str):
        return mock.Mock(
            file=file, loop=False, volume=1.0, min_distance=1.0, priority=10,
            trigger=None, stop=None, stereo=False, doppler_off=True,
            random_start_pitch=None, relative_position=None, effects=[])

    def test_the_level_archive_is_searched_for_a_vehicle_sample(self) -> None:
        level_files = mock.sentinel.level_archive
        seen = []

        def resolve(ref, files, sounds, rates=None):
            seen.append(files)
            return ("pak40fire.wav", b"data") if files is level_files else None

        with mock.patch.object(extract_map, "resolve_sound", resolve):
            layers = extract_map._sound_layers(
                [self.sample("@ROOT/Sound/@RTD/pak40fire.wav")],
                mock.Mock(), lambda r: "../_shared/sounds/pak40fire.mp3",
                level_files)

        self.assertEqual(seen, [level_files])
        self.assertEqual([l["file"] for l in layers],
                         ["../_shared/sounds/pak40fire.mp3"])

    def test_without_it_the_layer_is_still_dropped_rather_than_faked(self) -> None:
        # The old behaviour is the fallback, not an error: a sample that is
        # genuinely absent has to leave the layer out, or the viewer decodes a
        # 404 into a null buffer.
        with mock.patch.object(extract_map, "resolve_sound",
                               return_value=None):
            layers = extract_map._sound_layers(
                [self.sample("gone.wav")], mock.Mock(), lambda r: "x", None)
        self.assertEqual(layers, [])


class Node:
    """The shape `find_engine_script` reads off an `ObjectLibrary` entry."""

    def __init__(self, name, kind, source=None, children=()):
        self.name = name
        self.kind = kind
        self.source = source
        self.children = [mock.Mock(template=c.name) for c in children]


class EngineScriptWalkTests(unittest.TestCase):
    """Which `Engine` child a vehicle's sound script is taken from.

    EoD's Loach declares five and binds `Sounds/HueyEngine.ssc` to the last one
    BFS reaches, so stopping at the first Engine reported the helicopter — and
    the Mi4T, Mi8T, Hawk and SA2 — as having no engine sound at all.
    """

    def library(self, *nodes):
        lib = mock.Mock()
        lib.objects = {n.name.lower(): n for n in nodes}
        return lib

    def pool(self, cons: dict[str, str]):
        pool = mock.Mock()
        pool.find = lambda path: path if path in cons else None
        pool.read = lambda path: cons[path].encode("latin-1")
        return pool

    def test_the_walk_passes_an_engine_that_binds_nothing(self) -> None:
        quiet = Node("TailEngine", "Engine", source="v/Physics.con")
        loud = Node("MainEngine", "Engine", source="v/Physics.con")
        root = Node("Loach", "PlayerControlObject", children=(quiet, loud))
        found = extract_map.find_engine_script(
            self.library(root, quiet, loud),
            self.pool({"v/Physics.con":
                       "ObjectTemplate.create Engine MainEngine\n"
                       "ObjectTemplate.loadSoundScript Sounds/HueyEngine.ssc\n"}),
            "Loach")
        self.assertEqual(found, ("v/Sounds/HueyEngine.ssc", "MainEngine"))

    def test_the_first_engine_with_a_script_still_wins(self) -> None:
        # Every vanilla vehicle binds the script to the Engine BFS reaches
        # first; the widened walk must not start preferring a later one.
        first = Node("ShermanEngine", "Engine", source="v/Physics.con")
        second = Node("ShermanEngine2", "Engine", source="v/Physics.con")
        root = Node("Sherman", "PlayerControlObject", children=(first, second))
        found = extract_map.find_engine_script(
            self.library(root, first, second),
            self.pool({"v/Physics.con":
                       "ObjectTemplate.create Engine ShermanEngine\n"
                       "ObjectTemplate.loadSoundScript Sounds/A.ssc\n"
                       "ObjectTemplate.create Engine ShermanEngine2\n"
                       "ObjectTemplate.loadSoundScript Sounds/B.ssc\n"}),
            "Sherman")
        self.assertEqual(found, ("v/Sounds/A.ssc", "ShermanEngine"))

    def test_no_engine_binds_a_script_is_still_none(self) -> None:
        engine = Node("SA2Engine", "Engine", source="v/Physics.con")
        root = Node("SA2", "PlayerControlObject", children=(engine,))
        self.assertIsNone(extract_map.find_engine_script(
            self.library(root, engine),
            self.pool({"v/Physics.con": "ObjectTemplate.create Engine SA2Engine\n"}),
            "SA2"))


class TranscodeTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_it_produces_a_real_mp3(self) -> None:
        dest = self.root / "x.mp3"
        extract_map.transcode_to_mp3(pcm_wav(0.5), dest)
        head = dest.read_bytes()[:4]
        # LAME writes an ID3v2 tag or a bare frame sync; either is a real MP3,
        # and the Xing/LAME gapless header rides inside the first frame.
        self.assertTrue(head.startswith(b"ID3") or head[0] == 0xFF, head)

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_it_leaves_no_temp_files_on_success(self) -> None:
        extract_map.transcode_to_mp3(pcm_wav(), self.root / "x.mp3")
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), ["x.mp3"])

    def test_a_missing_ffmpeg_raises(self) -> None:
        with mock.patch.object(subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaises(extract_map.TranscodeError):
                extract_map.transcode_to_mp3(pcm_wav(), self.root / "x.mp3")

    @unittest.skipUnless(ffmpeg_available(), "ffmpeg not installed")
    def test_garbage_input_raises_and_leaves_nothing(self) -> None:
        dest = self.root / "x.mp3"
        with self.assertRaises(extract_map.TranscodeError):
            extract_map.transcode_to_mp3(b"not a wav", dest)
        self.assertFalse(dest.exists())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_ffmpeg_availability_is_detectable_for_the_preflight(self) -> None:
        with mock.patch.object(subprocess, "run", side_effect=FileNotFoundError):
            self.assertFalse(extract_map.ffmpeg_available())


if __name__ == "__main__":
    unittest.main()


class SupplyDepotGiveSoundTests(unittest.TestCase):
    """A SupplyDepot's script is its give sound, never building ambience."""

    class _Template:
        def __init__(self, source, children=()):
            self.source = source
            self.children = [type("Ref", (), {"template": c})() for c in children]

    class _Library:
        def __init__(self, templates):
            self.templates = {k.lower(): v for k, v in templates.items()}

        def object(self, name):
            return self.templates.get(name.lower())

    class _Objects:
        def __init__(self, files):
            self.files = files

        def find(self, path):
            return path if path in self.files else None

        def read(self, hit):
            return self.files[hit].encode("latin-1")

    def _find(self, kind):
        from bf42.level import _find_template_sound_script
        con = (f"ObjectTemplate.create {kind} Thing\n"
               "ObjectTemplate.loadSoundScript Sounds/Thing.ssc\n")
        library = self._Library({
            "Holder": self._Template("objects/holder.con", ["Thing"]),
            "Thing": self._Template("objects/thing.con"),
        })
        objects = self._Objects({"objects/holder.con": "", "objects/thing.con": con})
        return _find_template_sound_script("Holder", library, objects)

    def test_a_supply_depot_script_is_not_ambience(self):
        self.assertIsNone(self._find("SupplyDepot"))

    def test_any_other_kind_still_is(self):
        self.assertEqual(("objects/thing.con", "Sounds/Thing.ssc"),
                         self._find("SimpleObject"))
