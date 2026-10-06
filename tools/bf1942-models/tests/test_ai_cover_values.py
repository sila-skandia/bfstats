"""The `ai` layer keeps the level's cover values (LOAD-8).

Every `aiTemplatePlugIn.coverValue` is in an object's `Ai/Objects.con`, and
`Game::loadAllConFiles` runs `/ai/` scripts on an AI level, which the
viewer's game with bots is. Dropping them (298b1cd1) left `patch_scene
--layer ai`, and every full bake, writing `ai.coverValues` empty: El Alamein
26 -> 0, DC's 27 -> 0, so the TakeCover behaviour had nothing to score.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import scene_layers  # noqa: E402


def _game_dir() -> Path | None:
    try:
        from extract_models import DEFAULT_GAME_DIR
    except Exception:  # noqa: BLE001
        return None
    game = Path(os.path.expanduser(str(DEFAULT_GAME_DIR)))
    return game if (game / "Mods" / "DesertCombat").is_dir() else None


@unittest.skipIf(_game_dir() is None, "no BF1942 + Desert Combat install")
class CoverValueTests(unittest.TestCase):
    """`patch_scene --layer ai` on a scratch copy of El Alamein."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="ai-cover-"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def patch(self, mod: str, tree_rel: str) -> dict:
        import patch_scene
        tree = self.tmp / mod
        level = tree / "el_alamein"
        level.mkdir(parents=True)
        # The tree's own file when it is there, else a bare one: the layer
        # replaces `ai` either way.
        published = HERE / "viewer" / "maps" / tree_rel / "el_alamein" / "scene.json"
        if published.is_file():
            shutil.copyfile(published, level / "scene.json")
        else:
            (level / "scene.json").write_text(scene_layers.dump({"level": "El_Alamein"}))
        patch_scene.patch_level(_game_dir(), mod, level, ["ai"], tree=tree)
        return json.loads((level / "scene.json").read_text())["ai"]["coverValues"]

    def test_vanilla_el_alamein_keeps_its_26(self) -> None:
        cover = self.patch("bf1942", ".")
        self.assertEqual(26, len(cover))
        self.assertEqual(100.0, cover["bunker1_m1"])
        self.assertEqual(5.0, cover["stebarbwire_m1"])

    def test_desert_combat_el_alamein_keeps_its_27(self) -> None:
        self.assertEqual(27, len(self.patch("DesertCombat", "mods/desertcombat")))


if __name__ == "__main__":
    unittest.main()
