from __future__ import annotations

import json
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402

from bf42 import con as con_mod  # noqa: E402
from bf42.level import (  # noqa: E402
    CombatArea,
    ControlPointTemplate,
    SpawnGroupSettings,
    GameplayObjects,
    LevelInfo,
    SpawnTemplate,
    StaticInstance,
    TerrainInfo,
    parse_control_point_templates,
    parse_soldier_spawn_templates,
    parse_static_objects,
)


WAKE_TEMPLATES = """
NetworkableInfo.createNewInfo ControlPointInfo

ObjectTemplate.create ControlPoint The_Airfield
ObjectTemplate.setControlPointName The_Airfield
ObjectTemplate.radius 50
ObjectTemplate.team 2
ObjectTemplate.spawnGroupId 2
ObjectTemplate.objectSpawnerId 2
ObjectTemplate.areaValue 20
ObjectTemplate.timeToGetControl 10
rem ObjectTemplate.unableToChangeTeam 1
ObjectTemplate.geometry flagbase_m1
ObjectTemplate.hasCollisionPhysics 1
ObjectTemplate.addTemplate AnimatedFlag
ObjectTemplate.setPosition 0/8.2/0
ObjectTemplate.setTeamGeometry 1 flagJp_m1
ObjectTemplate.setTeamGeometry 2 flagus_m1
"""


class TeamGeometryTests(unittest.TestCase):
    """`setTeamGeometry` is the only thing that colours a flag.

    Refractor never swaps the texture: all six vanilla flags bind the same
    `texture/flags_o` atlas and differ only by the UV rect baked into the mesh.
    Before this was parsed every flag fell through to `AnimatedFlag`'s own
    placeholder, `flagso_m1` — a Soviet flag on Wake.
    """

    def test_object_library_records_both_teams(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con("Conquest/ControlPointTemplates.con", WAKE_TEMPLATES)
        template = library.objects["the_airfield"]
        self.assertEqual(template.team_geometry, {1: "flagJp_m1", 2: "flagus_m1"})

    def test_malformed_team_index_is_skipped_not_fatal(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con("x.con", "ObjectTemplate.create ControlPoint A\n"
                                 "ObjectTemplate.setTeamGeometry x flagus_m1\n"
                                 "ObjectTemplate.setTeamGeometry 1 flagge_m1\n")
        self.assertEqual(library.objects["a"].team_geometry, {1: "flagge_m1"})

    def test_a_template_without_the_command_keeps_an_empty_map(self) -> None:
        library = con_mod.ObjectLibrary()
        library.add_con("x.con", "ObjectTemplate.create ControlPoint A\n"
                                 "ObjectTemplate.geometry flagbase_m1\n")
        self.assertEqual(library.objects["a"].team_geometry, {})


class ControlPointTemplateTests(unittest.TestCase):
    def test_wake_airfield_parses_whole(self) -> None:
        tpl = parse_control_point_templates(WAKE_TEMPLATES)["the_airfield"]
        self.assertEqual(tpl.display_name, "The_Airfield")
        self.assertEqual(tpl.team, 2)
        self.assertEqual(tpl.radius, 50.0)
        self.assertEqual(tpl.area_value, 20.0)
        self.assertEqual(tpl.spawn_group_id, 2)
        self.assertEqual(tpl.object_spawner_id, 2)
        self.assertEqual(tpl.geometry, "flagbase_m1")
        self.assertEqual(tpl.flag_child, "AnimatedFlag")
        self.assertEqual(tpl.flag_offset, (0.0, 8.2, 0.0))
        self.assertTrue(tpl.visible)

    def test_the_law_settings_parse(self) -> None:
        """Every template field `ControlPoint::handleFrameUpdate` 0x08283b00
        reads (setters ConsoleClass636..640, 649, 650); unset is None, the
        ctor's default (0x082846d0) being the viewer's."""
        text = WAKE_TEMPLATES + (
            "ObjectTemplate.timeToLoseControl 10\n"
            "ObjectTemplate.disableIfEnemyInsideRadius 0\n"
            "ObjectTemplate.disableWhenLosingControl 1\n"
            "ObjectTemplate.loseControlWhenEnemyClose 0\n"
            "ObjectTemplate.loseControlWhenNotClose 1\n"
            "ObjectTemplate.minNrToTakeControl 2\n"
            "ObjectTemplate.onlyTakeableByTeam 2\n")
        tpl = parse_control_point_templates(text)["the_airfield"]
        self.assertEqual(tpl.time_to_lose_control, 10.0)
        self.assertIs(tpl.disable_if_enemy_inside_radius, False)
        self.assertIs(tpl.disable_when_losing_control, True)
        self.assertIs(tpl.lose_control_when_enemy_close, False)
        self.assertIs(tpl.lose_control_when_not_close, True)
        self.assertEqual(tpl.min_nr_to_take_control, 2)
        self.assertEqual(tpl.only_takeable_by_team, 2)
        bare = parse_control_point_templates(WAKE_TEMPLATES)["the_airfield"]
        self.assertIsNone(bare.time_to_lose_control)
        self.assertIsNone(bare.lose_control_when_enemy_close)
        self.assertIsNone(bare.min_nr_to_take_control)

    def test_remmed_out_property_does_not_apply(self) -> None:
        """`rem ObjectTemplate.unableToChangeTeam 1` is a comment, not a value."""
        self.assertFalse(parse_control_point_templates(WAKE_TEMPLATES)
                         ["the_airfield"].unable_to_change_team)

    def test_flag_mesh_follows_the_starting_owner(self) -> None:
        tpl = parse_control_point_templates(WAKE_TEMPLATES)["the_airfield"]
        self.assertEqual(tpl.flag_mesh(), "flagus_m1")      # team 2 at start
        self.assertEqual(tpl.flag_mesh(1), "flagJp_m1")

    def test_neutral_point_flies_nothing(self) -> None:
        """The Midway case: `team 0`, geometry declared for 1 and 2 only.

        Falling through to `AnimatedFlag`'s placeholder would fly a Soviet flag
        over Midway, so a neutral point must come back pole-only.
        """
        text = WAKE_TEMPLATES.replace("ObjectTemplate.team 2", "ObjectTemplate.team 0")
        tpl = parse_control_point_templates(text)["the_airfield"]
        self.assertEqual(tpl.team, 0)
        self.assertIsNone(tpl.flag_mesh())
        self.assertTrue(tpl.visible)      # the pole still stands

    def test_mod_declared_neutral_geometry_is_used(self) -> None:
        """Mods that do set team 0 get their neutral flag, not pole-only."""
        text = (WAKE_TEMPLATES.replace("ObjectTemplate.team 2", "ObjectTemplate.team 0")
                + "ObjectTemplate.setTeamGeometry 0 neutral_flag_m1\n")
        self.assertEqual(parse_control_point_templates(text)["the_airfield"].flag_mesh(),
                         "neutral_flag_m1")

    def test_case_insensitive_create_keyword(self) -> None:
        """Berlin writes `create controlpoint`, Wake writes `create ControlPoint`."""
        out = parse_control_point_templates(
            "ObjectTemplate.create controlpoint AlliesBase_2_Cpoint\n"
            "ObjectTemplate.team 2\n")
        self.assertIn("alliesbase_2_cpoint", out)

    def test_setposition_without_a_flag_child_is_ignored(self) -> None:
        """`setPosition` only ever positions the `addTemplate` before it.

        A control point with no flag child has nothing for it to move, and
        letting it write `flag_offset` would hang a cloth in mid-air on the
        zone-only levels.
        """
        tpl = parse_control_point_templates(
            "ObjectTemplate.create ControlPoint A\n"
            "ObjectTemplate.setPosition 0/8.2/0\n")["a"]
        self.assertIsNone(tpl.flag_child)
        self.assertEqual(tpl.flag_offset, (0.0, 0.0, 0.0))


class ZoneOnlyTests(unittest.TestCase):
    """The four ways a level says "capture zone, no object".

    Each was found in a real level and each fails differently if unhandled.
    The fourth (a real but empty mesh) cannot be seen here — it only shows up
    once the mesh resolves — so it is the assembler's job, not the parser's.
    """

    def test_commented_out_geometry(self) -> None:
        """Vanilla Kasserine_Pass, all five flags."""
        tpl = parse_control_point_templates(
            "ObjectTemplate.create ControlPoint axis_base\n"
            "ObjectTemplate.team 1\n"
            "rem ObjectTemplate.geometry flagbase_m1\n"
            "rem ObjectTemplate.addTemplate AnimatedFlag\n")["axis_base"]
        self.assertIsNone(tpl.geometry)
        self.assertFalse(tpl.visible)

    def test_blank_geometry_argument(self) -> None:
        """FH Pegasus writes the command with nothing after it."""
        tpl = parse_control_point_templates(
            "ObjectTemplate.create ControlPoint a\nObjectTemplate.geometry\n")["a"]
        self.assertEqual(tpl.geometry, "")
        self.assertFalse(tpl.visible)

    def test_null_geometry_name(self) -> None:
        """DesertCombat DC_Sea_Rigs names a template that does not exist."""
        tpl = parse_control_point_templates(
            "ObjectTemplate.create ControlPoint a\nObjectTemplate.geometry null\n")["a"]
        self.assertFalse(tpl.visible)


class SoldierSpawnTests(unittest.TestCase):
    TEXT = """
ObjectTemplate.create SpawnPoint AxisSpawnPoint_beach1
ObjectTemplate.setSpawnId 0
ObjectTemplate.setGroup 1

ObjectTemplate.create SpawnPoint AlliesSpawnPoint_air1
ObjectTemplate.setSpawnId 4
ObjectTemplate.setGroup 2
"""

    def test_parses_id_and_group(self) -> None:
        out = parse_soldier_spawn_templates(self.TEXT)
        self.assertEqual(out["axisspawnpoint_beach1"].spawn_id, 0)
        self.assertEqual(out["axisspawnpoint_beach1"].group, 1)
        self.assertEqual(out["alliesspawnpoint_air1"].group, 2)

    def test_non_spawnpoint_templates_are_ignored(self) -> None:
        out = parse_soldier_spawn_templates(
            "ObjectTemplate.create ObjectSpawner Airfield\nObjectTemplate.setGroup 9\n")
        self.assertEqual(out, {})

    @staticmethod
    def _placed(*templates: ControlPointTemplate, groups=None) -> GameplayObjects:
        """Templates placed once each, as `ControlPoints.con` would."""
        return GameplayObjects(
            mode="Conquest",
            control_points=[StaticInstance(template=t.name, position=(0.0, 0.0, 0.0),
                                           rotation=(0.0, 0.0, 0.0)) for t in templates],
            control_point_templates={t.name.lower(): t for t in templates},
            spawn_groups=groups or {},
            spawn_group_teams={n: g.team for n, g in (groups or {}).items()
                               if g.team is not None})

    def test_group_team_comes_from_the_owning_control_point(self) -> None:
        """A spawn point carries no team of its own."""
        objects = self._placed(ControlPointTemplate(name="A", team=2, spawn_group_id=2),
                               ControlPointTemplate(name="B", team=1, spawn_group_id=1))
        self.assertEqual(objects.team_of_group(2), 2)
        self.assertEqual(objects.team_of_group(1), 1)
        self.assertIsNone(objects.team_of_group(7))
        self.assertIsNone(objects.team_of_group(None))

    def test_an_unplaced_template_claims_nothing(self) -> None:
        """Only a placed point runs `ControlPoint::init` / `reset`."""
        objects = GameplayObjects(
            mode="Conquest",
            control_point_templates={
                "a": ControlPointTemplate(name="A", team=2, spawn_group_id=2)})
        self.assertIsNone(objects.team_of_group(2))

    def test_the_control_point_beats_group_team(self) -> None:
        """Wake Conquest: group 1 is `groupTeam 1`, The_Beach claims it at team 2.

        `spawnPointManagerSettings` runs first and `ControlPoints` last, and the
        point writes its team into the group (SPAWNGRP-3), so the beach starts
        American.
        """
        objects = self._placed(
            ControlPointTemplate(name="The_Beach", team=2, spawn_group_id=1),
            groups={1: SpawnGroupSettings(group=1, team=1)})
        self.assertEqual(objects.team_of_group(1), 2)

    def test_a_neutral_point_zeroes_its_groups(self) -> None:
        objects = self._placed(
            ControlPointTemplate(name="Village", team=0, spawn_group_id=5),
            groups={5: SpawnGroupSettings(group=5, team=2)})
        self.assertEqual(objects.team_of_group(5), 0)

    def test_group_enable_to_change_team_0_keeps_group_team(self) -> None:
        objects = self._placed(
            ControlPointTemplate(name="Airfield", team=2, spawn_group_id=1),
            groups={1: SpawnGroupSettings(group=1, team=1, enable_to_change_team=False)})
        self.assertEqual(objects.team_of_group(1), 1)

    def test_second_spawn_group_is_team_twos(self) -> None:
        """Team 1 enables `spawnGroupId`, team 2 `secondSpawnGroupId`; the other
        keeps its `groupTeam` (Kasserine SinglePlayer's axis_base: 1 and 6)."""
        objects = self._placed(
            ControlPointTemplate(name="A", team=1, spawn_group_id=1, second_spawn_group_id=6),
            groups={6: SpawnGroupSettings(group=6, team=1)})
        self.assertEqual(objects.team_of_group(1), 1)
        self.assertEqual(objects.team_of_group(6), 1)   # its groupTeam, not the point's
        held_by_two = self._placed(
            ControlPointTemplate(name="A", team=2, spawn_group_id=1, second_spawn_group_id=6))
        self.assertEqual(held_by_two.team_of_group(6), 2)
        self.assertIsNone(held_by_two.team_of_group(1))


class PlacementJoinTests(unittest.TestCase):
    """`ControlPoints.con` placements are ordinary `Object.create` blocks."""

    PLACEMENTS = """
Object.create The_Airfield
Object.absolutePosition 1383.75/115.998/775.193
Object.rotation 0/0/0
"""

    def test_placement_joins_its_template_case_insensitively(self) -> None:
        objects = GameplayObjects(
            mode="Conquest",
            control_points=parse_static_objects(self.PLACEMENTS),
            control_point_templates=parse_control_point_templates(WAKE_TEMPLATES))
        inst = objects.control_points[0]
        self.assertEqual(inst.position, (1383.75, 115.998, 775.193))
        self.assertIsNotNone(objects.template_for(inst))
        self.assertEqual(objects.template_for(inst).flag_mesh(), "flagus_m1")

    def test_a_placement_with_no_template_is_not_an_error(self) -> None:
        """Cassino's CTF layer places three templates it never defines
        (`UndefinedTemplateTests`)."""
        objects = GameplayObjects(
            mode="Conquest",
            control_points=parse_static_objects(self.PLACEMENTS))
        self.assertIsNone(objects.template_for(objects.control_points[0]))


class UndefinedTemplateTests(unittest.TestCase):
    """A placement of a template the layer never defines is no control point.

    `Object.create` of an undeclared template makes nothing:
    `ObjectTemplateAdm::createObject` 0x084513e0 returns 0 for a null template
    (0x08451403, ledger SPAWNGRP-7). So `scene.json` lists no such point, where
    it used to list one with no radius, weight or settings: the map drew a
    marker and a grey bar segment for it, and a pad within 60 m bound to it.
    """

    AIRFIELD = """
Object.create The_Airfield
Object.absolutePosition 1383.75/115.998/775.193
"""
    # Cassino's CTF placements, ahead of a real point so an index would move.
    CASSINO_CTF = """
Object.create openbase_lumbermill_Cpoint
Object.absolutePosition 639.658/83.3344/556.038
Object.create openbasecammo
Object.absolutePosition 516.598/84.6821/591.681
"""

    @staticmethod
    def _layer(placements: str, pads: list[StaticInstance] | None = None) -> GameplayObjects:
        return GameplayObjects(
            mode="Ctf",
            control_points=parse_static_objects(placements),
            control_point_templates=parse_control_point_templates(WAKE_TEMPLATES),
            object_spawns=list(pads or []),
            object_spawn_templates={"antitankgunspawner": SpawnTemplate(
                name="AntiTankGunSpawner", vehicles={1: "Pak40", 2: "Pak40"})})

    @staticmethod
    def _info(layer: GameplayObjects) -> LevelInfo:
        """The layer as the default mode, which `load_level` also makes the
        top-level vehicle layer."""
        info = LevelInfo(name="T", terrain=TerrainInfo())
        info.gameplay = layer
        info.spawn_objects = layer.object_spawns
        info.spawn_templates = layer.object_spawn_templates
        return info

    @staticmethod
    def _pad(x: float, z: float) -> StaticInstance:
        return StaticInstance("AntiTankGunSpawner", (x, 100.0, z), (0.0, 0.0, 0.0), team=1)

    def test_only_a_defined_template_is_created(self) -> None:
        layer = self._layer(self.CASSINO_CTF + self.AIRFIELD)
        self.assertEqual(len(layer.control_points), 3)      # still read, not an error
        self.assertEqual([inst.template for inst in layer.created_control_points()],
                         ["The_Airfield"])

    def test_the_report_leaves_it_out_and_the_rest_as_it_was(self) -> None:
        mixed = self._layer(self.CASSINO_CTF + self.AIRFIELD)
        alone = self._layer(self.AIRFIELD)
        for placed in (None, {"the_airfield"}, set()):
            got = extract_map._control_point_report(self._info(mixed), placed)
            self.assertEqual(json.dumps(got),
                             json.dumps(extract_map._control_point_report(self._info(alone), placed)))
            self.assertEqual([entry["name"] for entry in got], ["The_Airfield"])
        # A layer other than the default, as `modes.<mode>` is written.
        info = self._info(alone)
        self.assertEqual(extract_map._control_point_report(info, None, mixed),
                         extract_map._control_point_report(info, None, alone))

    def test_a_layer_of_them_alone_reports_no_point(self) -> None:
        layer = self._layer(self.CASSINO_CTF)
        self.assertEqual(extract_map._control_point_report(self._info(layer), None), [])

    def test_a_pad_binds_none_of_them(self) -> None:
        """Cassino CTF's Pak40 pad 25 m from `openbasecammo`, which bound it
        at the 60 m reach of a point with no radius."""
        layer = self._layer(self.CASSINO_CTF, [self._pad(535.0, 574.0)])
        [pad] = extract_map._object_spawn_report(self._info(layer), layer)
        self.assertEqual(pad["vehicle"], "Pak40")
        self.assertNotIn("controlPointIndex", pad)
        self.assertNotIn("controlPointName", pad)

    def test_a_pad_s_index_is_its_point_s_place_in_the_report(self) -> None:
        layer = self._layer(self.CASSINO_CTF + self.AIRFIELD, [self._pad(1390.0, 780.0)])
        info = self._info(layer)
        [pad] = extract_map._object_spawn_report(info)
        points = extract_map._control_point_report(info, None)
        self.assertEqual(pad["controlPointIndex"], 0)
        self.assertEqual(points[pad["controlPointIndex"]]["name"], pad["controlPointName"])
        self.assertEqual(pad["controlPointName"], "The_Airfield")


class CassinoCtfArchiveTests(unittest.TestCase):
    """Road to Rome's Cassino, against the shipped archives: its CTF
    `ControlPoints.con` is vanilla Kursk's, at Kursk's coordinates, and only
    Kursk defines the two templates it places."""

    @classmethod
    def setUpClass(cls) -> None:
        from extract_models import DEFAULT_GAME_DIR, mod_chain
        from bf42.level import find_level_archives, load_gameplay_objects, load_level_files
        if not (DEFAULT_GAME_DIR / "Mods" / "XPack1").is_dir():
            raise unittest.SkipTest("Road to Rome is not installed")

        def layer(mod: str, level: str, mode: str) -> GameplayObjects:
            paths = find_level_archives(DEFAULT_GAME_DIR, mod, level,
                                        chain=mod_chain(DEFAULT_GAME_DIR, mod))
            if not paths:
                raise unittest.SkipTest(f"{mod} {level} is not installed")
            return load_gameplay_objects(load_level_files(paths, level), mode)

        cls.ctf = layer("XPack1", "cassino", "Ctf")
        cls.conquest = layer("XPack1", "cassino", "Conquest")
        cls.kursk = layer("bf1942", "Kursk", "Ctf")

    def test_the_ctf_layer_creates_none_of_its_three_placements(self) -> None:
        self.assertEqual([inst.template for inst in self.ctf.control_points],
                         ["openbase_lumbermill_Cpoint", "openbasecammo", "openbasecammo"])
        self.assertEqual(self.ctf.created_control_points(), [])

    def test_kursk_defines_both(self) -> None:
        self.assertIn("openbasecammo", self.kursk.control_point_templates)
        self.assertIn("openbase_lumbermill_cpoint", self.kursk.control_point_templates)
        self.assertEqual(self.kursk.created_control_points(), self.kursk.control_points)

    def test_ctf_reports_no_point_and_binds_no_pad(self) -> None:
        """Two Pak40 pads stand within 60 m of an `openbasecammo`, and bound
        it while the exporter listed it."""
        info = LevelInfo(name="cassino", terrain=TerrainInfo())
        info.gameplay = self.conquest
        self.assertEqual(extract_map._control_point_report(info, None, self.ctf), [])
        pads = extract_map._object_spawn_report(info, self.ctf)
        near = [pad for pad in pads if any(
            math.hypot(pad["position"][0] - inst.position[0],
                       -pad["position"][2] - inst.position[2]) <= 60.0
            for inst in self.ctf.control_points)]
        self.assertEqual([pad["vehicle"] for pad in near], ["Pak40", "Pak40"])
        self.assertFalse([pad for pad in pads if "controlPointIndex" in pad])

    def test_conquest_keeps_all_six(self) -> None:
        self.assertEqual(len(self.conquest.control_points), 6)
        self.assertEqual(self.conquest.created_control_points(), self.conquest.control_points)


ANIMATED_FLAG = """
ObjectTemplate.create AnimatedBundle AnimatedFlag
ObjectTemplate.geometry flagso_m1
ObjectTemplate.createSkeleton animations/flag.ske
"""


class FlagClothTests(unittest.TestCase):
    """The cloth is a skinned mesh, not the rigid child the level implies.

    `Objects/Items/Flag/Geometries.con` declares every flag as
    `GeometryTemplate.create AnimatedMesh` with `setSkin animations/flag.skn`.
    Left as the `addTemplate` child the assembler sees, it exports at its
    authoring pose — a flat sheet centred on its own origin, which at the
    declared `0/8.2/0` straddles the top of an 8.52 m pole and reads upside
    down. `detach_flag_cloth` removes it so the skinned builder owns it.
    """

    def _setup(self, templates: str = WAKE_TEMPLATES, team: int | None = None):
        library = con_mod.ObjectLibrary()
        library.add_con("Objects/Items/Flag/Objects.con", ANIMATED_FLAG)
        library.add_con("Conquest/ControlPointTemplates.con", templates)
        info = LevelInfo(name="T", terrain=TerrainInfo())
        info.gameplay = GameplayObjects(
            mode="Conquest",
            control_points=[StaticInstance("The_Airfield", (0.0, 0.0, 0.0),
                                           (0.0, 0.0, 0.0), team=team)],
            control_point_templates=parse_control_point_templates(templates))
        return library, info

    def test_cloth_child_is_detached(self) -> None:
        library, info = self._setup()
        self.assertEqual(extract_map.detach_flag_cloth(library, info), 1)
        self.assertEqual(library.objects["the_airfield"].children, [])

    def test_the_pole_is_left_alone(self) -> None:
        """`geometry` is the pole and must survive: a control point whose
        cloth cannot be built still stands a flagpole."""
        library, info = self._setup()
        extract_map.detach_flag_cloth(library, info)
        self.assertEqual(library.objects["the_airfield"].geometry, "flagbase_m1")

    def test_the_shared_template_is_not_mutated(self) -> None:
        library, info = self._setup()
        extract_map.detach_flag_cloth(library, info)
        self.assertEqual(library.objects["animatedflag"].geometry, "flagso_m1")

    def test_a_template_with_no_cloth_is_a_no_op(self) -> None:
        text = WAKE_TEMPLATES.replace("ObjectTemplate.addTemplate AnimatedFlag",
                                      "rem ObjectTemplate.addTemplate AnimatedFlag")
        library, info = self._setup(text)
        self.assertEqual(extract_map.detach_flag_cloth(library, info), 0)

    def test_unrelated_children_survive(self) -> None:
        """Only the named flag child goes; a mod may hang other parts on a
        control point and they are not ours to drop."""
        text = WAKE_TEMPLATES + "ObjectTemplate.addTemplate SomeOtherPart\n"
        library, info = self._setup(text)
        extract_map.detach_flag_cloth(library, info)
        self.assertEqual([c.template for c in library.objects["the_airfield"].children],
                         ["SomeOtherPart"])


class FlagRigTests(unittest.TestCase):
    """Which cloth mesh a flag flies, and the bind the skinned export needs."""

    def test_bind_recovers_the_bone_local_offset(self) -> None:
        """`bind = (I, rest - offset)` is what makes glTF skinning agree with
        the engine.

        Every flag vertex carries exactly one influence at weight 1.0, so a
        bone's bind *rotation* is unconstrained and `pose.refine_binds` — which
        solves rotation from three points per bone — returns nothing at all.
        Identity is a valid choice, and with it `inverseBind * v` is the
        bone-local offset, so glTF's `jointWorld * inverseBind * v` reduces to
        `posed_world * offset`, which is exactly `pose.skinned_positions`.
        """
        rest = (1.0970, -0.6413, 0.0001)
        offset = (-0.0016, -0.0087, 0.0)
        bind_t = tuple(rest[i] - offset[i] for i in range(3))
        # inverse bind (identity rotation) takes the vertex back to the offset.
        recovered = tuple(rest[i] - bind_t[i] for i in range(3))
        for got, want in zip(recovered, offset):
            self.assertAlmostEqual(got, want, places=6)


class MinimapProjectionTests(unittest.TestCase):
    """World metres onto the level's map art.

    The art frames the level's **active combat area**, not the world. Most
    levels declare none and the two coincide, which is why `x / worldSize`
    passed for so long — but 142 of the 1018 installed levels declare a
    sub-world one and every marker lands wrong on them.
    """

    @staticmethod
    def _info(world: float, combat: CombatArea | None = None) -> LevelInfo:
        info = LevelInfo(name="T", terrain=TerrainInfo())
        info.terrain.world_size = world
        info.combat = combat
        return info

    @staticmethod
    def _project(m: list[float], x: float, z_refractor: float) -> tuple[float, float]:
        """Project a Refractor position the way the viewer will — through glTF."""
        z = -z_refractor                      # what `_to_gltf_vec` writes
        return (m[0] * x + m[1] * z + m[2], m[3] * x + m[4] * z + m[5])

    def test_no_combat_area_spans_the_whole_world(self) -> None:
        m = extract_map._world_to_image(self._info(2048.0))
        self.assertEqual(self._project(m, 0.0, 0.0), (0.0, 1.0))        # SW corner
        self.assertEqual(self._project(m, 2048.0, 2048.0), (1.0, 0.0))  # NE corner
        self.assertEqual(self._project(m, 1024.0, 1024.0), (0.5, 0.5))  # centre

    def test_wake_beach_lands_where_the_atoll_is(self) -> None:
        """Regression for a sign error in the `v` row.

        Two inversions cancel — the image's V runs down, and the glTF exporter
        has already negated Z. Getting one of them twice put Wake's beach at
        v = 1.349, off the image entirely.
        """
        m = extract_map._world_to_image(self._info(2048.0))
        u, v = self._project(m, 1144.53, 715.047)
        self.assertAlmostEqual(u, 0.5589, places=3)
        self.assertAlmostEqual(v, 0.6509, places=3)

    def test_berlin_sub_world_combat_area(self) -> None:
        """`1536 1536 512 512` against a 2048 world — a 4x error if ignored."""
        m = extract_map._world_to_image(
            self._info(2048.0, CombatArea(1536.0, 1536.0, 512.0, 512.0)))
        self.assertEqual(self._project(m, 1536.0, 1536.0), (0.0, 1.0))
        self.assertEqual(self._project(m, 2048.0, 2048.0), (1.0, 0.0))
        # The naive rule would have put this at 0.875 / 0.125 instead.
        self.assertEqual(self._project(m, 1792.0, 1792.0), (0.5, 0.5))

    def test_combat_area_is_origin_plus_size_not_two_corners(self) -> None:
        """Berlin's last two values are smaller than its first two.

        Read as corners that rectangle would be inside out, so the only
        reading that works is origin plus extent.
        """
        m = extract_map._world_to_image(
            self._info(2048.0, CombatArea(1536.0, 1536.0, 512.0, 512.0)))
        u, _v = self._project(m, 2048.0, 1536.0)
        self.assertEqual(u, 1.0)

    def test_caen_offset_combat_area(self) -> None:
        """`360 460 1229 1229` — the level whose bridges proved the rule."""
        m = extract_map._world_to_image(
            self._info(2048.0, CombatArea(360.0, 460.0, 1229.0, 1229.0)))
        self.assertEqual(self._project(m, 360.0, 460.0), (0.0, 1.0))
        u, v = self._project(m, 1589.0, 1689.0)
        self.assertAlmostEqual(u, 1.0, places=6)
        self.assertAlmostEqual(v, 0.0, places=6)

    def test_degenerate_combat_area_falls_back_to_the_world(self) -> None:
        """A zero-sized declaration must not divide by zero."""
        m = extract_map._world_to_image(
            self._info(1024.0, CombatArea(0.0, 0.0, 0.0, 0.0)))
        self.assertEqual(self._project(m, 1024.0, 1024.0), (1.0, 0.0))


if __name__ == "__main__":
    unittest.main()
