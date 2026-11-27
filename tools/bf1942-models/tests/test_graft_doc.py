"""A grafted weapon reads the arms rig's document from the weapon it replaces.

`arms-rig.js` `graftRig` keeps the arms of the weapon in hand and swaps only
the weapon (DC's Mortar_weap): it hands back `held.doc`, the arms rig's
document, for `hand-weapon.js` to read `clips` and `view.center1pHands` from.
Until 2026-11-27 the weapon in hand (`hw`) never stored its document, so every
graft read `undefined.clips` and threw: 68 page errors over DC Final's 48
levels, every Support kit's slot 4 (`kit.weapon-not-raised` in the behaviour
audit). This pins the two halves of the contract together.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"


class GraftDocTests(unittest.TestCase):
    def test_the_graft_hands_back_the_held_weapons_document(self) -> None:
        arms = (VIEWER / "arms-rig.js").read_text()
        body = arms[arms.index("function graftRig("):]
        body = body[:body.index("\n  }\n")]
        self.assertIn("doc: held.doc", body)

    def test_the_weapon_in_hand_keeps_its_document(self) -> None:
        hand = (VIEWER / "hand-weapon.js").read_text()
        start = hand.index("const hw = {")
        block = hand[start:hand.index("\n    };", start)]
        self.assertRegex(block, r"\n\s+doc: fp \? doc \?\? null : null,")
        # and reads its clips through it without throwing on a missing one
        self.assertRegex(block, r"clips: fp \? doc\?\.clips \?\? null : null")


if __name__ == "__main__":
    unittest.main()
