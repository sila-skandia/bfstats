from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_hud_mods as ehm  # noqa: E402


class LayoutTextureKeyTests(unittest.TestCase):
    """The spawn screen names glyphs no sprite list reaches (FH's
    class_support_16x16); the backfill needs every `texture` the pack-root
    layouts carry, at any depth, and only those files."""

    def test_keys_are_collected_from_both_layouts_at_any_depth(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "spawn-layout.json").write_text(json.dumps(
                {"groups": {"spawn": {"elements": [
                    {"texture": "class_support_16x16"}, {"text": "x"}]}}}))
            (root / "hud-layout.json").write_text(json.dumps(
                {"elements": [{"leaf": {"texture": "healthbar_full_assault_64x64"}}]}))
            (root / "chat-layout.json").write_text(json.dumps(
                {"texture": "not_read"}))
            self.assertEqual(
                {"class_support_16x16", "healthbar_full_assault_64x64"},
                ehm.layout_texture_keys(root))

    def test_a_pack_with_neither_layout_names_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(set(), ehm.layout_texture_keys(Path(tmp)))


if __name__ == "__main__":
    unittest.main()
