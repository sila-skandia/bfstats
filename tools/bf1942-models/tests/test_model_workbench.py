"""The model inspector's Hit regions, Display and Model tabs
(features/mesh-viewer-advanced-tab).

`viewer/model-display-state.js` is the numbers behind each control: what the
texture opacity slider, Textures off, the wireframe and back faces do to a
material, and what each hit-region mode draws. It imports nothing, so
`model_workbench_harness.mjs` runs it under node and these pin the result.
The page half pins the markup: the tabs are out for everyone (no `data-dev`),
every control the modules look up by id is there, and the slider runs from
opaque down to nothing. `model_workbench_page.mjs` drives the real page
headless and is run by hand (it needs the models).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VIEWER = ROOT / "viewer"
HARNESS = Path(__file__).with_name("model_workbench_harness.mjs")
STATE = VIEWER / "model-display-state.js"
INDEX = VIEWER / "index.html"
INDEX_CSS = VIEWER / "index.css"
DISPLAY = VIEWER / "model-display.js"
ARMOUR = VIEWER / "model-armour.js"
TABS = VIEWER / "model-workbench.js"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        shutil.copyfile(STATE, work / STATE.name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class DisplayStateTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_the_default_is_the_model_as_extracted(self) -> None:
        d = self.r["defaults"]
        self.assertEqual(
            {"textures": True, "opacity": 1, "wireframe": False, "seeThrough": False,
             "doubleside": False, "explode": False, "explodeAmount": 0.5}, d)
        s = self.r["surface"]["defaultOpaque"]
        self.assertEqual("MAP", s["map"])
        self.assertFalse(s["transparent"])
        self.assertEqual(1, s["opacity"])
        self.assertTrue(s["depthWrite"])
        self.assertIsNone(s["prepass"])
        self.assertTrue(s["visible"])

    def test_textures_off_is_flat_grey(self) -> None:
        s = self.r["surface"]["texturesOff"]
        self.assertIsNone(s["map"])
        self.assertEqual(self.r["constants"]["FLAT_GREY"], s["color"])
        self.assertFalse(s["transparent"])

    def test_the_slider_fades_the_surface_and_keeps_its_nearest_face(self) -> None:
        # 40%: blended, depth write off, and a depth-only copy drawn first so
        # the hull is one skin rather than every back face stacked.
        s = self.r["surface"]["opaque40"]
        self.assertTrue(s["transparent"])
        self.assertAlmostEqual(0.4, s["opacity"])
        self.assertFalse(s["depthWrite"])
        self.assertEqual(self.r["constants"]["FRONT_SIDE"], s["side"])
        self.assertIsNotNone(s["prepass"])
        self.assertEqual(0, s["prepass"]["alphaTest"])
        self.assertIsNone(s["prepass"]["map"])

    def test_back_faces_drop_the_depth_copy_and_show_both_sides(self) -> None:
        s = self.r["surface"]["opaque40SeeThrough"]
        self.assertIsNone(s["prepass"])
        self.assertEqual(self.r["constants"]["DOUBLE_SIDE"], s["side"])
        # Back faces only mean something on a faded surface.
        self.assertEqual(self.r["constants"]["FRONT_SIDE"],
                         self.r["surface"]["defaultOpaque"]["side"])

    def test_zero_opacity_hides_the_surface(self) -> None:
        s = self.r["surface"]["opaqueZero"]
        self.assertFalse(s["visible"])
        self.assertIsNone(s["prepass"])

    def test_an_alpha_tested_cutout_keeps_its_holes(self) -> None:
        # three discards when texel.a * opacity < alphaTest, so the threshold
        # scales with the opacity or the whole cut-out vanishes when faded.
        s = self.r["surface"]["cutout40"]
        self.assertAlmostEqual(0.5 * 0.4, s["alphaTest"])
        self.assertAlmostEqual(0.4, s["opacity"])
        # Its depth copy keeps the map and the full threshold: holes in depth too.
        self.assertEqual("MAP", s["prepass"]["map"])
        self.assertAlmostEqual(0.5, s["prepass"]["alphaTest"])
        self.assertAlmostEqual(0.5, self.r["surface"]["cutoutOpaque"]["alphaTest"])

    def test_an_already_blended_material_keeps_its_own_blending(self) -> None:
        glass = self.r["surface"]["glass40"]
        self.assertAlmostEqual(0.6 * 0.4, glass["opacity"])
        self.assertFalse(glass["depthWrite"])
        self.assertIsNone(glass["prepass"])   # a depth copy of glass hides what is behind it
        opaque = self.r["surface"]["glassOpaque"]
        self.assertTrue(opaque["transparent"])
        self.assertAlmostEqual(0.6, opaque["opacity"])
        flash = self.r["surface"]["flash40"]
        self.assertTrue(self.r["snapshot"]["flash"]["additive"])
        self.assertIsNone(flash["prepass"])
        self.assertTrue(flash["depthWrite"])   # its own, untouched

    def test_the_wireframe_pushes_the_surface_back(self) -> None:
        self.assertTrue(self.r["surface"]["wireOpaque"]["polygonOffset"])
        self.assertTrue(self.r["surface"]["opaque40Wire"]["polygonOffset"])
        self.assertFalse(self.r["surface"]["defaultOpaque"]["polygonOffset"])

    def test_the_edges_overlay(self) -> None:
        w = self.r["wire"]
        self.assertFalse(w["off"]["visible"])
        self.assertTrue(w["on"]["visible"])
        self.assertTrue(w["on"]["depthTest"])          # only the edges you could see
        self.assertFalse(w["seeThrough"]["depthTest"])  # every edge
        self.assertGreater(w["faint"]["opacity"], w["on"]["opacity"])
        self.assertFalse(w["hidden"]["visible"])

    def test_double_sided(self) -> None:
        self.assertEqual(self.r["constants"]["DOUBLE_SIDE"], self.r["surface"]["doubleside"]["side"])

    def test_regions_only_hides_the_model(self) -> None:
        self.assertFalse(self.r["surface"]["hidden"]["visible"])
        self.assertIsNone(self.r["surface"]["hidden"]["prepass"])

    def test_the_slider_value(self) -> None:
        c = self.r["clamp"]
        self.assertEqual(1, c["over"])
        self.assertEqual(0, c["under"])
        self.assertAlmostEqual(0.4, c["text"])
        self.assertEqual(1, c["junk"])
        self.assertAlmostEqual(0.4, c["step"])
        self.assertEqual(["40%", "0%", "100%"], [c["label40"], c["label0"], c["label100"]])

    def test_region_modes(self) -> None:
        r = self.r["regions"]
        self.assertEqual(["off", "overlay", "only"], self.r["constants"]["REGION_MODES"])
        self.assertFalse(r["off"]["show"])
        self.assertTrue(r["overlay"]["show"])
        self.assertFalse(r["overlay"]["hideModel"])
        self.assertTrue(r["only"]["hideModel"])
        self.assertLess(r["overlay"]["opacity"], r["only"]["opacity"])
        self.assertEqual("off", r["unknown"]["mode"])
        self.assertAlmostEqual(0.75, r["overlay75"]["opacity"])
        self.assertAlmostEqual(0.1, r["floor"]["opacity"])

    def test_the_old_checkbox_hook_maps_onto_a_mode(self) -> None:
        # shoot.mjs --collision and the ?shots checks call setCollision(true).
        m = self.r["modeOf"]
        self.assertEqual("overlay", m["yes"])
        self.assertEqual("off", m["no"])
        self.assertEqual("off", m["nil"])
        self.assertEqual("only", m["only"])
        self.assertEqual("off", m["junk"])

    def test_tabs(self) -> None:
        self.assertEqual(["regions", "display", "model"], self.r["constants"]["WORKBENCH_TABS"])
        t = self.r["tabs"]
        self.assertEqual("regions", t["none"])
        self.assertEqual("display", t["display"])
        self.assertEqual("regions", t["junk"])


class PageMarkupTests(unittest.TestCase):
    html: str

    @classmethod
    def setUpClass(cls) -> None:
        cls.html = INDEX.read_text()

    def test_nothing_on_the_page_hides_behind_dev(self) -> None:
        self.assertIsNone(re.search(r"<\w[^>]*\sdata-dev\b", self.html))

    def test_three_tabs_each_controlling_its_panel(self) -> None:
        self.assertIn('role="tablist"', self.html)
        for name in ("regions", "display", "model"):
            tab = re.search(rf'<button[^>]*id="wb-tab-{name}"[^>]*>', self.html)
            self.assertIsNotNone(tab, name)
            self.assertIn('role="tab"', tab.group(0))
            self.assertIn(f'aria-controls="wb-{name}"', tab.group(0))
            self.assertRegex(self.html, rf'id="wb-{name}" role="tabpanel"')
        # The visitor's default: Hit regions open, the others closed.
        self.assertRegex(self.html, r'id="wb-tab-regions"[^>]*aria-selected="true"')
        self.assertRegex(self.html, r'id="wb-display"[^>]*hidden')
        self.assertRegex(self.html, r'id="wb-model"[^>]*hidden')

    def test_every_control_the_modules_look_up_is_there(self) -> None:
        sources = DISPLAY.read_text() + ARMOUR.read_text() + TABS.read_text()
        ids = set(re.findall(r"getElementById\('([\w-]+)'\)", sources))
        # Built by renderHitPanel when a shot is placed, not in the markup.
        built = {"angle-output", "angle-range", "impact-value", "impact-label", "damage-basis",
                 "impact-formula", "hp-loss", "hp-note", "distance-range", "distance-output"}
        for id_ in sorted(ids - built):
            with self.subTest(id_):
                self.assertIn(f'id="{id_}"', self.html)

    def test_the_texture_opacity_slider(self) -> None:
        slider = re.search(r'<input[^>]*id="texture-opacity"[^>]*>', self.html).group(0)
        self.assertIn('type="range"', slider)
        self.assertIn('min="0"', slider)
        self.assertIn('max="1"', slider)
        self.assertIn('value="1"', slider)
        self.assertRegex(self.html, r'<label[^>]*for="texture-opacity"[^>]*>Texture opacity</label>')

    def test_textures_off_says_it_plainly(self) -> None:
        seg = re.search(r'id="textures-seg".*?</div>', self.html, re.S).group(0)
        self.assertIn('data-value="on"', seg)
        self.assertIn('data-value="off"', seg)
        self.assertIn("flat grey", seg)

    def test_the_region_modes_are_the_modules_modes(self) -> None:
        seg = re.search(r'id="regions-seg".*?</div>', self.html, re.S).group(0)
        self.assertEqual(["off", "overlay", "only"], re.findall(r'data-mode="(\w+)"', seg))

    def test_the_tab_strip_sticks_and_has_phone_targets(self) -> None:
        css = INDEX_CSS.read_text()
        self.assertRegex(css, r"\.wb-tabs \{[^}]*position: sticky")
        phone = css[css.index("@media (max-width: 720px)"):]
        self.assertRegex(phone, r"\.wb-chip \{ min-height: 3\dpx; \}")

    def test_no_emoji(self) -> None:
        for path in (INDEX, INDEX_CSS, DISPLAY, ARMOUR, TABS, STATE):
            text = path.read_text()
            self.assertIsNone(re.search(r"[\U0001F300-\U0001FAFF☀-➿]", text), path.name)


if __name__ == "__main__":
    unittest.main()
