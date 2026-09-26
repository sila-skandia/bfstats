"""Game modes: reading every layer a level ships, and the `scene.json` schema.

A BF1942 level archive carries one directory per game mode -- `Conquest/`,
`SinglePlayer/`, `Ctf/`, `Tdm/`, `ObjectiveMode/` -- and the extractor read
exactly one, whichever `find_gameplay_mode` hit first. These tests pin the four
things that changed:

  * `find_gameplay_modes` lists them all, and its first entry is still exactly
    what `find_gameplay_mode` returns, so the default cannot drift;
  * `GameTypes/<x>.con` is the authority on which layer a game type loads,
    which is not always the file's own name -- `CoOp` loads `SinglePlayer/`
    and no vanilla level ships a `CoOp/` directory at all;
  * `union_object_spawns` / `union_control_points` collapse the layers into
    one set of scene nodes tagged by mode, so the glb carries each pad once;
  * the report gains `modes` and `gameTypes` and changes nothing else.

The measurements quoted in the assertions come from a sweep of the 1,302 level
archives of the 18 installed mods; the script is
`features/bf1942-3d-models/game-modes.md`.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402

from bf42.level import (  # noqa: E402
    GameplayObjects,
    LevelInfo,
    SpawnTemplate,
    StaticInstance,
    TerrainInfo,
    find_gameplay_mode,
    find_gameplay_modes,
    load_game_types,
    compose_game_type_layers,
    load_gameplay_objects,
    parse_game_type,
    tickets_for_mode,
)

GAME_DIR = Path("~/.wine/drive_c/EA Games/Battlefield 1942").expanduser()


# Wake's own `GameTypes/CoOp.con`, trimmed. The point of the file: it is named
# CoOp and every layer file it runs is SinglePlayer's.
WAKE_COOP = """
Game.setNumberOfTickets 1 140
Game.setNumberOfTickets 2 100
Game.setTicketLostPerMin 1 15
Game.setTicketLostPerMin 2 10000

run SinglePlayer/SoldierSpawnTemplates
run SinglePlayer/SoldierSpawns
run SinglePlayer/SpawnpointManagerSettings
run SinglePlayer/ObjectSpawnTemplates
run SinglePlayer/ControlPointTemplates

if v_arg1 == host
run ai
run SinglePlayer/ObjectSpawns
run SinglePlayer/ControlPoints
endIf
"""

WAKE_CONQUEST = """
Game.setNumberOfTickets 2 100
Game.setNumberOfTickets 1 100
Game.setTicketLostPerMin 2 30
Game.setTicketLostPerMin 1 5

run Conquest/SpawnpointManagerSettings
run Conquest/SoldierSpawnTemplates
run Conquest/SoldierSpawns
run Conquest/ObjectSpawnTemplates
run Conquest/ControlPointTemplates
if v_arg1 == host
	run Conquest/ObjectSpawns
 	run Conquest/ControlPoints
endIf
"""

# CTF is decided on flag captures, so its script sets no ticket count at all.
WAKE_CTF = """
run Ctf/SpawnpointManagerSettings
run Ctf/SoldierSpawnTemplates
run Ctf/SoldierSpawns
run Ctf/ObjectSpawnTemplates
run Ctf/ControlPointTemplates
run Ctf/ObjectSpawns v_arg1
run Ctf/ControlPoints v_arg1
"""


class GameTypeParsingTests(unittest.TestCase):
    """`GameTypes/<x>.con` says which layer directory it loads."""

    def test_coop_loads_the_singleplayer_layer(self) -> None:
        gt = parse_game_type(WAKE_COOP, "CoOp")
        self.assertEqual(gt.mode, "SinglePlayer")
        self.assertEqual(gt.name, "CoOp")

    def test_coop_tickets_are_the_coop_script_s_own(self) -> None:
        gt = parse_game_type(WAKE_COOP, "CoOp")
        self.assertEqual((gt.tickets.team1, gt.tickets.team2), (140, 100))
        self.assertEqual(gt.tickets.loss_per_min_team1, 15)
        # 10,000 a minute: the CoOp script ends the round the moment the
        # human side loses its last flag.
        self.assertEqual(gt.tickets.loss_per_min_team2, 10000)
        # The record names the game type, because there is no
        # `GameTypes/SinglePlayer.con` these numbers could have come from.
        self.assertEqual(gt.tickets.mode, "CoOp")

    def test_conquest_loads_the_conquest_layer(self) -> None:
        gt = parse_game_type(WAKE_CONQUEST, "Conquest")
        self.assertEqual(gt.mode, "Conquest")
        self.assertEqual((gt.tickets.team1, gt.tickets.team2), (100, 100))

    def test_a_script_that_sets_no_tickets_reports_none(self) -> None:
        self.assertIsNone(parse_game_type(WAKE_CTF, "Ctf").tickets)

    def test_the_directory_casing_is_canonicalised(self) -> None:
        # Shipped spellings vary: `run singleplayer/...` on some levels,
        # `run SinglePlayer/...` on others.
        self.assertEqual(parse_game_type("run singleplayer/Bots", "X").mode,
                         "SinglePlayer")

    def test_a_bare_run_does_not_name_a_layer(self) -> None:
        self.assertEqual(parse_game_type("run ai\nrun ../shared", "X").mode, "")

    def test_the_most_run_directory_wins(self) -> None:
        # Real shape: a CoOp script that also re-runs one Conquest file.
        text = ("run Conquest/ControlPoints\n"
                "run SinglePlayer/SoldierSpawns\n"
                "run SinglePlayer/ObjectSpawns\n")
        self.assertEqual(parse_game_type(text, "CoOp").mode, "SinglePlayer")

    def test_commented_runs_are_not_counted(self) -> None:
        text = ("rem run Tdm/ControlPoints\n"
                "beginrem\nrun Ctf/ControlPoints\nendrem\n"
                "run Conquest/ControlPoints\n")
        self.assertEqual(parse_game_type(text, "Conquest").mode, "Conquest")


class WakeArchiveTests(unittest.TestCase):
    """Against the shipped Wake archive, which has four layers and three
    game types -- including a `Tdm/` directory no game type ever runs."""

    @classmethod
    def setUpClass(cls) -> None:
        if not GAME_DIR.is_dir():
            raise unittest.SkipTest("the game is not installed")
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from extract_models import mod_chain
        from bf42.level import find_level_archives, load_level_files
        chain = mod_chain(GAME_DIR, "bf1942")
        paths = find_level_archives(GAME_DIR, "bf1942", "Wake", chain=chain)
        if not paths:
            raise unittest.SkipTest("Wake.rfa is not installed")
        cls.files = load_level_files(paths, "Wake")

    def test_wake_ships_four_layers(self) -> None:
        self.assertEqual(find_gameplay_modes(self.files),
                         ["Conquest", "Ctf", "Tdm", "SinglePlayer"])

    def test_the_first_layer_is_the_default_mode(self) -> None:
        """The guarantee that keeps every old caller reading what it read."""
        self.assertEqual(find_gameplay_modes(self.files)[0],
                         find_gameplay_mode(self.files))

    def test_wake_offers_three_game_types(self) -> None:
        types = load_game_types(self.files)
        self.assertEqual({name: gt.mode for name, gt in types.items()},
                         {"Conquest": "Conquest", "CoOp": "SinglePlayer",
                          "Ctf": "Ctf"})

    def test_wake_s_tdm_directory_is_shipped_but_never_run(self) -> None:
        # It is in the archive with five control points and 30 vehicle pads,
        # and no `GameTypes/Tdm.con` or root `Tdm.con` loads it. Extracted
        # anyway: the data is there and the page can show it.
        self.assertIn("Tdm", find_gameplay_modes(self.files))
        self.assertNotIn("Tdm", load_game_types(self.files))
        self.assertEqual(len(load_gameplay_objects(self.files, "Tdm").control_points), 5)

    def test_singleplayer_tickets_come_from_the_coop_script(self) -> None:
        # The root `Coop.con` the server runs (100 / 100, in both wake.rfa and
        # the wake_003.rfa patch), not `GameTypes/Coop.con` (140 / 100). The
        # parity lab's server starts a 32-player Wake co-op round at 200 / 200,
        # which is the root's 100 scaled by 32 / 16 (ledger TKT-1, TKT-3).
        types = load_game_types(self.files)
        tickets = tickets_for_mode(types, "SinglePlayer")
        self.assertEqual((tickets.team1, tickets.team2), (100, 100))
        self.assertEqual((tickets.loss_per_min_team1, tickets.loss_per_min_team2), (15, 10000))
        self.assertEqual(tickets.mode, "CoOp")
        self.assertTrue(types["CoOp"].source.lower().endswith("/wake/coop.con"),
                        types["CoOp"].source)

    def test_the_gametypes_copy_is_not_what_runs(self) -> None:
        # The file the old reading took, still in the archive with its own
        # numbers: what `load_game_types` must not report.
        hit = self.files.find("GameTypes/Coop.con")
        stale = parse_game_type(self.files.read(hit).decode("latin-1"), "CoOp")
        self.assertEqual((stale.tickets.team1, stale.tickets.team2), (140, 100))

    def test_a_layer_no_game_type_runs_has_no_tickets(self) -> None:
        self.assertIsNone(tickets_for_mode(load_game_types(self.files), "Tdm"))

    def test_singleplayer_moves_the_beach_flag_and_shrinks_its_radius(self) -> None:
        conquest = load_gameplay_objects(self.files, "Conquest")
        single = load_gameplay_objects(self.files, "SinglePlayer")
        cq = next(i for i in conquest.control_points
                  if i.template.lower() == "the_beach")
        sp = next(i for i in single.control_points
                  if i.template.lower() == "the_beach")
        self.assertNotEqual([round(v, 1) for v in cq.position],
                            [round(v, 1) for v in sp.position])
        self.assertEqual(round(sp.position[2], 1), 762.0)
        self.assertEqual(round(cq.position[2], 1), 715.0)
        self.assertEqual(conquest.template_for(cq).radius, 50.0)
        self.assertEqual(single.template_for(sp).radius, 25.0)

    def test_tdm_hands_the_beach_to_the_other_side(self) -> None:
        conquest = load_gameplay_objects(self.files, "Conquest")
        tdm = load_gameplay_objects(self.files, "Tdm")

        def team(layer):
            inst = next(i for i in layer.control_points
                        if i.template.lower() == "the_beach")
            tpl = layer.template_for(inst)
            return inst.team if inst.team is not None else tpl.team

        self.assertEqual(team(conquest), 2)
        self.assertEqual(team(tdm), 1)

    def test_singleplayer_doubles_the_soldier_spawns(self) -> None:
        self.assertEqual(
            len(load_gameplay_objects(self.files, "Conquest").soldier_spawns), 17)
        self.assertEqual(
            len(load_gameplay_objects(self.files, "SinglePlayer").soldier_spawns), 35)

    def test_ctf_keeps_one_flag_of_five(self) -> None:
        self.assertEqual(
            len(load_gameplay_objects(self.files, "Ctf").control_points), 1)

    def test_every_layer_brings_its_own_vehicle_set(self) -> None:
        counts = {mode: len(load_gameplay_objects(self.files, mode).object_spawns)
                  for mode in find_gameplay_modes(self.files)}
        self.assertEqual(counts, {"Conquest": 32, "Ctf": 26, "Tdm": 30,
                                  "SinglePlayer": 23})

    def test_the_layer_carries_its_own_object_spawn_templates(self) -> None:
        # `extract_map` used to read these two files itself for one mode.
        layer = load_gameplay_objects(self.files, "SinglePlayer")
        self.assertTrue(layer.object_spawn_templates)
        self.assertTrue(layer.object_spawns)

    def test_a_level_with_no_layers_at_all_yields_an_empty_list(self) -> None:
        empty = load_gameplay_objects(self.files, None)
        self.assertEqual(empty.mode, "Conquest")


def _inst(template: str, x: float, z: float, team=None) -> StaticInstance:
    return StaticInstance(template, (x, 0.0, z), (0.0, 0.0, 0.0), team=team)


def _spawner(name: str, vehicle: str, minimum=None, maximum=None) -> SpawnTemplate:
    tpl = SpawnTemplate(name=name)
    tpl.vehicles[1] = vehicle
    tpl.vehicles[2] = vehicle
    tpl.min_spawn_delay = minimum
    tpl.max_spawn_delay = maximum
    return tpl


def _layer(mode, *, spawns=(), specs=(), points=()) -> GameplayObjects:
    return GameplayObjects(
        mode=mode,
        object_spawns=list(spawns),
        object_spawn_templates={s.name.lower(): s for s in specs},
        control_points=list(points),
    )


class UnionTests(unittest.TestCase):
    """The glb holds one node per pad, not one per mode."""

    def _info(self, modes) -> LevelInfo:
        info = LevelInfo(name="T", terrain=TerrainInfo())
        info.modes = modes
        return info

    def test_a_pad_two_modes_share_becomes_one_node_tagged_twice(self) -> None:
        spec = _spawner("pad", "Willy", 30, 30)
        info = self._info({
            "Conquest": _layer("Conquest", spawns=[_inst("pad", 10, 20)],
                               specs=[spec]),
            "Tdm": _layer("Tdm", spawns=[_inst("pad", 10, 20)], specs=[spec]),
        })
        union = extract_map.union_object_spawns(info)
        self.assertEqual(len(union), 1)
        self.assertEqual(union[0][1], "Willy")
        self.assertEqual(union[0][3], ["Conquest", "Tdm"])
        # Agreed windows need no per-mode table.
        self.assertEqual(union[0][4], {})

    def test_a_pad_only_one_mode_parks_is_tagged_only_for_it(self) -> None:
        info = self._info({
            "Conquest": _layer("Conquest", spawns=[_inst("a", 10, 20)],
                               specs=[_spawner("a", "Willy")]),
            "SinglePlayer": _layer("SinglePlayer", spawns=[_inst("b", 90, 90)],
                                   specs=[_spawner("b", "Chi-Ha")]),
        })
        union = extract_map.union_object_spawns(info)
        self.assertEqual([(u[1], u[3]) for u in union],
                         [("Willy", ["Conquest"]), ("Chi-Ha", ["SinglePlayer"])])

    def test_the_default_mode_s_pads_come_first_in_its_own_order(self) -> None:
        """So a scene with no `?mode=` holds the nodes it always held."""
        info = self._info({
            "Conquest": _layer("Conquest",
                               spawns=[_inst("a", 1, 1), _inst("b", 2, 2)],
                               specs=[_spawner("a", "A"), _spawner("b", "B")]),
            "Tdm": _layer("Tdm", spawns=[_inst("c", 3, 3), _inst("a", 1, 1)],
                          specs=[_spawner("a", "A"), _spawner("c", "C")]),
        })
        self.assertEqual([u[1] for u in extract_map.union_object_spawns(info)],
                         ["A", "B", "C"])

    def test_modes_that_time_a_pad_differently_get_a_per_mode_table(self) -> None:
        info = self._info({
            "Conquest": _layer("Conquest", spawns=[_inst("p", 5, 5)],
                               specs=[_spawner("p", "humvee", 40, 80)]),
            "Tdm": _layer("Tdm", spawns=[_inst("p", 5, 5)],
                          specs=[_spawner("p", "humvee", 70, 110)]),
        })
        _, _, _, modes, windows = extract_map.union_object_spawns(info)[0]
        self.assertEqual(modes, ["Conquest", "Tdm"])
        self.assertEqual(windows, {"Conquest": (40.0, 80.0), "Tdm": (70.0, 110.0)})

    def test_a_spawner_that_spawns_nothing_is_not_in_the_union(self) -> None:
        info = self._info({"Conquest": _layer(
            "Conquest", spawns=[_inst("ghost", 1, 1)], specs=[])})
        self.assertEqual(extract_map.union_object_spawns(info), [])

    def test_the_same_flag_with_two_owners_is_two_nodes(self) -> None:
        """Wake's beach flag opens Japanese in Conquest and American in Tdm,
        and the cloth baked onto the pole is chosen by team -- so one node
        cannot serve both."""
        info = self._info({
            "Conquest": _layer("Conquest", points=[_inst("beach", 5, 5, team=2)]),
            "Tdm": _layer("Tdm", points=[_inst("beach", 5, 5, team=1)]),
        })
        union = extract_map.union_control_points(info)
        self.assertEqual([(u[0].team, u[2]) for u in union],
                         [(2, ["Conquest"]), (1, ["Tdm"])])

    def test_a_flag_two_modes_agree_on_is_one_node(self) -> None:
        info = self._info({
            "Conquest": _layer("Conquest", points=[_inst("base", 5, 5, team=1)]),
            "Ctf": _layer("Ctf", points=[_inst("base", 5, 5, team=1)]),
        })
        union = extract_map.union_control_points(info)
        self.assertEqual(len(union), 1)
        self.assertEqual(union[0][2], ["Conquest", "Ctf"])

    def test_a_flag_that_moved_between_modes_is_two_nodes(self) -> None:
        info = self._info({
            "Conquest": _layer("Conquest", points=[_inst("beach", 5, 715, team=2)]),
            "SinglePlayer": _layer("SinglePlayer",
                                   points=[_inst("beach", 5, 762, team=2)]),
        })
        self.assertEqual(len(extract_map.union_control_points(info)), 2)

    def test_poses_agree_to_a_centimetre(self) -> None:
        spec = _spawner("p", "Willy")
        info = self._info({
            "Conquest": _layer("Conquest", spawns=[_inst("p", 10.0001, 20.0)],
                               specs=[spec]),
            "Tdm": _layer("Tdm", spawns=[_inst("p", 10.0, 20.0)], specs=[spec]),
        })
        self.assertEqual(len(extract_map.union_object_spawns(info)), 1)


class ModesReportTests(unittest.TestCase):
    """`scene.json.modes`: one entry per layer, six keys, nothing else."""

    def _info(self) -> LevelInfo:
        from bf42.level import ControlPointTemplate, GameType
        info = LevelInfo(name="T", terrain=TerrainInfo())
        flag = ControlPointTemplate(name="base")
        flag.team = 1
        flag.radius = 50.0
        conquest = _layer("Conquest", points=[_inst("base", 5, 5, team=2)],
                          spawns=[_inst("pad", 1, 1)],
                          specs=[_spawner("pad", "Willy", 30, 30)])
        conquest.control_point_templates = {"base": flag}
        single = _layer("SinglePlayer", points=[_inst("base", 5, 5, team=1)])
        single.control_point_templates = {"base": flag}
        info.modes = {"Conquest": conquest, "SinglePlayer": single}
        # What `load_level` does: the legacy fields are the default layer.
        info.gameplay = conquest
        info.spawn_objects = conquest.object_spawns
        info.spawn_templates = conquest.object_spawn_templates
        info.game_types = {
            "Conquest": GameType(name="Conquest", mode="Conquest"),
            "CoOp": GameType(name="CoOp", mode="SinglePlayer"),
        }
        return info

    def test_one_entry_per_layer(self) -> None:
        out = extract_map._modes_report(self._info(), None, None, {})
        self.assertEqual(sorted(out), ["Conquest", "SinglePlayer"])

    def test_every_entry_carries_the_same_six_keys(self) -> None:
        out = extract_map._modes_report(self._info(), None, None, {})
        for name, entry in out.items():
            with self.subTest(name):
                self.assertEqual(sorted(entry), [
                    "combatArea", "controlPoints", "gameTypes", "objectSpawns",
                    "soldierSpawns", "tickets", "vehicleSoldierSpawns",
                ])

    def test_an_entry_names_the_game_types_that_load_it(self) -> None:
        out = extract_map._modes_report(self._info(), None, None, {})
        self.assertEqual(out["Conquest"]["gameTypes"], ["Conquest"])
        self.assertEqual(out["SinglePlayer"]["gameTypes"], ["CoOp"])

    def test_the_default_entry_is_the_top_level_report(self) -> None:
        """What makes "no ?mode=" and "before this change" the same picture."""
        info = self._info()
        out = extract_map._modes_report(info, None, None, {})
        self.assertEqual(out["Conquest"]["controlPoints"],
                         extract_map._control_point_report(info, None))
        self.assertEqual(out["Conquest"]["objectSpawns"],
                         extract_map._object_spawn_report(info))
        self.assertEqual(out["Conquest"]["soldierSpawns"],
                         extract_map._soldier_spawn_report(info))

    def test_each_layer_reports_its_own_flag_owner(self) -> None:
        out = extract_map._modes_report(self._info(), None, None, {})
        self.assertEqual(out["Conquest"]["controlPoints"][0]["team"], 2)
        self.assertEqual(out["SinglePlayer"]["controlPoints"][0]["team"], 1)

    def test_a_layer_with_no_fleet_gets_an_empty_list_not_the_default_s(self) -> None:
        out = extract_map._modes_report(
            self._info(), None, None, {"Conquest": [{"vehicle": "shokaku"}]})
        self.assertEqual(out["Conquest"]["vehicleSoldierSpawns"],
                         [{"vehicle": "shokaku"}])
        self.assertEqual(out["SinglePlayer"]["vehicleSoldierSpawns"], [])

    def test_the_level_wide_combat_area_is_written_on_every_layer(self) -> None:
        area = {"min": [0, 0, 0], "max": [512, 0, -512]}
        out = extract_map._modes_report(self._info(), None, area, {})
        self.assertEqual(out["Conquest"]["combatArea"], area)
        self.assertEqual(out["SinglePlayer"]["combatArea"], area)


class TicketReportTests(unittest.TestCase):
    def test_a_layer_with_no_tickets_reports_none(self) -> None:
        self.assertIsNone(extract_map._tickets_report(None))

    def test_a_ticket_record_keeps_the_shape_the_hud_reads(self) -> None:
        from bf42.level import TicketInfo
        out = extract_map._tickets_report(
            TicketInfo(mode="CoOp", team1=140, team2=100,
                       loss_per_min_team1=15, loss_per_min_team2=10000))
        self.assertEqual(out, {"mode": "CoOp", "team1": 140, "team2": 100,
                               "lossPerMin": {"team1": 15, "team2": 10000}})

    def test_a_half_declared_record_omits_what_it_does_not_have(self) -> None:
        from bf42.level import TicketInfo
        out = extract_map._tickets_report(TicketInfo(mode="ObjectiveMode", team1=100))
        self.assertEqual(out, {"mode": "ObjectiveMode", "team1": 100})


# Road to Rome's Anzio `GameTypes/CoOp.con`, trimmed to its run lines. The
# point of this file: `run` is per FILE, so the flags come out of `Conquest/`
# while everything else comes out of `SinglePlayer/`. No directory holds this
# layout, so no directory can name it.
ANZIO_COOP = """
Game.setNumberOfTickets 1 120
Game.setNumberOfTickets 2 100

run SinglePlayer/SoldierSpawnTemplates
run SinglePlayer/SoldierSpawns
run SinglePlayer/SpawnpointManagerSettings
run SinglePlayer/ObjectSpawnTemplates
run Conquest/ControlPointTemplates

if v_arg1 == host
run ai
run SinglePlayer/ObjectSpawns
run Conquest/ControlPoints
rem object.create redBase
else
rem object.create flagPole
endIf
"""


class SplitLayerGameTypeTests(unittest.TestCase):
    """A game type whose `run` lines straddle two layer directories.

    35 of the 3,048 GameTypes scripts across the 18 installed mods do this --
    all 6 Road to Rome CoOp scripts, 8 of Secret Weapons' 9, and 21 across
    Forgotten Hope, FHSW and bf1918. None in vanilla, which is why a
    directory-keyed reading looked complete.
    """

    def test_the_directory_of_each_layer_file_is_recorded(self) -> None:
        gt = parse_game_type(ANZIO_COOP, "CoOp")
        self.assertEqual(gt.files["soldierspawns"], "SinglePlayer")
        self.assertEqual(gt.files["objectspawns"], "SinglePlayer")
        self.assertEqual(gt.files["controlpoints"], "Conquest")
        self.assertEqual(gt.files["controlpointtemplates"], "Conquest")

    def test_a_split_script_is_composed(self) -> None:
        self.assertTrue(parse_game_type(ANZIO_COOP, "CoOp").composed)

    def test_a_single_directory_script_is_not_composed(self) -> None:
        self.assertFalse(parse_game_type(WAKE_COOP, "CoOp").composed)

    def test_bare_runs_do_not_make_a_script_composed(self) -> None:
        gt = parse_game_type("run ai\nrun SinglePlayer/ControlPoints\n", "CoOp")
        self.assertFalse(gt.composed)
        self.assertEqual(gt.files, {"controlpoints": "SinglePlayer"})

    def test_a_composed_game_type_gets_a_layer_of_its_own(self) -> None:
        files = _FakeFiles({
            "Conquest/ControlPoints.con": _flag("base", 1),
            "SinglePlayer/ControlPoints.con": _flag("other", 2),
            "SinglePlayer/SoldierSpawns.con": _spawn("sp"),
            "Conquest/SoldierSpawns.con": _spawn("cq"),
        })
        types = {"CoOp": parse_game_type(ANZIO_COOP, "CoOp")}
        layers = {"Conquest": load_gameplay_objects(files, "Conquest"),
                  "SinglePlayer": load_gameplay_objects(files, "SinglePlayer")}
        compose_game_type_layers(files, types, layers)
        self.assertIn("CoOp", layers)
        # The engine's answer: Conquest's flags, SinglePlayer's spawns.
        self.assertEqual([c.template for c in layers["CoOp"].control_points],
                         ["base"])
        self.assertEqual([s.template for s in layers["CoOp"].soldier_spawns],
                         ["sp"])
        # And the game type now points at its own layer, so the per-layer
        # `gameTypes` list, the ticket lookup and `?mode=CoOp` all agree.
        self.assertEqual(types["CoOp"].mode, "CoOp")

    def test_an_unsplit_game_type_gets_no_extra_layer(self) -> None:
        files = _FakeFiles({"SinglePlayer/ControlPoints.con": _flag("base", 1)})
        types = {"CoOp": parse_game_type(WAKE_COOP, "CoOp")}
        layers = {"SinglePlayer": load_gameplay_objects(files, "SinglePlayer")}
        compose_game_type_layers(files, types, layers)
        self.assertEqual(list(layers), ["SinglePlayer"])
        self.assertEqual(types["CoOp"].mode, "SinglePlayer")

    def test_sources_override_the_directory_per_file(self) -> None:
        files = _FakeFiles({
            "Conquest/ControlPoints.con": _flag("cqflag", 1),
            "SinglePlayer/ControlPoints.con": _flag("spflag", 2),
            "SinglePlayer/SoldierSpawns.con": _spawn("spspawn"),
        })
        out = load_gameplay_objects(files, "SinglePlayer",
                                    sources={"controlpoints": "Conquest"})
        self.assertEqual([c.template for c in out.control_points], ["cqflag"])
        self.assertEqual([s.template for s in out.soldier_spawns], ["spspawn"])


def _flag(name: str, team: int) -> str:
    return (f"Object.create {name}\n"
            "Object.absolutePosition 10/0/10\n"
            "Object.rotation 0/0/0\n"
            f"Object.setTeam {team}\n")


def _spawn(name: str) -> str:
    return (f"Object.create {name}\n"
            "Object.absolutePosition 5/0/5\n"
            "Object.rotation 0/0/0\n")


class _FakeFiles:
    """The `LevelFiles` methods `load_gameplay_objects` and `load_game_types`
    use."""

    def __init__(self, blobs: dict[str, str]) -> None:
        self._blobs = {k.lower(): v for k, v in blobs.items()}

    def find(self, rel: str):
        return rel.lower() if rel.lower() in self._blobs else None

    def read(self, key: str) -> bytes:
        return self._blobs[key].encode("latin-1")

    def under(self, directory: str) -> list[str]:
        prefix = directory.lower().strip("/") + "/"
        return sorted(k for k in self._blobs
                      if k.startswith(prefix) and "/" not in k[len(prefix):])


class GameTypeScriptTests(unittest.TestCase):
    """Which script a game type is read from: the level's root `<name>.con`,
    because that is what the dedicated server runs (`Game::load` 0x0805b4b0
    runs `bf1942/levels/<level>/` + the bare `coop.con` that
    `Setup::startHostGame` hands it). `GameTypes/` only says the game type
    exists. Ledger TKT-3."""

    ROOT = WAKE_COOP.replace("1 140", "1 100")

    def test_the_root_script_is_read(self) -> None:
        files = _FakeFiles({"Coop.con": self.ROOT, "GameTypes/Coop.con": WAKE_COOP})
        types = load_game_types(files)
        self.assertEqual(list(types), ["CoOp"])
        self.assertEqual((types["CoOp"].tickets.team1, types["CoOp"].tickets.team2), (100, 100))
        self.assertEqual(types["CoOp"].source, "coop.con")

    def test_gametypes_is_what_says_a_game_type_exists(self) -> None:
        # A root script with no GameTypes/ entry is not a game type the level
        # offers: the menu does not list it and the server will not queue it.
        files = _FakeFiles({"Coop.con": self.ROOT, "Ctf.con": WAKE_CTF,
                            "GameTypes/Coop.con": WAKE_COOP})
        self.assertEqual(list(load_game_types(files)), ["CoOp"])

    def test_no_root_script_falls_back_to_gametypes(self) -> None:
        files = _FakeFiles({"GameTypes/Coop.con": WAKE_COOP})
        types = load_game_types(files)
        self.assertEqual(types["CoOp"].tickets.team1, 140)
        self.assertEqual(types["CoOp"].source, "gametypes/coop.con")

    def test_the_root_scripts_layer_files_are_the_ones_composed(self) -> None:
        # Road to Rome's Anzio: the root `Coop.con` takes the vehicles from
        # Conquest/ and the flags from SinglePlayer/, the reverse of its
        # GameTypes/ copy (ANZIO_COOP).
        root = ANZIO_COOP.replace("run SinglePlayer/ObjectSpawnTemplates",
                                  "run Conquest/ObjectSpawnTemplates") \
                         .replace("run SinglePlayer/ObjectSpawns", "run Conquest/ObjectSpawns") \
                         .replace("run Conquest/ControlPointTemplates",
                                  "run SinglePlayer/ControlPointTemplates") \
                         .replace("run Conquest/ControlPoints", "run SinglePlayer/ControlPoints")
        files = _FakeFiles({"Coop.con": root, "GameTypes/Coop.con": ANZIO_COOP})
        gt = load_game_types(files)["CoOp"]
        self.assertEqual(gt.files["objectspawns"], "Conquest")
        self.assertEqual(gt.files["controlpoints"], "SinglePlayer")
        self.assertTrue(gt.composed)

    def test_load_tickets_reads_the_root_script(self) -> None:
        from bf42.level import load_tickets
        files = _FakeFiles({"Conquest.con": WAKE_CONQUEST.replace("2 100", "2 90"),
                            "GameTypes/Conquest.con": WAKE_CONQUEST})
        self.assertEqual(load_tickets(files, "Conquest").team2, 90)

    def test_a_root_script_without_tickets_does_not_borrow_gametypes(self) -> None:
        # The server runs the root script and nothing else, so its silence is
        # the answer.
        from bf42.level import load_tickets
        files = _FakeFiles({"Conquest.con": WAKE_CTF, "GameTypes/Conquest.con": WAKE_CONQUEST})
        self.assertIsNone(load_tickets(files, "Conquest"))

    def test_a_script_s_own_max_players_is_read(self) -> None:
        # Kasserine Pass co-op, after its bleed lines.
        gt = parse_game_type(WAKE_COOP + "game.maxNrofPlayers 18\n", "CoOp")
        self.assertEqual(gt.tickets.max_players, 18)
        report = extract_map._tickets_report(gt.tickets)
        self.assertEqual(report["maxPlayers"], 18)
        self.assertNotIn("maxPlayers", extract_map._tickets_report(
            parse_game_type(WAKE_COOP, "CoOp").tickets))


class PackArchiveTests(unittest.TestCase):
    """The root scripts of the shipped levels where the two copies differ."""

    @classmethod
    def setUpClass(cls) -> None:
        if not GAME_DIR.is_dir():
            raise unittest.SkipTest("the game is not installed")
        from extract_models import mod_chain
        from bf42.level import find_level_archives, load_level_files

        def level(mod: str, name: str):
            paths = find_level_archives(GAME_DIR, mod, name, chain=mod_chain(GAME_DIR, mod))
            if not paths:
                raise unittest.SkipTest(f"{mod} {name} is not installed")
            return load_level_files(paths, name)
        cls.level = staticmethod(level)

    def test_kasserine_coop_sets_its_own_max_players(self) -> None:
        types = load_game_types(self.level("bf1942", "Kasserine_Pass"))
        self.assertEqual(types["CoOp"].tickets.max_players, 18)

    def test_berlin_coop_starts_the_axis_at_sixty(self) -> None:
        # Root 60 / 100; GameTypes/ says 100 / 100.
        tickets = load_game_types(self.level("bf1942", "Berlin"))["CoOp"].tickets
        self.assertEqual((tickets.team1, tickets.team2), (60, 100))

    def test_el_alamein_tdm_runs_its_own_directory(self) -> None:
        # Its GameTypes/Tdm.con runs Ctf/*; the root Tdm.con runs Tdm/*.
        gt = load_game_types(self.level("bf1942", "El_Alamein"))["Tdm"]
        self.assertEqual(gt.mode, "Tdm")


class TagModesTests(unittest.TestCase):
    """The glb tag. A node with no `modes` key is in every mode, which is how
    every scene built before this existed reads -- so a node that IS in every
    mode must not get one, or a single-layer level's glb stops being byte-
    identical to a pre-modes one for no gain at all."""

    class _Node:
        def __init__(self) -> None:
            self.extras = None

    class _Builder:
        def __init__(self) -> None:
            self.nodes = {0: TagModesTests._Node()}

        def node(self, index: int):
            return self.nodes[index]

    def test_a_node_in_every_mode_is_left_untagged(self) -> None:
        builder = self._Builder()
        extract_map._tag_modes(builder, 0, ["Conquest"], 1)
        self.assertIsNone(builder.node(0).extras)

    def test_a_node_in_some_modes_is_tagged(self) -> None:
        builder = self._Builder()
        extract_map._tag_modes(builder, 0, ["Conquest", "Tdm"], 4)
        self.assertEqual(builder.node(0).extras, {"modes": ["Conquest", "Tdm"]})

    def test_the_tag_joins_whatever_extras_the_node_already_had(self) -> None:
        builder = self._Builder()
        builder.node(0).extras = {"kind": "controlPoints"}
        extract_map._tag_modes(builder, 0, ["Ctf"], 4)
        self.assertEqual(builder.node(0).extras,
                         {"kind": "controlPoints", "modes": ["Ctf"]})

    def test_without_a_layer_count_every_node_is_tagged(self) -> None:
        # The old signature, which the flag cloths and the tests both used.
        builder = self._Builder()
        extract_map._tag_modes(builder, 0, ["Conquest"])
        self.assertEqual(builder.node(0).extras, {"modes": ["Conquest"]})


class RoadToRomeArchiveTests(unittest.TestCase):
    """Anzio, against the shipped Road to Rome archive: the root `Coop.con`
    the server runs takes the soldier spawns and the flags from
    `SinglePlayer/` and the vehicles from `Conquest/`, so its layer is neither
    directory's. (Its `GameTypes/Coop.con` has it the other way round, flags
    from `Conquest/` and vehicles from `SinglePlayer/`; that is the copy the
    server does not run. Ledger TKT-3.)"""

    @classmethod
    def setUpClass(cls) -> None:
        if not GAME_DIR.is_dir():
            raise unittest.SkipTest("the game is not installed")
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from extract_models import mod_chain
        from bf42.level import find_level_archives, load_level_files
        chain = mod_chain(GAME_DIR, "XPack1")
        if not chain:
            raise unittest.SkipTest("Road to Rome is not installed")
        paths = find_level_archives(GAME_DIR, "XPack1", "Anzio", chain=chain)
        if not paths:
            raise unittest.SkipTest("Anzio.rfa is not installed")
        cls.files = load_level_files(paths, "Anzio")

    def test_the_coop_script_straddles_two_directories(self) -> None:
        gt = load_game_types(self.files)["CoOp"]
        self.assertTrue(gt.composed)
        self.assertEqual(gt.files["controlpoints"].lower(), "singleplayer")
        self.assertEqual(gt.files["objectspawns"].lower(), "conquest")
        self.assertEqual(gt.files["soldierspawns"].lower(), "singleplayer")
        self.assertEqual((gt.tickets.team1, gt.tickets.team2), (100, 100))

    def test_the_composed_layer_flies_singleplayer_s_flags_over_conquest_s_vehicles(self) -> None:
        types = load_game_types(self.files)
        layers = {m: load_gameplay_objects(self.files, m)
                  for m in find_gameplay_modes(self.files)}
        compose_game_type_layers(self.files, types, layers)
        coop = layers["CoOp"]
        conquest = layers["Conquest"]
        single = layers["SinglePlayer"]
        self.assertEqual([c.template for c in coop.control_points],
                         [c.template for c in single.control_points])
        self.assertEqual([o.template for o in coop.object_spawns],
                         [o.template for o in conquest.object_spawns])
        self.assertEqual(len(coop.soldier_spawns), len(single.soldier_spawns))
        self.assertEqual(types["CoOp"].mode, "CoOp")


if __name__ == "__main__":
    unittest.main()
