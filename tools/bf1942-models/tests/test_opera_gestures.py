"""Opera's mouse gestures and the right mouse button -- report #10 of
features/browser-play-feedback-2026-11-06.

A first-time player in Opera held the right button to zoom (`c_PIAltFire`),
moved the mouse down, and Opera's default "new tab" gesture took the window,
three times in one round. A page cannot cancel the gesture, so:

  - `viewer/opera-gestures.js` knows Opera (client hints' "Opera" / "Opera GX"
    brand, or `OPR/` in the UA) and, the first time the page takes the mouse
    in play, shows a card saying where Opera turns mouse and rocker gestures
    off instead of capturing; its button captures. The dismissal is kept in
    localStorage (and in memory when storage is off).
  - a page that went hidden in play with the right button held shows the card
    again on return, dismissed or not;
  - while captured, `viewer/page-input.js` takes the default away from every
    button's down, up and auxclick on the game's own presses, and from the
    context menu anywhere, but never from a field, a touch, or uncaptured;
  - the beforeunload prompt guards seated play as well as on foot.

Driven headless by `opera_gestures_harness.mjs` over the real modules.
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
HARNESS = Path(__file__).with_name("opera_gestures_harness.mjs")
MODULES = ("opera-gestures.js", "page-input.js", "console.js", "console-view.js",
           "touch-controls.js", "kit-icon.js", "pointer-route.js")
TYPES = ("pointerdown", "pointerup", "mousedown", "mouseup", "auxclick", "contextmenu")


def run_harness() -> dict:
    if shutil.which("node") is None:
        raise unittest.SkipTest("node is not installed")
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        for name in MODULES:
            shutil.copyfile(VIEWER / name, work / name)
        (work / "package.json").write_text('{"type":"module"}\n')
        shutil.copyfile(HARNESS, work / "harness.mjs")
        proc = subprocess.run(["node", str(work / "harness.mjs")],
                              capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise AssertionError(f"harness failed:\n{proc.stderr}")
    return json.loads(proc.stdout)


class OperaGestureTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_opera_is_known_by_brand_or_ua(self) -> None:
        d = self.r["detect"]
        self.assertTrue(d["operaBrand"])
        self.assertTrue(d["operaGxBrand"])
        self.assertTrue(d["oprUa"])
        self.assertFalse(d["chrome"])
        self.assertFalse(d["firefox"])
        self.assertFalse(d["operaInName"])
        self.assertFalse(d["none"])

    def test_the_card_names_both_settings_and_german_names_them_too(self) -> None:
        en, de = self.r["text"]["en"], self.r["text"]["de"]
        self.assertIn("Mouse gestures", en["steps"])
        self.assertIn("Rocker gestures", en["steps"])
        self.assertIn("Shortcuts", en["steps"])
        self.assertNotIn("Mausgesten", en["steps"])
        self.assertIn("Mausgesten", de["steps"])
        self.assertIn("Wippgesten", de["steps"])
        self.assertEqual(self.r["text"]["returned"]["title"], "OPERA TOOK THE MOUSE")

    def test_shown_once_in_play_then_remembered(self) -> None:
        h = self.r["hint"]
        self.assertTrue(h["enabled"])
        self.assertFalse(h["freeCamGate"])
        self.assertTrue(h["firstGate"])
        self.assertEqual(h["cardBuilt"], 1)
        self.assertTrue(h["visible"])
        self.assertTrue(h["gateWhileUp"])
        self.assertEqual(h["afterAccept"], {"accepted": 1, "visible": False,
                                            "dismissed": True, "stored": "1"})
        self.assertFalse(h["gateAfterDismiss"])
        self.assertEqual(self.r["reload"], {"dismissed": True, "gate": False})

    def test_storage_off_still_dismisses_for_the_page_load(self) -> None:
        self.assertEqual(self.r["storageOff"], {"first": True, "dismissed": True, "second": False})

    def test_comes_back_only_after_hidden_in_play_with_right_held(self) -> None:
        h = self.r["hint"]
        self.assertFalse(h["hiddenWithoutRight"])
        self.assertFalse(h["visibleNoPending"])
        self.assertFalse(h["hiddenFreeCam"])
        self.assertTrue(h["hiddenInPlayRight"])
        self.assertTrue(h["comeback"])
        self.assertEqual(h["comebackTitle"], "OPERA TOOK THE MOUSE")
        self.assertEqual(h["cardsAfterComeback"], 1)
        self.assertEqual(h["afterComeback"], {"accepted": 2, "visible": False, "pending": False})

    def test_never_for_other_browsers_or_phones(self) -> None:
        self.assertEqual(self.r["chromeHint"], {"enabled": False, "gate": False,
                                                "hidden": False, "visible": False})
        self.assertEqual(self.r["phoneHint"], {"enabled": False, "gate": False})
        self.assertEqual(self.r["chrome"], {"enabled": False, "captured": True, "cards": 0})


class PageWiringTests(unittest.TestCase):
    r: dict

    @classmethod
    def setUpClass(cls) -> None:
        cls.r = run_harness()

    def test_beforeunload_guards_seated_play_too(self) -> None:
        self.assertEqual(self.r["unload"], {"uncaptured": False, "onFoot": True, "seated": True,
                                            "freeCam": False, "seatedReleased": False})

    def test_presses_are_prevented_only_while_captured(self) -> None:
        h = self.r["handlers"]
        self.assertTrue(h["capturedCaptured"])
        for t in TYPES:
            self.assertFalse(h["uncaptured"][t], t)
            self.assertTrue(h["canvasRight"][t], t)
            self.assertTrue(h["canvasSide"][t], t)
            self.assertFalse(h["released"][t], t)

    def test_fields_touch_and_other_targets_keep_their_defaults(self) -> None:
        h = self.r["handlers"]
        for t in TYPES:
            self.assertFalse(h["unlockedField"][t], t)
        self.assertFalse(h["unlockedOther"])
        self.assertTrue(h["lockedOther"])
        self.assertFalse(h["touch"])
        self.assertFalse(h["touchCompat"])
        self.assertTrue(h["fieldBlurred"])

    def test_first_capture_in_play_waits_for_the_card(self) -> None:
        o = self.r["opera"]
        self.assertTrue(o["enabled"])
        self.assertEqual(o["firstCapture"], {"captured": False, "visible": True, "cards": 1})
        self.assertFalse(o["secondCaptureWhileUp"])
        self.assertEqual(o["afterOk"], {"captured": True, "visible": False, "stored": "1"})
        self.assertEqual(o["nextCapture"], {"captured": True, "visible": False})
        self.assertEqual(o["freeCam"], {"captured": True, "visible": False})

    def test_hidden_with_right_held_brings_the_card_back(self) -> None:
        o = self.r["opera"]
        self.assertTrue(o["rightDown"])
        self.assertTrue(o["pendingWhileHidden"])
        self.assertEqual(o["onReturn"], {"captured": False, "visible": True, "rightDown": False,
                                         "title": "OPERA TOOK THE MOUSE"})
        self.assertEqual(o["afterReturnOk"], {"captured": True, "visible": False})
        self.assertEqual(o["plainTabSwitch"], {"captured": True, "visible": False})


if __name__ == "__main__":
    unittest.main()
