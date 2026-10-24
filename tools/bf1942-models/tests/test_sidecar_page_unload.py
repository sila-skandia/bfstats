"""A page that stays after the browser asks to leave is still on the server.

Crouch is left Ctrl and reload is R, so a crouched reload is the browser's
Ctrl+R. Mid-play `viewer/page-input.js` answers the beforeunload with the
"leave site?" prompt. `viewer/net-room.js` used to tear the room down on the
same beforeunload: the leave went to the sidecar and the socket closed before
the prompt was answered, so a player who chose to stay had an empty field and
scoreboard, no modal, and a sidecar idling on the server. The owner saw it
right after a kill with the No4 on BF1942-AUSTRALIA (2026-10-24, sidecar.log:
"the page left", two socket closes, no reconnect). Reproduced headless against
a fake sidecar replaying that run: a reload whose prompt is dismissed left the
page disconnected before this change and connected after it.

The teardown now runs on `pagehide`, which fires only when the page really
goes (features/udp-sidecar/wire.md section 43).
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

VIEWER = Path(__file__).resolve().parent.parent / "viewer"


class PageUnloadTests(unittest.TestCase):
    def test_the_room_is_left_on_pagehide_not_beforeunload(self) -> None:
        src = (VIEWER / "net-room.js").read_text()
        code = re.sub(r"//[^\n]*", "", src)
        self.assertNotRegex(code, r"addEventListener\(\s*'beforeunload'",
                            "a beforeunload teardown leaves the server even when the player stays")
        self.assertRegex(code, r"addEventListener\(\s*'pagehide'\s*,[^\n]*netTeardownRoom")

    def test_only_the_prompt_listens_for_beforeunload(self) -> None:
        # Whatever answers beforeunload runs before the player has decided;
        # the prompt is the one listener that may.
        hits = []
        for path in VIEWER.glob("*.js"):
            code = re.sub(r"//[^\n]*", "", path.read_text())
            if re.search(r"addEventListener\(\s*'beforeunload'", code):
                hits.append(path.name)
        self.assertEqual(hits, ["page-input.js"])


if __name__ == "__main__":
    unittest.main()
