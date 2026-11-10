"""`patch_scene.py --layer ai --no-archives` (features/bot-map-generation): a
generated bot layer applied to a published `scene.json` on a machine that does
not hold the mod's archives. No game install is read here: the maps tree is a
scratch one and the layer a copy of the one kept as source under
`bot-layers/`.
"""

# watches: tools/bf1942-models/bot-layers/bf1942/shigaisen_b/*

from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import patch_scene  # noqa: E402
import scene_layers  # noqa: E402

LAYER = ROOT / "bot-layers" / "bf1942" / "shigaisen_b"
LEVEL = "shigaisen_b"


class NoArchivesTests(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.tree = self.tmp / "tree"
        self.level_dir = self.tree / LEVEL
        self.level_dir.mkdir(parents=True)
        self.scene = self.level_dir / "scene.json"
        self.layer = self.tmp / "layers" / "bf1942" / LEVEL
        shutil.copytree(LAYER, self.layer)
        # The layer's own verdict is another test's subject: each case here
        # writes the one it needs.
        (self.layer / "verdict.json").unlink(missing_ok=True)
        self.write_scene({"level": "shigaisen_B", "worldSize": 1024,
                          "controlPoints": [{"name": "Middle"}],
                          "heightmap": {"image": "terrain/heightmap.png"}})
        # Nothing with the flag may build the archives' context.
        self.context = mock.patch.object(
            scene_layers, "LevelContext", side_effect=AssertionError("the archives were opened"))
        self.opened = self.context.start()
        self.addCleanup(self.context.stop)

    def write_scene(self, report: dict) -> str:
        text = scene_layers.dump(report)
        self.scene.write_text(text)
        return text

    def report(self) -> dict:
        return json.loads(self.scene.read_text())

    def pathfinding(self) -> list[str]:
        folder = self.level_dir / "pathfinding"
        return sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []

    def run_patch(self, *extra: str, env: dict[str, str] | None = None,
                  layers: tuple[str, ...] = ("ai",), flag: bool = True) -> tuple[int, str]:
        """Run `patch_scene.main` on the scratch level. Returns (exit code, what it printed)."""
        clean = {k: v for k, v in os.environ.items() if not k.startswith("BOT_LAYERS_")}
        clean["BOT_LAYERS_ROOT"] = str(self.tmp / "layers")
        argv = ["--layer", *layers, "--mod", "bf1942", "--tree", str(self.tree),
                "--game-dir", str(self.tmp / "no-game-here"), *extra, LEVEL]
        if flag:
            argv.insert(0, "--no-archives")
        out = io.StringIO()
        with mock.patch.dict(os.environ, {**clean, **(env or {})}, clear=True), \
             contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = patch_scene.main(argv)
        return code, out.getvalue()

    def test_a_level_with_no_ai_takes_its_generated_layer_marked(self) -> None:
        before = self.report()
        code, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertEqual(code, 0, said)
        self.opened.assert_not_called()
        after = self.report()
        marker = json.loads((self.layer / "generated.json").read_text())
        self.assertEqual(after["ai"]["generated"]["generator"], "botgen")
        self.assertEqual(after["ai"]["generated"]["version"], marker["version"])
        self.assertEqual(after["ai"]["generated"]["files"], marker["files"])
        self.assertEqual(after["ai"]["generated"]["gate"], "BOT_LAYERS_UNVERIFIED")
        self.assertTrue(after["ai"]["strategicAreas"])
        self.assertTrue(after["ai"]["sideStrategies"])
        # Every other key as it was, in its place; the file still the extractor's form.
        self.assertEqual(list(after), [*before, "ai"])
        self.assertEqual({k: after[k] for k in before}, before)
        self.assertEqual(self.scene.read_text(), scene_layers.dump(after))

    def test_the_pathfinding_folder_is_written_from_the_layers_own_maps(self) -> None:
        self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        index = json.loads((self.level_dir / "pathfinding" / "index.json").read_text())
        loaded = [m for m in index["maps"] if m["loaded"]]
        self.assertEqual([m["name"] for m in loaded], ["Tank0", "Infantry1"])
        self.assertEqual(self.pathfinding(), sorted(["index.json", *(m["file"] for m in loaded)]))
        for m in loaded:
            self.assertEqual((self.level_dir / "pathfinding" / m["file"]).read_bytes(),
                             (self.layer / "Pathfinding" / m["file"]).read_bytes())

    def test_cover_values_are_named_as_left_out_and_a_published_blocks_are_kept(self) -> None:
        _, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertIn("cover values left out", said)
        report = self.report()
        self.assertEqual(report["ai"]["coverValues"], {})
        # A block a bake with the archives wrote: its cover values are the
        # level's statics', not the layer's, and a re-patch keeps them.
        report["ai"]["coverValues"] = {"sandbag_m1": 5.0}
        report["ai"]["strategicAreas"] = []
        self.write_scene(report)
        code, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertEqual(code, 0, said)
        self.assertIn("cover values kept from the published block (1 templates)", said)
        self.assertEqual(self.report()["ai"]["coverValues"], {"sandbag_m1": 5.0})
        self.assertTrue(self.report()["ai"]["strategicAreas"])

    def test_a_layer_with_no_verdict_is_not_applied_and_a_pass_is(self) -> None:
        original = self.scene.read_text()
        code, said = self.run_patch()
        self.assertEqual(code, 0, said)
        self.assertIn("not read: no verdict", said)
        self.assertEqual(self.scene.read_text(), original)
        self.assertEqual(self.pathfinding(), [])
        (self.layer / "verdict.json").write_text(json.dumps({"verdict": "fail"}))
        self.run_patch()
        self.assertEqual(self.scene.read_text(), original)
        (self.layer / "verdict.json").write_text(
            json.dumps({"verdict": "pass", "config": "with vehicles"}))
        self.run_patch()
        self.assertEqual(self.report()["ai"]["generated"]["gate"], "pass")
        self.assertIn("index.json", self.pathfinding())

    def test_bot_layers_off_takes_a_generated_block_and_its_maps_away(self) -> None:
        original = self.scene.read_text()
        self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertIn("ai", self.report())
        code, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1", "BOT_LAYERS_OFF": "1"})
        self.assertEqual(code, 0, said)
        self.assertIn("BOT_LAYERS_OFF", said)
        self.assertEqual(self.scene.read_text(), original)
        self.assertEqual(self.pathfinding(), [])

    def test_a_level_with_no_layer_folder_is_unchanged_and_says_so(self) -> None:
        original = self.scene.read_text()
        shutil.rmtree(self.layer)
        code, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertEqual(code, 0, said)
        self.assertIn(f"no generated layer for bf1942/{LEVEL}", said)
        self.assertEqual(self.scene.read_text(), original)

    def test_a_shipped_ai_layer_is_left_alone(self) -> None:
        shipped = self.write_scene({"level": "shigaisen_B", "worldSize": 1024,
                                    "ai": {"settings": {}, "strategicAreas": [{"name": "Theirs"}],
                                           "coverValues": {}}})
        maps = self.level_dir / "pathfinding"
        maps.mkdir()
        (maps / "Tank0Level0Map.raw").write_bytes(b"the level's own")
        self.assertTrue(scene_layers.ships_own_ai(self.report()))
        code, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertEqual(code, 0, said)
        self.assertIn("left alone", said)
        self.assertEqual(self.scene.read_text(), shipped)
        self.assertEqual((maps / "Tank0Level0Map.raw").read_bytes(), b"the level's own")
        self.assertEqual(self.pathfinding(), ["Tank0Level0Map.raw"])

    def test_the_published_file_says_whether_the_level_ships_ai(self) -> None:
        self.assertFalse(scene_layers.ships_own_ai({}))
        self.assertFalse(scene_layers.ships_own_ai({"ai": None}))
        self.assertFalse(scene_layers.ships_own_ai({"ai": {"generated": {"generator": "botgen"}}}))
        self.assertTrue(scene_layers.ships_own_ai({"ai": {"strategicAreas": []}}))

    def test_the_flag_refuses_any_other_layer(self) -> None:
        original = self.scene.read_text()
        for layers in (("ai", "game"), ("sounds",), ("all",)):
            with self.subTest(layers=layers), self.assertRaises(SystemExit) as stop:
                self.run_patch(layers=layers, env={"BOT_LAYERS_UNVERIFIED": "1"})
            self.assertEqual(stop.exception.code, 2)
        with self.assertRaises(ValueError):
            patch_scene.patch_level(None, "bf1942", self.level_dir, ["ai", "sounds"],
                                    tree=self.tree, no_archives=True)
        self.assertEqual(self.scene.read_text(), original)

    def test_a_scene_filed_under_another_levels_name_is_refused(self) -> None:
        self.write_scene({"level": "another_level", "worldSize": 1024})
        code, said = self.run_patch(env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.assertEqual(code, 1)
        self.assertIn("answers as another_level", said)

    def test_without_the_flag_the_archives_are_asked_as_ever(self) -> None:
        original = self.scene.read_text()
        code, said = self.run_patch(flag=False, env={"BOT_LAYERS_UNVERIFIED": "1"})
        self.opened.assert_called_once()
        self.assertEqual(code, 1)
        self.assertIn("the archives were opened", said)
        self.assertEqual(self.scene.read_text(), original)


if __name__ == "__main__":
    unittest.main()
