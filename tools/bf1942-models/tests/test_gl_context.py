"""`viewer/gl-context.js` under node, through `gl_context_harness.mjs`.

The map page survives a lost WebGL context without a reload
(features/webgl-context-restore): it calls `preventDefault()` so the browser
may restore the context, asks for the restore itself, pauses only the 3D draw
while the world, the room and the audio keep running, re-links and re-uploads
what three forgot before drawing again, and puts up the Reload card only when
no restore comes.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS = HERE / "gl_context_harness.mjs"
MAP_HTML = HERE.parent / "viewer" / "map.html"


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    proc = subprocess.run(["node", str(HARNESS)], capture_output=True, text=True, timeout=60)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class GlContextGuardTests(unittest.TestCase):
    results: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.results = run_harness()

    def test_loss_pauses_drawing_and_lets_the_browser_restore(self) -> None:
        basic = self.results["basic"]
        self.assertTrue(basic["before"])
        self.assertEqual(basic["lost"], {"drawing": False, "down": True, "state": "lost",
                                         "prevented": True, "onLost": 1})

    def test_restore_is_asked_for_and_asked_again(self) -> None:
        basic = self.results["basic"]
        self.assertEqual(basic["beforeAsk"], 0)
        self.assertEqual(basic["firstAsk"], 1)
        self.assertEqual(basic["secondAsk"], 2)
        # Resumed: no more asks, and no card.
        self.assertEqual(basic["later"], {"fallback": 0, "restoreContext": 2})

    def test_drawing_resumes_only_after_the_warm_up(self) -> None:
        basic = self.results["basic"]
        self.assertEqual(basic["warming"], {"state": "warming", "drawing": False, "rewarm": 1})
        self.assertEqual(basic["after"]["state"], "live")
        self.assertEqual(basic["after"]["resumed"], [{"fellBack": False}])
        self.assertEqual(basic["history"], ["lost", "restored", "resumed"])
        self.assertEqual(self.results["waitsForWarm"], {"held": False, "released": True})

    def test_a_stuck_or_failing_warm_up_does_not_keep_the_page_dark(self) -> None:
        self.assertEqual(self.results["cap"], {"atCapMinus": False, "atCap": True, "how": "cap"})
        self.assertEqual(self.results["throws"], {"sync": True, "async": True})

    def test_card_only_when_no_restore_comes(self) -> None:
        fallback = self.results["fallback"]
        self.assertEqual((fallback["beforeCard"], fallback["card"], fallback["stillOne"]), (0, 1, 1))
        # A restore after the card still brings the picture back.
        self.assertTrue(fallback["drawing"])
        self.assertEqual(fallback["resumed"], [{"fellBack": True}])

    def test_a_second_loss_while_warming_wins(self) -> None:
        self.assertEqual(self.results["relost"],
                         {"staleResumed": False, "stateAfterStale": "lost", "final": True})

    def test_no_lose_context_extension(self) -> None:
        self.assertTrue(self.results["noExtension"]["drawing"])


class MapPageWiringTests(unittest.TestCase):
    """The page's half: the guard on the renderer's canvas, the 3D passes
    behind it, and the card only on the fallback."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.page = MAP_HTML.read_text()

    def test_only_the_3d_passes_wait_for_the_context(self) -> None:
        body = re.search(r"\nfunction draw\(dt\) \{\n(.*?)\n\}\n", self.page, re.S).group(1)
        self.assertIn("if (glContext.drawing()) draw3d();", body)
        self.assertNotIn("renderer.render", body)
        # The 2D surfaces still draw through a loss.
        self.assertIn("mapSurfaces.drawMinimap()", body)

    def test_restore_rewarms_what_the_page_draws(self) -> None:
        body = re.search(r"\nfunction rewarmAfterRestore\(\) \{\n(.*?)\n\}\n", self.page, re.S).group(1)
        for part in ("level.warmSubtree(scene)", "guns.warm()", "soldierKit.vmScene"):
            self.assertIn(part, body)

    def test_input_is_released_only_on_the_fallback(self) -> None:
        guard = re.search(r"const glContext = createGlContextGuard\(\{(.*?)\n\}\);", self.page, re.S).group(1)
        on_lost = re.search(r"onLost: (.*?),\n", guard).group(1)
        self.assertNotIn("release", on_lost)
        on_fallback = re.search(r"onFallback: \(\) => \{(.*?)\n  \},", guard, re.S).group(1)
        self.assertIn("pageInput.release()", on_fallback)
        self.assertIn("showGraphicsCard", on_fallback)


if __name__ == "__main__":
    unittest.main()
