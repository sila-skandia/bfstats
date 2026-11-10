"""`publish_bot_layers.py`: which layers the gate lets out, and the menu rows' flags."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import publish_bot_layers as pbl  # noqa: E402


def layer(root: Path, level: str, verdict: dict | None) -> None:
    folder = root / "bf1942" / level
    folder.mkdir(parents=True)
    (folder / "generated.json").write_text("{}")
    if verdict is not None:
        (folder / "verdict.json").write_text(json.dumps(verdict))


class GatedLayers(unittest.TestCase):
    def test_pass_and_accepted_are_in_the_rest_say_why(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            layer(root, "passes", {"verdict": "pass"})
            layer(root, "accepted", {"verdict": "fail", "accepted": {"reason": "one check short at 16 a side"}})
            layer(root, "fails", {"verdict": "fail"})
            layer(root, "blank_reason", {"verdict": "fail", "accepted": {"reason": " "}})
            layer(root, "unjudged", None)
            (root / "bf1942" / "not_a_layer").mkdir()
            live, closed = pbl.gated_layers("bf1942", root)
        self.assertEqual(live, ["accepted", "passes"])
        self.assertEqual(closed, {"fails": "verdict fail", "blank_reason": "verdict fail", "unjudged": "no verdict"})

    def test_a_mod_with_no_layers(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(pbl.gated_layers("fhsw", Path(tmp)), ([], {}))


class MenuRows(unittest.TestCase):
    def rows(self):
        return {"levels": [
            {"dir": "shigaisen_b", "singlePlayer": False},
            {"dir": "the_maze", "singlePlayer": False, "generatedBots": True},
            {"dir": "berlin", "singlePlayer": True},
            {"dir": "the_room", "singlePlayer": False},
        ]}

    def test_flags_follow_the_gate(self):
        doc = self.rows()
        changed = pbl.mark_menu(doc, {"shigaisen_b", "berlin"})
        self.assertEqual(changed, ["+shigaisen_b", "-the_maze"])
        by = {r["dir"]: r for r in doc["levels"]}
        self.assertIs(by["shigaisen_b"]["generatedBots"], True)
        self.assertNotIn("generatedBots", by["the_maze"])
        # A level that ships single player never takes the flag, layer or not.
        self.assertNotIn("generatedBots", by["berlin"])
        self.assertNotIn("generatedBots", by["the_room"])

    def test_nothing_to_do_changes_nothing(self):
        doc = self.rows()
        before = json.dumps(doc)
        self.assertEqual(pbl.mark_menu(doc, {"the_maze"}), [])
        self.assertEqual(json.dumps(doc), before)


if __name__ == "__main__":
    unittest.main()
