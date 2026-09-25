"""`viewer/progress.js`'s MISSION BRIEFING panel, driven headless by
`load_briefing_harness.mjs`.

The panel is a third region of the authentic loading overlay (the menu_loading
plate and the escape prompt are the other two), fed by `load.briefing(...)` off
the report's `briefing` object (`scene.json`'s `game` layer, Gap 14's
`Menu/Init.con` trio). Pinned here:

  * the authentic screen's markup carries the panel, heading and map-type
    badge, and starts empty (`data-empty="true"`), so a report without a
    briefing — every tree written before this, and a level whose con ships no
    trio — shows exactly the overlay that shipped before;
  * the load handle exposes `briefing()` on both placements, and it survives
    data, null, undefined and an object with none of the fields.

The DOM stub is minimal (`dataset`, `textContent`, `style.setProperty`), so
this pins wiring and null-safety, not layout. The layout check is the live
browser pass done at build time (panel centred on the menu_loading plate,
464 px wide, no clipping at Wake's 322-char text) — re-run it by serving
`viewer/` and loading any map page.
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
HARNESS = Path(__file__).with_name("load_briefing_harness.mjs")
# progress.js pulls audio.js, which pulls loading-audio-ui.js: all three are
# copied so the harness imports the real files.
MODULES = ["progress.js", "audio.js", "loading-audio-ui.js"]


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    for name in MODULES:
        if not (VIEWER / name).exists():
            raise unittest.SkipTest(f"{name} is not in the tree")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(
            ["node", str(work / "harness.mjs")],
            capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class LoadBriefingPanelTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_authentic_screen_carries_the_panel(self) -> None:
        self.assertTrue(self.results["markupHasPanel"])
        self.assertTrue(self.results["markupHeading"])
        self.assertTrue(self.results["markupType"])

    def test_the_panel_starts_empty(self) -> None:
        self.assertTrue(self.results["markupEmptyDefault"])

    def test_the_load_handle_exposes_briefing_on_both_placements(self) -> None:
        self.assertTrue(self.results["handleHasBriefing"])
        self.assertTrue(self.results["cornerHasBriefing"])


if __name__ == "__main__":
    unittest.main()
