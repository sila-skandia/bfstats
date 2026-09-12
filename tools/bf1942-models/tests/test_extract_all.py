from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bf42 import con as con_mod  # noqa: E402
from extract_all import has_renderable_geometry  # noqa: E402


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

    def test_an_unknown_template_is_not_renderable(self) -> None:
        self.assertFalse(
            has_renderable_geometry(con_mod.ObjectLibrary(), "Ghost"))


if __name__ == "__main__":
    unittest.main()
