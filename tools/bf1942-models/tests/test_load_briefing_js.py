"""`viewer/progress.js`'s mission-briefing screen, driven headless by
`load_briefing_harness.mjs`.

The game's load flow is two screens: the fullscreen splash while the level
streams, then — over the live 3D scene — the mission-briefing dialog (map
name, the two team flags, the game type, the settings block, the
OBJECTIVES/COMMENTS boxes) with a READY button that gates the join and keeps
the loading music playing. `progress.js` draws it on the same overlay:
`load.briefing(...)` fills it, `end()` parks the overlay in the `briefing`
state instead of concealing, and READY (the game's own `knapp3` plates) fades
the music, fires the page's `onReady` and resolves. Pinned here:

  * the authentic screen's markup carries the dialog (name, mode, settings,
    both bands, two flags) and the READY button, and no longer the old
    splash-borne MISSION BRIEFING panel;
  * `load.briefing(...)` fills the dialog (name, joined game-type line,
    objectives text, empty comments, per-side flags) and survives data, null,
    undefined and an object with none of the fields;
  * `end()` on the authentic placement flips the overlay to `briefing` and
    hands back a promise; READY fires `onReady` exactly once, clears the
    state, and settles the promise. The corner placement keeps the old
    done-means-gone behaviour.

The DOM stub is minimal (`dataset`, `textContent`, `style.setProperty`,
recorded listeners), so this pins wiring and state, not layout. The layout
check is the live browser pass in `features/briefing-screen/README.md` —
plate at (144, 81) in the 800x600 stage, no clipping at Wake's 322-char
objectives text, READY row 421..458.
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


class LoadBriefingScreenTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_the_authentic_screen_carries_the_dialog_and_ready(self) -> None:
        r = self.results
        self.assertTrue(r["markupHasDialog"])
        self.assertTrue(r["markupHasBands"])
        self.assertTrue(r["markupHasReady"])
        self.assertTrue(r["markupHasFlags"])

    def test_the_old_splash_panel_is_gone(self) -> None:
        r = self.results
        self.assertTrue(r["markupNoSplashPanel"])
        self.assertTrue(r["markupNoHeading"])

    def test_briefing_data_fills_the_dialog(self) -> None:
        r = self.results
        self.assertEqual(r["dialogName"], "WAKE ISLAND")
        self.assertEqual(r["dialogMode"], "CONQUEST - ASSAULT MAP")
        self.assertEqual(r["dialogObjectives"], "This is a Conquest: Assault map.")
        self.assertTrue(r["dialogCommentsEmpty"])
        self.assertTrue(r["dialogFirstFlagShown"])
        self.assertTrue(r["dialogSecondFlagHidden"])
        self.assertEqual(r["settingsRows"], 3)

    def test_briefing_survives_null_and_garbage(self) -> None:
        r = self.results
        self.assertTrue(r["handleHasBriefing"])
        self.assertTrue(r["cornerHasBriefing"])
        self.assertTrue(r["dialogCleared"])

    def test_end_parks_on_the_briefing_screen_until_ready(self) -> None:
        r = self.results
        self.assertTrue(r["endReturnsPromise"])
        self.assertTrue(r["stateBriefing"])
        self.assertTrue(r["readyFiresOnReady"])
        self.assertTrue(r["readyClearsState"])

    def test_corner_placement_still_conceals_on_end(self) -> None:
        self.assertTrue(self.results["cornerEndConceals"])


if __name__ == "__main__":
    unittest.main()
