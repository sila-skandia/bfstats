from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import optimise_mesh  # noqa: E402
from bf42 import glbopt  # noqa: E402
from test_glbopt import CHECKER, png, textured_glb  # noqa: E402


class MeshRootTests(unittest.TestCase):
    def test_the_root_is_the_directory_above_maps_or_models(self) -> None:
        self.assertEqual(Path("/v"), optimise_mesh.mesh_root_of(Path("/v/maps")))
        self.assertEqual(Path("/v"), optimise_mesh.mesh_root_of(Path("/v/maps/mods/xpack1")))
        self.assertEqual(Path("/v"), optimise_mesh.mesh_root_of(Path("/v/models/viewmodels")))
        self.assertEqual(Path("/s"), optimise_mesh.mesh_root_of(Path("/s/maps/_shared")))

    def test_a_tree_outside_any_root_has_none(self) -> None:
        self.assertIsNone(optimise_mesh.mesh_root_of(Path("/tmp/out")))


class ExtractorHookTests(unittest.TestCase):
    """`run_then_optimise`: the entry point every extractor goes through."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.out = self.root / "maps" / "_shared"
        self.out.mkdir(parents=True)
        self.glb = self.out / "effects.glb"

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def extractor(self) -> int:
        # What an extractor's main() does: parse its own flags, write a glb.
        assert "--no-optimise" not in sys.argv, "main() must not see the flag"
        self.glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
        return 0

    def run_with(self, *argv: str) -> int:
        with mock.patch.object(sys, "argv", ["extract_x.py", *argv]):
            return optimise_mesh.run_then_optimise(self.extractor, Path("/nowhere"))

    def test_what_the_extractor_wrote_ends_up_in_the_store(self) -> None:
        self.assertEqual(0, self.run_with("--out", str(self.out)))
        doc, _ = glbopt.read_glb(self.glb.read_bytes())
        self.assertTrue(doc["images"][0]["uri"].startswith("../../textures/"))
        self.assertEqual(1, len(list((self.root / "textures").rglob("*.webp"))))

    def test_no_optimise_leaves_the_glb_self_contained(self) -> None:
        self.assertEqual(0, self.run_with("--out", str(self.out), "--no-optimise"))
        doc, _ = glbopt.read_glb(self.glb.read_bytes())
        self.assertIn("bufferView", doc["images"][0])
        self.assertFalse((self.root / "textures").exists())


class BatchWorkerTests(unittest.TestCase):
    def test_a_staged_level_is_not_optimised_where_it_is_staged(self) -> None:
        # Image URIs are relative to the glb, so a level optimised in staging
        # would point at textures from the wrong depth once promoted.
        import extract_maps_all
        seen = {}

        def fake_run(command, **_):
            seen["command"] = command
            return mock.Mock(returncode=1, stdout="", stderr="stop here")

        with mock.patch.object(extract_maps_all.subprocess, "run", fake_run):
            extract_maps_all._extract_one(("Bocage", "/g", "bf1942", "/s", 512, False, [],
                                           "/sounds", "mp3", "/out"))
        self.assertIn("--no-optimise", seen["command"])

    def test_a_uri_that_resolves_to_nothing_fails_the_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            staged = root / "maps" / ".staging" / "bocage" / "bocage"
            staged.mkdir(parents=True)
            glb = staged / "scene.glb"
            glb.write_bytes(textured_glb([(png(CHECKER), "a")]))
            optimise_mesh.process(str(glb), str(root))          # URIs at staging depth
            promoted = root / "maps" / "bocage"
            promoted.mkdir()
            (promoted / "scene.glb").write_bytes(glb.read_bytes())
            with self.assertRaises(ValueError):
                optimise_mesh.process(str(promoted / "scene.glb"), str(root))


if __name__ == "__main__":
    unittest.main()
