"""`viewer/map-art-frame.js` -- the open map's framing of a level's map art,
driven headless by `map_art_frame_harness.mjs`.

Some levels' `InGameMap` is not a map edge to edge: FHSW's Tunis 1943 draws
its ground in the lower half of a 512x512 art and leaves the upper half solid
black, and 164 of the 992 exported levels carry such a margin
(`features/authentic-spawn-map` section 19). Retail draws the whole texture
into the spawn map's square, so the map hangs off one edge of the pane under a
black band. The viewer (an INVENTION, labelled in the module) trims the black
margin and shows a square window of the art centred on what is left, on the
deploy screen and the M map. These tests pin the trim, the window and the
surface <-> art mapping the ring clicks go through.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("map_art_frame_harness.mjs")
MODULES = {"map-art-frame.js": VIEWER / "map-art-frame.js"}


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for source in MODULES.values():
        if not source.exists():
            raise unittest.SkipTest(f"{source.name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name, source in MODULES.items():
            shutil.copyfile(source, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class MapArtFrameTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def assertWindow(self, expected: tuple[float, float, float], got: dict) -> None:
        for key, want in zip(("u0", "v0", "span"), expected):
            self.assertAlmostEqual(want, got[key], places=6, msg=f"{key} of {got}")

    def assertRect(self, expected: tuple[float, float, float, float], got: dict) -> None:
        for key, want in zip(("u0", "v0", "u1", "v1"), expected):
            self.assertAlmostEqual(want, got[key], places=6, msg=f"{key} of {got}")

    # ---- the content rect ----------------------------------------------------

    def test_tunis_lower_half_is_the_content(self) -> None:
        # Noise under the black threshold and one bright texel a row in the
        # margin do not make a margin row count as map.
        self.assertRect((0, 0.5, 1, 1), self.results["tunis"]["rect"])

    def test_an_edge_to_edge_map_is_whole(self) -> None:
        self.assertRect((0, 0, 1, 1), self.results["full"]["rect"])

    def test_a_corner_map(self) -> None:
        self.assertRect((0, 0, 0.5, 0.375), self.results["corner"]["rect"])

    def test_an_all_black_art_has_no_content(self) -> None:
        self.assertIsNone(self.results["black"]["rect"])

    def test_a_non_square_art_is_read_on_its_own_axes(self) -> None:
        self.assertRect((0, 0.5, 1, 1), self.results["nonSquare"]["rect"])

    def test_bad_input_is_no_content(self) -> None:
        bad = self.results["bad"]
        self.assertIsNone(bad["nullData"])
        self.assertIsNone(bad["short"])
        self.assertIsNone(bad["zeroSize"])

    # ---- the window ----------------------------------------------------------

    def test_tunis_is_centred_in_the_pane(self) -> None:
        # The content is the full width, so the window is the whole width and
        # slides up a quarter: the lower-half map sits in the middle, the
        # backdrop a quarter above and a quarter below it.
        self.assertWindow((0, 0.25, 1), self.results["tunis"]["window"])

    def test_retail_framing_where_the_art_is_a_map_edge_to_edge(self) -> None:
        whole = (0, 0, 1)
        self.assertWindow(whole, self.results["full"]["window"])
        # A one-texel black seam and a black DXT block inside: a sliver, not a
        # margin, so these levels draw exactly as before.
        self.assertWindow(whole, self.results["seam"]["window"])
        self.assertWindow(whole, self.results["black"]["window"])
        self.assertWindow(whole, self.results["bad"]["nullRect"])
        self.assertWindow(whole, self.results["bad"]["emptyRect"])

    def test_a_band_already_centred_stays_put(self) -> None:
        self.assertWindow((0, 0, 1), self.results["middleBand"]["window"])

    def test_a_small_map_fills_the_pane(self) -> None:
        # 256x192 in the top-left corner: the window is its longer side, half
        # the art, centred on it, hanging a sixteenth of the art above it.
        self.assertWindow((0, -0.0625, 0.5), self.results["corner"]["window"])

    def test_a_column_is_centred_across(self) -> None:
        self.assertWindow((0.3125, 0, 1), self.results["rightColumn"]["window"])

    # ---- surface <-> art ------------------------------------------------------

    def test_the_mapping_under_the_tunis_window(self) -> None:
        m = self.results["mapping"]
        self.assertAlmostEqual(0.5, m["centre"]["u"])
        self.assertAlmostEqual(0.75, m["centre"]["v"])
        self.assertAlmostEqual(0.25, m["topLeft"]["v"])
        self.assertAlmostEqual(1.25, m["bottomRight"]["v"])
        self.assertAlmostEqual(0.25, m["contentTop"]["fy"])
        self.assertAlmostEqual(0.75, m["contentBottom"]["fy"])
        self.assertAlmostEqual(0.3, m["roundTrip"]["fx"])
        self.assertAlmostEqual(0.7, m["roundTrip"]["fy"])
        self.assertAlmostEqual(0.25, m["wholeIdentity"]["u"])
        self.assertAlmostEqual(0.75, m["wholeIdentity"]["v"])


if __name__ == "__main__":
    unittest.main()
