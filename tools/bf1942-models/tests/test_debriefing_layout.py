"""`extract_debriefing_layout.py` on the installed game's `menu/LoadMenu`.

The multiplayer debriefing plate (ledger ROUND-12) is a group of
`menu/LoadMenu`: this reads it out of the shipped vanilla `menu.rfa` and
checks the draw list against what the file holds. Skipped where the game is
not installed.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from extract_debriefing_layout import decode_layout, layout_textures  # noqa: E402
from extract_models import DEFAULT_GAME_DIR  # noqa: E402

VANILLA = Path(DEFAULT_GAME_DIR).expanduser() / "Mods" / "bf1942"
MENU = VANILLA / "Archives" / "menu.rfa"


def lexicon() -> dict[str, str]:
    from extract_spawn_layout import load_lexicon
    found = [p for p in VANILLA.iterdir() if p.name.lower() == "lexiconall.dat"]
    return load_lexicon(found[0]) if found else {}


@unittest.skipUnless(MENU.exists(), "the BF1942 install is not here")
class DebriefingLayoutTests(unittest.TestCase):
    layout: dict

    @classmethod
    def setUpClass(cls) -> None:
        from bf42.rfa import RfaArchive
        archive = RfaArchive(str(MENU))
        cls.layout = decode_layout(archive.read("menu/LoadMenu"), lexicon())

    def kinds(self, kind: str) -> list[dict]:
        return [el for el in self.layout["elements"] if el["kind"] == kind]

    def test_the_group_is_the_multiplayer_plate(self) -> None:
        self.assertEqual([150.0, 100.0, 512.0, 512.0], self.layout["group"]["rect"])
        plate = self.kinds("picture")[0]
        self.assertEqual(("mp_debriefing_512x512", [150.0, 100.0, 512.0, 512.0]),
                         (plate["texture"], plate["rect"]))
        # Shown for a game joined (2) or hosted (3), not the single-player 0, 1, 4.
        when = plate["when"][0]
        self.assertEqual({2, 3}, {t["value"] for t in when["terms"]})
        self.assertTrue(all(t["var"] == "StartingGame" for t in when["terms"]))

    def test_the_title_and_the_tickets_are_bound(self) -> None:
        texts = {el.get("var") or el.get("key"): el for el in self.kinds("text")}
        title = texts["Debriefing/DebriefingHeading"]
        self.assertEqual(("trebuchet_ms18", "center", [155.0, 98.0, 500.0, 20.0]),
                         (title["font"], title["align"], title["rect"]))
        self.assertEqual(("trebuchet_ms11_latin", [342.0, 131.0, 40.0, 20.0]),
                         (texts["AxisTicket"]["font"], texts["AxisTicket"]["rect"]))
        self.assertEqual([442.0, 131.0, 40.0, 20.0], texts["AlliedTicket"]["rect"])
        self.assertEqual(("BEST PLAYERS", "trebuchet_ms8"),
                         (texts["DEBRIEFING_HEADING"]["text"], texts["DEBRIEFING_HEADING"]["font"]))
        self.assertEqual("PLAYERNAME", texts["COL_HEADING_PLAYER_NAME"]["text"])
        # The flags are slots the client fills, not solid quads.
        flags = {el["var"]: el["rect"] for el in self.kinds("picture") if el.get("var")}
        self.assertEqual({"AxisTicketFlagLoad": [322.0, 133.0, 16.0, 16.0],
                          "AlliedTicketFlagLoad": [422.0, 133.0, 16.0, 16.0]}, flags)

    def test_the_heading_strip_and_the_list(self) -> None:
        fills = self.kinds("fill")
        self.assertEqual([[154.0, 178.0, 502.0, 18.0], [155.0, 179.0, 501.0, 16.0]],
                         [f["rect"] for f in fills])
        self.assertEqual([0.5195, 0.4922, 0.3008], [round(v, 4) for v in fills[1]["color"][:3]])
        icons = [(el["texture"], el["rect"][0]) for el in self.kinds("picture") if el.get("texture")
                 and el["texture"].startswith("menu_icon")]
        self.assertEqual([("menu_icon_score_16x16", 372.0), ("menu_icon_kills_16x16", 420.0),
                          ("menu_icon_death_16x16", 472.0), ("menu_icon_ping_16x16", 524.0)], icons)
        box = self.kinds("listbox")[0]
        self.assertEqual(("Debriefing/DebriefingList", [145.0, 55.0, 500.0, 500.0], 76.0, "standard6"),
                         (box["data"], box["rect"], box["rowHeight"], box["font"]))

    def test_the_rows_art_is_packed(self) -> None:
        names = layout_textures(self.layout)
        for name in ("1_16x16", "3_16x16", "axis_xl_gold_32x32", "allied_xl_bronze_32x32",
                     "mp_debriefing_512x512", "menu_icon_ping_16x16"):
            self.assertIn(name, names)
        self.assertEqual(["standard6", "trebuchet_ms11_latin", "trebuchet_ms18", "trebuchet_ms8"],
                         self.layout["fonts"])


if __name__ == "__main__":
    unittest.main()
