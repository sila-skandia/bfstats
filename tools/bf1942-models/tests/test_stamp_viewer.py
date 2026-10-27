"""The mesh image serves the viewer's code from versioned, immutable URLs.

`mesh/stamp-viewer.mjs` rewrites the pages of the image's copy of the viewer:
an import map that sends every module to `/_v/<version>/`, a modulepreload
for each module in the page's static graph, and versioned stylesheets and
module `src`s. These run it over a copy of the real viewer and pin what the
pages come out with, and that every module a page will ask for exists, so a
module renamed or moved cannot leave a preload or a page pointing at nothing.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
VIEWER = REPO / "tools" / "bf1942-models" / "viewer"
STAMP = REPO / "mesh" / "stamp-viewer.mjs"
MOUNTED = {"models", "maps", "replays", "glbs", "textures"}


def copy_code(dest: Path) -> None:
    """The viewer as the image has it: everything but the volume's trees."""
    for entry in VIEWER.iterdir():
        if entry.name in MOUNTED:
            continue
        if entry.is_dir():
            shutil.copytree(entry, dest / entry.name)
        else:
            shutil.copy2(entry, dest / entry.name)


@unittest.skipIf(shutil.which("node") is None, "node is not installed")
class StampViewerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.dir = Path(cls.tmp.name)
        copy_code(cls.dir)
        run = subprocess.run(["node", str(STAMP), str(cls.dir)],
                             capture_output=True, text=True, check=True)
        cls.version = re.search(r"viewer code version ([0-9a-f]{12})", run.stdout).group(1)
        cls.pages = {rel: (cls.dir / rel).read_text(encoding="utf-8")
                     for rel in ("map.html", "play/index.html", "index.html",
                                 "kits.html")}

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def import_map(self, html: str) -> dict:
        match = re.search(r'<script type="importmap">\s*(\{.*?\})\s*</script>', html, re.S)
        return json.loads(match.group(1))["imports"]

    def test_every_page_sends_its_modules_under_the_version(self) -> None:
        prefix = f"/_v/{self.version}/"
        for rel, html in self.pages.items():
            imports = self.import_map(html)
            self.assertEqual(imports["/"], prefix, rel)
            # Without it a module already under /_v/ would be prefixed twice.
            self.assertEqual(imports["/_v/"], "/_v/", rel)
            self.assertEqual(imports["three"], f"{prefix}vendor/three.module.js", rel)

    def test_every_preload_and_src_names_a_file_the_image_has(self) -> None:
        prefix = f"/_v/{self.version}/"
        for rel, html in self.pages.items():
            hrefs = re.findall(r'<link rel="modulepreload" href="([^"]+)">', html)
            hrefs += re.findall(r'<script type="module" src="([^"]+)">', html)
            hrefs += re.findall(r'<link rel="stylesheet" href="([^"]+)">', html)
            self.assertTrue(hrefs, rel)
            for href in hrefs:
                self.assertTrue(href.startswith(prefix), (rel, href))
                self.assertTrue((self.dir / href[len(prefix):]).is_file(), (rel, href))

    def test_the_game_page_preloads_its_whole_graph(self) -> None:
        preloads = re.findall(r'<link rel="modulepreload" href="[^"]+/([^/"]+\.js)">',
                              self.pages["map.html"])
        # The page's own imports, a few of their imports, and three.
        for module in ("level-load.js", "world.js", "bot-pilot.js", "three.module.js"):
            self.assertIn(module, preloads)
        self.assertGreater(len(preloads), 300)

    def test_the_front_end_preloads_its_graph_and_not_the_game(self) -> None:
        html = self.pages["play/index.html"]
        preloads = re.findall(r'<link rel="modulepreload" href="([^"]+)">', html)
        self.assertIn(f"/_v/{self.version}/play/front-end.js", preloads)
        self.assertNotIn(f"/_v/{self.version}/world.js", preloads)

    def test_the_preloads_come_after_the_import_map(self) -> None:
        for rel, html in self.pages.items():
            first = html.find('rel="modulepreload"')
            self.assertGreater(first, html.index('<script type="importmap">'), rel)

    def test_the_version_follows_the_code(self) -> None:
        with tempfile.TemporaryDirectory() as other:
            dest = Path(other)
            copy_code(dest)
            (dest / "mods.js").write_text((dest / "mods.js").read_text() + "\n// changed\n")
            run = subprocess.run(["node", str(STAMP), str(dest)],
                                 capture_output=True, text=True, check=True)
            self.assertNotIn(self.version, run.stdout)

    def test_the_checkout_is_left_alone(self) -> None:
        self.assertNotIn("/_v/", (VIEWER / "map.html").read_text(encoding="utf-8"))


class VersionedPathTests(unittest.TestCase):
    """A module that resolves a URL against itself takes the version out,
    or the volume's files would be fetched under a URL every deploy moves."""

    def test_modules_resolve_the_root_through_viewer_root(self) -> None:
        offenders = []
        for path in list(VIEWER.glob("*.js")) + list(VIEWER.glob("play/*.js")):
            if path.name == "viewer-root.js":
                continue
            if "import.meta.url" in path.read_text(encoding="utf-8"):
                offenders.append(path.name)
        self.assertEqual(offenders, [], "use VIEWER_ROOT from viewer-root.js")

    @unittest.skipIf(shutil.which("node") is None, "node is not installed")
    def test_viewer_root_drops_the_version(self) -> None:
        script = (
            "const src = require('fs').readFileSync(process.argv[1], 'utf8');"
            "const expr = src.match(/import\\.meta\\.url(\\.replace\\([^;]+\\))\\)/)[1];"
            "const at = u => eval(JSON.stringify(u) + expr);"
            "console.log(at('https://play.bfstats.io/_v/0123456789ab/mods.js'));"
            "console.log(at('http://localhost:5273/mods.js'));"
        )
        out = subprocess.run(["node", "-e", script, str(VIEWER / "viewer-root.js")],
                             capture_output=True, text=True, check=True).stdout.split()
        self.assertEqual(out, ["https://play.bfstats.io/mods.js", "http://localhost:5273/mods.js"])


if __name__ == "__main__":
    unittest.main()
