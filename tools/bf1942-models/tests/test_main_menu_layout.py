"""`extract_main_menu_layout.py`: the front end's navigation and MULTIPLAY
screen out of `menu.rfa`.

Against the installed game, because the point of the extractor is what the
shipped files say and a synthetic fixture would only assert that the code
agrees with itself. What is pinned here is the handful of facts
`viewer/play/nav-strip.js` and `viewer/play/multiplay.js` read the pack for:
where the two rows of buttons sit, that the server browser decoded at all
(it did not before MEME-15), where its list box and columns are, and that
the CREATE GAME page's rows have a well to sit in.

Also runs `test_nav_strip.mjs` over `viewer/play/nav-strip.js`, so
`unittest discover` reaches it.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import extract_main_menu_layout as emml  # noqa: E402
from bf42.modmenu import MenuSources  # noqa: E402
from extract_menu_layout import measure_rows  # noqa: E402
from extract_models import mod_chain  # noqa: E402
from extract_spawn_layout import load_chain_lexicon  # noqa: E402

GAME_DIR = Path.home() / ".wine/drive_c/EA Games/Battlefield 1942"
MENU_RFA = GAME_DIR / "Mods/bf1942/Archives/menu.rfa"

NAV_SUITE = Path(__file__).with_name("test_nav_strip.mjs")


def rect(el):
    return [round(v, 2) for v in el["rect"]]


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class MainMenuLayoutTests(unittest.TestCase):
    """Against the shipped front-end pages."""

    @classmethod
    def setUpClass(cls) -> None:
        sources = MenuSources(mod_chain(GAME_DIR, "bf1942"))
        lexicon = load_chain_lexicon(sources.lexicon_paths)
        with sources.open_menu() as menu:
            cls.layout = emml.decode_layout(menu, lexicon)
        cls.pages = cls.layout["pages"]

    def page(self, key):
        return self.pages[key]["elements"]

    def labelled(self, key, locale):
        return next(el for el in self.page(key)
                    if el["kind"] == "text" and el.get("key") == locale)

    # --- the tab strip ------------------------------------------------------

    def test_the_six_tabs_are_in_file_order_left_to_right(self) -> None:
        labels = [(el["rect"][0], el["text"]) for el in self.page("mainNav")
                  if el["kind"] == "text" and "when" not in el]
        self.assertEqual(
            ["SINGLEPLAY", "MULTIPLAY", "OPTIONS", "CUSTOM GAME", "INTRO", "CREDITS"],
            [text for _, text in sorted(labels)])

    def test_the_strip_sits_at_level_three(self) -> None:
        """`Navigation/NavigationY` is 85 / 58 / 33 and nothing in the page
        says which of them applies; the extractor settles it at the third,
        which is where a sub-tab's own screen sits."""
        self.assertEqual(33.0, self.layout["navigationY"])
        singleplay = self.labelled("mainNav", "MENU_SINGLEPLAY")
        self.assertEqual([29.0, 42.0, 97.0, 18.0], rect(singleplay))
        plates = {el["rect"][1] for el in self.page("mainNav") if el["kind"] == "button"}
        self.assertEqual({33.0}, plates, "every tab plate on the same row")

    def test_the_second_row_is_one_slot_in_and_one_row_down(self) -> None:
        create = self.labelled("multiplayerNav", "MENU_CREATE_GAME")
        internet = self.labelled("multiplayerNav", "MENU_INTERNET")
        self.assertEqual(137.0, internet["rect"][0], "the row starts at the second slot")
        self.assertEqual(353.0, create["rect"][0], "CREATE GAME is the third of four")
        self.assertEqual(68.0, create["rect"][1])
        self.assertEqual(internet["rect"][1], create["rect"][1], "one row")
        tab = self.labelled("mainNav", "MENU_MULTIPLAY")
        self.assertEqual(26.0, create["rect"][1] - tab["rect"][1],
                         "one row below the tabs")

    def test_a_tab_dims_itself_by_its_own_index(self) -> None:
        """The 0.6-alpha copy of each tab is gated on
        `Navigation/Level1/MouseClickedIndex ne <its index>`, and that
        condition is the only place a tab's number appears. The first two
        are 2 and 1, not 1 and 2 — which is why `nav-strip.js` reads them
        rather than counting."""
        def index_of(x):
            for el in self.page("mainNav"):
                if el["rect"][0] != x or "when" not in el:
                    continue
                for cond in el["when"]:
                    for term in cond.get("terms", [cond]):
                        if term["var"] == "Navigation/Level1/MouseClickedIndex":
                            return term["value"]
            return None
        self.assertEqual(2, index_of(21.0), "SINGLEPLAY")
        self.assertEqual(1, index_of(129.0), "MULTIPLAY")

    # --- the server browser -------------------------------------------------

    def test_the_server_browser_decoded(self) -> None:
        """MEME-15: `menu/InternetMenu` desynced the reader until
        `BfTransformNodeSize`'s field order was fixed, and came out empty."""
        self.assertGreater(len(self.page("internet")), 100)

    def test_the_five_columns_and_their_sorts(self) -> None:
        heads = [(el["rect"][0], el["text"]) for el in self.page("internet")
                 if el["kind"] == "text" and el.get("key", "").startswith("MULTIPLAYER_")
                 and el["rect"][1] == 158.0]
        self.assertEqual(["SERVER", "PLAYERS", "PING", "GAME TYPE", "MAP"],
                         [text for _, text in sorted(heads)])
        sorts = [el["calls"][0] for el in self.page("internet")
                 if el["kind"] == "hit" and el.get("calls")
                 and el["calls"][0].startswith("Headings/Sort")]
        self.assertEqual(["Headings/SortServerAsc", "Headings/SortPlayersAsc",
                          "Headings/SortPingAsc", "Headings/SortGameAsc",
                          "Headings/SortMapAsc"], sorts)

    def test_the_list_box_and_its_scroll_track(self) -> None:
        box = emml.list_box(self.layout, "internet",
                            "Join/Internet/InternetServerList")
        self.assertIsNotNone(box)
        self.assertEqual([28.0, 188.0, 562.0, 270.0], rect(box))
        self.assertEqual(14.0, box["rowHeight"])
        # `Join/ScrollbarHeight - 23`, which reads as 0 unless `SubData` is
        # evaluated. The track is what `multiplay.js` hangs the thumb on.
        track = [el for el in self.page("internet")
                 if el["kind"] == "fill" and el["rect"][2] < 20 and el["rect"][3] > 40]
        self.assertIn([578.0, 211.0, 10.0, 222.0], [rect(el) for el in track])

    def test_the_selected_server_bar_is_under_the_list(self) -> None:
        """Its Y is `AddData(Join/ServerListHeight, Join/ServerInfoPosY)`.
        Read as a plain value that is `None`, and the bar lands at the top
        of the page over the INTERNET GAME heading."""
        bar = next(el for el in self.page("internet")
                   if el.get("var") == "ServerInfo/ServerInfoName")
        self.assertEqual(460.0, bar["rect"][1])
        box = emml.list_box(self.layout, "internet",
                            "Join/Internet/InternetServerList")
        self.assertGreater(bar["rect"][1], box["rect"][1] + box["rect"][3] - 20,
                           "at the foot of the list, not over it")

    def test_the_join_button_is_where_start_is(self) -> None:
        """The same slot the Instant Battle screen's START sits in."""
        join = next(el for el in self.page("internetNav")
                    if el["kind"] == "button"
                    and "Join/Internet/JoinInternetGame" in el.get("calls", []))
        self.assertEqual([670.0, 535.0, 109.0, 25.0], rect(join))

    # --- CREATE GAME --------------------------------------------------------

    def test_the_create_page_carries_its_three_lists(self) -> None:
        data = [el["data"] for el in self.page("createGame") if el["kind"] == "listbox"]
        self.assertEqual(["Host/Create/LevelsList", "Host/Create/GameTypeList",
                          "Host/Create/SelectedLevelsList"], data)

    def test_the_settings_rows_come_off_the_split(self) -> None:
        """`menu/CreateGameMenuPage1` is placed by its layer, not by a
        transform of its own, so its body hangs off a bare top-level
        `SplitNode` the default walk skips. Without it the page is four
        elements — a heading and an arrow."""
        labels = {el.get("key") for el in self.page("createGamePage1")}
        self.assertIn("CREATE_GAME_SERVERNAME", labels)
        self.assertIn("CREATE_GAME_MAX_PLAYERS", labels)
        self.assertGreater(len(self.page("createGamePage1")), 40)

    def test_the_two_start_buttons(self) -> None:
        calls = [el["calls"][0] for el in self.page("createGameNav")
                 if el["kind"] == "button" and el.get("calls")]
        self.assertEqual(["Host/Internet/HostInternetGame", "Host/Lan/HostLanGame"],
                         calls)


@unittest.skipUnless(MENU_RFA.exists(), "needs the BF1942 install")
class CreateGameWellTests(unittest.TestCase):
    """`measure_rows` over the CREATE GAME plates. Needs the textures on
    disk, so it re-extracts into a temporary directory rather than reading
    whatever a previous run left in the viewer tree."""

    @classmethod
    def setUpClass(cls) -> None:
        import tempfile
        from extract_menu_layout import extract_textures, layout_textures
        cls._tmp = tempfile.TemporaryDirectory()
        out = Path(cls._tmp.name)
        sources = MenuSources(mod_chain(GAME_DIR, "bf1942"))
        lexicon = load_chain_lexicon(sources.lexicon_paths)
        with sources.open_menu() as menu:
            cls.layout = emml.decode_layout(menu, lexicon)
            cls.layout["textures"] = extract_textures(
                menu, layout_textures(cls.layout), out / "textures", False)
        measure_rows(cls.layout, out, "createGame")

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_every_list_sits_below_its_plate_heading(self) -> None:
        for box in self.layout["pages"]["createGame"]["elements"]:
            if box["kind"] != "listbox":
                continue
            with self.subTest(box["data"]):
                well = box.get("rows")
                self.assertIsNotNone(well, "the plate art has a well")
                self.assertGreater(well["top"], box["rect"][1],
                                   "the first row is not over the heading")
                self.assertLessEqual(well["bottom"],
                                     box["rect"][1] + box["rect"][3] + 1)
                self.assertGreaterEqual(well["count"], 4)


class NodeSuiteTests(unittest.TestCase):
    def test_nav_strip_passes_under_node(self) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("node is not installed")
        proc = subprocess.run(["node", str(NAV_SUITE)],
                              capture_output=True, text=True, timeout=120)
        self.assertEqual(0, proc.returncode,
                         f"{NAV_SUITE.name} failed:\n{proc.stdout}\n{proc.stderr}")


if __name__ == "__main__":
    unittest.main()
