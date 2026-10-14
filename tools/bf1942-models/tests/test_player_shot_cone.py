"""The player's hitscan against the bots (`viewer/hand-fire.js`
`resolvePlayerShotOnBots`, used on a page whose rounds carry no `bodyCast`)
draws the engine's cone: hundredths of a radian, a square (ledger DEV-9), as
`round-launch.js` `deviate` draws the visible round. It used to roll a disc
of the total read as degrees, 1.75 times the engine's reach."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "viewer" / "hand-fire.js"


class PlayerShotConeTests(unittest.TestCase):
    def setUp(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        start = text.index("function resolvePlayerShotOnBots")
        self.body = text[start:text.index("\n  }\n", start)]

    def test_the_cone_is_in_hundredths_of_a_radian(self) -> None:
        self.assertIn("total / 100", self.body)
        self.assertNotIn("DEG_TO_RAD", self.body)

    def test_the_pattern_is_a_square_not_a_disc(self) -> None:
        self.assertIsNone(re.search(r"Math\.sqrt\(\s*Math\.random", self.body))
        self.assertEqual(2, len(re.findall(r"1 - 2 \* rand\(\)", self.body)))


if __name__ == "__main__":
    unittest.main()
