"""The armoury browser opens at once, whatever the size of the catalogue
(features/mesh-viewer-performance, "Armoury browser open").

FHSW's catalogue is 4,091 models. Built at once, its cards cost the click
1.6 s at a 4x CPU throttle; a click before the page module and the catalogue
had loaded did nothing at all. `armoury_browser_harness.mjs` drives
`viewer/model-browser.js` and `viewer/index.html`'s markup and inline shim in
headless Chromium with a synthetic 4,000-model catalogue, and these pin what
it saw: the shell opens in the click's own task, before and after the module
has loaded, the click builds no more than the first chunk of cards, and
scrolling, search, Enter, the lineup, the plot and a card's click still do
what they did.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HARNESS = Path(__file__).with_name("armoury_browser_harness.mjs")
PLAYWRIGHT = ROOT.parents[1] / "ui" / "node_modules" / "playwright" / "index.mjs"
BROWSER = ROOT / "viewer" / "model-browser.js"
INDEX = ROOT / "viewer" / "index.html"

FIRST_CHUNK = 48


@unittest.skipUnless(shutil.which("node") and PLAYWRIGHT.exists(),
                     "node or ui/node_modules/playwright missing")
class ArmouryBrowserOpen(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            raise AssertionError(f"harness failed:\n{proc.stdout}\n{proc.stderr}")
        cls.r = json.loads(proc.stdout.strip().splitlines()[-1])
        if "skip" in cls.r:
            raise unittest.SkipTest(cls.r["skip"])

    def test_no_page_errors(self) -> None:
        self.assertEqual([], self.r["errors"])

    def test_a_click_before_the_module_opens_the_shell(self) -> None:
        early = self.r["early"]
        self.assertTrue(early["shown"])
        self.assertGreater(early["skeleton"], 0)
        self.assertEqual("browser-search", early["focused"])

    def test_the_module_takes_over_and_keeps_what_was_typed(self) -> None:
        takeover = self.r["takeover"]
        self.assertTrue(takeover["shimGone"])
        self.assertEqual("tank", takeover["query"])
        self.assertEqual("2666 of 4000", takeover["count"])
        self.assertEqual(["Tank0001", "Tank0002", "Tank0004"], takeover["names"])

    def test_a_click_builds_no_more_than_the_first_chunk(self) -> None:
        self.assertTrue(self.r["closed"])
        self.assertTrue(self.r["open"]["shown"])
        self.assertLessEqual(self.r["open"]["cardsInTask"], FIRST_CHUNK)
        self.assertEqual(FIRST_CHUNK, self.r["firstScreen"])

    def test_scrolling_builds_the_rest(self) -> None:
        grown = self.r["scrolled"]["grown"]
        self.assertEqual(sorted(grown), grown)
        self.assertGreater(grown[0], FIRST_CHUNK)
        self.assertEqual(self.r["models"], self.r["scrolled"]["final"])

    def test_a_long_facet_is_folded(self) -> None:
        self.assertEqual(10, self.r["facets"]["kitBoxes"])
        self.assertEqual("+190 more", self.r["facets"]["kitMore"])

    def test_search_enter_and_card_clicks_pick(self) -> None:
        self.assertEqual({"count": "1 of 4000", "names": ["Plane0003"]}, self.r["search"])
        self.assertEqual({"picked": [3], "hidden": True}, self.r["pick"])
        # Plane0000, Plane0003, Plane0006 by name: the third card is model 6.
        self.assertEqual(6, self.r["cardPick"])

    def test_the_lineup_is_chunked_and_the_plot_draws_everything(self) -> None:
        self.assertEqual(FIRST_CHUNK, self.r["scale"]["rows"])
        self.assertIn("Every model here is drawn at scale", self.r["scale"]["note"])
        self.assertEqual(self.r["models"], self.r["plot"])

    def test_the_feed_stops_at_phone_width_too(self) -> None:
        # Within reach of a 844 px screen: the first chunk and a chunk or two.
        self.assertLess(self.r["phone"], 400)


class ArmouryBrowserSource(unittest.TestCase):
    def test_first_chunk_matches_the_module(self) -> None:
        self.assertIn(f"const FIRST_CHUNK = {FIRST_CHUNK};", BROWSER.read_text())

    def test_the_shim_comes_before_the_module_scripts(self) -> None:
        html = INDEX.read_text()
        self.assertLess(html.index("window.__armouryEarly"), html.index('<script type="module">'))
        self.assertIn("window.__armouryEarly?.dispose()", BROWSER.read_text())

    def test_open_does_not_render_synchronously(self) -> None:
        text = BROWSER.read_text()
        body = text[text.index("  function openBrowser() {"):]
        body = body[:body.index("\n  }\n")]
        self.assertNotIn("renderBrowser()", body)
        self.assertIn("renderAfterPaint()", body)


if __name__ == "__main__":
    unittest.main()
