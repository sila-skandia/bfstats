from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_map  # noqa: E402

from bf42 import con as con_mod  # noqa: E402
from bf42.level import (  # noqa: E402
    CombatArea,
    ControlPointTemplate,
    GameplayObjects,
    LevelInfo,
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

    def test_group_team_comes_from_the_owning_control_point(self) -> None:
        """A spawn point carries no team of its own."""
        objects = GameplayObjects(
            mode="Conquest",
            control_point_templates={
                "a": ControlPointTemplate(name="A", team=2, spawn_group_id=2),
                "b": ControlPointTemplate(name="B", team=1, spawn_group_id=1),
            })
        self.assertEqual(objects.team_of_group(2), 2)
        self.assertEqual(objects.team_of_group(1), 1)
        self.assertIsNone(objects.team_of_group(7))
        self.assertIsNone(objects.team_of_group(None))

    def test_second_spawn_group_also_binds(self) -> None:
        objects = GameplayObjects(
            mode="Conquest",
            control_point_templates={
                "a": ControlPointTemplate(name="A", team=1, spawn_group_id=1,
                                          second_spawn_group_id=6)})
        self.assertEqual(objects.team_of_group(6), 1)


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
        """Vanilla Coral_Sea ships placements with no templates file at all."""
        objects = GameplayObjects(
            mode="Conquest",
            control_points=parse_static_objects(self.PLACEMENTS))
        self.assertIsNone(objects.template_for(objects.control_points[0]))


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
