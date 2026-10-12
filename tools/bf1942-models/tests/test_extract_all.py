from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import con as con_mod  # noqa: E402
from extract_all import CATEGORIES, has_renderable_geometry  # noqa: E402
from extract_models import CATEGORY_PREFIXES, template_category  # noqa: E402


def library_from(text: str) -> con_mod.ObjectLibrary:
    library = con_mod.ObjectLibrary()
    library.add_con("Objects/Test/Objects.con", text)
    return library


class RenderableGeometryTests(unittest.TestCase):
    def test_a_template_with_a_mesh_somewhere_is_renderable(self) -> None:
        library = library_from("\n".join([
            "ObjectTemplate.create HandFireArms Foo",
            "ObjectTemplate.addTemplate FooComplex",
            "ObjectTemplate.create AnimatedBundle FooComplex",
            "ObjectTemplate.geometry Foo",
        ]))
        self.assertTrue(has_renderable_geometry(library, "Foo"))

    def test_an_effects_only_tree_is_not(self) -> None:
        # The Coaxial_browning shape: FireArms whose only children are the
        # muzzle flash and shell-eject emitters, no geometry anywhere.
        library = library_from("\n".join([
            "ObjectTemplate.create FireArms Coax",
            "ObjectTemplate.addTemplate e_Muzz",
            "ObjectTemplate.create EffectBundle e_Muzz",
            "ObjectTemplate.addTemplate Em_flash",
            "ObjectTemplate.create Emitter Em_flash",
        ]))
        self.assertFalse(has_renderable_geometry(library, "Coax"))

    def test_a_self_referencing_tree_terminates(self) -> None:
        library = library_from("\n".join([
            "ObjectTemplate.create Bundle Loop",
            "ObjectTemplate.addTemplate Loop",
        ]))
        self.assertFalse(has_renderable_geometry(library, "Loop"))

    def test_a_random_pick_child_is_followed_to_its_first_variant(self) -> None:
        # FH's GMC: the hull is `GMC_Random` with `setRandomGeometries 3`,
        # and only `GMC_Random1`..`3` are declared (LOAD-6).
        library = library_from("\n".join([
            "ObjectTemplate.create PlayerControlObject GMC",
            "ObjectTemplate.addTemplate GMC_Random",
            "ObjectTemplate.setRandomGeometries 3",
            "ObjectTemplate.create Bundle GMC_Random1",
            "ObjectTemplate.geometry GMC_m1",
            "ObjectTemplate.create Bundle GMC_Random2",
            "ObjectTemplate.geometry GMC_m2",
        ]))
        self.assertTrue(has_renderable_geometry(library, "GMC"))

    def test_a_template_created_invisible_draws_nothing(self) -> None:
        # FHSW's catapult dummy: a PlayerControlObject that names a mesh and
        # is created invisible. build_node returns before reading either the
        # mesh or the children, so asking for it only earns an export failure.
        library = library_from("\n".join([
            "ObjectTemplate.create PlayerControlObject Dummy",
            "ObjectTemplate.geometry Projectile_105mm_BBox_m1",
            "ObjectTemplate.createInvisible 1",
            "ObjectTemplate.addTemplate DummyHull",
            "ObjectTemplate.create Bundle DummyHull",
            "ObjectTemplate.geometry Hull_m1",
        ]))
        self.assertFalse(has_renderable_geometry(library, "Dummy"))

    def test_an_invisible_child_does_not_hide_a_drawn_sibling(self) -> None:
        library = library_from("\n".join([
            "ObjectTemplate.create PlayerControlObject Gun",
            "ObjectTemplate.addTemplate GunDummy",
            "ObjectTemplate.addTemplate GunBarrel",
            "ObjectTemplate.create Bundle GunDummy",
            "ObjectTemplate.geometry Box_m1",
            "ObjectTemplate.createInvisible 1",
            "ObjectTemplate.create Bundle GunBarrel",
            "ObjectTemplate.geometry Barrel_m1",
        ]))
        self.assertTrue(has_renderable_geometry(library, "Gun"))

    def test_an_invisible_spring_is_walked_for_its_children(self) -> None:
        # The KettenKrad's undrawn wheels: the Spring keeps its node, and what
        # hangs under it is still built.
        library = library_from("\n".join([
            "ObjectTemplate.create Spring Wheel",
            "ObjectTemplate.geometry Wheel_m1",
            "ObjectTemplate.createInvisible 1",
            "ObjectTemplate.addTemplate Hub",
            "ObjectTemplate.create Bundle Hub",
            "ObjectTemplate.geometry Hub_m1",
        ]))
        self.assertTrue(has_renderable_geometry(library, "Wheel"))
        lone = library_from("\n".join([
            "ObjectTemplate.create Spring Wheel",
            "ObjectTemplate.geometry Wheel_m1",
            "ObjectTemplate.createInvisible 1",
        ]))
        self.assertFalse(has_renderable_geometry(lone, "Wheel"))

    def test_an_unknown_template_is_not_renderable(self) -> None:
        self.assertFalse(
            has_renderable_geometry(con_mod.ObjectLibrary(), "Ghost"))


class CategoryTests(unittest.TestCase):
    def test_every_category_the_catalogue_files_under_is_extracted(self) -> None:
        """A catalogue row whose category the run does not ask for is never
        extracted: `object` (a spawned destructible, a scripted cage) was
        left out, so no tree had those models or their wrecks."""
        self.assertLessEqual(set(CATEGORY_PREFIXES.values()), set(CATEGORIES))
        library = library_from("\n".join([
            "ObjectTemplate.create PlayerControlObject Dest_bridge",
            "ObjectTemplate.addTemplate lodDest_bridge",
            "ObjectTemplate.create LodObject lodDest_bridge",
        ]))
        self.assertEqual(template_category(library, "Dest_bridge"), "object")
        self.assertIn(template_category(library, "Dest_bridge"), CATEGORIES)
        self.assertIn(template_category(library, "NoSuchTemplate"), CATEGORIES)


if __name__ == "__main__":
    unittest.main()
