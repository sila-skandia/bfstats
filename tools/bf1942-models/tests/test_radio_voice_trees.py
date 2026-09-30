"""The extracted voice trees against their own manifests.

Every `_shared/voices/radio-sounds.json` under `viewer/maps` lists the radio,
shout and announcer patches (`extract_radio.py`) and, per nation, the lines
its language does not ship (`missing`). The viewer rolls a patch over the
stems a nation has (`radio.js` `nationStems`, ledger RADIO-6), so a stem that
is neither on disk nor listed missing is a line that goes silent where the
game speaks it. Skipped where no tree has been extracted.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

MAPS = Path(__file__).resolve().parents[1] / "viewer" / "maps"
SCRIPTS = ("radio", "local", "gameplay")
# `GamePlay.ssc`'s chat beep is language-free: `voices/radiomess.mp3`.
LANGUAGE_FREE = {"radiomess"}


def manifests() -> list[Path]:
    trees = [MAPS / "_shared"] + sorted((MAPS / "mods").glob("*/_shared"))
    return [t / "voices" / "radio-sounds.json" for t in trees
            if (t / "voices" / "radio-sounds.json").is_file()]


@unittest.skipUnless(manifests(), "no voice tree has been extracted")
class VoiceTreeTests(unittest.TestCase):
    def test_every_line_a_nation_speaks_is_on_disk(self) -> None:
        for path in manifests():
            data = json.loads(path.read_text())
            voices = path.parent
            stems = {s for script in SCRIPTS for p in data.get(script) or []
                     for s in p["stems"]} - LANGUAGE_FREE
            for nation in data["nations"]:
                absent = {s for m in data.get("missing", []) if m.get("nation") == nation
                          for s in m.get("stems", [])}
                for stem in sorted(stems - absent):
                    mp3 = voices / nation / f"{stem}.mp3"
                    with self.subTest(tree=str(path.parent.parent.relative_to(MAPS)), line=f"{nation}/{stem}"):
                        self.assertTrue(mp3.is_file() and mp3.stat().st_size > 0)

    def test_the_desert_combat_trees_speak_every_line_on_both_sides(self) -> None:
        for mod in ("desertcombat", "dc_final"):
            path = MAPS / "mods" / mod / "_shared" / "voices" / "radio-sounds.json"
            if not path.is_file():
                continue
            data = json.loads(path.read_text())
            with self.subTest(mod=mod):
                self.assertEqual(6, len(data.get("gameplay") or []), "the announcer script")
                lacking = {m["nation"] for m in data["missing"]}
                self.assertNotIn("us", lacking)
                self.assertNotIn("iraq", lacking)
                self.assertEqual("Iraqi", data["nations"]["iraq"]["language"])


if __name__ == "__main__":
    unittest.main()
