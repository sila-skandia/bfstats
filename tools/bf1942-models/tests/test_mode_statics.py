"""Statics a mode script places beyond `StaticObjects.con`.

The dedicated server runs the level's root `<mode>.con` (ledger TKT-3), and
that script can create objects of its own through the files it runs. Secret
Weapons does: Hellendoorn, Kbely Airfield and Mimoyecques run
`Conquest/AdditionalStaticObjects` from their Conquest, CoOp, Ctf and Tdm
scripts, Telemark a root-level `AdditionalStaticObjects`, and none of the four
runs it from ObjectiveMode, where the same spots hold a destroyable objective
an `ObjectiveSpawners` pad makes. The exporter read `StaticObjects.con` alone,
so the V2s, the Kbely prototypes, the V3 shafts and the turbines were missing
from every mode.

Pinned here: how a host walks the script (`_host_lines`, `script_objects`),
which placements are scenery (`is_gameplay_kind`), how they are tagged by
layer (`union_mode_statics`), and that the bake and the sound layer carry the
tag. The census behind the numbers is
`features/bf1942-engine-reference/surveys/mode_script_statics.py`.
"""

from __future__ import annotations

import json
import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402

from bf42.level import (  # noqa: E402
    GameType,
    GameplayObjects,
    LevelInfo,
    StaticInstance,
    TerrainInfo,
    _host_lines,
    discover_level_sounds,
    is_gameplay_kind,
    load_game_types,
    script_objects,
)

GAME_DIR = Path("~/.wine/drive_c/EA Games/Battlefield 1942").expanduser()


class _FakeFiles:
    """The `LevelFiles` methods the script walker, `load_game_types`, the
    sound discovery and `build_scene` use. Keys are level-relative."""

    def __init__(self, blobs: dict[str, str]) -> None:
        self._blobs = {k.lower(): v for k, v in blobs.items()}

    def find(self, rel: str):
        rel = rel.lower()
        return rel if rel in self._blobs else None

    def read(self, key: str) -> bytes:
        return self._blobs[key.lower()].encode("latin-1")

    def under(self, directory: str) -> list[str]:
        prefix = directory.lower().strip("/") + "/"
        return sorted(k for k in self._blobs
                      if k.startswith(prefix) and "/" not in k[len(prefix):])

    def names(self) -> list[str]:
        return list(self._blobs)

    def tiles(self) -> list:
        return []


def _create(template: str, x: float, z: float, yaw: float = 0.0) -> str:
    return (f"Object.create {template}\n"
            f"Object.absolutePosition {x}/50/{z}\n"
            f"Object.rotation {yaw}/0/0\n")


# Hellendoorn's four scripts, trimmed to what matters here.
V2S = _create("Hellendoorn_V2Orginal", 318.611, 248.782, 180) + \
    "rem\nrem ***  ***\nrem\n" + _create("Hellendoorn_V2Orginal", 320.182, 265.844, 180)

CONQUEST = """
Game.setNumberOfTickets 1 100
run Conquest/SpawnpointManagerSettings
run Conquest/ObjectSpawnTemplates
run Conquest/ControlPointTemplates
run Conquest/AdditionalStaticObjects
run Conquest/ObjectSpawns
run Conquest/ControlPoints v_arg1
"""

CTF = """
run Ctf/ObjectSpawnTemplates
run ctf/ControlPointTemplates
run Conquest/AdditionalStaticObjects
run Ctf/ObjectSpawns
run ctf/ControlPoints v_arg1

if v_arg1 == host
	object.create redBase
	Object.absolutePosition 574.492/59.4741/933.41
	Object.Rotation 0/0/0
else
	object.create FlagPole redFlagPole
	Object.absolutePosition 574.492/59.4741/933.41
	Object.Rotation 0/0/0
endIf
"""

OBJECTIVE = """
run ObjectiveMode/ObjectSpawnTemplates
run ObjectiveMode/ObjectiveSpawnerTemplates v_arg1
run ObjectiveMode/ObjectSpawns
run ObjectiveMode/ObjectiveSpawners v_arg1
"""

OBJECTIVE_TEMPLATES = """
ObjectTemplate.create DestroyTargetObjective DestroyTurbine01
ObjectTemplate.setTargetName Turbine01

ObjectTemplate.create ObjectSpawner TurbineSpawner
ObjectTemplate.setObjectTemplate 1 Hellendoorn_V2

ObjectTemplate.create ObjectSpawner DestroyTurbineObjectiveSpawner01
ObjectTemplate.setObjectTemplate 1 DestroyTurbine01
"""

OBJECTIVE_SPAWNERS = _create("TurbineSpawner", 318.611, 248.782) + """
Object.setName Turbine01
Object.create DestroyTurbineObjectiveSpawner01
object.setName ObjectiveSpawner01
"""


def _hellendoorn() -> _FakeFiles:
    return _FakeFiles({
        "GameTypes/Conquest.con": "", "GameTypes/Ctf.con": "",
        "GameTypes/ObjectiveMode.con": "",
        "Conquest.con": CONQUEST, "Ctf.con": CTF, "ObjectiveMode.con": OBJECTIVE,
        "Conquest/AdditionalStaticObjects.con": V2S,
        # A copy nothing runs: the archive ships one in every mode directory.
        "Ctf/AdditionalStaticObjects.con": _create("NotRun", 1, 1),
        "Conquest/ObjectSpawns.con": _create("SomePad", 10, 10),
        "Conquest/ControlPoints.con": _create("SomeFlag", 20, 20),
        "Conquest/ObjectSpawnTemplates.con":
            "ObjectTemplate.create ObjectSpawner SomePad\n",
        "Ctf/ControlPoints.con": _create("AxisBase", 30, 30),
        "ObjectiveMode/ObjectiveSpawnerTemplates.con": OBJECTIVE_TEMPLATES,
        "ObjectiveMode/ObjectiveSpawners.con": OBJECTIVE_SPAWNERS,
    })


class HostLinesTests(unittest.TestCase):
    """Which lines of a script a host runs."""

    def test_the_host_arm_runs_and_the_join_arm_does_not(self) -> None:
        lines = _host_lines(CTF, ["host"])
        self.assertIn("\tobject.create redBase", lines)
        self.assertNotIn("\tobject.create FlagPole redFlagPole", lines)

    def test_a_file_run_without_arguments_takes_the_other_arm(self) -> None:
        # `run X` passes nothing, so X's `v_arg1` is empty.
        lines = _host_lines(CTF, [])
        self.assertNotIn("\tobject.create redBase", lines)
        self.assertIn("\tobject.create FlagPole redFlagPole", lines)

    def test_a_quoted_host_is_the_same_test(self) -> None:
        text = 'if v_arg1 == "host"\nyes\nendIf\n'
        self.assertEqual(_host_lines(text, ["host"]), ["yes"])

    def test_elseif_takes_the_first_true_arm_only(self) -> None:
        text = ("if v_arg1 == join\na\nelseIf v_arg1 == host\nb\n"
                "elseIf v_arg1 == host\nc\nelse\nd\nendIf\ne\n")
        self.assertEqual(_host_lines(text, ["host"]), ["b", "e"])

    def test_nested_blocks_inside_a_dead_arm_stay_dead(self) -> None:
        text = ("if v_arg1 == join\nif v_arg1 != join\na\nelse\nb\nendIf\n"
                "else\nc\nendIf\n")
        self.assertEqual(_host_lines(text, ["host"]), ["c"])

    def test_a_test_on_an_untracked_variable_keeps_its_first_arm(self) -> None:
        text = "if v_gameplaymode == gpm_cq\na\nelse\nb\nendIf\n"
        self.assertEqual(_host_lines(text, ["host"]), ["a"])

    def test_a_commented_endif_does_not_close_the_block(self) -> None:
        text = "if v_arg1 == join\nrem endIf\na\nendIf\nb\n"
        self.assertEqual(_host_lines(text, ["host"]), ["b"])

    def test_return_ends_the_file(self) -> None:
        self.assertEqual(_host_lines("a\nreturn\nb\n", ["host"]), ["a"])


class ScriptObjectsTests(unittest.TestCase):
    """What a mode script's chain creates, the layer files apart."""

    def test_a_run_file_s_placements_are_collected_with_their_source(self) -> None:
        made = script_objects(_hellendoorn(), "conquest.con")
        self.assertEqual([o.template for o in made.objects],
                         ["Hellendoorn_V2Orginal"] * 2)
        self.assertEqual({o.source for o in made.objects},
                         {"conquest/additionalstaticobjects.con"})
        self.assertEqual(made.objects[0].position, (318.611, 50.0, 248.782))
        self.assertEqual(made.objects[0].rotation, (180.0, 0.0, 0.0))

    def test_layer_files_are_left_to_the_layer_reader(self) -> None:
        # ObjectSpawns and ControlPoints create pads and flags; those are
        # `load_gameplay_objects`'s, never statics.
        made = script_objects(_hellendoorn(), "conquest.con")
        self.assertNotIn("SomePad", [o.template for o in made.objects])
        self.assertNotIn("SomeFlag", [o.template for o in made.objects])

    def test_a_layer_file_s_declarations_are_still_recorded(self) -> None:
        made = script_objects(_hellendoorn(), "conquest.con")
        self.assertEqual(made.declared["somepad"], "objectspawner")

    def test_the_script_s_own_placements_count_in_the_host_arm(self) -> None:
        made = script_objects(_hellendoorn(), "ctf.con")
        self.assertEqual([o.template for o in made.objects],
                         ["Hellendoorn_V2Orginal"] * 2 + ["redBase"])
        self.assertEqual(made.objects[-1].source, "ctf.con")

    def test_only_the_files_the_script_runs_are_read(self) -> None:
        made = script_objects(_hellendoorn(), "ctf.con")
        self.assertNotIn("NotRun", [o.template for o in made.objects])

    def test_objective_spawners_come_with_their_declared_kinds(self) -> None:
        made = script_objects(_hellendoorn(), "objectivemode.con")
        self.assertEqual([o.template for o in made.objects],
                         ["TurbineSpawner", "DestroyTurbineObjectiveSpawner01"])
        self.assertEqual(made.declared["turbinespawner"], "objectspawner")
        self.assertEqual(made.declared["destroyturbine01"], "destroytargetobjective")

    def test_a_nested_run_is_relative_to_the_including_file(self) -> None:
        files = _FakeFiles({
            "Conquest.con": "run Conquest/Props\n",
            "Conquest/Props.con": "run Trees\n" + _create("Crate", 1, 1),
            "Conquest/Trees.con": _create("Birch", 2, 2),
            "Trees.con": _create("WrongBirch", 3, 3),
        })
        made = script_objects(files, "conquest.con")
        # The included file's placements come where its `run` line is.
        self.assertEqual([o.template for o in made.objects], ["Birch", "Crate"])

    def test_a_path_only_the_level_root_resolves_is_taken(self) -> None:
        # How the `GameTypes/` fallback scripts write theirs.
        files = _FakeFiles({
            "GameTypes/Conquest.con": "run Conquest/AdditionalStaticObjects\n",
            "Conquest/AdditionalStaticObjects.con": _create("Shaft", 1, 1),
        })
        made = script_objects(files, "gametypes/conquest.con")
        self.assertEqual([o.template for o in made.objects], ["Shaft"])

    def test_arguments_are_passed_on(self) -> None:
        guarded = "if v_arg1 == host\n" + _create("HostOnly", 1, 1) + "endIf\n"
        files = _FakeFiles({
            "Conquest.con": "run A v_arg1\nrun B\n",
            "A.con": guarded,
            "B.con": guarded.replace("HostOnly", "Never"),
        })
        made = script_objects(files, "conquest.con")
        self.assertEqual([o.template for o in made.objects], ["HostOnly"])

    def test_a_missing_file_and_a_cycle_are_survived(self) -> None:
        files = _FakeFiles({
            "Conquest.con": "run Missing\nrun Loop\n",
            "Loop.con": "run Loop\n",
        })
        self.assertEqual(script_objects(files, "conquest.con").objects, [])

    def test_load_game_types_records_the_chain_s_objects(self) -> None:
        types = load_game_types(_hellendoorn())
        self.assertEqual(len(types["Conquest"].objects), 2)
        self.assertEqual(types["ObjectiveMode"].declared["turbinespawner"],
                         "objectspawner")


class GameplayKindTests(unittest.TestCase):

    def test_round_machinery_is_not_scenery(self) -> None:
        for kind in ("ControlPoint", "SpawnPoint", "ObjectSpawner", "FlagBase",
                     "Flag", "DestroyTargetObjective", "ANDCompositeObjective",
                     "TimerObjective"):
            with self.subTest(kind):
                self.assertTrue(is_gameplay_kind(kind))

    def test_scenery_and_the_unknown_are_not(self) -> None:
        for kind in ("SimpleObject", "Bundle", "RotationalBundle", "SupplyDepot",
                     "TreeMesh", "AreaObject", None, ""):
            with self.subTest(kind):
                self.assertFalse(is_gameplay_kind(kind))


class _Template:
    def __init__(self, kind: str) -> None:
        self.kind = kind


class _Library:
    """`ObjectLibrary.object` for the handful of templates a test names."""

    def __init__(self, kinds: dict[str, str]) -> None:
        self._kinds = {k.lower(): v for k, v in kinds.items()}

    def object(self, name: str):
        kind = self._kinds.get(name.lower())
        return None if kind is None else _Template(kind)


LIBRARY = _Library({"Hellendoorn_V2Orginal": "SimpleObject",
                    "redBase": "FlagBase", "FlagPole": "SimpleObject"})


def _info(files: _FakeFiles, layers: list[str],
          statics: list[StaticInstance] | None = None) -> LevelInfo:
    info = LevelInfo(name="Hellendoorn", terrain=TerrainInfo())
    info.static_objects = list(statics or [])
    info.modes = {name: GameplayObjects(mode=name) for name in layers}
    info.game_types = load_game_types(files)
    return info


class UnionModeStaticsTests(unittest.TestCase):

    def test_a_static_is_tagged_with_the_layers_whose_scripts_place_it(self) -> None:
        info = _info(_hellendoorn(), ["Conquest", "ObjectiveMode", "Ctf", "SinglePlayer"])
        rows = extract_map.union_mode_statics(info, LIBRARY)
        self.assertEqual([(i.template, m) for i, m in rows],
                         [("Hellendoorn_V2Orginal", ["Conquest", "Ctf"])] * 2)

    def test_a_static_in_every_layer_is_left_untagged(self) -> None:
        files = _hellendoorn()
        info = _info(files, ["Conquest", "Ctf"])
        del info.game_types["ObjectiveMode"]
        rows = extract_map.union_mode_statics(info, LIBRARY)
        self.assertEqual([m for _i, m in rows], [None, None])

    def test_round_machinery_is_left_out(self) -> None:
        # The CTF flag base by the library's kind; the objective spawners by
        # the kinds the ObjectiveMode chain declares.
        info = _info(_hellendoorn(), ["Conquest", "ObjectiveMode", "Ctf"])
        templates = {i.template for i, _m in extract_map.union_mode_statics(info, LIBRARY)}
        self.assertEqual(templates, {"Hellendoorn_V2Orginal"})

    def test_without_a_library_only_the_declared_kinds_are_known(self) -> None:
        info = _info(_hellendoorn(), ["Conquest", "ObjectiveMode", "Ctf"])
        templates = [i.template for i, _m in extract_map.union_mode_statics(info)]
        self.assertIn("redBase", templates)
        self.assertNotIn("TurbineSpawner", templates)

    def test_a_game_type_whose_layer_is_not_shipped_adds_nothing(self) -> None:
        # The page shows the default layer for it, which must not gain its
        # statics.
        info = _info(_hellendoorn(), ["ObjectiveMode"])
        self.assertEqual(extract_map.union_mode_statics(info, LIBRARY), [])

    def test_a_repeat_of_a_staticobjects_placement_is_not_placed_twice(self) -> None:
        repeat = StaticInstance("Hellendoorn_V2Orginal", (318.611, 50.0, 248.782),
                                (180.0, 0.0, 0.0))
        info = _info(_hellendoorn(), ["Conquest", "Ctf"], statics=[repeat])
        rows = extract_map.union_mode_statics(info, LIBRARY)
        self.assertEqual([i.position for i, _m in rows], [(320.182, 50.0, 265.844)])

    def test_layers_are_listed_in_the_level_s_order(self) -> None:
        info = _info(_hellendoorn(), ["Ctf", "SinglePlayer", "Conquest"])
        rows = extract_map.union_mode_statics(info, LIBRARY)
        self.assertEqual(rows[0][1], ["Ctf", "Conquest"])


class ModeStaticSoundTests(unittest.TestCase):
    """An emitter on a mode script's static is heard only in its layers."""

    FILES = _FakeFiles({
        "Sounds/Turbine.con": ("ObjectTemplate.create SimpleObject turbinehum\n"
                               "ObjectTemplate.loadSoundScript turbine.ssc\n"),
        "Sounds/turbine.ssc": ("#templateLevel HIGH\nnewPatch\n"
                               "load @ROOT/Sound/@RTD/turbine.wav\nloop\nvolume 0.5\n"),
    })

    def test_the_emitter_carries_the_layers(self) -> None:
        inst = StaticInstance("turbinehum", (1.0, 2.0, 3.0), (0.0, 0.0, 0.0))
        sounds = discover_level_sounds(
            self.FILES, [inst], mode_statics=[(inst, ["Conquest", "CoOp"])])
        # The StaticObjects.con placement is in every layer; the mode
        # script's is only in its own.
        self.assertEqual([a.modes for a in sounds.areas], [None, ["Conquest", "CoOp"]])
        self.assertEqual(sounds.areas[1].points, [[1.0, 2.0, -3.0]])

    @staticmethod
    def _turbine_library():
        # Telemark's turbine, trimmed: `Objects.rfa` adds the hum by name,
        # and only the level's `Sounds/` declares it.
        from bf42.con import ObjectLibrary
        library = ObjectLibrary()
        library.add_con("Objects/Objectives/Turbines/Objects.con", """
ObjectTemplate.create Bundle TurbinesOrginal
ObjectTemplate.geometry Turbines_m1
objectTemplate.addTemplate turbinehum
ObjectTemplate.addTemplate TurbineRotation
ObjectTemplate.setPosition 0.071/2.85/0.101

ObjectTemplate.create RotationalBundle TurbineRotation
ObjectTemplate.geometry TurbineRotation_m1
""")
        return library

    def test_a_level_sound_under_a_placed_template_is_heard_there(self) -> None:
        inst = StaticInstance("TurbinesOrginal", (1177.11, 24.64, 564.382), (0.0, 0.0, 0.0))
        sounds = discover_level_sounds(
            self.FILES, [], self._turbine_library(), None,
            mode_statics=[(inst, ["Conquest", "CoOp"])])
        self.assertEqual([(a.name, a.points, a.modes) for a in sounds.areas],
                         [("turbinehum", [[1177.11, 24.64, -564.382]], ["Conquest", "CoOp"])])

    def test_the_child_s_height_is_carried(self) -> None:
        library = self._turbine_library()
        library.add_con("Objects/Objectives/Mast/Objects.con", """
ObjectTemplate.create Bundle Mast
ObjectTemplate.addTemplate turbinehum
ObjectTemplate.setPosition 0/15/0
""")
        inst = StaticInstance("Mast", (10.0, 5.0, 20.0), (0.0, 0.0, 0.0))
        sounds = discover_level_sounds(self.FILES, [inst], library, None)
        self.assertEqual([a.points for a in sounds.areas], [[[10.0, 20.0, -20.0]]])

    def test_a_child_the_library_knows_is_left_to_the_building_walk(self) -> None:
        library = self._turbine_library()
        library.add_con("Objects/Sounds/Objects.con",
                        "ObjectTemplate.create SimpleObject turbinehum\n")
        inst = StaticInstance("TurbinesOrginal", (1.0, 2.0, 3.0), (0.0, 0.0, 0.0))
        sounds = discover_level_sounds(self.FILES, [inst], library, None)
        self.assertEqual(sounds.areas, [])

    def test_the_report_writes_modes_only_when_there_are_some(self) -> None:
        from bf42.level import LevelSounds, PlacedAreaSound
        from bf42.rfa import ArchivePool
        import tempfile
        info = LevelInfo(name="x", terrain=TerrainInfo())
        info.sounds = LevelSounds(areas=[
            PlacedAreaSound(name="a", file="Sound/a.wav"),
            PlacedAreaSound(name="b", file="Sound/b.wav", modes=["Ctf"]),
        ])
        files = _FakeFiles({"Sound/a.wav": "RIFF", "Sound/b.wav": "RIFF"})
        with tempfile.TemporaryDirectory() as tmp:
            report = extract_map.extract_sounds(
                info, files, ArchivePool(), Path(tmp) / "lvl",
                audio_format="wav")
        by_name = {a["name"]: a for a in report["areas"]}
        self.assertNotIn("modes", by_name["a"])
        self.assertEqual(by_name["b"]["modes"], ["Ctf"])


class _Assembler:
    """What `build_scene`'s object pass asks of an `Assembler`: one empty
    node per placement, named after the template."""

    include_collision = False
    meshes = None

    def __init__(self, library) -> None:
        self.library = library

    def begin_animations(self) -> None:
        pass

    def flush_animations(self, builder) -> int:
        return 0

    def build_node(self, builder, name, report, *, position, rotation, world_origin):
        from bf42 import gltf
        if self.library.object(name) is None:
            return None
        return builder.add_node(gltf.Node(name=name, translation=tuple(position)))


def _glb_nodes(glb: bytes) -> list[dict]:
    length = struct.unpack("<I", glb[12:16])[0]
    return json.loads(glb[20:20 + length]).get("nodes", [])


class BuildSceneTests(unittest.TestCase):

    def _bake(self, info):
        from bf42.level import Heightmap
        heightmap = Heightmap(dim=2, spacing=1.0, y_scale=1.0, samples=[0] * 4)
        return extract_map.build_scene(
            _hellendoorn(), info, heightmap, _Assembler(LIBRARY),
            max_texture=64, include_objects=True)

    def test_the_bake_places_and_tags_the_mode_statics(self) -> None:
        info = _info(_hellendoorn(), ["Conquest", "ObjectiveMode", "Ctf"])
        glb, report = self._bake(info)
        v2 = [n for n in _glb_nodes(glb) if n["name"] == "Hellendoorn_V2Orginal"]
        self.assertEqual(len(v2), 2)
        self.assertEqual([n["extras"]["modes"] for n in v2], [["Conquest", "Ctf"]] * 2)
        self.assertEqual(report["objects"]["modeStatics"],
                         {"placed": 2, "files": ["conquest/additionalstaticobjects.con"]})
        # `placed` stays StaticObjects.con's count, which `maps.json` carries.
        self.assertEqual(report["objects"]["placed"], 0)
        self.assertEqual(report["objects"]["skipped"], [])

    def test_a_level_without_any_reports_nothing_new(self) -> None:
        info = _info(_FakeFiles({"GameTypes/Conquest.con": "",
                                 "Conquest.con": "run Conquest/ObjectSpawns\n"}),
                     ["Conquest"])
        _glb, report = self._bake(info)
        self.assertNotIn("modeStatics", report["objects"])


class SecretWeaponsArchiveTests(unittest.TestCase):
    """The four shipped levels, read from the installed Secret Weapons."""

    @classmethod
    def setUpClass(cls) -> None:
        if not GAME_DIR.is_dir():
            raise unittest.SkipTest("the game is not installed")
        from extract_models import build_library, build_pools, mod_chain
        chain = mod_chain(GAME_DIR, "XPack2")
        if not chain or chain[0].name.lower() != "xpack2":
            raise unittest.SkipTest("Secret Weapons is not installed")
        cls.chain = chain
        _m, _t, objects, _g = build_pools(chain, [])
        cls.library = build_library(objects)

    def rows(self, level: str):
        _files, info, _hm, _paths = extract_map.load_level(
            GAME_DIR, "XPack2", level, self.chain)
        return [(i.template, i.source, m)
                for i, m in extract_map.union_mode_statics(info, self.library)]

    def test_hellendoorn_parks_four_v2s_outside_objectivemode(self) -> None:
        self.assertEqual(self.rows("Hellendoorn"), [
            ("Hellendoorn_V2Orginal", "Conquest/AdditionalStaticObjects.con",
             ["Conquest", "Ctf", "Tdm", "CoOp"])] * 4)

    def test_kbely_airfield_parks_its_two_prototypes(self) -> None:
        self.assertEqual([r[0] for r in self.rows("Kbely_Airfield")],
                         ["KBely_UFOOrginal"] * 2)

    def test_mimoyecques_sinks_three_shafts_in_conquest_and_coop(self) -> None:
        self.assertEqual(self.rows("Mimoyecques"), [
            ("V3_Shaft_m1", "Conquest/AdditionalStaticObjects.con",
             ["Conquest", "CoOp"])] * 3)

    def test_telemark_s_turbines_come_from_a_root_level_file(self) -> None:
        self.assertEqual(self.rows("Telemark"), [
            ("Telemark_TurbinesOrginal", "AdditionalStaticObjects.con",
             ["Conquest", "Ctf", "Tdm", "CoOp"])] * 2)

    def test_a_level_without_any_has_none(self) -> None:
        # Peenemunde's scripts create nothing beyond the layer files and
        # its CTF bases.
        self.assertEqual(self.rows("Peenemunde"), [])


if __name__ == "__main__":
    unittest.main()
