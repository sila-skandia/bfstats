"""A player reaches a level through the Instant Battle screen, not `map.html`.

The level list is a `<select>` inside the debug panel, which `show.dev 1`
gates. A bare `map.html` therefore has nothing to choose a level with, and used
to open the first one in the manifest with no way off it. These pin the three
things that keep that from coming back: the bare page hands over to the menu,
the ways in that must stay on the page still do, and there is a way back.

The page is play.bfstats.io's. mesh.bfstats.io, served by the same nginx,
has neither the tab nor the page (features/mesh-site); this PC keeps both.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parents[1] / "viewer"
MAP_HTML = (VIEWER / "map.html").read_text(encoding="utf-8")


class MapEntryTests(unittest.TestCase):
    def test_the_menu_the_map_hands_over_to_exists(self) -> None:
        self.assertIn("new URL('./play/index.html', location.href)", MAP_HTML)
        self.assertTrue((VIEWER / "play" / "index.html").is_file())

    def test_a_bare_map_page_hands_over_before_anything_loads(self) -> None:
        guard = re.search(r"if \(([^{]*?)\) \{\s*location\.replace\(MENU_URL\);"
                          r"\s*await new Promise\(\(\) => \{\}\);", MAP_HTML)
        self.assertIsNotNone(guard, "the bare-page guard is gone")
        # The manifest fetch is what starts a level loading.
        self.assertLess(guard.start(), MAP_HTML.index("const replayUrl ="))

    def test_a_named_level_a_recording_dev_and_headless_runs_stay(self) -> None:
        guard = re.search(r"if \(([^{]*?)\) \{\s*location\.replace\(MENU_URL\)",
                          MAP_HTML).group(1)
        for stays in ("!params.has('map')", "!params.has('replay')",
                      "!params.has('shots')", "params.get('dev') !== '1'"):
            self.assertIn(stays, guard)

    def test_the_console_has_the_engine_s_way_back_to_the_menu(self) -> None:
        # The console's commands are registered in page-console.js, which the
        # page hands its MENU_URL (`page.MENU_URL`).
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from page_source import page_source
        self.assertRegex(
            page_source(),
            r"object: 'game', method: 'disconnect',[^}]*?"
            r"run: \(\) => \{ location\.assign\((?:\w+\.)?MENU_URL\); \}")

    def test_the_site_s_maps_tab_opens_the_menu(self) -> None:
        for page in ("index.html", "poses.html", "kits.html", "map.html"):
            text = (VIEWER / page).read_text(encoding="utf-8")
            self.assertNotIn('href="./map.html"', text, page)
            self.assertIn('href="./play/index.html"', text, page)

    def test_the_mesh_host_alone_drops_the_maps_tab(self) -> None:
        css = (VIEWER / "shell.css").read_text(encoding="utf-8")
        self.assertIn(":root.shell-no-maps .shell-tab-maps { display: none; }", css)
        for page in ("index.html", "poses.html", "kits.html"):
            text = (VIEWER / page).read_text(encoding="utf-8")
            self.assertIn('<a class="shell-tab-maps" href="./play/index.html">Maps</a>',
                          text, page)
            # On the host alone, and set in <head>, before the bar paints.
            check = text.index("if (location.hostname === 'mesh.bfstats.io') "
                               "document.documentElement.classList.add('shell-no-maps');")
            self.assertLess(check, text.index("<body>"), page)

    def test_the_mesh_host_sends_the_map_page_to_the_play_host(self) -> None:
        conf = (VIEWER.parents[2] / "mesh" / "nginx.conf").read_text(encoding="utf-8")
        self.assertIn("if ($to_play_host) {\n"
                      "        return 301 https://play.bfstats.io$request_uri;", conf)
        # nginx matches "$host$uri" against this; PCRE and `re` agree on it.
        pattern = re.search(r'"~(\^mesh[^"]+)" 1;', conf).group(1)
        for moved in ("mesh.bfstats.io/map.html", "mesh.bfstats.io/play",
                      "mesh.bfstats.io/play/", "mesh.bfstats.io/play/front-end.js"):
            self.assertRegex(moved, pattern)
        for stays in ("mesh.bfstats.io/", "mesh.bfstats.io/index.html",
                      "mesh.bfstats.io/kits.html", "mesh.bfstats.io/maps/maps.json",
                      "mesh.bfstats.io/mods.js", "mesh.bfstats.io/map.html.bak",
                      "play.bfstats.io/map.html", "play.bfstats.io/play/"):
            self.assertNotRegex(stays, pattern)


if __name__ == "__main__":
    unittest.main()
