"""`viewer/progress.js`'s mission-briefing handshake, driven headless by
`load_briefing_harness.mjs`.

The game's load flow is two screens: the fullscreen splash while the level
streams, then — over the live 3D scene — the mission-briefing screen (map
name, the two team flags, the game type, the settings block, the
OBJECTIVES/COMMENTS boxes) with a READY button that gates the join and keeps
the loading music playing. The screen's pixels are `briefing-screen.js`'s
canvas (the game's own mp_briefing plate, bitmap faces and knapp plates);
`progress.js` hosts it, forwards `load.briefing(...)` to it, parks the overlay
in the `briefing` state at `end()` instead of concealing, and keeps the READY
hit area — the invisible button the module lays over the drawn plate. Pinned
here:

  * the authentic overlay hosts the briefing module's canvas and the READY
    hit button, and carries no DOM briefing dialog;
  * `load.briefing(...)` forwards its payload (name, game type, flags) to the
    module's paint, `null` clears it, and garbage never reaches it;
  * `end()` on the authentic placement lays the screen out, flips the overlay
    to `briefing` and hands back a promise; READY fires `onReady` exactly
    once, clears the state, settles the promise, and relays hover. The corner
    placement (no briefing module) keeps the old done-means-gone behaviour.

The DOM stub is minimal (`dataset`, recorded listeners), so this pins wiring
and state, not pixels. The pixels are the live browser pass in
`features/briefing-screen/README.md` — the plate at (144, 81) with the game's
faces on it, checked against a stock Wake capture.
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

    def test_the_overlay_hosts_the_canvas_and_hit_button(self) -> None:
        r = self.results
        self.assertTrue(r["markupNoDomDialog"])
        self.assertTrue(r["markupHasHitButton"])

    def test_the_old_splash_panel_is_gone(self) -> None:
        r = self.results
        self.assertTrue(r["markupNoSplashPanel"])
        self.assertTrue(r["markupNoHeading"])

    def test_briefing_data_is_forwarded_to_the_module(self) -> None:
        r = self.results
        self.assertTrue(r["handleHasBriefing"])
        self.assertEqual(r["paintForwardedName"], "WAKE ISLAND")
        self.assertEqual(r["paintForwardedFlags"], "maps/_shared/hud/flag_ticket_jp.png")

    def test_briefing_survives_null_and_garbage(self) -> None:
        r = self.results
        self.assertTrue(r["paintCleared"])
        self.assertTrue(r["paintSurvivesEmpty"])

    def test_end_parks_on_the_briefing_screen_until_ready(self) -> None:
        r = self.results
        self.assertTrue(r["endReturnsPromise"])
        self.assertTrue(r["stateBriefing"])
        self.assertTrue(r["layoutRan"])
        self.assertTrue(r["paintRanOnEnd"])
        self.assertTrue(r["readyFiresOnReady"])
        self.assertTrue(r["readyClearsState"])
        self.assertTrue(r["hoverRelayed"])

    def test_corner_placement_still_conceals_on_end(self) -> None:
        self.assertTrue(self.results["cornerEndConceals"])


if __name__ == "__main__":
    unittest.main()