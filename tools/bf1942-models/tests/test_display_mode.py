"""OPTIONS > VIDEO > DISPLAY MODE: the game's resolution list, drawn on the
page's VIDEO screen (`viewer/video-options.js` `displayModePanel`,
`viewer/play/controls-screen.js` `paintDisplayModes`).

features/video-options, ledger VID-11. The sentence these tests defend:

    the VIDEO screen draws the game's DISPLAY MODE plate where `menu/VideoMenu`
    puts it, its list box filled with the screen's modes in the game's
    "%dx%dx%d" words at the box's own row pitch, and a click on a row picks
    that mode.

The plate is the game's own (`extract_controls_menu_layout.py` ->
`viewer/maps/_shared/hud/menu/controls-layout.json`); the list and the pixel
ratio a mode gives are `test_video_settings.py`'s.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).resolve().parent / "display_mode_harness.mjs"
LAYOUT = ROOT / "viewer" / "maps" / "_shared" / "hud" / "menu" / "controls-layout.json"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    if not LAYOUT.is_file():
        raise unittest.SkipTest(
            "controls-layout.json is not extracted - run extract_controls_menu_layout.py")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DisplayModeTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_plate_is_the_games(self) -> None:
        # `menu_videodispl_256x256` at (65,230), its heading, the scroll
        # column, in the file's order.
        self.assertEqual(
            [["picture", "menu_videodispl_256x256", [65, 230, 256, 256]],
             ["text", "DISPLAY MODE", [77, 238, 150, 20]],
             ["button", "menu_scrollpilupp_16x8", [234, 257, 16, 8]],
             ["fill", None, [234, 265, 10, 152]],
             ["button", "menu_scrollpilner_16x8", [234, 418, 16, 8]]],
            self.results["elements"])

    def test_the_list_box_is_the_games(self) -> None:
        # `Options/Video/DisplayModeList`: (69,242,177,200), 14-unit rows,
        # the olive select colour, rows inset 4 for the scroll bar.
        box = self.results["box"]
        self.assertEqual([69, 242, 177, 200], box["rect"])
        self.assertEqual(("standard6_latin", 14, 4), (box["font"], box["rowHeight"], box["inset"]))
        self.assertEqual([0.49219, 0.53516, 0.28910, 1.0], [round(c, 5) for c in box["select"]])

    def test_the_rows_sit_in_the_plates_well(self) -> None:
        # From the up arrow's top to the down arrow's foot, the box's left to
        # the scroll track: twelve rows from y=257, the plate art's own well
        # (257..438, `extract_menu_layout.list_rows`).
        self.assertEqual([69, 257, 165, 168], self.results["rows"])
        self.assertEqual(12, self.results["count"])

    def test_a_click_picks_the_row_under_it(self) -> None:
        self.assertEqual({"first": 0, "third": 2, "last": 5, "pastTheList": -1,
                          "scrollColumn": -1, "heading": -1}, self.results["hits"])

    def test_the_entries_are_in_the_games_words(self) -> None:
        # "%dx%dx%d" (BF1942.exe 0x006b0520), the screen's own size on top.
        self.assertEqual(["1920x1080x32", "1600x900x32", "1365x768x32", "1280x720x32",
                          "1067x600x32", "853x480x32"], self.results["labels"])

    def test_a_pack_without_the_page_has_no_list(self) -> None:
        self.assertIsNone(self.results["olderPack"])


if __name__ == "__main__":
    unittest.main()
